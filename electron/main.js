const { app, BrowserWindow, desktopCapturer, ipcMain, session, Menu, MessageChannelMain, powerSaveBlocker, screen: electronScreen, net } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const windowsGpuMode = getWindowsGpuMode();
const commandLineSwitches = getCommandLineSwitches();

for (const [name, value] of commandLineSwitches) {
  app.commandLine.appendSwitch(name, value);
}

function getWindowsGpuMode() {
  if (process.platform !== "win32") return "";
  const argvMode = process.argv
    .map((arg) => String(arg || "").match(/^--accord-gpu-mode=(.+)$/)?.[1])
    .find(Boolean);
  const mode = String(process.env.ACCORD_GPU_MODE || argvMode || "auto").toLowerCase();
  return ["auto", "d3d11", "default-safe", "screen-test-safe"].includes(mode) ? mode : "auto";
}

function getEffectiveWindowsGpuMode() {
  if (process.platform !== "win32") return "";
  if (windowsGpuMode === "default-safe" || windowsGpuMode === "screen-test-safe") return windowsGpuMode;
  return "d3d11";
}

function getCommandLineSwitches() {
  if (process.platform === "win32" && windowsGpuMode === "screen-test-safe") {
    return [["autoplay-policy", "no-user-gesture-required"]];
  }

  const switches = [
    ["autoplay-policy", "no-user-gesture-required"],
    ["disable-background-timer-throttling"],
    ["disable-renderer-backgrounding"],
  ];

  if (process.platform === "linux") {
    switches.push(["enable-features", "WebRTCPipeWireCapturer"]);
  }

  if (process.platform === "win32") {
    // Chromium 126 기본 캡처 백엔드(DXGI/GDI)는 4K에서 느림. WGC 사용 시 캡처 fps 대폭 개선.
    switches.push(["enable-features", "AllowWgcScreenCapturer"]);
  }

  if (process.platform === "win32" && getEffectiveWindowsGpuMode() === "d3d11") {
    switches.push(["use-angle", "d3d11"]);
  }

  return switches;
}

let mainWindow = null;
let screenTestWindow = null;
let programAudioCapture = new Map();
let programAudioPort = null;
let screenSharePowerBlockerId = null;
let screenCaptureConfig = {};

app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
  const host = safeHost(url);
  if (isVoiceServerHost(host) || url.startsWith("https://")) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupCertificates();
  setupPermissions();
  setupDisplayMedia();
  setupNavigation();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopProgramAudioCapture();
  stopScreenSharePowerBlocker();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0d1117",
    title: "Accord",
    icon: getWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.loadFile(path.join(__dirname, "../shell/index.html"));
}

function getWindowIcon() {
  const iconPath = path.join(__dirname, "../assets/icon.png");
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function startScreenSharePowerBlocker() {
  if (screenSharePowerBlockerId !== null && powerSaveBlocker.isStarted(screenSharePowerBlockerId)) return;
  screenSharePowerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
}

function stopScreenSharePowerBlocker() {
  if (screenSharePowerBlockerId === null) return;
  if (powerSaveBlocker.isStarted(screenSharePowerBlockerId)) {
    powerSaveBlocker.stop(screenSharePowerBlockerId);
  }
  screenSharePowerBlockerId = null;
}

function setupCertificates() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => callback(0));
}

function setupPermissions() {
  const allowed = new Set([
    "media",
    "display-capture",
    "speaker-selection",
    "fullscreen",
  ]);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowed.has(permission));
  });

  if (!session.defaultSession.setPermissionCheckHandler) return;
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => allowed.has(permission));
}

function setupDisplayMedia() {
  if (!session.defaultSession.setDisplayMediaRequestHandler) return;

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const source = chooseScreenSource(sources);
    if (!source) {
      callback({});
      return;
    }

    const defaultDisplayAudio = { audio: process.platform === "darwin" ? undefined : "loopback" };
    callback({
      video: source,
      audio: request.audioRequested === false ? undefined : defaultDisplayAudio.audio,
    });
  }, { useSystemPicker: false });
}

function setupNavigation() {
  ipcMain.handle("get-system-audio-source", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false,
    });
    const screen = sources.find((source) => source.id.startsWith("screen:")) || sources[0];
    if (!screen) return { ok: false, error: "공유할 화면 소스를 찾지 못했습니다." };
    return { ok: true, id: screen.id, name: screen.name };
  });

  ipcMain.handle("get-screen-source", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const screen = chooseScreenSource(sources);
    if (!screen) return { ok: false, error: "공유할 화면 소스를 찾지 못했습니다." };
    return {
      ok: true,
      id: screen.id,
      name: screen.name,
      source: getSourceDiagnostics(screen),
      diagnostics: await getScreenDiagnostics(),
    };
  });

  ipcMain.handle("get-screen-diagnostics", async () => {
    return { ok: true, diagnostics: await getScreenDiagnostics() };
  });

  ipcMain.handle("set-screen-capture-config", (event, config = {}) => {
    screenCaptureConfig = {
      displayId: String(config.displayId || ""),
      mode: String(config.mode || ""),
    };
    return { ok: true };
  });

  ipcMain.handle("open-screen-test-window", async () => {
    const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
    const displayInfo = getDisplayDiagnostic(display);
    const width = Math.round((display.bounds?.width || 1280) * (display.scaleFactor || 1));
    const height = Math.round((display.bounds?.height || 720) * (display.scaleFactor || 1));
    screenCaptureConfig = {
      displayId: String(display.id || ""),
      mode: "minimal-screen-test",
    };
    openScreenTestWindow(display, {
      width,
      height,
      display: displayInfo,
      diagnostics: await getScreenDiagnostics(),
    });
    return { ok: true };
  });

  ipcMain.handle("load-voice-url", async (event, rawUrl) => {
    const target = normalizeServerUrl(rawUrl);
    if (!target || !mainWindow) return { ok: false, error: "서버 주소가 올바르지 않습니다." };
    // 서버가 살아 있는지 먼저 확인한다. 죽어 있으면 런처에 그대로 머문다(앱 재시작 불필요).
    const reachable = await checkServerReachable(target);
    if (!reachable) {
      return { ok: false, error: "서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요." };
    }
    try {
      await mainWindow.loadURL(target);
      return { ok: true };
    } catch (error) {
      // 로딩이 중간에 실패하면 런처로 되돌려 앱을 껐다 켜지 않아도 되게 한다.
      try { await mainWindow.loadFile(path.join(__dirname, "../shell/index.html")); } catch {}
      return { ok: false, error: "서버 연결에 실패했습니다. 다시 시도해 주세요." };
    }
  });

  ipcMain.handle("back-to-launcher", async () => {
    if (!mainWindow) return { ok: false };
    await mainWindow.loadFile(path.join(__dirname, "../shell/index.html"));
    return { ok: true };
  });

  ipcMain.handle("set-screen-share-active", async (event, active) => {
    if (active) startScreenSharePowerBlocker();
    else stopScreenSharePowerBlocker();
    return { ok: true };
  });

  ipcMain.handle("list-program-audio-sources", async () => {
    if (process.platform !== "win32") return { ok: false, error: "Windows에서만 사용할 수 있습니다." };
    const helperInfo = getProgramLoopbackHelperInfo();
    if (!helperInfo.exists) return { ok: false, error: makeHelperError("프로그램별 오디오 캡처 helper가 없습니다.", helperInfo) };
    const args = ["list", "--exclude-pid", String(process.pid)];

    return new Promise((resolve) => {
      execFile(helperInfo.path, args, {
        cwd: helperInfo.cwd,
        windowsHide: true,
        timeout: 5000,
      }, (error, stdout, stderr) => {
        if (error) {
          console.error("program audio list failed", error, helperInfo);
          resolve({ ok: false, error: makeHelperError(parseHelperError(stderr) || error.message, helperInfo, error, args) });
          return;
        }

        try {
          const data = JSON.parse(stdout || "{}");
          resolve(data?.ok ? data : { ok: false, error: data?.error || "프로그램 목록을 읽지 못했습니다." });
        } catch {
          resolve({ ok: false, error: "프로그램 목록 응답을 해석하지 못했습니다." });
        }
      });
    });
  });

  ipcMain.handle("start-program-audio-capture", async (event, rawPids) => {
    if (process.platform !== "win32") return { ok: false, error: "Windows에서만 사용할 수 있습니다." };
    const helperInfo = getProgramLoopbackHelperInfo();
    if (!helperInfo.exists) return { ok: false, error: makeHelperError("프로그램별 오디오 캡처 helper가 없습니다.", helperInfo) };

    const rawList = normalizePidList(rawPids);
    if (!rawList.length) return { ok: false, error: "공유할 프로그램을 선택하세요." };

    // 캡처는 프로세스 트리 포함 모드라, 다른 선택 pid의 자손을 또 캡처하면
    // 같은 오디오가 중복 합산된다(증폭/클리핑 + 콤 필터). 트리 루트만 남긴다.
    const pids = await dedupeProgramAudioPids(helperInfo, rawList);
    console.log(`program audio capture pids: raw=${rawList.join(",")} deduped=${pids.join(",")}`);

    stopProgramAudioCapture();
    // PCM을 렌더러 메인 스레드를 거치지 않고 AudioWorklet에 직결하기 위한 채널.
    // 렌더러가 바빠도(화면공유 인코딩 등) 오디오 전달이 밀리지 않는다.
    try {
      const { port1, port2 } = new MessageChannelMain();
      programAudioPort = port1;
      event.sender.postMessage("program-audio-port", { pids }, [port2]);
    } catch (error) {
      console.error("program audio port setup failed", error);
      programAudioPort = null;
    }
    try {
      for (const pid of pids) {
        startProgramAudioCaptureProcess(event.sender, helperInfo, pid);
      }
    } catch (error) {
      stopProgramAudioCapture();
      console.error("program audio capture failed", error, helperInfo);
      return { ok: false, error: makeHelperError(error.message, helperInfo, error, ["capture", "--pid", pids.join(","), "--sample-rate", "48000", "--channels", "2"]) };
    }

    return { ok: true };
  });

  ipcMain.handle("stop-program-audio-capture", () => {
    stopProgramAudioCapture();
    return { ok: true };
  });
}

function openScreenTestWindow(display, payload) {
  if (screenTestWindow && !screenTestWindow.isDestroyed()) {
    screenTestWindow.close();
  }

  screenTestWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  screenTestWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    sendScreenTestLog("minimal-screen-test-console", [
      `level=${level}`,
      message,
      line ? `line=${line}` : "",
      sourceId ? `source=${sourceId}` : "",
    ].filter(Boolean).join(" "));
  });
  screenTestWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") screenTestWindow?.close();
  });
  screenTestWindow.on("closed", () => {
    screenTestWindow = null;
    sendScreenTestLog("minimal-screen-test-closed", "window closed");
  });

  const query = {
    w: String(payload.width),
    h: String(payload.height),
    fps: "60",
    displayId: String(display.id || ""),
    electron: process.versions.electron || "",
    gpuMode: windowsGpuMode || "",
    effectiveGpuMode: getEffectiveWindowsGpuMode() || "",
    switches: JSON.stringify(commandLineSwitches.map(([name, value]) => ({ name, value }))),
    display: JSON.stringify(payload.display || {}),
    gpuSummary: JSON.stringify(payload.diagnostics?.gpuSummary || {}),
  };
  sendScreenTestLog("minimal-screen-test-open", `query=${JSON.stringify(query)}`);
  screenTestWindow.loadFile(path.join(__dirname, "screen-test.html"), { query });
}

function sendScreenTestLog(event, detail = "") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("screen-test-log", {
      event,
      detail: String(detail || ""),
      at: new Date().toISOString(),
    });
  }
}

function chooseScreenSource(sources) {
  const screens = sources.filter((source) => source.id?.startsWith?.("screen:"));
  const targetDisplayId = String(screenCaptureConfig.displayId || getCursorDisplayId() || "");
  return screens.find((source) => source.display_id === targetDisplayId) || screens[0] || sources[0] || null;
}

function getCursorDisplayId() {
  if (!electronScreen?.getDisplayNearestPoint || !electronScreen?.getCursorScreenPoint) return "";
  const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint());
  return display?.id ? String(display.id) : "";
}

async function getScreenDiagnostics() {
  const gpuInfo = await getBasicGpuInfo();
  const diagnostics = {
    platform: process.platform,
    electronVersion: process.versions.electron || "",
    hardwareAcceleration: !app.commandLine.hasSwitch("disable-gpu"),
    windowsGpuMode,
    effectiveWindowsGpuMode: getEffectiveWindowsGpuMode(),
    switches: commandLineSwitches.map(([name, value]) => ({
      name,
      value,
      enabled: app.commandLine.hasSwitch(name),
    })),
    displays: getDisplayDiagnostics(),
    gpuFeatureStatus: app.getGPUFeatureStatus?.() || null,
    gpuSummary: getGpuSummary(gpuInfo),
  };

  if (gpuInfo?.error) {
    diagnostics.gpuInfoError = gpuInfo.error;
  } else {
    diagnostics.gpuInfo = {
      auxAttributes: getGpuAuxSummary(gpuInfo?.auxAttributes),
      gpuDevice: gpuInfo?.gpuDevice || [],
      machineModelName: gpuInfo?.machineModelName || "",
      machineModelVersion: gpuInfo?.machineModelVersion || "",
    };
  }

  return diagnostics;
}

async function getBasicGpuInfo() {
  try {
    return await app.getGPUInfo?.("basic");
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

function getGpuSummary(gpuInfo) {
  if (!gpuInfo || gpuInfo.error) return null;
  const aux = gpuInfo.auxAttributes || {};
  const features = app.getGPUFeatureStatus?.() || {};
  return {
    glImplementationParts: aux.glImplementationParts || "",
    directComposition: Boolean(aux.overlayInfo?.directComposition),
    supportsD3dSharedImages: Boolean(aux.supportsD3dSharedImages),
    supportsDx12: Boolean(aux.supportsDx12),
    supportsVulkan: Boolean(aux.supportsVulkan),
    videoEncode: features.video_encode || "",
    gpuCompositing: features.gpu_compositing || "",
    directRenderingDisplayCompositor: features.direct_rendering_display_compositor || "",
    rasterization: features.rasterization || "",
  };
}

function getGpuAuxSummary(aux = {}) {
  return {
    glImplementationParts: aux.glImplementationParts || "",
    directComposition: Boolean(aux.overlayInfo?.directComposition),
    supportsD3dSharedImages: Boolean(aux.supportsD3dSharedImages),
    supportsDx12: Boolean(aux.supportsDx12),
    supportsVulkan: Boolean(aux.supportsVulkan),
    inProcessGpu: Boolean(aux.inProcessGpu),
    passthroughCmdDecoder: Boolean(aux.passthroughCmdDecoder),
  };
}

function getDisplayBySource(source) {
  const sourceDisplayId = String(source?.display_id || "");
  if (!sourceDisplayId || !electronScreen?.getAllDisplays) return null;
  return electronScreen.getAllDisplays().find((display) => String(display.id) === sourceDisplayId) || null;
}

function getSourceDisplayDiagnostics(source) {
  const display = getDisplayBySource(source);
  if (!display) return null;
  return getDisplayDiagnostic(display);
}

function getDisplayDiagnostic(display) {
  const physicalEstimate = display.size && display.scaleFactor
    ? {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    }
    : null;
  return {
    id: display.id,
    label: display.label || "",
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    touchSupport: display.touchSupport,
    colorDepth: display.colorDepth,
    depthPerComponent: display.depthPerComponent,
    bounds: display.bounds,
    workArea: display.workArea,
    size: display.size,
    physicalEstimate,
    workAreaSize: display.workAreaSize,
    internal: Boolean(display.internal),
  };
}

function getSourceDiagnostics(source) {
  const thumbnailSize = source.thumbnail?.getSize?.() || null;
  return {
    id: source.id,
    name: source.name,
    displayId: source.display_id || "",
    thumbnailSize,
    display: getSourceDisplayDiagnostics(source),
  };
}

function getDisplayDiagnostics() {
  if (!electronScreen?.getAllDisplays) return [];
  return electronScreen.getAllDisplays().map(getDisplayDiagnostic);
}

function dedupeProgramAudioPids(helperInfo, pids) {
  if (pids.length <= 1) return Promise.resolve(pids);
  return new Promise((resolve) => {
    execFile(helperInfo.path, ["dedupe", "--pids", pids.join(",")], {
      cwd: helperInfo.cwd,
      windowsHide: true,
      timeout: 5000,
    }, (error, stdout) => {
      if (error) {
        console.error("program audio dedupe failed", error);
        resolve(pids);
        return;
      }
      try {
        const data = JSON.parse(stdout || "{}");
        const deduped = Array.isArray(data?.pids)
          ? data.pids.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0)
          : [];
        resolve(deduped.length ? deduped : pids);
      } catch {
        resolve(pids);
      }
    });
  });
}

function getProgramLoopbackHelperInfo() {
  const relative = path.join("electron", "bin", "AccordProcessLoopback.exe");
  const candidates = app.isPackaged
    ? [
      path.join(process.resourcesPath, "app.asar.unpacked", relative),
      path.join(process.resourcesPath, relative),
    ]
    : [
      path.join(__dirname, "bin", "AccordProcessLoopback.exe"),
      path.join(__dirname, "..", relative),
    ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  const helperPath = found || candidates[0];
  return {
    path: helperPath,
    cwd: path.dirname(helperPath),
    exists: Boolean(found),
    packaged: app.isPackaged,
    candidates,
  };
}

function normalizePidList(rawPids) {
  if (!Array.isArray(rawPids)) return [];
  const pids = [];
  for (const value of rawPids) {
    const pid = Number(value);
    if (!Number.isInteger(pid) || pid <= 0 || pids.includes(pid)) continue;
    pids.push(pid);
  }
  return pids.slice(0, 12);
}

function startProgramAudioCaptureProcess(webContents, helperInfo, pid) {
  const args = [
    "capture",
    "--pid",
    String(pid),
    "--sample-rate",
    "48000",
    "--channels",
    "2",
  ];
  const child = spawn(helperInfo.path, args, {
    cwd: helperInfo.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  programAudioCapture.set(pid, child);

  child.stdout.on("data", (chunk) => {
    if (webContents.isDestroyed()) return;
    if (programAudioPort) {
      try {
        programAudioPort.postMessage({ pid, data: chunk });
        return;
      } catch {
        programAudioPort = null;
      }
    }
    const data = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    webContents.send("program-audio-data", { pid, data });
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  child.on("error", (error) => {
    programAudioCapture.delete(pid);
    console.error("program audio helper spawn failed", error, helperInfo);
    if (!webContents.isDestroyed()) {
      webContents.send("program-audio-stopped", { pid, error: makeHelperError(error.message, helperInfo, error, args) });
    }
  });

  child.on("close", (code) => {
    programAudioCapture.delete(pid);
    if (!webContents.isDestroyed()) {
      webContents.send("program-audio-stopped", { pid, code, error: parseHelperError(stderr) });
    }
  });
}

function makeHelperError(message, helperInfo, error = null, args = []) {
  const parts = [
    message || "프로그램별 오디오 helper 실행에 실패했습니다.",
    `helper=${helperInfo.path}`,
    `cwd=${helperInfo.cwd}`,
    `exists=${helperInfo.exists ? "1" : "0"}`,
    `platform=${process.platform}`,
    `packaged=${helperInfo.packaged ? "1" : "0"}`,
  ];
  if (args.length) parts.push(`args=${args.join(" ")}`);
  if (error?.code) parts.push(`code=${error.code}`);
  if (error?.errno) parts.push(`errno=${error.errno}`);
  if (error?.syscall) parts.push(`syscall=${error.syscall}`);
  if (error?.stack) parts.push(`stack=${String(error.stack).replace(/\s+/g, " ").slice(0, 800)}`);
  return parts.join(" / ");
}

function stopProgramAudioCapture() {
  for (const child of programAudioCapture.values()) {
    if (!child.killed) child.kill();
  }
  programAudioCapture.clear();
  programAudioPort?.close?.();
  programAudioPort = null;
}

function parseHelperError(stderr) {
  const text = String(stderr || "").trim();
  if (!text) return "";
  const line = text.split(/\r?\n/).find((item) => item.trim().startsWith("{")) || text;
  try {
    const parsed = JSON.parse(line);
    return parsed?.error || text;
  } catch {
    return text;
  }
}

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "/");
  } catch {
    return "";
  }
}

function checkServerReachable(target) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const healthUrl = `${String(target).replace(/\/$/, "")}/health`;
    try {
      const request = net.request({ method: "GET", url: healthUrl });
      const timer = setTimeout(() => {
        try { request.abort(); } catch {}
        finish(false);
      }, 4000);
      request.on("response", (response) => {
        clearTimeout(timer);
        finish(response.statusCode >= 200 && response.statusCode < 500);
        response.on("data", () => {});
        response.on("end", () => {});
        response.on("error", () => {});
      });
      request.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      request.end();
    } catch {
      finish(false);
    }
  });
}

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function isVoiceServerHost(host) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  );
}
