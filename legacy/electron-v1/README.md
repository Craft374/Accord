# Accord

친구와 직접 연 서버에서 쓰는 저지연 음성통화 앱

브라우저 통화보다 장치 설정을 더 만지기 쉽게 하려고 데스크톱 클라이언트로 바꿨습니다.  
현재 0.1v

## 실행 방법

서버만 열기:

```bash
npm run server:open
```

기본 포트는 `25565`입니다.

## 클라이언트

빌드 결과:

- Mac: `dist/Accord Mac arm64.zip`
- Windows: `dist/Accord Windows x64.exe`

개발 실행:

```bash
npm run client
```

## 완료

- 방 목록에서 만들기/입장
- 방별 인원 제한
- 여러 명 WebRTC 음성 연결
- 입력 장치 선택
- 출력 장치 선택
- 마이크 증폭 조절
- 잡음 제거, 에코 제거, 자동 증폭 설정
- 컴퓨터 사운드 공유 옵션
- Opus 고음질/저지연 설정
- 송신/수신 bitrate, RTT, 지터, 손실률, 코덱 표시
- 서버 원클릭 실행 스크립트
- Mac/Windows 클라이언트 빌드 설정

## 개발중

- 연결 실패 원인 표시 개선
- TURN 서버 설정
- 아이콘과 서명 설정

## 고민중

- macOS 시스템 사운드 공유 방식
- 방 유지 방식

## 사용 기술

- Node.js
- Electron
- WebRTC
- WebSocket
- HTML/CSS/JavaScript

## 참고

- 친구에게는 서버에 뜨는 `Friend` 주소를 보내면 됩니다.
- `localhost`는 각자 자기 컴퓨터라서 친구에게 보내면 안 됩니다.
- 자체 인증서를 쓰기 때문에 처음 실행 시 보안 경고가 뜰 수 있습니다.
- Windows는 앱 안에서 컴퓨터 사운드 공유를 켤 수 있습니다.
- macOS는 직접 시스템 사운드 공유 대신 BlackHole 같은 가상 오디오 장치를 입력으로 선택하는 방식이 필요합니다.
- Mac에서 마이크와 컴퓨터 소리를 같이 보내려면 Audio MIDI 설정에서 마이크+BlackHole Aggregate Device를 만들고, 출력은 스피커+BlackHole Multi-Output Device로 잡는 방식이 필요합니다.
