# Running a server

[한국어](SERVER.md) · **English**

The Accord server (`server.js`) is a zero-dependency Node.js server that handles signalling
(WebSocket) and serves the app UI (`public/`) at the same time.
Browsers only allow microphone and screen sharing over **HTTPS (or localhost)**, so a real server
should run over HTTPS.

- Default port: `25565` (override with the `PORT` environment variable)
- On startup the console prints the local / LAN / external addresses to connect to.
- The first HTTPS run generates a self-signed certificate into `.cert/` automatically
  (get past the browser warning with "Advanced → Proceed").

---

## 1. One-click scripts

### macOS — production server (HTTPS + TURN)

**Double-click `start-server-mac.command`** in the repository root.

It checks and starts Docker Desktop → brings up a coturn TURN server → generates `server.env` →
starts the HTTPS server. Press `Ctrl+C` in the window to stop (HTTPS and coturn stop together).

> Requires Node.js 18+ and Docker Desktop. For connections from outside your network, read
> [External access](#external-internet-access) first.

### Windows — local test server (HTTP)

**Double-click `start-server-win.bat`** in the repository root.

A simple server you can reach at `http://localhost:25565` on the same PC (localhost works with a
microphone even over HTTP). `Ctrl+C` to stop.

> To connect from other devices — or to use a microphone from them — you need HTTPS. See
> "Manual commands · Windows" below.

---

## 2. Manual commands

From the repository root:

### macOS

```bash
./scripts/mac/start-mac-server.sh   # with TURN (needs Docker; same as the one-click script)
node scripts/start-https.js         # HTTPS only, no TURN
node server.js                      # HTTP (localhost testing)
```

### Windows

```bash
node scripts/start-https.js         # HTTPS (LAN / external) — needs openssl
node server.js                      # HTTP (localhost testing)
```

`node scripts/start-https.js` uses **openssl** to create the self-signed certificate. If openssl is
not on your cmd/PowerShell PATH, run it from Git Bash, or point at an existing certificate:

```bash
SSL_CERT_FILE=path/cert.pem SSL_KEY_FILE=path/key.pem node server.js
```

### Linux

```bash
node scripts/start-https.js         # HTTPS
node server.js                      # HTTP
```

If you need TURN, run coturn yourself and fill in `server.env` (see below).

---

## Connecting a client

- **Desktop app**: launch it and enter the server address (`https://SERVER_IP:25565`)
- **Browser**: open `https://SERVER_IP:25565` (Chrome recommended)
- **From source**: `npm install`, then `npm run client` (runs Electron from source)

---

## External (internet) access

For someone outside your router to connect, forward these ports to the server machine's local IP.

| Purpose | Port |
|---|---|
| Accord HTTPS/WSS | `25565/TCP` |
| TURN | `3478/TCP`, `3478/UDP` |
| TURN relay | `49160-49200/TCP`, `49160-49200/UDP` |

TURN **must** be advertised with a public IP (or domain). If clients receive a private address like
`turn:192.168.x.x`, relay connections from outside will fail.

### Reference setup with a Mac as the server

1. Install and start Docker Desktop on the Mac
2. Double-click `start-server-mac.command` (coturn first, then HTTPS)
3. Allow Node.js / Docker when the macOS firewall prompts
4. Forward the ports above to the Mac's local IP on your router
5. Clients connect to `https://MAC_ADDRESS:25565`
6. To regenerate just the TURN values, run `start-server-mac.command` again

---

## TURN configuration (`server.env`)

The macOS one-click script writes this for you. To do it by hand, copy `server.env.example` to
`server.env` and fill it in:

```env
TURN_URLS=turn:PUBLIC_IP_OR_DOMAIN:3478?transport=udp,turn:PUBLIC_IP_OR_DOMAIN:3478?transport=tcp
TURN_USERNAME=username
TURN_CREDENTIAL=password
STUN_URLS=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478
```

The console reports whether TURN is configured when the server starts.

---

## Diagnostics to check

When a connection fails, look at these entries in the client diagnostic log:

- `ice-server-config`: whether the client received TURN settings from the server
- `relay-candidate-local` / `relay-candidate-remote`: whether relay candidates were created
- `selected-candidate-pair`: the ICE path actually chosen
- `candidate-counts`: how many `host` / `srflx` / `relay` candidates exist

If you see `ICE failed` with no relay candidates, check the TURN server, port `3478`, the relay port
range and the TURN credentials first.

---

## Troubleshooting

- **Microphone blocked**: check whether you connected over plain HTTP — only HTTPS (self-signed is fine) or localhost may use the microphone
- **A friend can't connect**: TURN is missing or advertised with a private IP — check port forwarding and the public IP in `server.env`
- **Certificate warning**: expected with a self-signed certificate — "Advanced → Proceed"
- **Echo**: enable echo cancellation in settings or use headphones. On macOS, set the output device to a real speaker/headphone

## Updating the server

The server machine updates by running `git pull` on this repository. Because the server also serves
the UI, changes to **`public/` count too**, not just `server.js` — the flow is
`push → pull on the server → restart the server`.
The desktop app only needs rebuilding when `electron/`, `shell/` or `native/` changed
([BUILD.en.md](BUILD.en.md)).
