#!/bin/zsh
set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN=""
TURN_CONTAINER_NAME="${TURN_CONTAINER_NAME:-accord-coturn}"
STOP_TURN_ON_EXIT=0

main() {
  cd "$ROOT_DIR"
  trap cleanup EXIT INT TERM

  echo "Accord Mac one-click server"
  echo "-------------------------------"
  echo ""

  NODE_BIN="$(find_node)"
  if [[ -z "$NODE_BIN" ]]; then
    echo "Node.js를 찾지 못했습니다."
    echo "Node.js 설치 후 다시 실행해 주세요."
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker 명령을 찾지 못했습니다."
    echo "Docker Desktop을 설치하고 다시 실행해 주세요."
    echo "다운로드: https://www.docker.com/products/docker-desktop/"
    return 1
  fi

  ensure_docker_desktop || return 1

  echo ""
  echo "TURN/coturn을 준비합니다."
  ./setup-turn-mac.sh || return 1
  STOP_TURN_ON_EXIT=1

  echo ""
  echo "HTTPS Accord 서버를 시작합니다."
  echo "서버를 끄려면 이 창에서 Ctrl+C를 누르세요. HTTPS와 coturn이 같이 꺼집니다."
  echo ""

  "$NODE_BIN" scripts/start-https.js
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then
      print -r -- "$candidate"
      return
    fi
  done
}

ensure_docker_desktop() {
  if docker info >/dev/null 2>&1; then
    echo "Docker Desktop: 실행 중"
    return 0
  fi

  echo "Docker Desktop을 시작합니다."
  if ! open -a Docker >/dev/null 2>&1; then
    echo "Docker Desktop 앱을 열지 못했습니다."
    echo "Docker Desktop을 직접 실행한 뒤 다시 시도해 주세요."
    return 1
  fi

  local waited=0
  while [[ $waited -lt 120 ]]; do
    if docker info >/dev/null 2>&1; then
      echo ""
      echo "Docker Desktop: 실행 중"
      return 0
    fi
    printf "."
    sleep 2
    waited=$((waited + 2))
  done

  echo ""
  echo "Docker Desktop이 120초 안에 준비되지 않았습니다."
  echo "Docker Desktop이 완전히 켜진 뒤 다시 실행해 주세요."
  return 1
}

cleanup() {
  if [[ "$STOP_TURN_ON_EXIT" != "1" ]]; then
    return
  fi
  STOP_TURN_ON_EXIT=0
  echo ""
  echo "coturn 컨테이너를 정리합니다."
  docker stop "$TURN_CONTAINER_NAME" >/dev/null 2>&1 || true
}

main "$@"
