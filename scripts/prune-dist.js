const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist");
const keep = new Set([
  "Accord Mac arm64.zip",
  "Accord Windows x64 Portable.exe",
]);

if (!fs.existsSync(distDir)) process.exit(0);

for (const entry of fs.readdirSync(distDir)) {
  if (keep.has(entry)) continue;
  fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
}
