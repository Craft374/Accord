const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow = null;

app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
  const host = safeHost(url);
  const isPrivateServer =
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  if (isPrivateServer || url.startsWith("https://")) {
    event.preventDefault();
    callback(true);
    return;
  }

  callback(false);
});

app.whenReady().then(() => {
  setupCertificatePolicy();
  setupPermissionPolicy();
  setupDisplayMedia();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function setupCertificatePolicy() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => callback(0));
}

function setupPermissionPolicy() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(["media", "display-capture", "speaker-selection"].includes(permission));
  });

  if (!session.defaultSession.setPermissionCheckHandler) return;

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return ["media", "display-capture", "speaker-selection"].includes(permission);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f4f6f4",
    title: "Accord",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
}

function setupDisplayMedia() {
  if (!session.defaultSession.setDisplayMediaRequestHandler) return;

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 1, height: 1 },
    });
    const screen = sources.find((source) => source.id.startsWith("screen:")) || sources[0];

    if (!screen) {
      callback({});
      return;
    }

    callback({
      video: screen,
      audio: "loopback",
    });
  }, { useSystemPicker: false });
}

function safeHost(rawUrl) {
  try {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rawUrl)) return rawUrl;
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function isVoiceServerHost(host) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  );
}
