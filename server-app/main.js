// Accord Server — 뉴비도 딸깍 한 번으로 자기 Accord 서버를 띄우는 데스크톱 앱(윈도우·맥).
// 서버는 이 앱의 자식 프로세스(core.js)로 돌고, 창을 닫아도 트레이/메뉴 막대에 남아 계속 돈다.
// 메인 프로세스에서는 동기 I/O 를 하지 않는다(윈도우 "응답 없음"·모래시계 커서 방지).
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, ipcMain, nativeImage, nativeTheme, shell, utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ServerHost } = require("./core.js");

// 클라이언트 앱(이름 accord)과 데이터·단일 실행 잠금이 겹치지 않게 이름을 먼저 정한다.
app.setName("Accord Server");
app.setPath("userData", path.join(app.getPath("appData"), "Accord Server"));
if (process.platform === "win32") app.setAppUserModelId("craft374.accord.server"); // 없으면 윈도우 알림이 안 뜬다
const HOME = app.getPath("userData");
const CONFIG_FILE = path.join(HOME, "config.json");
// 가입은 기본으로 닫는다: 서버 앱에는 관리자가 없어서 모르는 사람이 직접 가입하면 지울 방법이 없다.
const DEFAULT_CONFIG = { port: 25565, allowSignup: false, openAtLogin: false };
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
});
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
    if (atLogin) startServer(); // 컴퓨터를 켜면 창 없이 서버만 켠다
    else createWindow();
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
    ACCORD_DATA_DIR: path.join(HOME, "server-data"),
    SSL_CERT_FILE: path.join(HOME, "cert", "cert.pem"),
    SSL_KEY_FILE: path.join(HOME, "cert", "key.pem"),
  };
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
    icon: path.join(__dirname, "..", "assets", "icon.png"),
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
  const image = nativeImage.createFromPath(path.join(__dirname, "..", "assets", isMac ? "icon.png" : "icon.ico"));
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
  openDataDir: () => shell.openPath(HOME),
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
