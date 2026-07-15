# 데스크톱 앱 빌드 방법

데스크톱 앱(Electron)은 서버 주소를 입력해 통화 UI를 여는 얇은 껍데기입니다.
빌드하면 배포용 실행 파일(Windows 포터블 exe / macOS zip)이 `dist/` 에 만들어집니다.

## 준비물

| 무엇 | 필요한 것 |
|---|---|
| 공통 | Node.js 18+, 저장소 루트에서 `npm install` 한 번 |
| Windows 빌드 | Windows + .NET Framework 4.x 의 `csc.exe` (Windows 기본 포함) |
| macOS 빌드 | macOS (arm64) |

> `npm install` 은 개발용 의존성(electron, electron-builder)을 받습니다. 서버 실행에는 필요 없습니다.

빌드 전에 한 번:

```bash
npm install
```

---

## 1. 스크립트로 바로 빌드 (원클릭)

### Windows 포터블 exe (Windows에서)

`scripts/win/build-windows.bat` **더블클릭**.

`native/windows-process-loopback/Program.cs`(프로그램별 오디오 캡처 helper)를 .NET `csc.exe` 로 먼저 컴파일한 뒤
electron-builder로 x64 포터블 exe를 만듭니다.
산출물: **`dist/Accord Windows x64 Portable.exe`**

### macOS 앱 (macOS에서)

`scripts/mac/build-mac.command` **더블클릭**.

arm64 zip을 만듭니다. 산출물: **`dist/Accord Mac arm64.zip`**

---

## 2. 직접 명령으로 빌드 (수동)

저장소 루트에서:

### Windows

```bash
npm run build:win
```

### macOS

```bash
npm run build:mac
```

두 명령 모두 끝에 `dist/` 안에 산출물이 생깁니다. 필요하면 `node scripts/prune-dist.js` 로 중간 산출물을 정리합니다.

---

## 검증

```bash
npm run check   # scripts/check-v2.js — 정적 검사 + 회귀 리뷰
```

## 버전 규칙

- **서버 버전**: `server.js` 의 `VERSION` (n.n.n)
- **클라이언트 버전**: `public/app.js` 의 `CLIENT_VERSION` — 서버 버전과 헷갈리지 않게 **그냥 정수**(1, 2, 3 …)로 올립니다.
  `package.json` 의 `version` 은 electron-builder가 semver를 요구해 `"N.0.0"` 형태로 두고, 그 앞 숫자(major)가 `CLIENT_VERSION` 과 같아야 합니다(`npm run check` 가 검사).
- `public/` 등 클라 코드가 바뀌면 서버가 그 코드를 배포하므로 서버 버전도 함께 올립니다.
