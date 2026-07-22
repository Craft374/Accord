const { execFileSync } = require("node:child_process");
const path = require("node:path");

// electron 31.7.7의 macOS 프리빌트 바이너리에 원래 박혀 있던 서명이 애플 쪽에서 폐기(revoke)돼
// Gatekeeper가 "악성 코드가 포함되어 있어서 열리지 않았습니다"로 차단·삭제하는 문제가 있었다.
// 서명을 지우고 새로 애드혹 서명하면 해시가 바뀌어 폐기 목록에 안 걸린다(electron-builder afterPack 훅).
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--remove-signature", appPath]);
  execFileSync("codesign", ["--deep", "--force", "--sign", "-", appPath]);
};
