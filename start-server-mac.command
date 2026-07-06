#!/bin/zsh

cd "$(dirname "$0")"

./start-mac-server.sh
exit_code=$?

echo ""
if [[ $exit_code -eq 0 ]]; then
  echo "서버가 종료되었습니다."
else
  echo "서버 실행에 실패했습니다. 위 메시지를 확인해 주세요."
fi
read -k 1 "?창을 닫으려면 아무 키나 누르세요..."
exit "$exit_code"
