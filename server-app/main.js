// Accord Server — 뉴비도 딸깍 한 번으로 자기 Accord 서버를 띄우는 데스크톱 앱(윈도우·맥).
// 서버는 이 앱의 자식 프로세스(core.js)로 돌고, 창을 닫아도 트레이/메뉴 막대에 남아 계속 돈다.
// 메인 프로세스에서는 동기 I/O 를 하지 않는다(윈도우 "응답 없음"·모래시계 커서 방지).
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, shell, utilityProcess } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { ServerHost, MODES } = require("./core.js");

// 클라이언트 앱(이름 accord)과 데이터·단일 실행 잠금이 겹치지 않게 이름을 먼저 정한다.
app.setName("Accord Server");
app.setPath("userData", path.join(app.getPath("appData"), "Accord Server"));
if (process.platform === "win32") app.setAppUserModelId("craft374.accord.server"); // 없으면 윈도우 알림이 안 뜬다
const HOME = app.getPath("userData");
const CONFIG_FILE = path.join(HOME, "config.json");
// 가입은 기본으로 닫는다: 서버 앱에는 관리자가 없어서 모르는 사람이 직접 가입하면 지울 방법이 없다.
// dataDir: 비우면 앱 데이터 폴더. 이미 쓰던 Accord 의 server-data 폴더를 고르면 그 계정·채팅을 그대로 쓴다.
const DEFAULT_CONFIG = { port: 25565, allowSignup: false, openAtLogin: false, mode: "basic", dataDir: "" };
const isMac = process.platform === "darwin";

// utilityProcess: Chromium 이 자식 프로세스로 띄워서 윈도우 모래시계 커서·콘솔 창이 없고, 맥 독에도 안 뜬다.
const host = new ServerHost({
  launch: (file, env) => {
    const child = utilityProcess.fork(file, [], { env: { ...process.env, ...env }, stdio: "pipe", serviceName: "Accord Server" });
    return {
      send: (msg) => child.postMessage(msg),
      kill: () => child.kill(),
      stdout: child.stdout,
      stderr: child.stderr,
      on: (event, fn) => child.on(event, fn),
    };
  },
  cloudflared: cloudflaredPath,
});

// 인터넷 링크 모드용 cloudflared. 처음 한 번 Cloudflare 공식 GitHub 릴리스에서 받아 앱 데이터 폴더에 둔다(약 40MB).
// net.fetch: 크로미움 네트워크(OS 인증서 저장소)를 써서 학교·회사망 인증서도 통한다.
const CLOUDFLARED = path.join(HOME, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
let downloading = null;
let reportDownload = () => {};
async function cloudflaredPath(onStatus) {
  if (await fs.access(CLOUDFLARED).then(() => true, () => false)) return CLOUDFLARED;
  // 받는 도중 서버를 다시 켜도 같은 파일을 두 번 받지 않게 하나로 묶고, 진행률은 마지막으로 물어본 쪽에 보낸다.
  reportDownload = onStatus;
  downloading ??= downloadCloudflared((text) => reportDownload(text)).finally(() => { downloading = null; });
  return downloading;
}

async function downloadCloudflared(onStatus) {
  const arch = process.arch === "arm64" && isMac ? "arm64" : "amd64";
  const asset = process.platform === "win32" ? "cloudflared-windows-amd64.exe" : `cloudflared-darwin-${arch}.tgz`;
  const res = await net.fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, { signal: AbortSignal.timeout(5 * 60000) });
  if (!res.ok || !res.body) throw new Error(`cloudflared 를 내려받지 못했습니다(${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  // 다 받고 확인한 뒤에만 최종 경로로 옮긴다 — 중간에 끊기면 잘린 파일이 캐시로 남지 않게.
  const work = path.join(path.dirname(CLOUDFLARED), ".download");
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const tmp = path.join(work, asset);
  const file = await fs.open(tmp, "w");
  let got = 0;
  let shown = -1;
  try {
    for await (const chunk of res.body) {
      await file.write(chunk);
      got += chunk.length;
      const pct = total ? Math.floor((got / total) * 100) : -1;
      if (pct !== shown && pct % 5 === 0) onStatus(`링크 도구(cloudflared) 내려받는 중… ${(shown = pct)}%`);
    }
  } finally {
    await file.close();
  }
  if (total && got !== total) throw new Error("cloudflared 내려받기가 중간에 끊겼습니다.");
  let bin = tmp;
  if (asset.endsWith(".tgz")) {
    await promisify(execFile)("tar", ["-xzf", tmp, "-C", work]);
    bin = path.join(work, "cloudflared");
  }
  await fs.chmod(bin, 0o755);
  await fs.rename(bin, CLOUDFLARED);
  await fs.rm(work, { recursive: true, force: true });
  return CLOUDFLARED;
}

let config = { ...DEFAULT_CONFIG };
let win = null;
let tray = null;
let quitting = false;
let toldBackground = false;

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(async () => {
    if (!isMac) Menu.setApplicationMenu(null); // 맥은 기본 메뉴를 둬야 입력칸 복사·붙여넣기(⌘C/⌘V)가 된다
    config = { ...DEFAULT_CONFIG, ...(await readJson(CONFIG_FILE)) };
    const atLogin = process.argv.includes("--autostart") || app.getLoginItemSettings().wasOpenedAtLogin;
    createTray();
    // 자동 시작을 켜 두면 실행할 때마다 서버를 켠다(맥 13+ 는 로그인 실행 여부를 못 알아낼 수 있어서). 로그인 실행이면 창은 안 띄운다.
    if (config.openAtLogin || atLogin) startServer();
    if (!atLogin) createWindow();
  });
  app.on("activate", showWindow);
  app.on("window-all-closed", () => {}); // 창이 없어도 트레이에 남는다(종료는 아래 close 처리에서)
  app.on("before-quit", (event) => {
    if (quitting || host.state === "stopped") return;
    event.preventDefault();
    quitApp();
  });
}

host.on("state", (snap) => {
  send("state", snap);
  updateTray();
});
host.on("log", (line) => send("log", line));

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function serverEnv() {
  return {
    PORT: String(config.port),
    ALLOW_SIGNUP: config.allowSignup ? "1" : "0",
    ACCORD_DATA_DIR: dataDir(),
    SSL_CERT_FILE: path.join(HOME, "cert", "cert.pem"),
    SSL_KEY_FILE: path.join(HOME, "cert", "key.pem"),
    ...MODES[config.mode],
  };
}

function dataDir() {
  return config.dataDir || path.join(HOME, "server-data");
}

// 다른 폴더를 데이터 폴더로 쓴다. 엉뚱한 폴더(저장소 루트 등)에 데이터를 흩뿌리지 않게
// Accord 데이터 폴더(users.json 이 있는 곳)나 빈 폴더만 받는다.
async function chooseDataDir() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Accord 데이터 폴더 고르기",
    message: "이미 쓰던 Accord 의 server-data 폴더, 또는 빈 폴더를 골라 주세요.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths[0]) return config;
  const dir = filePaths[0];
  const entries = await fs.readdir(dir);
  if (!entries.includes("users.json") && entries.some((name) => !name.startsWith("."))) {
    throw new Error("Accord 데이터 폴더(users.json 이 들어 있는 server-data)나 빈 폴더를 골라 주세요.");
  }
  return saveConfig({ dataDir: dir });
}

function startServer() {
  host.start(serverEnv());
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 480,
    minHeight: 560,
    show: false, // 그려진 뒤에 보여 줘서 흰 화면 깜빡임이 없게
    title: "Accord Server",
    backgroundColor: isMac ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#000000" : "#f2f2f7",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    vibrancy: isMac ? "under-window" : undefined,
    visualEffectState: "followWindow",
    icon: path.join(__dirname, "..", "assets", "server-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"), { query: { platform: process.platform } });
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (quitting) return;
    // 서버가 꺼져 있으면 그냥 끝낸다. 켜져 있으면 실수로 닫아도 서버가 안 꺼지게 창만 숨긴다.
    if (host.state === "stopped") return app.quit(); // 크래시 뒤 재시작 대기(starting)도 켜진 것으로 본다
    event.preventDefault();
    win.hide();
    if (!toldBackground && Notification.isSupported()) {
      toldBackground = true;
      new Notification({ title: "Accord Server", body: `서버는 계속 켜져 있습니다. 끄려면 ${isMac ? "메뉴 막대" : "작업 표시줄 트레이"}의 아이콘을 눌러 주세요.` }).show();
    }
  });
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}

function showWindow() {
  if (!app.isReady()) return;
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function quitApp() {
  quitting = true;
  win?.hide(); // 끄는 동안 창이 멈춘 듯 남아 있지 않게 먼저 숨긴다
  await host.stop();
  app.quit();
}

function createTray() {
  // 윈도우는 여러 크기가 든 .ico 를 그대로 줘서 125~200% 배율에서도 흐리지 않게 한다.
  const image = nativeImage.createFromPath(path.join(__dirname, "..", "assets", isMac ? "server-icon.png" : "server-icon.ico"));
  tray = new Tray(isMac && !image.isEmpty() ? image.resize({ width: 18, height: 18, quality: "best" }) : image);
  tray.on("click", showWindow);
  updateTray();
}

const STATE_LABEL = { stopped: "꺼져 있음", starting: "켜는 중…", running: "켜져 있음", stopping: "끄는 중…" };
function updateTray() {
  if (!tray) return;
  const running = host.state === "running";
  tray.setToolTip(`Accord Server — ${STATE_LABEL[host.state]}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `서버 ${STATE_LABEL[host.state]}`, enabled: false },
    { label: "창 열기", click: showWindow },
    { label: running ? "서버 끄기" : "서버 켜기", enabled: host.state === "running" || host.state === "stopped", click: () => (running ? host.stop() : startServer()) },
    { type: "separator" },
    { label: "종료 (서버도 꺼짐)", click: quitApp },
  ]));
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function saveConfig(patch) {
  const port = Number(patch.port ?? config.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("포트는 1024~65535 사이 숫자여야 합니다.");
  if (patch.mode !== undefined && !MODES[patch.mode]) throw new Error("알 수 없는 접속 방식입니다.");
  config = { ...config, ...patch, port };
  if ("openAtLogin" in patch) app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin), args: ["--autostart"] });
  await fs.mkdir(HOME, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}

// 렌더러와는 invoke(비동기)만 쓴다. sendSync 는 렌더러를 멈추게 한다.
const handlers = {
  init: () => ({ ...host.snapshot(), logs: host.logs, config }),
  start: () => startServer(),
  stop: () => host.stop(),
  restart: () => host.restart(serverEnv()),
  setConfig: (patch) => saveConfig(patch),
  request: (type, payload) => host.request(type, payload),
  copy: (text) => clipboard.writeText(String(text)),
  openDataDir: () => shell.openPath(dataDir()),
  chooseDataDir,
  resetDataDir: () => saveConfig({ dataDir: "" }),
};
for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}
