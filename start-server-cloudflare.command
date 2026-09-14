#!/bin/zsh
set -u

cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
SERVER_PORT="${PORT:-25565}"
SERVER_PID=""
TUNNEL_PID=""
TUNNEL_CONFIG=""

cleanup() {
  local child_pid
  for child_pid in "$TUNNEL_PID" "$SERVER_PID"; do
    if [[ -n "$child_pid" ]]; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  TUNNEL_PID=""
  SERVER_PID=""
  if [[ -n "$TUNNEL_CONFIG" ]]; then
    rm -f "$TUNNEL_CONFIG"
    TUNNEL_CONFIG=""
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

main() {
  if [[ "$SERVER_PORT" != <1-65535> ]]; then
    echo "PORT는 1~65535 사이의 숫자여야 합니다."
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 18 이상을 설치한 뒤 다시 실행해 주세요."
    return 1
  fi
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared가 필요합니다. 터미널에서 brew install cloudflared 실행 후 다시 열어 주세요."
    return 1
  fi
  if lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$SERVER_PORT 포트를 사용 중입니다. 기존 Accord/dorm 서버를 끄고 다시 실행해 주세요."
    return 1
  fi

  # 기존 Cloudflare 계정 설정과 별개로 임시 터널을 연다.
  TUNNEL_CONFIG="$(mktemp -t accord-cloudflare)" || return 1
  printf '{}\n' > "$TUNNEL_CONFIG" || return 1

  echo "Accord 임시 외부 접속 서버를 시작합니다."
  PORT="$SERVER_PORT" HOST=127.0.0.1 PUBLIC_HOST=localhost node scripts/start-https.js &
  SERVER_PID=$!

  local ready=0 attempt
  local local_url="https://127.0.0.1:$SERVER_PORT"
  for attempt in {1..40}; do
    kill -0 "$SERVER_PID" 2>/dev/null || break
    if curl --noproxy '*' -fkSs --max-time 1 "$local_url/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ready" != "1" ]] || ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "서버가 준비되지 않았습니다. 위 오류를 확인해 주세요."
    return 1
  fi

  echo ""
  echo "아래에 표시되는 https://...trycloudflare.com 주소를 친구에게 보내 주세요."
  echo "이 창을 켜 두세요. Ctrl+C 또는 창을 닫으면 서버와 외부 접속이 함께 종료됩니다."
  echo "음성·화면공유는 P2P 연결이며, 기숙사망에서는 별도 TURN이 필요할 수 있습니다."
  echo ""
  # 자기서명 인증서 예외는 이 PC의 루프백 서버 연결에만 적용한다.
  cloudflared tunnel --config "$TUNNEL_CONFIG" --no-autoupdate --protocol http2 \
    --url "$local_url" --no-tls-verify --grace-period 1s &
  TUNNEL_PID=$!

  while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep 1
  done
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Accord 서버가 종료되어 외부 접속도 종료합니다."
    return 1
  fi
  wait "$TUNNEL_PID"
}

main
exit_code=$?
cleanup
if [[ "$exit_code" -ne 0 && -t 0 ]]; then
  read -k 1 "?창을 닫으려면 아무 키나 누르세요..."
fi
exit "$exit_code"
