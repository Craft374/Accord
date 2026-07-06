const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");

const PORT = Number(process.env.PORT || 25565);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_HOST = normalizeHost(process.env.PUBLIC_HOST || "");
const PUBLIC_URL = normalizePublicUrl(process.env.PUBLIC_URL || "", PUBLIC_HOST, PORT);
const PUBLIC_DIR = path.join(__dirname, "public");
const CERT_DIR = path.join(__dirname, ".cert");
const CERT_FILE = path.join(CERT_DIR, "cert.pem");
const KEY_FILE = path.join(CERT_DIR, "key.pem");
const CERT_MARKER_FILE = path.join(CERT_DIR, "host.txt");
const MAX_ROOM_LIMIT = 8;

const rooms = new Map();
const clients = new Map();

const serverOptions = loadTlsOptions();
const server = serverOptions
  ? https.createServer(serverOptions, handleRequest)
  : http.createServer(handleRequest);

server.on("upgrade", handleUpgrade);
server.on("clientError", handleClientError);

server.listen(PORT, HOST, () => {
  const protocol = serverOptions ? "https" : "http";
  console.log("");
  console.log(`Accord server is running on ${protocol}://${HOST}:${PORT}`);
  console.log(`Local: ${protocol}://localhost:${PORT}`);
  if (PUBLIC_URL) {
    console.log(`Friend: ${PUBLIC_URL}`);
  } else {
    console.log(`Friend: ${protocol}://YOUR_PUBLIC_IP:${PORT}`);
    console.log("Tip: PUBLIC_HOST=YOUR_PUBLIC_IP npm start");
  }
  if (!serverOptions) {
    console.log("Warning: HTTPS certificate was not created. Remote browser mic access may be blocked.");
  }
  console.log("");
});

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendCors(res, 204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendCors(res, 405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const base = `${serverOptions ? "https" : "http"}://${req.headers.host || "localhost"}`;
  const url = new URL(req.url, base);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/config") {
    sendJson(res, 200, {
      publicUrl: PUBLIC_URL,
      iceServers: getIceServers(),
      maxRoomLimit: MAX_ROOM_LIMIT,
    });
    return;
  }

  const fileName = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, fileName));
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendCors(res, 403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendCors(res, 404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    sendCors(res, 200, {
      "content-type": getContentType(filePath),
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function handleUpgrade(req, socket) {
  const base = `${serverOptions ? "https" : "http"}://${req.headers.host || "localhost"}`;
  const url = new URL(req.url, base);

  if (url.pathname !== "/signal") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const client = {
    id: crypto.randomBytes(8).toString("hex"),
    socket,
    roomId: "",
    userName: "Guest",
    buffer: Buffer.alloc(0),
    closed: false,
  };

  clients.set(client.id, client);

  socket.on("data", (chunk) => readFrames(client, chunk));
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));

  send(client, { type: "hello", id: client.id, rooms: getRoomList() });
}

function handleClientError(error, socket) {
  if (!socket.writable) return;

  const rawPacket = error.rawPacket ? error.rawPacket.toString("utf8") : "";
  const requestLine = rawPacket.split("\r\n")[0] || "";
  const hostLine = rawPacket
    .split("\r\n")
    .find((line) => line.toLowerCase().startsWith("host:"));

  if (/^(GET|HEAD|POST)\s+/i.test(requestLine) && hostLine) {
    const host = hostLine.slice(5).trim();
    const targetPath = requestLine.split(" ")[1] || "/";
    socket.end(
      [
        "HTTP/1.1 301 Moved Permanently",
        `Location: https://${host}${targetPath}`,
        "Content-Type: text/plain; charset=utf-8",
        "Connection: close",
        "",
        "Use HTTPS for microphone access.",
      ].join("\r\n"),
    );
    return;
  }

  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
}

function readFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const firstByte = client.buffer[0];
    const secondByte = client.buffer[1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let length = secondByte & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const bigLength = client.buffer.readBigUInt64BE(2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        closeClient(client);
        return;
      }
      length = Number(bigLength);
      offset = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + length;
    if (client.buffer.length < frameLength) return;

    let payload = client.buffer.slice(offset + maskLength, frameLength);
    if (masked) {
      const mask = client.buffer.slice(offset, offset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    client.buffer = client.buffer.slice(frameLength);

    if (opcode === 8) {
      closeClient(client);
      return;
    }

    if (opcode === 9) {
      sendFrame(client.socket, payload, 10);
      continue;
    }

    if (opcode !== 1) continue;
    handleSocketMessage(client, payload.toString("utf8"));
  }
}

function handleSocketMessage(client, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    send(client, { type: "error", message: "Invalid message" });
    return;
  }

  if (message.type === "set-name") {
    client.userName = sanitizeName(message.userName);
    broadcastRooms();
    return;
  }

  if (message.type === "list-rooms") {
    send(client, { type: "rooms", rooms: getRoomList() });
    return;
  }

  if (message.type === "create-room") {
    const room = createRoom(message.name, message.limit);
    joinRoom(client, room.id, message.userName);
    return;
  }

  if (message.type === "join-room") {
    joinRoom(client, message.roomId, message.userName);
    return;
  }

  if (message.type === "leave-room") {
    leaveRoom(client);
    send(client, { type: "left", rooms: getRoomList() });
    broadcastRooms();
    return;
  }

  if (message.type === "signal") {
    relaySignal(client, message.target, message.data);
  }
}

function createRoom(rawName, rawLimit) {
  const name = sanitizeRoomName(rawName);
  const limit = clampLimit(rawLimit);
  const baseId = slugify(name);
  let id = baseId;
  let index = 2;

  while (rooms.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }

  const room = {
    id,
    name,
    limit,
    clients: new Set(),
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  broadcastRooms();
  return room;
}

function joinRoom(client, rawRoomId, rawUserName) {
  const roomId = sanitizeRoomId(rawRoomId);
  const room = rooms.get(roomId);
  if (!room) {
    send(client, { type: "error", message: "방을 찾을 수 없습니다." });
    return;
  }

  if (client.roomId === room.id) return;
  if (room.clients.size >= room.limit) {
    send(client, { type: "error", message: "방 인원이 가득 찼습니다." });
    return;
  }

  if (client.roomId) leaveRoom(client);

  client.userName = sanitizeName(rawUserName || client.userName);
  const existingPeers = Array.from(room.clients).map(getPeerInfo);
  room.clients.add(client);
  client.roomId = room.id;

  send(client, {
    type: "joined",
    id: client.id,
    room: getRoomSummary(room),
    peers: existingPeers,
  });

  const joinedPeer = getPeerInfo(client);
  for (const peer of room.clients) {
    if (peer !== client) {
      send(peer, {
        type: "peer-joined",
        peer: joinedPeer,
        room: getRoomSummary(room),
      });
    }
  }

  broadcastRooms();
}

function relaySignal(client, rawTargetId, data) {
  const targetId = typeof rawTargetId === "string" ? rawTargetId : "";
  const target = clients.get(targetId);
  if (!target || !client.roomId || client.roomId !== target.roomId) return;
  if (!data || typeof data !== "object") return;

  send(target, {
    type: "signal",
    from: client.id,
    data,
  });
}

function leaveRoom(client) {
  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = "";
    return;
  }

  room.clients.delete(client);

  for (const peer of room.clients) {
    send(peer, {
      type: "peer-left",
      peerId: client.id,
      room: getRoomSummary(room),
    });
  }

  if (room.clients.size === 0) {
    rooms.delete(room.id);
  }

  client.roomId = "";
  broadcastRooms();
}

function removeClient(client) {
  if (client.closed) return;
  client.closed = true;
  leaveRoom(client);
  clients.delete(client.id);
}

function closeClient(client) {
  removeClient(client);
  try {
    client.socket.end();
  } catch {
    // Ignore socket shutdown errors.
  }
}

function broadcastRooms() {
  const message = { type: "rooms", rooms: getRoomList() };
  for (const client of clients.values()) {
    send(client, message);
  }
}

function getRoomList() {
  return Array.from(rooms.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(getRoomSummary);
}

function getRoomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    limit: room.limit,
    count: room.clients.size,
    participants: Array.from(room.clients).map((client) => client.userName),
  };
}

function getPeerInfo(client) {
  return {
    id: client.id,
    name: client.userName,
  };
}

function send(client, data) {
  if (client.closed) return;
  sendFrame(client.socket, JSON.stringify(data), 1);
}

function sendFrame(socket, data, opcode) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  let header;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payload]));
}

function loadTlsOptions() {
  const certFromEnv = process.env.SSL_CERT_FILE;
  const keyFromEnv = process.env.SSL_KEY_FILE;

  if (certFromEnv && keyFromEnv && fs.existsSync(certFromEnv) && fs.existsSync(keyFromEnv)) {
    return {
      cert: fs.readFileSync(certFromEnv),
      key: fs.readFileSync(keyFromEnv),
    };
  }

  if (!ensureLocalCertificate()) return null;

  return {
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  };
}

function ensureLocalCertificate() {
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const marker = JSON.stringify({ publicHost: PUBLIC_HOST, hostname: os.hostname() });
    const hasSameCertificate =
      fs.existsSync(CERT_FILE) &&
      fs.existsSync(KEY_FILE) &&
      fs.existsSync(CERT_MARKER_FILE) &&
      fs.readFileSync(CERT_MARKER_FILE, "utf8") === marker;

    if (hasSameCertificate) return true;

    const configFile = path.join(CERT_DIR, "openssl.cnf");
    fs.writeFileSync(configFile, createOpenSslConfig(), "utf8");

    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-nodes",
        "-days",
        "365",
        "-newkey",
        "rsa:2048",
        "-keyout",
        KEY_FILE,
        "-out",
        CERT_FILE,
        "-config",
        configFile,
      ],
      { stdio: "ignore" },
    );

    if (result.status !== 0) return false;
    fs.writeFileSync(CERT_MARKER_FILE, marker, "utf8");
    return true;
  } catch {
    return false;
  }
}

function createOpenSslConfig() {
  const dnsNames = new Set(["localhost", os.hostname()]);
  const ipNames = new Set(["127.0.0.1"]);

  if (PUBLIC_HOST) {
    if (net.isIP(PUBLIC_HOST)) {
      ipNames.add(PUBLIC_HOST);
    } else {
      dnsNames.add(PUBLIC_HOST);
    }
  }

  const altNames = [];
  let dnsIndex = 1;
  for (const name of dnsNames) {
    altNames.push(`DNS.${dnsIndex} = ${name}`);
    dnsIndex += 1;
  }

  let ipIndex = 1;
  for (const ip of ipNames) {
    altNames.push(`IP.${ipIndex} = ${ip}`);
    ipIndex += 1;
  }

  return `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = Accord Local

[v3_req]
subjectAltName = @alt_names

[alt_names]
${altNames.join("\n")}
`.trim();
}

function getIceServers() {
  if (!process.env.ICE_SERVERS) {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }

  try {
    const parsed = JSON.parse(process.env.ICE_SERVERS);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return process.env.ICE_SERVERS.split(",")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ urls: url }));
  }
}

function sendJson(res, statusCode, body) {
  sendCors(res, statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendCors(res, statusCode, headers = {}) {
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function sanitizeName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  return value.slice(0, 24) || "Guest";
}

function sanitizeRoomName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  return value.slice(0, 32) || "통화방";
}

function sanitizeRoomId(roomId) {
  if (typeof roomId !== "string") return "";
  return /^[a-zA-Z0-9_-]{1,48}$/.test(roomId) ? roomId : "";
}

function slugify(value) {
  const ascii = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fallback = crypto.randomBytes(3).toString("hex");
  return (ascii || `room-${fallback}`).slice(0, 40);
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(MAX_ROOM_LIMIT, Math.max(2, Math.floor(parsed)));
}

function normalizeHost(value) {
  if (!value) return "";
  const trimmed = value.trim().replace(/^https?:\/\//, "").split("/")[0];
  return trimmed.replace(/:\d+$/, "");
}

function normalizePublicUrl(publicUrl, publicHost, port) {
  if (publicUrl) {
    try {
      return new URL(publicUrl).origin;
    } catch {
      return "";
    }
  }

  if (!publicHost) return "";
  return `https://${publicHost}:${port}`;
}
