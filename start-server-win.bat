@echo off
setlocal
cd /d "%~dp0"

echo Accord 서버 (Windows - 로컬 테스트용)
echo ---------------------------------------
echo 이 PC에서 https://localhost:25565 로 접속하세요. (자체서명 인증서라 브라우저 경고가 뜨면 "고급 - 계속 진행")
echo (같은 네트워크의 다른 기기는 https://이PC의IP:25565 - docs/SERVER.md 참고)
echo 서버를 끄려면 이 창에서 Ctrl+C 를 누르세요.
echo.

if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" server.js
) else (
  node server.js
)

if errorlevel 1 (
  echo.
  echo 서버 실행에 실패했습니다. Node.js가 설치돼 있는지 확인해 주세요.
)
echo.
pause
