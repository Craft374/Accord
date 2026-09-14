const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "native", "windows-process-loopback", "Program.cs");
const manifest = path.join(root, "native", "windows-process-loopback", "app.manifest");
const captureSource = path.join(root, "native", "windows-screen-capture", "main.cpp");
const outputDir = path.join(root, "electron", "bin");
const output = path.join(outputDir, "AccordProcessLoopback.exe");
const captureOutput = path.join(outputDir, "AccordScreenCapture.exe");

if (process.platform !== "win32") {
  if (fs.existsSync(output) && fs.existsSync(captureOutput)) {
    console.log("reuse existing windows helpers");
    process.exit(0);
  }
  console.error("Windows helpers are missing. Build them on Windows first.");
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

// 화면 캡처 helper(C++/WinRT)는 MSVC로 빌드한다. Visual Studio Build Tools의 "C++를 사용한 데스크톱 개발"이 필요하다.
const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
const vsPath = fs.existsSync(vswhere)
  ? spawnSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).stdout.trim()
  : "";
if (!vsPath) {
  console.error("Windows screen capture helper build failed: MSVC was not found. Install Visual Studio Build Tools with the C++ workload.");
  process.exit(1);
}

// /MT: VC++ 런타임을 exe에 넣어 재배포 패키지가 없는 PC에서도 돈다. .obj는 임시 폴더에 버린다.
const objDir = fs.mkdtempSync(path.join(os.tmpdir(), "accord-screen-capture-"));
const vcvars = path.join(vsPath, "VC", "Auxiliary", "Build", "vcvars64.bat");
const cl = spawnSync(
  `call "${vcvars}" >nul && cl /nologo /EHsc /std:c++20 /O2 /MT /W3 /utf-8 "${captureSource}" /Fe:"${captureOutput}"`,
  { cwd: objDir, shell: true, encoding: "utf8" },
);
fs.rmSync(objDir, { recursive: true, force: true });

if (cl.stdout) process.stdout.write(cl.stdout);
if (cl.stderr) process.stderr.write(cl.stderr);
if (cl.status !== 0) process.exit(cl.status || 1);

console.log(`built ${path.relative(root, captureOutput)}`);
