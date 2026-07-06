# Mac 서버 설정

Mac에서 HTTPS Accord 서버와 Docker coturn TURN 서버를 열고, Windows/Parallels는 Mac 서버 주소로 접속하는 기준입니다.

## 순서

1. Mac에 Docker Desktop을 설치하고 실행합니다.
2. `start-server-mac.command`를 더블클릭합니다.
3. 스크립트가 Docker Desktop을 확인하고, coturn TURN 서버와 HTTPS 서버를 순서대로 켭니다.
4. macOS 방화벽 알림이 뜨면 Node.js/Docker 연결을 허용합니다.
5. 외부 네트워크에서 접속할 경우 공유기 포트포워딩을 Mac 내부 IP로 설정합니다.
6. Windows/Parallels 클라이언트는 `https://Mac주소:25565`로 접속합니다.
7. 클라이언트 진단 로그에서 `ice-server-config`, `relay-candidate-local` 또는 `relay-candidate-remote`를 확인합니다.

TURN 값만 다시 만들고 싶을 때도 `start-server-mac.command`를 다시 실행하면 됩니다.

## 포트

- Accord HTTPS/wss: `25565/TCP`
- TURN: `3478/TCP`, `3478/UDP`
- coturn relay: `49160-49200/TCP`, `49160-49200/UDP`

공유기 포트포워딩이 필요하면 위 포트를 Mac 내부 IP로 열어야 합니다.
공유기 설정은 자동으로 바꾸지 않습니다.

## 확인할 로그

- `ice-server-config`: 클라이언트가 서버에서 TURN 설정을 받았는지 확인
- `relay-candidate-local` / `relay-candidate-remote`: relay candidate 생성 여부 확인
- `selected-candidate-pair`: 실제 선택된 ICE 경로 확인
- `candidate-counts`: `host`, `srflx`, `relay` 개수 확인

ICE failed인데 relay candidate가 없으면 Mac TURN 서버, 3478 포트, relay 포트 범위, TURN 계정을 먼저 확인합니다.
