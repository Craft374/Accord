# Accord

> 대화와 기록, 협업이 하나의 흐름으로.

**한국어** · [English](README.en.md)

**Accord**는 저지연 음성 통화와 화면 공유에서 시작해 채팅, 마크다운 메모, 공동 창작 도구까지 한곳에 담은 협업 앱입니다.
Discord의 소통, Slack의 협업, Notion의 기록이 만나는 지점—그 사이 어딘가를 지향합니다.

이름은 불일치를 뜻하는 Discord의 반대말, **Accord(조화·합의)**에서 가져왔습니다.
흩어진 대화와 작업이 자연스럽게 어우러지는 공간이라는 의미를 담았습니다.

[공식 홈페이지](https://craft374.github.io/Accord/) · [서버 열기](docs/SERVER.md) · [앱 빌드](docs/BUILD.md)

- 서버(`server.js`)가 시그널링(WebSocket)과 통화 UI(`public/`)를 함께 내려줍니다.
- 데스크톱 앱(Electron)은 서버 주소를 입력해 그 UI를 여는 얇은 껍데기입니다.
- 통화 자체는 WebRTC P2P이고, 필요하면 TURN(coturn) 릴레이를 씁니다.

## 주요 기능

- **통화** — 방 만들기 / 입장 / 인원 제한, 마이크 통화, 입력·출력 장치 선택, 상대별 볼륨 조절
- **화면 공유** — 해상도·프레임 선택, Windows는 고성능 캡처 경로, 컴퓨터 사운드 공유(Windows 전체/프로그램별, macOS BlackHole·Loopback)
- **오디오 품질** — 잡음·에코 제거 / 자동 증폭 / 저지연 / 고음질 옵션, 연결 품질 표시, 진단·자동 복구
- **채널 & 방** — 계정·초대코드 기반 채널, 역할·권한, 통화방 외에 채팅·메모장·그림판·로그 방
- **함께 쓰기** — 실시간 채팅(마크다운·이미지·커스텀 이모지), 공동 메모장(글꼴·글자색·코드 강조), 공동 그림판, 1:1 DM
- **다크 UI** — 디스코드풍 다크 테마, 프로필 카드, 집중 모드

## 어떻게 생겼나

데스크톱 앱을 켜면 서버 주소를 입력하는 시작 화면이 나오고, 접속하면 왼쪽에 채널·방 목록,
가운데에 통화/채팅/메모/그림판 화면이 뜨는 구성입니다.

## 바로 시작

- **서버를 열고 싶다** → [docs/SERVER.md](docs/SERVER.md)
  (macOS는 `start-server-mac.command`, Windows 로컬 테스트는 `start-server-win.bat` 더블클릭)
- **데스크톱 앱을 빌드하고 싶다** → [docs/BUILD.md](docs/BUILD.md)
- **소스로 앱을 실행해보고 싶다** → `npm install` 후 `npm run client`

> 서버 실행에는 Node.js 18+ 만 있으면 됩니다(서버는 의존성 없음). 브라우저에서 마이크·화면공유를 쓰려면
> HTTPS(또는 localhost)가 필요합니다.

## 프로젝트 구조

```
server.js                          시그널링 + UI 서빙 서버 (의존성 없음)
data-store.js                      계정·채널·방·메모 등 영속 데이터
public/                            통화·채팅·메모·그림판 UI (서버가 내려줌)
website/                           GitHub Pages 공식 홈페이지
electron/                          데스크톱 앱 메인/프리로드
shell/                             데스크톱 앱 시작 화면 (서버 주소 입력)
native/windows-process-loopback/   Windows 프로그램별 오디오 캡처 helper (C#)
scripts/                           빌드·검사용 Node 스크립트
scripts/win/                       Windows 빌드 스크립트 (.bat/.command)
scripts/mac/                       macOS 빌드·서버 스크립트 (.command/.sh)
docs/                              서버 열기 / 앱 빌드 가이드
start-server-mac.command           macOS 서버 원클릭 실행
start-server-win.bat               Windows 로컬 서버 원클릭 실행
```

## 사용 기술

Node.js (서버, 의존성 없음) · WebRTC · Electron · coturn(TURN)
