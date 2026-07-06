const os = require("node:os");
const { spawn } = require("node:child_process");

const port = process.env.PORT || "25565";
const publicHost = process.env.PUBLIC_HOST || getLanIp() || "localhost";
const child = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    PUBLIC_HOST: publicHost,
  },
});

child.on("exit", (code) => process.exit(code || 0));

function getLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "";
}
