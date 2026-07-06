const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("voiceDesktop", {
  isDesktop: true,
  platform: process.platform,
});
