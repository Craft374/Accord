const { contextBridge, ipcRenderer } = require("electron");
const { spawn } = require("node:child_process");

// MessagePort는 contextBridge로 넘길 수 없어 window.postMessage로 메인 월드에 전달한다.
ipcRenderer.on("program-audio-port", (event) => {
  if (event.ports?.length) {
    window.postMessage({ accordProgramAudioPort: true }, "*", event.ports);
  }
});

// 네이티브 화면 캡처(Windows): helper(AccordScreenCapture.exe)를 preload가 직접 띄워 stdout 프레임을 읽는다.
// 4K 프레임을 IPC·MessagePort로 넘기면 복제에만 프레임당 15ms가 넘어서, 여기서 VideoFrame을 만들어 페이지로 transfer한다.
let nativeScreenChild = null;

function startNativeScreenProcess({ path, cwd, args }) {
  stopNativeScreenProcess();
  // stdin은 쓰지 않지만 파이프로 열어 둔다: 이 렌더러가 사라지면 파이프가 닫혀 helper도 따라 끝난다.
  const child = spawn(path, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  nativeScreenChild = child;
  const header = Buffer.alloc(16);
  let headerBytes = 0;
  let frame = null;
  let frameBytes = 0;
  let stderr = "";
  // stdout = [16바이트 헤더(너비, 높이, 타임스탬프 µs) + NV12]의 반복. 조각나서 올 수 있으므로 버퍼 하나에 모은다.
  // VideoFrame이 만들 때 데이터를 복사하므로 같은 버퍼를 다시 써도 된다. 페이지가 바쁘면 이 콜백도 늦게 돌아 파이프가 막히고,
  // 그동안 helper의 캡처 풀(2장)이 차서 새 프레임은 버려지므로 지연이 쌓이지 않는다.
  child.stdout.on("data", (chunk) => {
    let at = 0;
    while (at < chunk.length) {
      if (headerBytes < header.length) {
        const copied = chunk.copy(header, headerBytes, at);
        headerBytes += copied;
        at += copied;
        if (headerBytes < header.length) return;
        const size = header.readUInt32LE(0) * header.readUInt32LE(4) * 1.5;
        if (frame?.length !== size) frame = Buffer.allocUnsafe(size);
        frameBytes = 0;
      }
      const copied = chunk.copy(frame, frameBytes, at);
      frameBytes += copied;
      at += copied;
      if (frameBytes < frame.length) return;
      headerBytes = 0;
      const videoFrame = new VideoFrame(frame, {
        format: "NV12",
        codedWidth: header.readUInt32LE(0),
        codedHeight: header.readUInt32LE(4),
        timestamp: Number(header.readBigInt64LE(8)),
        colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
      });
      window.postMessage({ accordNativeScreenFrame: videoFrame }, "*", [videoFrame]);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  // 우리가 끈(stop·새 캡처로 교체) helper는 알리지 않는다. 스스로 끝났을 때만(창 닫힘·오류) 페이지에 알린다.
  const ended = (error) => {
    if (nativeScreenChild !== child) return;
    nativeScreenChild = null;
    window.postMessage({ accordNativeScreenStopped: error }, "*");
  };
  child.on("error", (error) => ended(`${error.message} (helper=${path})`));
  child.on("close", (code) => ended(stderr.match(/"error":"([^"]*)"/)?.[1] || `화면 캡처 helper가 종료되었습니다. code=${code}`));
}

function stopNativeScreenProcess() {
  const child = nativeScreenChild;
  nativeScreenChild = null;
  child?.kill();
}
window.addEventListener("pagehide", stopNativeScreenProcess);

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
  listScreenWindows: () => ipcRenderer.invoke("list-screen-windows"),
  // 프레임은 window 메시지 { accordNativeScreenFrame: VideoFrame }, 스스로 멈추면 { accordNativeScreenStopped: 오류 }로 온다.
  startNativeScreenCapture: async (options) => {
    const result = await ipcRenderer.invoke("get-native-screen-capture", options || {});
    if (!result?.ok) throw new Error(result?.error || "화면 캡처 helper를 시작하지 못했습니다.");
    startNativeScreenProcess(result);
  },
  stopNativeScreenCapture: () => stopNativeScreenProcess(),
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
  // 전체 컴퓨터 소리 공유: 기본 출력 장치에서 소리 내는 프로그램 전부를 프로그램별 공유와 같은 방식으로 캡처한다.
  startSystemAudioCapture: async () => {
    const result = await ipcRenderer.invoke("start-program-audio-capture", [], { allPrograms: true });
    if (!result?.ok) throw new Error(result?.error || "컴퓨터 사운드 캡처를 시작하지 못했습니다.");
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
