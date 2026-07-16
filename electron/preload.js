const { contextBridge, ipcRenderer } = require("electron");

// MessagePort는 contextBridge로 넘길 수 없어 window.postMessage로 메인 월드에 전달한다.
ipcRenderer.on("program-audio-port", (event) => {
  if (event.ports?.length) {
    window.postMessage({ accordProgramAudioPort: true }, "*", event.ports);
  }
});

// 클라이언트(앱) 버전은 package.json 에서 읽는다. 서버 버전과는 별개로 관리한다.
let appVersion = "";
try {
  appVersion = require("../package.json").version || "";
} catch {
  appVersion = "";
}

contextBridge.exposeInMainWorld("voiceDesktop", {
  isDesktop: true,
  platform: process.platform,
  appVersion,
  electronVersion: process.versions.electron || "",
  getSystemAudioSource: async () => {
    const result = await ipcRenderer.invoke("get-system-audio-source");
    if (!result?.ok) throw new Error(result?.error || "공유할 화면 소스를 찾지 못했습니다.");
    return { id: result.id, name: result.name };
  },
  getScreenSource: async () => {
    const result = await ipcRenderer.invoke("get-screen-source");
    if (!result?.ok) throw new Error(result?.error || "공유할 화면 소스를 찾지 못했습니다.");
    return { id: result.id, name: result.name, source: result.source || null, diagnostics: result.diagnostics || null };
  },
  getScreenDiagnostics: async () => {
    const result = await ipcRenderer.invoke("get-screen-diagnostics");
    if (!result?.ok) throw new Error(result?.error || "화면 진단 정보를 가져오지 못했습니다.");
    return result.diagnostics || null;
  },
  openScreenTestWindow: async () => {
    const result = await ipcRenderer.invoke("open-screen-test-window");
    if (!result?.ok) throw new Error(result?.error || "최소 화면 테스트를 열지 못했습니다.");
    return result;
  },
  onScreenTestLog: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on("screen-test-log", handler);
    return () => ipcRenderer.removeListener("screen-test-log", handler);
  },
  setScreenCaptureConfig: async (config) => {
    const result = await ipcRenderer.invoke("set-screen-capture-config", config || {});
    if (!result?.ok) throw new Error(result?.error || "화면 캡처 설정을 적용하지 못했습니다.");
    return result;
  },
  listProgramAudioSources: async () => {
    const result = await ipcRenderer.invoke("list-program-audio-sources");
    if (!result?.ok) throw new Error(result?.error || "프로그램 오디오 목록을 가져오지 못했습니다.");
    return result.items || [];
  },
  startProgramAudioCapture: async (pids) => {
    const result = await ipcRenderer.invoke("start-program-audio-capture", pids);
    if (!result?.ok) throw new Error(result?.error || "프로그램별 오디오 캡처를 시작하지 못했습니다.");
    return result;
  },
  stopProgramAudioCapture: () => ipcRenderer.invoke("stop-program-audio-capture"),
  onProgramAudioData: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on("program-audio-data", handler);
    return () => ipcRenderer.removeListener("program-audio-data", handler);
  },
  onProgramAudioStopped: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on("program-audio-stopped", handler);
    return () => ipcRenderer.removeListener("program-audio-stopped", handler);
  },
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  copyImage: (dataUrl) => ipcRenderer.invoke("copy-image", dataUrl),
  loadServer: (url) => ipcRenderer.invoke("load-voice-url", url),
  backToLauncher: () => ipcRenderer.invoke("back-to-launcher"),
  setScreenShareActive: (active) => ipcRenderer.invoke("set-screen-share-active", Boolean(active)),
});
