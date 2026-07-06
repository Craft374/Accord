const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rootDir = path.join(__dirname, "..");
const port = process.env.PORT || "25565";

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  const publicHost = process.env.PUBLIC_HOST || (await getPublicIp().catch(() => ""));
  const localIp = getLocalIp();

  console.log("");
  console.log("Accord server");
  console.log(`Local:  https://localhost:${port}`);
  if (localIp) console.log(`LAN:    https://${localIp}:${port}`);
  if (publicHost) console.log(`Friend: https://${publicHost}:${port}`);
  console.log("");

  const child = spawn(process.execPath, ["server.js"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: port,
      PUBLIC_HOST: publicHost,
    },
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal && info.address.startsWith("192.168.")) {
        return info.address;
      }
    }
  }

  for (const infos of Object.values(interfaces)) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }

  return "";
}

function getPublicIp() {
  return new Promise((resolve, reject) => {
    const request = https.get("https://api.ipify.org", { timeout: 5000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        const ip = body.trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          resolve(ip);
        } else {
          reject(new Error("공인 IP를 확인하지 못했습니다."));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("공인 IP 확인 시간이 초과되었습니다."));
    });
    request.on("error", reject);
  });
}
