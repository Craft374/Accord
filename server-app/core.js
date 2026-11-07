// Accord 서버(server.js)를 자식 프로세스로 띄우고 관리한다. CLI(scripts/accord-server.js)와 서버 앱(server-app/main.js)이 같이 쓴다.
// - 서버와는 IPC 로만 이야기한다(네트워크로 여는 관리 창구 없음).
// - 켜진 뒤 예기치 않게 꺼지면 점점 늦게(1→2→4…30초) 다시 띄운다. 켜지기도 전에 죽으면(포트 충돌 등) 재시작하지 않고 이유를 알린다.
const { fork, spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SERVER_JS = path.join(__dirname, "..", "server.js");
const LOG_LIMIT = 500;
const STOP_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;

// 접속 방식(서버 앱 설정·CLI --mode 가 같이 쓴다). 값은 서버에 넘길 환경변수.
const MODES = {
  basic: {}, // 기본: 같은 네트워크, 또는 공유기 포트포워딩
  link: { HOST: "127.0.0.1", ACCORD_TUNNEL: "1" }, // 인터넷 링크: Cloudflare 임시 터널. 포트포워딩 없이 링크로만 들어온다
  campus: { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, // 학교·회사망: 인증서를 바꿔치는 망이라 서버의 바깥 연결(링크 미리보기·AI) 인증서 검사를 끈다
};

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
  // cloudflared(onStatus): 인터넷 링크 모드에서 쓸 cloudflared 실행 파일 경로를 돌려준다(서버 앱은 없으면 내려받는다).
  constructor({ launch = forkNode, cloudflared = async () => "cloudflared" } = {}) {
    super();
    this.launch = launch;
    this.cloudflared = cloudflared;
    this.tunnel = { url: "", status: "" };
    this.tunnelGen = 0;
    this.tunnelChild = null;
    this.tunnelTimer = null;
    this.tunnelFails = 0;
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
      this.info = { version: msg.version, port: msg.port, protocol: msg.protocol, urls: serverUrls(msg.protocol, msg.port, this.env.HOST) };
      this.setState("running");
      if (this.env.ACCORD_TUNNEL === "1") this.openTunnel();
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
    if (state !== "running") {
      this.info = null;
      this.closeTunnel();
    }
    this.emit("state", this.snapshot());
  }

  snapshot() {
    return { state: this.state, info: this.info, error: this.error, tunnel: this.tunnel };
  }

  // ===== 인터넷 링크(Cloudflare 임시 터널) =====
  // 서버가 켜지면 cloudflared 로 https://….trycloudflare.com 주소를 받는다. 끊기면 5초 뒤 다시 연다. 주소는 열 때마다 바뀐다.
  async openTunnel() {
    const gen = ++this.tunnelGen;
    const live = () => gen === this.tunnelGen;
    const setTunnel = (url, status) => {
      if (!live()) return;
      this.tunnel = { url, status };
      this.emit("state", this.snapshot());
    };
    const fail = (reason) => {
      if (!live()) return;
      this.log(`링크를 만들지 못했습니다: ${reason}`); // 화면의 상태 줄은 잘릴 수 있어 기록에도 남긴다
      setTunnel("", `링크를 만들지 못했습니다: ${reason}`);
    };
    setTunnel("", "링크를 만드는 중…");
    let bin;
    try {
      bin = await this.cloudflared((status) => setTunnel("", status));
      // 이 PC에 원래 있던 cloudflared 설정(~/.cloudflared)과 섞이지 않게 빈 설정으로 연다.
      await fs.writeFile(path.join(os.tmpdir(), "accord-cloudflared.yml"), "{}\n");
    } catch (error) {
      return fail(error.message);
    }
    if (!live()) return;
    const child = spawn(bin, [
      "tunnel", "--config", path.join(os.tmpdir(), "accord-cloudflared.yml"), "--no-autoupdate", "--protocol", "http2",
      // 자체서명 인증서 예외는 이 PC의 루프백 서버 연결에만 적용된다.
      "--url", `${this.info.protocol}://127.0.0.1:${this.info.port}`, "--no-tls-verify",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.tunnelChild = child;
    let failed = false;
    let gotUrl = false;
    let lastLine = "";
    const onData = (chunk) => {
      const text = String(chunk);
      // api.trycloudflare.com 은 cloudflared 가 실패 메시지에 찍는 자기 API 주소라 링크가 아니다.
      const url = text.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (url && live()) {
        gotUrl = true;
        this.tunnelFails = 0;
        this.log(`인터넷 링크: ${url}`);
        setTunnel(url, "");
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) lastLine = line.replace(/^\S+\s+(INF|ERR|WRN)\s+/, "").trim();
        if (/\bERR\b/.test(line)) this.log(`cloudflared: ${line}`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      failed = true;
      fail(error.code === "ENOENT" ? "cloudflared 가 없습니다. brew install cloudflared(맥) 또는 winget install Cloudflare.cloudflared(윈도우)로 설치해 주세요." : error.message);
    });
    child.on("exit", () => {
      if (this.tunnelChild === child) this.tunnelChild = null;
      if (failed || !live() || this.state !== "running") return;
      // 링크도 못 받고 끝났으면(망 차단·요청 과다 등) 점점 늦게, 5번째에는 멈추고 이유를 보여 준다.
      if (!gotUrl && ++this.tunnelFails >= 5) return fail(lastLine || "cloudflared 가 바로 종료됐습니다.");
      const delay = Math.min(60000, 5000 * 2 ** this.tunnelFails);
      setTunnel("", gotUrl ? "링크가 끊겨 다시 만드는 중…" : `링크를 다시 만드는 중… (${delay / 1000}초 뒤)`);
      this.tunnelTimer = setTimeout(() => live() && this.openTunnel(), delay);
    });
  }

  closeTunnel() {
    this.tunnelGen++;
    this.tunnelFails = 0;
    clearTimeout(this.tunnelTimer);
    this.tunnelChild?.kill();
    this.tunnelChild = null;
    this.tunnel = { url: "", status: "" };
  }
}

function serverUrls(protocol, port, host) {
  const urls = [{ label: "이 컴퓨터", url: `${protocol}://localhost:${port}` }];
  if (host === "127.0.0.1") return urls; // 인터넷 링크 모드는 이 PC와 링크로만 열린다
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

module.exports = { ServerHost, MODES };
