# Accord

친구랑 바로 들어가서 통화하려고 만든 개인용 저지연 음성 통화 + 화면 공유 도구입니다.
이름은 같은 통화 플랫폼인 Discord의 반대 의미에서 가져왔습니다.

- 서버(`server.js`)가 시그널링(WebSocket)과 통화 UI(`public/`)를 함께 내려줍니다.
- 데스크톱 앱(Electron)은 서버 주소를 입력해 그 UI를 여는 얇은 껍데기입니다.
- 통화 자체는 WebRTC P2P이고, 필요하면 TURN(coturn) 릴레이를 씁니다.

## 주요 기능

- 방 만들기 / 입장 / 인원 제한, 다크 UI
- 마이크 통화, 입력/출력 장치 선택, 상대별 볼륨 조절
- 화면 공유 (해상도/프레임 선택, Windows는 고성능 캡처 경로 지원)
- 컴퓨터 사운드 공유 (Windows: 전체 또는 프로그램별 선택, macOS: BlackHole/Loopback 연동)
- 잡음 제거 / 에코 제거 / 자동 증폭 / 저지연 / 고음질 옵션 (잡음·에코 제거는 기본 꺼짐)
- 연결 품질 표시, 오디오 진단, 자동 복구

## 요구 사항

| 무엇 | 필요한 것 |
|---|---|
| 서버 실행 | Node.js 18 이상 (별도 npm install 불필요 — 서버는 의존성 없음) |
| HTTPS 인증서 자동 생성 | openssl (macOS/Linux 기본 포함, Windows는 Git 설치 시 포함) |
| TURN 서버 (외부 접속용) | Docker (macOS는 Docker Desktop) |
| 데스크톱 앱 개발/빌드 | Node.js + `npm install` (electron, electron-builder) |
| Windows 앱 빌드 | Windows + .NET Framework 4.x의 `csc.exe` (Windows 기본 포함) |

브라우저에서 마이크/화면공유를 쓰려면 HTTPS(또는 localhost)가 필수라서, 서버는 기본적으로 HTTPS로 띄웁니다.
인증서는 처음 실행할 때 `.cert/`에 자기서명으로 자동 생성됩니다(브라우저 경고는 "계속 진행"으로 통과).

## 서버 실행

### macOS (권장 — 원클릭)

```
start-server-mac.command 더블클릭
```

Docker Desktop을 확인/실행하고, coturn TURN 서버를 띄우고 `server.env`를 자동 생성한 뒤 HTTPS 서버를 엽니다.
Windows/Parallels/외부에서 접속하는 구성이면 [SETUP_MAC_SERVER.md](SETUP_MAC_SERVER.md)를 먼저 읽어 주세요.

터미널에서 직접 열려면:

```bash
./start-mac-server.sh        # TURN 포함 (Docker 필요)
node scripts/start-https.js  # HTTPS 서버만 (TURN 없이)
```

### Windows

```bash
node scripts/start-https.js
```

openssl이 PATH에 없으면(Git Bash가 아닌 cmd 등) 인증서 생성에 실패할 수 있습니다.
이 경우 Git Bash에서 실행하거나, 이미 있는 인증서를 환경변수로 지정하세요:

```bash
SSL_CERT_FILE=경로/cert.pem SSL_KEY_FILE=경로/key.pem node server.js
```

### Linux

```bash
node scripts/start-https.js
```

TURN이 필요하면 coturn을 직접 띄우고 `server.env`에 값을 적습니다(아래 TURN 설정 참고).

### 공통

- 기본 포트: `25565` (`PORT` 환경변수로 변경 가능)
- 서버가 켜지면 콘솔에 로컬/LAN/외부용 접속 주소가 출력됩니다.
- 로컬 테스트만 할 때는 `npm start`(HTTP)도 되지만, 다른 기기에서는 마이크가 차단됩니다.

## 클라이언트 접속

- **데스크톱 앱**: 빌드된 앱을 실행하고 서버 주소(`https://서버IP:25565`)를 입력
- **브라우저**: `https://서버IP:25565` 접속 (Chrome 권장)
- **개발 중**: `npm install` 후 `npm run client` (Electron을 소스로 실행)

## 외부(인터넷) 접속 설정

같은 공유기 밖의 친구가 접속하려면 공유기에서 서버 PC 내부 IP로 포트포워딩이 필요합니다.

| 용도 | 포트 |
|---|---|
| Accord HTTPS/WSS | `25565/TCP` |
| TURN | `3478/TCP`, `3478/UDP` |
| TURN relay | `49160-49200/TCP`, `49160-49200/UDP` |

TURN은 반드시 **공인 IP(또는 도메인)** 로 광고돼야 합니다. `turn:192.168.x.x` 같은 사설 IP가
클라이언트에 전달되면 외부에서는 relay 연결이 안 됩니다.

## TURN 설정 (`server.env`)

macOS 원클릭 스크립트는 자동으로 만들어 줍니다. 수동으로 설정하려면 `server.env.example`을
`server.env`로 복사하고 채웁니다:

```env
TURN_URLS=turn:공인IP또는도메인:3478?transport=udp,turn:공인IP또는도메인:3478?transport=tcp
TURN_USERNAME=아이디
TURN_CREDENTIAL=비밀번호
STUN_URLS=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478
```

서버를 켜면 TURN 설정 여부가 콘솔에 표시됩니다. 연결이 안 될 때는 클라이언트 진단 로그에서
`ice-server-config`, `relay-candidate-local/remote`, `selected-candidate-pair`를 확인하세요.

## 데스크톱 앱 빌드

```bash
npm install
```

### Windows 포터블 exe (Windows에서)

```bash
npm run build:win
# 또는 scripts/build-windows.bat 더블클릭
```

`native/windows-process-loopback/Program.cs`(프로그램별 오디오 캡처 helper)를 .NET `csc.exe`로
먼저 컴파일한 뒤 electron-builder로 x64 포터블 exe를 만듭니다. 산출물: `dist/Accord Windows x64 Portable.exe`

### macOS 앱 (macOS에서)

```bash
npm run build:mac
# 또는 scripts/build-mac.command 더블클릭
```

arm64 zip을 만듭니다. 산출물: `dist/Accord Mac arm64.zip`

### 검증

```bash
npm run check   # scripts/check-v2.js — 정적 검사 + 회귀 리뷰
```

## 프로젝트 구조

```
server.js                  시그널링 + UI 서빙 HTTPS 서버 (의존성 없음)
public/                    통화 UI (서버가 내려줌 — 수정하면 서버 업데이트 필요)
electron/                  데스크톱 앱 메인/프리로드
shell/                     데스크톱 앱 시작 화면 (서버 주소 입력)
native/windows-process-loopback/  Windows 프로그램별 오디오 캡처 helper (C#)
scripts/                   서버 실행 / 빌드 / 검사 스크립트
setup-turn-mac.sh          macOS Docker coturn 자동 설정
legacy/electron-v1/        구버전 보관
```

## 서버 업데이트 방식

서버(Mac)는 이 저장소를 `git pull` 해서 업데이트합니다.
`server.js`뿐 아니라 **`public/`(통화 UI)을 고친 경우에도** 서버가 UI를 내려주기 때문에
push → 서버에서 pull → 서버 재시작이 필요합니다. 데스크톱 앱 재빌드는 `electron/`, `shell/`,
`native/`가 바뀐 경우에만 필요합니다.

## 문제 해결

- **마이크 권한이 차단됨**: HTTP로 접속했는지 확인 — HTTPS(자기서명 포함)나 localhost만 마이크 사용 가능
- **친구가 연결이 안 됨**: TURN 미설정이거나 사설 IP로 광고 중일 가능성 — 포트포워딩과 `server.env`의 공인 IP 확인
- **인증서 경고**: 자기서명 인증서라 정상 — 브라우저에서 "고급 → 계속 진행"
- **에코가 남**: 설정에서 "에코 제거"를 켜거나 헤드폰 사용, macOS는 출력 장치를 실제 스피커/헤드폰으로 지정

## 사용 기술

- Node.js (서버, 의존성 없음) / WebRTC / Electron / coturn(TURN)
