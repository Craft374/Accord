# 서버 여는 방법

**한국어** · [English](SERVER.en.md)

Accord 서버(`server.js`)는 시그널링(WebSocket)과 통화 UI(`public/`)를 함께 내려주는, 의존성 없는 Node.js 서버입니다.
브라우저에서 마이크·화면공유를 쓰려면 **HTTPS(또는 localhost)** 가 필요해서, 실사용 서버는 HTTPS로 띄웁니다.

- 기본 포트: `25565` (환경변수 `PORT` 로 변경 가능)
- 서버가 켜지면 콘솔에 로컬 / LAN / 외부용 접속 주소가 출력됩니다.
- 인증서는 처음 HTTPS로 실행할 때 `.cert/` 에 자기서명으로 자동 생성됩니다(브라우저 경고는 "고급 → 계속 진행"으로 통과).

---

## 1. 스크립트로 바로 열기 (원클릭)

### macOS — 실사용 서버 (HTTPS + TURN)

루트의 **`start-server-mac.command` 더블클릭**.

Docker Desktop을 확인·실행하고 → coturn TURN 서버를 띄우고 → `server.env` 를 자동 생성한 뒤 → HTTPS 서버를 엽니다.
끄려면 창에서 `Ctrl+C` (HTTPS와 coturn이 같이 꺼집니다).

> 필요한 것: Node.js 18+, Docker Desktop. 외부(인터넷) 접속까지 하려면 [외부 접속 설정](#외부인터넷-접속)을 먼저 읽어 주세요.

### Windows — 로컬 테스트 서버 (HTTP)

루트의 **`start-server-win.bat` 더블클릭**.

이 PC에서 `http://localhost:25565` 로 바로 접속되는 간단한 서버입니다(localhost는 HTTP여도 마이크가 됩니다).
끄려면 창에서 `Ctrl+C`.

> 다른 기기·외부에서 접속하거나 마이크를 쓰려면 HTTPS가 필요합니다 → 아래 "직접 명령으로 열기 · Windows" 참고.

---

## 2. 직접 명령으로 열기 (수동)

먼저 저장소 루트로 이동한 뒤:

### macOS

```bash
./scripts/mac/start-mac-server.sh   # TURN 포함 (Docker 필요, 위 원클릭과 동일)
node scripts/start-https.js         # HTTPS 서버만 (TURN 없이)
node server.js                      # HTTP 서버 (localhost 테스트용)
```

### Windows

```bash
node scripts/start-https.js         # HTTPS (LAN/외부용) — openssl 필요
node server.js                      # HTTP (localhost 테스트용)
```

`node scripts/start-https.js` 는 자기서명 인증서를 만들 때 **openssl** 을 씁니다. cmd/PowerShell PATH에 openssl이 없으면
Git Bash에서 실행하거나, 이미 있는 인증서를 환경변수로 지정하세요:

```bash
SSL_CERT_FILE=경로/cert.pem SSL_KEY_FILE=경로/key.pem node server.js
```

### Linux

```bash
node scripts/start-https.js         # HTTPS
node server.js                      # HTTP
```

TURN이 필요하면 coturn을 직접 띄우고 `server.env` 에 값을 채웁니다(아래 참고).

---

## 클라이언트 접속

- **데스크톱 앱**: 앱을 실행하고 서버 주소(`https://서버IP:25565`)를 입력
- **브라우저**: `https://서버IP:25565` 접속 (Chrome 권장)
- **개발 중**: `npm install` 후 `npm run client` (Electron을 소스로 실행)

---

## 외부(인터넷) 접속

같은 공유기 밖의 친구가 접속하려면 공유기에서 **서버 PC 내부 IP로 포트포워딩**이 필요합니다.

| 용도 | 포트 |
|---|---|
| Accord HTTPS/WSS | `25565/TCP` |
| TURN | `3478/TCP`, `3478/UDP` |
| TURN relay | `49160-49200/TCP`, `49160-49200/UDP` |

TURN은 반드시 **공인 IP(또는 도메인)** 로 광고돼야 합니다. `turn:192.168.x.x` 같은 사설 IP가 클라이언트에 전달되면
외부에서는 relay 연결이 안 됩니다.

### Mac을 서버로 두는 기준 구성

1. Mac에 Docker Desktop 설치·실행
2. `start-server-mac.command` 더블클릭 (coturn + HTTPS 순서로 켜짐)
3. macOS 방화벽 알림이 뜨면 Node.js/Docker 연결 허용
4. 공유기 포트포워딩을 Mac 내부 IP로 설정 (위 포트)
5. 클라이언트는 `https://Mac주소:25565` 로 접속
6. TURN 값만 다시 만들고 싶으면 `start-server-mac.command` 를 다시 실행

---

## TURN 설정 (`server.env`)

macOS 원클릭 스크립트는 자동으로 만들어 줍니다. 수동으로 하려면 `server.env.example` 을 `server.env` 로 복사하고 채웁니다:

```env
TURN_URLS=turn:공인IP또는도메인:3478?transport=udp,turn:공인IP또는도메인:3478?transport=tcp
TURN_USERNAME=아이디
TURN_CREDENTIAL=비밀번호
STUN_URLS=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478
```

서버를 켜면 TURN 설정 여부가 콘솔에 표시됩니다.

---

## 확인할 진단 로그

연결이 안 될 때 클라이언트 진단 로그에서 확인하세요:

- `ice-server-config`: 클라이언트가 서버에서 TURN 설정을 받았는지
- `relay-candidate-local` / `relay-candidate-remote`: relay candidate 생성 여부
- `selected-candidate-pair`: 실제 선택된 ICE 경로
- `candidate-counts`: `host` / `srflx` / `relay` 개수

`ICE failed` 인데 relay candidate가 없으면 TURN 서버, `3478` 포트, relay 포트 범위, TURN 계정을 먼저 확인합니다.

---

## 문제 해결

- **마이크 권한 차단**: HTTP로 접속했는지 확인 — HTTPS(자기서명 포함)나 localhost만 마이크 사용 가능
- **친구가 연결 안 됨**: TURN 미설정이거나 사설 IP로 광고 중 — 포트포워딩과 `server.env` 의 공인 IP 확인
- **인증서 경고**: 자기서명이라 정상 — 브라우저에서 "고급 → 계속 진행"
- **에코**: 설정에서 "에코 제거"를 켜거나 헤드폰 사용. macOS는 출력 장치를 실제 스피커/헤드폰으로 지정

## 서버 업데이트

서버(Mac)는 이 저장소를 `git pull` 해서 업데이트합니다. `server.js` 뿐 아니라 **`public/`(통화 UI)을 고친 경우에도**
서버가 UI를 내려주기 때문에 `push → 서버에서 pull → 서버 재시작` 이 필요합니다.
데스크톱 앱 재빌드는 `electron/`, `shell/`, `native/` 가 바뀐 경우에만 필요합니다([BUILD.md](BUILD.md)).
