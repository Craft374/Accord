#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/server.env"
CONTAINER_NAME="${TURN_CONTAINER_NAME:-accord-coturn}"
IMAGE="${TURN_IMAGE:-coturn/coturn:latest}"
STUN_URLS_VALUE="${STUN_URLS:-stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478}"
RELAY_MIN="${TURN_RELAY_MIN_PORT:-49160}"
RELAY_MAX="${TURN_RELAY_MAX_PORT:-49200}"
REALM="${TURN_REALM:-accord.local}"

main() {
  echo "Accord Mac TURN setup"
  echo "-------------------------"
  echo ""

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker를 찾지 못했습니다."
    echo "Mac에 Docker Desktop을 설치하고 실행한 뒤 다시 실행해 주세요."
    echo "다운로드: https://www.docker.com/products/docker-desktop/"
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker Desktop이 실행 중이 아닙니다."
    echo "Docker Desktop을 먼저 켠 뒤 다시 실행해 주세요."
    exit 1
  fi

  LAN_IP="$(detect_lan_ip || true)"
  EXISTING_PUBLIC_HOST="$(read_env_value PUBLIC_HOST || true)"
  # TURN 주소가 사설 IP면 외부 클라이언트가 relay를 못 만들어 연결이 실패한다.
  # 공인 IP를 자동 감지해 우선 사용한다.
  PUBLIC_IP="$(detect_public_ip || true)"
  TURN_HOST="${TURN_HOST:-${EXISTING_PUBLIC_HOST:-${PUBLIC_IP:-$LAN_IP}}}"

  if [[ -z "$TURN_HOST" ]]; then
    echo "Mac 내부 IP를 자동으로 찾지 못했습니다."
    echo "예: TURN_HOST=192.168.0.10 ./setup-turn-mac.sh"
    exit 1
  fi

  TURN_USERNAME="${TURN_USERNAME:-voicechat-$(date +%Y%m%d%H%M%S)}"
  TURN_PASSWORD="${TURN_CREDENTIAL:-$(make_secret)}"
  TURN_URLS_VALUE="${TURN_URLS:-turn:${TURN_HOST}:3478?transport=udp,turn:${TURN_HOST}:3478?transport=tcp}"
  EXTERNAL_IP_ARG="$(make_external_ip_arg "$TURN_HOST" "$LAN_IP")"

  echo "Mac 내부 IP: ${LAN_IP:-확인 필요}"
  echo "공인 IP(자동 감지): ${PUBLIC_IP:-감지 실패}"
  echo "TURN 주소: ${TURN_HOST}"
  echo "TURN relay 포트: ${RELAY_MIN}-${RELAY_MAX}"
  if is_private_ipv4 "$TURN_HOST"; then
    echo ""
    echo "⚠️  경고: TURN 주소(${TURN_HOST})가 사설 IP입니다."
    echo "   외부(친구) 클라이언트는 이 TURN에 접근할 수 없어 통화 연결이 실패합니다."
    echo "   공인 IP로 다시 실행하세요: TURN_HOST=<공인IP> ./setup-turn-mac.sh"
  fi
  echo ""

  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "기존 coturn 컨테이너를 교체합니다: $CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  docker_args=(
    run -d
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    -p "3478:3478/udp"
    -p "3478:3478/tcp"
    -p "${RELAY_MIN}-${RELAY_MAX}:${RELAY_MIN}-${RELAY_MAX}/udp"
    -p "${RELAY_MIN}-${RELAY_MAX}:${RELAY_MIN}-${RELAY_MAX}/tcp"
    "$IMAGE"
    -n
    --log-file=stdout
    --listening-port=3478
    --min-port="$RELAY_MIN"
    --max-port="$RELAY_MAX"
    --lt-cred-mech
    --fingerprint
    --realm="$REALM"
    --user="${TURN_USERNAME}:${TURN_PASSWORD}"
    --no-cli
    --no-tls
    --no-dtls
  )

  if [[ -n "$EXTERNAL_IP_ARG" ]]; then
    docker_args+=(--external-ip "$EXTERNAL_IP_ARG")
  fi

  echo "coturn Docker 컨테이너를 시작합니다."
  docker "${docker_args[@]}" >/dev/null

  update_server_env

  echo ""
  echo "TURN 설정 완료"
  echo "- container: $CONTAINER_NAME"
  echo "- TURN_URLS: $TURN_URLS_VALUE"
  echo "- TURN_USERNAME: $TURN_USERNAME"
  echo "- TURN_CREDENTIAL: 자동 생성됨"
  echo ""
  echo "공유기 포트포워딩이 필요하면 Mac 내부 IP(${LAN_IP:-확인 필요})로 아래 포트를 열어 주세요."
  echo "- Accord HTTPS: 25565/TCP"
  echo "- TURN: 3478/TCP, 3478/UDP"
  echo "- TURN relay: ${RELAY_MIN}-${RELAY_MAX}/TCP, ${RELAY_MIN}-${RELAY_MAX}/UDP"
}

detect_public_ip() {
  local url ip
  for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://checkip.amazonaws.com"; do
    ip="$(curl -4fsS --max-time 3 "$url" 2>/dev/null | tr -d '[:space:]')"
    if is_ipv4 "$ip"; then
      print -r -- "$ip"
      return
    fi
  done
  return 1
}

is_private_ipv4() {
  local value="$1"
  is_ipv4 "$value" || return 1
  case "$value" in
    192.168.*|10.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
  esac
  return 1
}

detect_lan_ip() {
  local iface ip route_iface
  for iface in en0 en1 bridge100; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if is_ipv4 "$ip"; then
      print -r -- "$ip"
      return
    fi
  done

  route_iface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "$route_iface" ]]; then
    ip="$(ipconfig getifaddr "$route_iface" 2>/dev/null || true)"
    if is_ipv4 "$ip"; then
      print -r -- "$ip"
      return
    fi
  fi
}

read_env_value() {
  local key="$1"
  local value
  [[ -f "$ENV_FILE" ]] || return 1
  value="$(sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  [[ -n "$value" ]] || return 1
  print -r -- "$value"
}

make_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 18
    return
  fi
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr -d "-" | tr "[:upper:]" "[:lower:]"
    return
  fi
  date +%s%N
}

make_external_ip_arg() {
  local host="$1"
  local lan_ip="$2"
  local external="${TURN_EXTERNAL_IP:-}"

  if [[ -z "$external" ]]; then
    if is_ipv4 "$host"; then
      external="$host"
    else
      external="$lan_ip"
    fi
  fi

  if [[ -z "$external" ]]; then
    return
  fi
  if [[ -n "$lan_ip" && "$external" != "$lan_ip" && "$(is_ipv4_text "$external")" == "1" && "$(is_ipv4_text "$lan_ip")" == "1" ]]; then
    print -r -- "${external}/${lan_ip}"
    return
  fi
  print -r -- "$external"
}

is_ipv4() {
  [[ "$(is_ipv4_text "$1")" == "1" ]]
}

is_ipv4_text() {
  local value="$1"
  local regex='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
  if [[ "$value" =~ "$regex" ]]; then
    print -r -- "1"
  else
    print -r -- "0"
  fi
}

update_server_env() {
  local tmp backup
  tmp="${ENV_FILE}.tmp.$$"

  if [[ -f "$ENV_FILE" ]]; then
    backup="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$ENV_FILE" "$backup"
    echo "기존 server.env 백업: ${backup:t}"
    awk '
      BEGIN {
        skip["STUN_URLS"] = 1
        skip["TURN_URLS"] = 1
        skip["TURN_URL"] = 1
        skip["TURNS_URL"] = 1
        skip["TURN_USERNAME"] = 1
        skip["TURN_CREDENTIAL"] = 1
      }
      {
        line = $0
        key = line
        sub(/=.*/, "", key)
        gsub(/^[ \t]+|[ \t]+$/, "", key)
        if ($0 ~ /^[ \t]*#/ || $0 !~ /=/ || !(key in skip)) print line
      }
    ' "$ENV_FILE" > "$tmp"
  else
    : > "$tmp"
  fi

  {
    echo ""
    echo "# Generated by start-server-mac.command at $(date '+%Y-%m-%d %H:%M:%S')"
    echo "STUN_URLS=$STUN_URLS_VALUE"
    echo "TURN_URLS=$TURN_URLS_VALUE"
    echo "TURN_USERNAME=$TURN_USERNAME"
    echo "TURN_CREDENTIAL=$TURN_PASSWORD"
  } >> "$tmp"

  mv "$tmp" "$ENV_FILE"
}

main "$@"
