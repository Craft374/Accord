const os = require("node:os");

process.env.VOICE_CHAT_REQUIRE_HTTPS = "1";
if (!process.env.PUBLIC_HOST) process.env.PUBLIC_HOST = getLanIp() || "localhost";

require("../server");

function getLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "";
}
