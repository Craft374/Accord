// 터미널용 Accord 서버 관리 도구. 서버를 켜 두고 이 창에서 명령으로 계정을 미리 만든다.
//   npm run host                    서버 켜기(포트는 PORT 환경변수 또는 --port, 기본 25565)
//   npm run host -- --no-signup     새 가입을 막기(이미 있는 계정과 여기서 만든 계정만 로그인)
//   npm run host -- --mode link     접속 방식: basic(기본) | link(인터넷 링크, cloudflared 필요) | campus(학교·회사망)
// 서버 설정(TURN 등)은 지금처럼 server.env 를 읽고, 데이터는 server-data/ 에 그대로 쌓인다.
const readline = require("node:readline");
const { ServerHost, MODES } = require("../server-app/core.js");

const HELP = `명령:
  users                          계정 목록(IP·접속 기록 제외)
  add <아이디> <비밀번호> [표시 이름]  계정 만들기
  passwd <아이디> <새 비밀번호>      비밀번호 바꾸기(모든 기기에서 로그아웃)
  del <아이디>                    계정 지우기
  status                         상태·접속 인원
  restart                        서버 다시 켜기
  quit                           서버 끄고 나가기(Ctrl+C 도 같음)`;

const args = process.argv.slice(2);
const env = {};
const portIndex = args.indexOf("--port");
if (portIndex >= 0) env.PORT = args[portIndex + 1];
if (args.includes("--no-signup")) env.ALLOW_SIGNUP = "0";
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args[modeIndex + 1] : "basic";
if (!MODES[mode]) {
  console.error(`알 수 없는 접속 방식입니다: ${mode} (basic | link | campus)`);
  process.exit(1);
}
Object.assign(env, MODES[mode]);

const host = new ServerHost();
host.on("log", (line) => console.log(line));
let lastState = "";
let lastTunnel = "";
host.on("state", ({ state, info, error, tunnel }) => {
  if (tunnel.status && tunnel.status !== lastTunnel) console.log(tunnel.status);
  lastTunnel = tunnel.status;
  if (state === lastState) return;
  lastState = state;
  if (state === "running") console.log(`\n서버가 켜졌습니다.\n${info.urls.map((u) => `  ${u.label}: ${u.url}`).join("\n")}\n\n${HELP}\n`);
  if (state === "stopped" && error) {
    console.error(`\n${error}`);
    process.exit(1);
  }
});

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  console.log("서버를 끄는 중…");
  await host.stop();
  process.exit();
}
process.on("SIGINT", quit);
process.on("SIGTERM", quit);

async function findUser(username) {
  const { users } = await host.request("host:list-users");
  const user = users.find((u) => u.username === String(username || "").toLowerCase());
  if (!user) throw new Error(`"${username}" 계정이 없습니다.`);
  return user;
}

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  switch (cmd) {
    case "":
      return;
    case "help":
      return console.log(HELP);
    case "users": {
      const { users } = await host.request("host:list-users");
      if (!users.length) return console.log("아직 계정이 없습니다.");
      return console.log(users.map((u) => `  ${u.username}  #${u.code}  ${u.displayName}  (${u.isAdmin ? "관리자" : u.hostCreated ? "미리 만듦" : "직접 가입"})`).join("\n"));
    }
    case "add": {
      const [username, password, ...name] = rest;
      await host.request("host:create-user", { username, password, displayName: name.join(" ") });
      return console.log(`계정을 만들었습니다: ${username}`);
    }
    case "passwd": {
      const user = await findUser(rest[0]);
      await host.request("host:set-password", { userId: user.id, password: rest[1] });
      return console.log(`비밀번호를 바꿨습니다: ${user.username}`);
    }
    case "del": {
      const user = await findUser(rest[0]);
      await host.request("host:delete-user", { userId: user.id });
      return console.log(`계정을 지웠습니다: ${user.username}`);
    }
    case "status": {
      if (host.state !== "running") return console.log(`상태: ${host.state}`);
      const { online } = await host.request("host:status");
      return console.log(`켜져 있음 · v${host.info.version} · 접속 ${online}명`);
    }
    case "restart":
      return host.restart();
    case "quit":
    case "exit":
      return quit();
    default:
      return console.log(`알 수 없는 명령입니다: ${cmd} (help 로 목록 보기)`);
  }
}

// systemd 처럼 터미널이 없으면 명령 입력 없이 서버만 돌린다.
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => run(line).catch((error) => console.log(`실패: ${error.message}`)));
  rl.on("SIGINT", quit);
}

host.start(env);
