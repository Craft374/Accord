#!/bin/zsh
# 기숙사/학교망 등 TLS 가로채기(SSL 인젝션) 환경 전용.
# 서버의 아웃바운드 인증서 검증을 끄고 여는 임시용 실행 파일.
# 집 등 정상망에서는 이거 말고 npm run server / start-server-mac.command 를 쓸 것.

cd "$(dirname "$0")"

echo "⚠️  인증서 검증을 끄고 서버를 실행합니다 (기숙사망 임시용)."
NODE_TLS_REJECT_UNAUTHORIZED=0 node server.js
exit_code=$?

echo ""
if [[ $exit_code -eq 0 ]]; then
  echo "서버가 종료되었습니다."
else
  echo "서버 실행에 실패했습니다. 위 메시지를 확인해 주세요."
fi
read -k 1 "?창을 닫으려면 아무 키나 누르세요..."
exit "$exit_code"
