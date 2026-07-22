# Accord

> Conversation and record, collaboration in one flow.

[한국어](README.md) · **English**

**Accord** is a self-hosted collaboration app. It starts with low-latency voice calls and screen
sharing, and keeps going into chat, collaborative markdown notes and a shared canvas — somewhere
between Discord's talk, Slack's teamwork and Notion's records.

The name is the opposite of *Discord*: **Accord** (harmony, agreement) — a space where scattered
conversations and work fall into place together.

[Website](https://craft374.github.io/Accord/en/) · [Run a server](docs/SERVER.en.md) · [Build the app](docs/BUILD.en.md)

- The server (`server.js`) does both signalling (WebSocket) and serving the app UI (`public/`).
- The desktop app (Electron) is a thin shell: you type a server address and it opens that UI.
- Calls themselves are WebRTC P2P, with a TURN (coturn) relay when direct connection fails.

## Features

- **Voice** — create / join rooms with member limits, mic calls, input & output device selection, per-user volume
- **Screen sharing** — selectable resolution and framerate, a high-performance capture path on Windows, computer audio sharing (whole system or a single app on Windows; BlackHole / Loopback on macOS)
- **Audio quality** — noise suppression, echo cancellation, auto gain, low-latency and high-fidelity modes, live connection quality, diagnostics and auto-recovery
- **Channels & rooms** — account and invite-code based channels, roles and permissions, and rooms for chat, notes, canvas and activity logs alongside voice rooms
- **Working together** — real-time chat (markdown, images, custom emoji), collaborative notes (fonts, text colours, code highlighting), a shared canvas, and 1:1 DMs
- **Dark UI** — Discord-style dark theme, profile cards, focus mode

## What it looks like

Launching the desktop app shows a start screen asking for a server address. Once connected, the
channel and room list sits on the left, with the voice / chat / notes / canvas view in the middle.

## Quick start

- **I want to run a server** → [docs/SERVER.en.md](docs/SERVER.en.md)
  (on macOS, double-click `start-server-mac.command`; for a local Windows test, `start-server-win.bat`)
- **I want to build the desktop app** → [docs/BUILD.en.md](docs/BUILD.en.md)
- **I just want to run the app from source** → `npm install`, then `npm run client`

> The server needs nothing but Node.js 18+ (it has zero dependencies). To use a microphone or screen
> sharing from a browser you need **HTTPS** (or localhost).

### There are no prebuilt binaries yet

Releases currently ship source only — the project updates too often for release builds to keep up.
Build it yourself with [docs/BUILD.en.md](docs/BUILD.en.md) (one command), or just open the server
address in Chrome, which needs no build at all. Prebuilt downloads will come once things settle.

## Project layout

```
server.js                          signalling + UI server (no dependencies)
data-store.js                      persistence for accounts, channels, rooms, notes
public/                            voice / chat / notes / canvas UI (served by the server)
website/                           GitHub Pages site
electron/                          desktop app main & preload
shell/                             desktop app start screen (server address input)
native/windows-process-loopback/   Windows per-application audio capture helper (C#)
scripts/                           build & check scripts (Node)
scripts/win/                       Windows build scripts (.bat)
scripts/mac/                       macOS build & server scripts (.command/.sh)
docs/                              server and build guides
start-server-mac.command           one-click macOS server
start-server-win.bat               one-click local Windows server
```

## Built with

Node.js (server, zero dependencies) · WebRTC · Electron · coturn (TURN)
