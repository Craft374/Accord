const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = [
  path.join(root, "node_modules", "app-builder-bin", "mac", "app-builder_amd64"),
  path.join(root, "node_modules", "app-builder-bin", "mac", "app-builder_arm64"),
  path.join(root, "node_modules", ".bin", "electron-builder"),
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  fs.chmodSync(file, 0o755);
}
