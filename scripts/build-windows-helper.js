const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "native", "windows-process-loopback", "Program.cs");
const manifest = path.join(root, "native", "windows-process-loopback", "app.manifest");
const outputDir = path.join(root, "electron", "bin");
const output = path.join(outputDir, "AccordProcessLoopback.exe");

if (process.platform !== "win32") {
  if (fs.existsSync(output)) {
    console.log("reuse existing windows process loopback helper");
    process.exit(0);
  }
  console.error("Windows process loopback helper is missing. Build it on Windows first.");
  process.exit(1);
}

const candidates = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];

const csc = candidates.find((item) => fs.existsSync(item));
if (!csc) {
  console.error("Windows process loopback helper build failed: csc.exe was not found.");
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(csc, [
  "/nologo",
  "/optimize+",
  "/platform:x64",
  "/target:exe",
  `/win32manifest:${manifest}`,
  `/out:${output}`,
  source,
], {
  cwd: root,
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);

console.log(`built ${path.relative(root, output)}`);
