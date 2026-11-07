// Accord 서버(server.js)를 자식 프로세스로 띄우고 관리한다. CLI(scripts/accord-server.js)와 서버 앱(server-app/main.js)이 같이 쓴다.
// - 서버와는 IPC 로만 이야기한다(네트워크로 여는 관리 창구 없음).
// - 켜진 뒤 예기치 않게 꺼지면 점점 늦게(1→2→4…30초) 다시 띄운다. 켜지기도 전에 죽으면(포트 충돌 등) 재시작하지 않고 이유를 알린다.
const { fork } = require("node:child_process");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");

const SERVER_JS = path.join(__dirname, "..", "server.js");
const LOG_LIMIT = 500;
const STOP_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;

// 기본 실행기(CLI): Node 로 fork 해서 IPC 로 이야기한다.
// 서버 앱은 Electron utilityProcess 를 넘긴다 — 윈도우에서 GUI 실행 파일을 그냥 띄우면 모래시계 커서가 뜨기 때문.
// 실행기는 { send(msg), kill(force), stdout, stderr, on("message"|"exit", fn) } 를 돌려준다.
function forkNode(file, env) {
  const child = fork(file, [], {
    cwd: path.dirname(file),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  child.on("error", () => {}); // 실패는 exit 으로 같이 처리된다
  return {
    send: (msg) => child.connected && child.send(msg),
    kill: (force) => child.kill(force ? "SIGKILL" : "SIGTERM"),
    stdout: child.stdout,
    stderr: child.stderr,
    on: (event, fn) => child.on(event, fn),
  };
}

class ServerHost extends EventEmitter {
  constructor({ launch = forkNode } = {}) {
    super();
    this.launch = launch;
    this.state = "stopped"; // stopped | starting | running | stopping
    this.info = null; // { version, port, protocol, urls }
    this.error = "";
    this.logs = [];
    this.child = null;
    this.env = {};
    this.pending = new Map();
    this.nextId = 1;
    this.crashes = 0;
    this.readyAt = 0;
    this.restartTimer = null;
  }

  start(env = this.env) {
    if (this.child || this.state === "starting" || this.state === "running") return;
    clearTimeout(this.restartTimer);
    this.env = env;
    this.error = "";
    this.setState("starting");
    const child = this.launch(SERVER_JS, { ...env, ACCORD_HOST: "1" }); // ACCORD_HOST: 서버가 호스트 IPC 를 여는 표시
    this.child = child;
    for (const stream of [child.stdout, child.stderr]) {
      let rest = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) this.log(line);
      });
    }
    child.on("message", (msg) => this.onMessage(msg));
    child.on("exit", (code, signal) => this.onExit(code, signal));
  }

  async stop() {
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) {
      this.setState("stopped");
      return;
    }
    this.setState("stopping");
    const exited = new Promise((resolve) => this.once("exited", resolve));
    this.request("host:shutdown").catch(() => {});
    // 응답이 없으면 강제로(멈춘 서버는 SIGTERM 핸들러도 못 돌리니 2초 뒤 SIGKILL)
    const soft = setTimeout(() => child.kill(false), STOP_TIMEOUT_MS);
    const hard = setTimeout(() => child.kill(true), STOP_TIMEOUT_MS + 2000);
    await exited;
    clearTimeout(soft);
    clearTimeout(hard);
  }

  async restart(env = this.env) {
    await this.stop();
    this.start(env);
  }

  request(type, payload = {}) {
    const child = this.child;
    if (!child || (this.state !== "running" && type !== "host:shutdown")) {
      return Promise.reject(new Error("서버가 켜져 있지 않습니다."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("서버가 응답하지 않습니다."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ ...payload, type, id });
    });
  }

  onMessage(msg) {
    if (msg?.type === "host:ready") {
      if (this.state !== "starting") return; // 켜지는 도중 끄기를 눌렀으면 늦게 온 ready 는 무시(안 그러면 끄는 걸 크래시로 보고 다시 켠다)
      this.readyAt = Date.now();
      this.info = { version: msg.version, port: msg.port, protocol: msg.protocol, urls: serverUrls(msg.protocol, msg.port) };
      this.setState("running");
      return;
    }
    const waiter = this.pending.get(msg?.replyTo);
    if (!waiter) return;
    this.pending.delete(msg.replyTo);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error(msg.error));
    else waiter.resolve(msg);
  }

  onExit(code, signal) {
    const was = this.state;
    this.child = null;
    this.emit("exited");
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("서버가 꺼졌습니다."));
    }
    this.pending.clear();
    if (was === "stopping") {
      this.setState("stopped");
      return;
    }
    if (was === "starting") {
      this.error = startFailureReason(this.logs, this.env.PORT);
      this.setState("stopped");
      return;
    }
    // 켜져 있다가 죽었다 → 1분 넘게 잘 돌았으면 처음부터, 아니면 점점 늦게 다시 띄운다.
    if (Date.now() - this.readyAt > 60000) this.crashes = 0;
    const delay = Math.min(30000, 1000 * 2 ** this.crashes++);
    this.log(`서버가 예기치 않게 꺼졌습니다(${signal || `코드 ${code}`}). ${delay / 1000}초 뒤 다시 켭니다.`);
    this.setState("starting");
    this.restartTimer = setTimeout(() => {
      this.state = "stopped";
      this.start();
    }, delay);
  }

  log(line) {
    this.logs.push(line);
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    this.emit("log", line);
  }

  setState(state) {
    this.state = state;
    if (state !== "running") this.info = null;
    this.emit("state", this.snapshot());
  }

  snapshot() {
    return { state: this.state, info: this.info, error: this.error };
  }
}

function serverUrls(protocol, port) {
  const urls = [{ label: "이 컴퓨터", url: `${protocol}://localhost:${port}` }];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) urls.push({ label: "같은 네트워크", url: `${protocol}://${item.address}:${port}` });
    }
  }
  return urls;
}

function startFailureReason(logs, port) {
  const text = logs.slice(-30).join("\n");
  if (text.includes("EADDRINUSE")) return `포트 ${port || 25565}을(를) 다른 프로그램이 쓰고 있습니다. 설정에서 포트를 바꿔 주세요.`;
  if (text.includes("EACCES")) return `포트 ${port || 25565}을(를) 열 권한이 없습니다. 1024 이상의 포트를 써 주세요.`;
  const last = logs.filter(Boolean).slice(-1)[0];
  return last ? `서버를 켜지 못했습니다: ${last}` : "서버를 켜지 못했습니다.";
}

module.exports = { ServerHost };
