const { contextBridge, ipcRenderer } = require("electron");

// 실패는 throw 로 바꿔서 렌더러에서 try/catch 로 받는다.
const call = async (name, ...args) => {
  const result = await ipcRenderer.invoke(name, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld("host", {
  init: () => call("init"),
  start: () => call("start"),
  stop: () => call("stop"),
  restart: () => call("restart"),
  setConfig: (patch) => call("setConfig", patch),
  request: (type, payload) => call("request", type, payload),
  copy: (text) => call("copy", text),
  openDataDir: () => call("openDataDir"),
  chooseDataDir: () => call("chooseDataDir"),
  resetDataDir: () => call("resetDataDir"),
  onState: (fn) => ipcRenderer.on("state", (_event, snap) => fn(snap)),
  onLog: (fn) => ipcRenderer.on("log", (_event, line) => fn(line)),
});
