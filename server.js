const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const store = require("./data-store");

loadServerEnvFiles();
store.init();
seedAdminAccount();

const VERSION = "0.2.44";
const PORT = Number(process.env.PORT || 25565);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_HOST = cleanHost(process.env.PUBLIC_HOST || "");
const PUBLIC_URL = cleanPublicUrl(process.env.PUBLIC_URL || "", PUBLIC_HOST, PORT);
const REQUIRE_HTTPS = process.env.VOICE_CHAT_REQUIRE_HTTPS === "1" || process.env.HTTPS === "1";
const MAX_ROOM_LIMIT = 8;
const PUBLIC_DIR = path.join(__dirname, "public");
const CERT_FILE = path.resolve(process.env.SSL_CERT_FILE || path.join(__dirname, ".cert", "cert.pem"));
const KEY_FILE = path.resolve(process.env.SSL_KEY_FILE || path.join(__dirname, ".cert", "key.pem"));
const CERT_DIR = path.dirname(CERT_FILE);

const clients = new Map();
const rooms = new Map();
const tlsOptions = loadTlsOptions();
if (!tlsOptions && REQUIRE_HTTPS) {
  console.error("HTTPS certificate was not created. Install openssl or set SSL_CERT_FILE and SSL_KEY_FILE.");
  process.exit(1);
}
const server = tlsOptions
  ? https.createServer(tlsOptions, handleRequest)
  : http.createServer(handleRequest);

server.on("upgrade", handleUpgrade);
server.on("clientError", handleClientError);
server.listen(PORT, HOST, () => {
  const protocol = tlsOptions ? "https" : "http";
  const localUrl = `${protocol}://localhost:${PORT}`;
  const lanUrl = getLanUrl(protocol, PORT);
  console.log("");
  console.log(`Accord v${VERSION}`);
  console.log(`Local: ${localUrl}`);
  if (lanUrl) console.log(`LAN:   ${lanUrl}`);
  console.log(`Friend: ${PUBLIC_URL || `${protocol}://YOUR_PUBLIC_IP:${PORT}`}`);
  if (!tlsOptions) {
    console.log("Warning: HTTPS certificate was not created. Remote browsers may block microphone and AudioWorklet.");
    console.log("Run `npm run server:https` after installing openssl, or set SSL_CERT_FILE and SSL_KEY_FILE.");
  }
  printTurnStatus();
  console.log("");
});

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendCors(res, 204);
    res.end();
    return;
  }

  const base = `${tlsOptions ? "https" : "http"}://${req.headers.host || "localhost"}`;
  const url = new URL(req.url, base);

  if (req.method === "POST") {
    if (url.pathname === "/upload") {
      handleUpload(req, res, url);
      return;
    }
    sendText(res, 404, "Not found");
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  if (url.pathname.startsWith("/uploads/")) {
    serveUpload(res, url.pathname);
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, version: VERSION, secure: Boolean(tlsOptions) });
    return;
  }

  if (url.pathname === "/version") {
    sendJson(res, 200, { version: VERSION, secure: Boolean(tlsOptions), updatedAt: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/config") {
    sendJson(res, 200, {
      version: VERSION,
      secure: Boolean(tlsOptions),
      protocol: tlsOptions ? "https" : "http",
      maxRoomLimit: MAX_ROOM_LIMIT,
      publicUrl: PUBLIC_URL,
      iceServers: getIceServers(),
      turnConfigured: hasTurnServer(),
      stunConfigured: hasStunServer(),
    });
    return;
  }

  const fileName = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, fileName));
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    sendCors(res, 200, {
      "content-type": getContentType(filePath),
      "cache-control": "no-store, max-age=0",
    });
    res.end(data);
  });
}

// 채팅 파일/이미지 업로드. 바이너리 본문 + 헤더(x-file-name)로 받는다.
function handleUpload(req, res, url) {
  const token = url.searchParams.get("token") || req.headers["x-auth-token"] || "";
  const user = store.getUserByToken(token);
  if (!user) {
    sendJson(res, 401, { error: "인증이 필요합니다." });
    return;
  }
  const mime = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
  let rawName = "file";
  try {
    rawName = decodeURIComponent(String(req.headers["x-file-name"] || "file"));
  } catch {
    rawName = String(req.headers["x-file-name"] || "file");
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on("data", (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > store.UPLOAD_MAX_BYTES) {
      aborted = true;
      sendJson(res, 413, { error: "파일이 너무 큽니다. 50MB 이하만 올릴 수 있습니다." });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (aborted) return;
    if (!size) {
      sendJson(res, 400, { error: "빈 파일입니다." });
      return;
    }
    try {
      const saved = store.saveUpload({ buffer: Buffer.concat(chunks), name: rawName, mime });
      logServer(`upload file=${saved.fileName} size=${saved.size} by=${user.username}`);
      sendJson(res, 200, { url: `/uploads/${saved.fileName}`, name: saved.name, size: saved.size, mime: saved.mime });
    } catch (error) {
      logServer(`upload failed: ${error.message || error}`);
      sendJson(res, 500, { error: "업로드에 실패했습니다." });
    }
  });
  req.on("error", () => {
    if (!aborted) sendJson(res, 500, { error: "업로드 중 오류가 발생했습니다." });
  });
}

function serveUpload(res, pathname) {
  let fileName = "";
  try {
    fileName = decodeURIComponent(pathname.slice("/uploads/".length));
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }
  const filePath = store.getUploadPath(fileName);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    sendCors(res, 200, {
      "content-type": getContentType(filePath),
      "cache-control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
}

function handleUpgrade(req, socket) {
  const base = `${tlsOptions ? "https" : "http"}://${req.headers.host || "localhost"}`;
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

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));

  const client = {
    id: crypto.randomBytes(8).toString("hex"),
    name: "Guest",
    roomId: "",
    socket,
    buffer: Buffer.alloc(0),
    closed: false,
    fragments: null,
    fragmentOpcode: 0,
    ip: cleanIp(req.socket.remoteAddress),
    userId: "",
    isAdmin: false,
    chatRoomId: "", // 현재 보고 있는 채팅방(입력중 표시 대상 판별용)
    memoRoomId: "", // 현재 보고 있는 메모장(실시간 동기화 대상 판별용)
  };

  clients.set(client.id, client);
  logServer("client connected", client);
  socket.on("data", (chunk) => readFrames(client, chunk));
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
  send(client, { type: "hello", id: client.id, version: VERSION });
}

function handleClientError(error, socket) {
  if (!socket.writable) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
}

function readFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        closeClient(client);
        return;
      }
      length = Number(big);
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
    const fin = (first & 0x80) === 0x80;

    if (opcode === 8) {
      closeClient(client);
      return;
    }
    if (opcode === 9 || opcode === 10) continue; // ping/pong 무시

    // 큰 메시지(예: 이미지 data URL)는 브라우저가 여러 프레임으로 쪼개 보낸다.
    // 연속(continuation) 프레임을 이어붙여 완성된 뒤에 처리한다.
    if (opcode === 0) {
      if (!Array.isArray(client.fragments)) continue; // 시작 없는 연속 프레임은 버린다.
      client.fragments.push(payload);
    } else if (opcode === 1 || opcode === 2) {
      client.fragments = [payload];
      client.fragmentOpcode = opcode;
    } else {
      continue;
    }

    if (!fin) continue;

    const full = client.fragments.length === 1 ? client.fragments[0] : Buffer.concat(client.fragments);
    const op = client.fragmentOpcode;
    client.fragments = null;
    if (op !== 1) continue; // 텍스트 메시지만 처리

    try {
      handleMessage(client, JSON.parse(full.toString("utf8")));
    } catch {
      send(client, { type: "error", message: "잘못된 메시지입니다." });
    }
  }
}

function handleMessage(client, message) {
  if (handleAuthMessage(client, message)) return;
  if (handleAdminMessage(client, message)) return;
  if (handleChannelMessage(client, message)) return;
  if (handleChatMessage(client, message)) return;
  if (handleMemoMessage(client, message)) return;

  if (message.type === "set-name") {
    client.name = cleanName(message.name);
    broadcastPresence();
    return;
  }

  if (message.type === "join-room") {
    joinVoiceRoom(client, String(message.roomId || ""));
    return;
  }

  if (message.type === "leave-room") {
    leaveRoom(client, true);
    return;
  }

  if (message.type === "client-log") {
    logClientEvent(client, message);
    return;
  }

  if (message.type === "signal") {
    const target = clients.get(String(message.target || ""));
    const signalKind = getSignalKind(message.data);
    if (!target || target.roomId !== client.roomId) {
      logServer(`signal target missing kind=${signalKind} target=${String(message.target || "")}`, client);
      return;
    }
    logServer(`signal kind=${signalKind} target=${target.id}`, client);
    send(target, {
      type: "signal",
      from: client.id,
      fromName: client.name,
      data: message.data,
    });
  }
}

function handleAuthMessage(client, message) {
  switch (message.type) {
    case "register": {
      const result = store.createUser({
        username: message.username,
        password: message.password,
        displayName: message.displayName,
        email: message.email,
      });
      if (result.error) {
        send(client, { type: "auth-error", action: "register", message: result.error });
        return true;
      }
      finishAuth(client, result.user, "register");
      return true;
    }
    case "login": {
      const result = store.authenticate(message.username, message.password);
      if (result.error) {
        send(client, { type: "auth-error", action: "login", message: result.error });
        return true;
      }
      finishAuth(client, result.user, "login");
      return true;
    }
    case "auth-token": {
      const user = store.getUserByToken(message.token);
      if (!user) {
        send(client, { type: "auth-expired" });
        return true;
      }
      finishAuth(client, user, "resume", message.token);
      return true;
    }
    case "logout": {
      if (message.token) store.destroySession(message.token);
      leaveRoom(client, false);
      client.userId = "";
      client.isAdmin = false;
      client.name = "Guest";
      broadcastPresence();
      return true;
    }
    case "change-password": {
      if (!client.userId) {
        send(client, { type: "auth-error", action: "change-password", message: "로그인이 필요합니다." });
        return true;
      }
      const result = store.changePassword(client.userId, message.oldPassword, message.newPassword);
      if (result.error) {
        send(client, { type: "auth-error", action: "change-password", message: result.error });
        return true;
      }
      send(client, { type: "auth-ok", action: "change-password", user: store.sanitizeUser(result.user) });
      return true;
    }
    case "update-profile": {
      if (!client.userId) {
        send(client, { type: "auth-error", action: "update-profile", message: "로그인이 필요합니다." });
        return true;
      }
      const result = store.updateProfile(client.userId, {
        displayName: message.displayName,
        avatar: message.avatar,
        email: message.email,
      });
      if (result.error) {
        send(client, { type: "auth-error", action: "update-profile", message: result.error });
        return true;
      }
      client.name = result.user.displayName;
      send(client, { type: "auth-ok", action: "update-profile", user: store.sanitizeUser(result.user) });
      // 닉네임/프로필 변경은 여러 채널의 멤버 표시에 영향 → 접속자 전원 채널 목록 갱신.
      refreshChannelsForAll();
      broadcastPresence();
      return true;
    }
    default:
      return false;
  }
}

function finishAuth(client, user, action, existingToken) {
  const token = existingToken || store.createSession(user.id);
  client.userId = user.id;
  client.isAdmin = Boolean(user.isAdmin);
  client.name = user.displayName;
  store.recordConnection(user.id, client.ip, action === "resume" ? "connect" : action);
  logServer(`auth ${action} user=${user.username} code=#${user.code} ip=${client.ip}`, client);
  send(client, { type: "auth-ok", action, token, user: store.sanitizeUser(user) });
  sendChannels(client);
  broadcastPresence();
}

function handleAdminMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("admin:")) return false;
  if (!client.isAdmin) {
    send(client, { type: "admin-error", message: "관리자 권한이 없습니다." });
    return true;
  }
  switch (message.type) {
    case "admin:list-users":
      sendAdminUsers(client);
      return true;
    case "admin:set-admin": {
      const result = store.setAdmin(message.userId, message.value);
      if (result.error) {
        send(client, { type: "admin-error", message: result.error });
        return true;
      }
      notifyUserUpdate(message.userId);
      sendAdminUsers(client);
      return true;
    }
    case "admin:set-code": {
      const result = store.setUserCode(message.userId, message.code);
      if (result.error) {
        send(client, { type: "admin-error", message: result.error });
        return true;
      }
      notifyUserUpdate(message.userId);
      sendAdminUsers(client);
      return true;
    }
    default:
      return false;
  }
}

function sendAdminUsers(client) {
  send(client, { type: "admin-users", users: store.listUsers(), online: onlineUserIds() });
}

function onlineUserIds() {
  const ids = new Set();
  for (const c of clients.values()) if (c.userId) ids.add(c.userId);
  return [...ids];
}

// 관리자 지정/코드 변경 등으로 계정이 바뀌면, 접속 중인 해당 유저 클라이언트에 즉시 반영한다.
function notifyUserUpdate(userId) {
  const user = store.findById(userId);
  if (!user) return;
  const payload = { type: "account-updated", user: store.sanitizeUser(user) };
  for (const c of clients.values()) {
    if (c.userId !== userId) continue;
    c.name = user.displayName;
    c.isAdmin = Boolean(user.isAdmin);
    send(c, payload);
    // 관리자 승격/해제 시 볼 수 있는 채널이 달라지므로 목록도 갱신한다.
    sendChannels(c);
  }
  broadcastPresence();
}

function seedAdminAccount() {
  const username = process.env.ADMIN_SEED_USERNAME || "craft374";
  const password = process.env.ADMIN_SEED_PASSWORD || "";
  const displayName = process.env.ADMIN_SEED_DISPLAYNAME || username;
  const result = store.seedAdmin({ username, password, displayName });
  if (result.created) console.log(`관리자 계정 생성됨: ${username} (#0000)`);
  else if (result.promoted) console.log(`기존 계정을 관리자(#0000)로 승격: ${username}`);
  else if (result.skipped === "no-password") {
    console.log("관리자 시드 건너뜀: ADMIN_SEED_PASSWORD 미설정. server.env에 추가하면 첫 실행 시 생성됩니다.");
  }
}

function cleanIp(value) {
  return String(value || "").replace(/^::ffff:/, "");
}

function getSignalKind(data) {
  if (data?.description?.type) return data.description.type;
  if (data?.candidate) return "candidate";
  if (data?.trackInfo) return `trackInfo:${data.trackInfo.role || ""}`;
  if (data?.mediaStatus) return "mediaStatus";
  if (data?.repairRequest) return `repair:${data.repairRequest.role || ""}`;
  return "unknown";
}

// 채널 안의 통화방(voice)에 입장. 방 메타데이터는 채널에 영속되고, 여기서는 실시간 접속(presence)만 관리한다.
function joinVoiceRoom(client, roomId) {
  if (!client.userId) {
    send(client, { type: "error", message: "로그인이 필요합니다." });
    return;
  }
  const found = store.findRoom(roomId);
  if (!found || found.room.type !== "voice") {
    send(client, { type: "error", message: "통화방을 찾지 못했습니다." });
    return;
  }
  if (!store.isChannelMember(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "error", message: "채널 멤버만 입장할 수 있습니다." });
    return;
  }

  leaveRoom(client, false);

  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, name: found.room.name, channelId: found.channel.id, clients: new Set() };
    rooms.set(roomId, room);
  }
  room.clients.add(client.id);
  client.roomId = roomId;
  logServer(`joined room=${room.name} peers=${room.clients.size - 1}`, client);

  const peers = [...room.clients]
    .filter((id) => id !== client.id)
    .map((id) => {
      const peer = clients.get(id);
      return { id, name: peer?.name || "Guest" };
    });

  send(client, { type: "joined", id: client.id, room: liveRoomInfo(room), peers });

  for (const peerId of room.clients) {
    if (peerId === client.id) continue;
    send(clients.get(peerId), {
      type: "peer-joined",
      peer: { id: client.id, name: client.name },
      room: liveRoomInfo(room),
    });
  }

  broadcastPresence();
}

function leaveRoom(client, notify) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  client.roomId = "";
  if (!room) return;

  room.clients.delete(client.id);
  logServer(`left room=${room.name} remaining=${room.clients.size}`, client);
  if (room.clients.size === 0) {
    rooms.delete(room.id); // 실시간 접속 항목만 정리(방 메타데이터는 채널에 영속).
  } else {
    for (const peerId of room.clients) {
      send(clients.get(peerId), {
        type: "peer-left",
        peerId: client.id,
        room: liveRoomInfo(room),
      });
    }
  }

  if (notify) send(client, { type: "left" });
  broadcastPresence();
}

function removeClient(client) {
  if (client.closed) return;
  client.closed = true;
  logServer("client disconnected", client);
  if (client.userId) store.recordConnection(client.userId, client.ip, "disconnect");
  leaveRoom(client, false);
  clients.delete(client.id);
  client.socket.destroy();
}

function closeClient(client) {
  client.socket.end();
  removeClient(client);
}

function sendSignal(target, data) {
  send(target, data);
}

function logServer(message, client = null) {
  const stamp = new Date().toISOString();
  const who = client ? ` id=${client.id} name=${client.name || "Guest"}` : "";
  console.log(`[${stamp}] ${message}${who}`);
}

function logClientEvent(client, message) {
  const event = String(message.event || "").slice(0, 80);
  const session = String(message.session || "").slice(0, 32);
  const detail = String(message.detail || "").slice(0, 500).replace(/\s+/g, " ");
  const room = client.roomId ? ` room=${client.roomId}` : "";
  const sessionText = session ? ` sid=${session}` : "";
  logServer(`client-log event=${event}${sessionText}${room} detail=${detail}`, client);
}

function send(client, data) {
  if (!client || client.closed || !client.socket.writable) return;
  const payload = Buffer.from(JSON.stringify(data));
  const header = makeFrameHeader(payload.length);
  client.socket.write(Buffer.concat([header, payload]));
}

function makeFrameHeader(length) {
  if (length < 126) return Buffer.from([0x81, length]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

// 실시간 통화방 접속 현황 + 온라인 유저를 모든 로그인 클라이언트에 알린다.
function broadcastPresence() {
  const presence = {};
  for (const room of rooms.values()) {
    presence[room.id] = [...room.clients].map((id) => {
      const c = clients.get(id);
      return { clientId: id, userId: c?.userId || "", name: c?.name || "Guest" };
    });
  }
  const online = onlineUserIds();
  const payload = { type: "presence", rooms: presence, online };
  for (const client of clients.values()) if (client.userId) send(client, payload);
}

function liveRoomInfo(room) {
  return {
    id: room.id,
    name: room.name,
    channelId: room.channelId || "",
    limit: MAX_ROOM_LIMIT,
    count: room.clients.size,
    participants: [...room.clients].map((id) => clients.get(id)?.name || "Guest"),
  };
}

// ===== 채널 메시지 =====
function handleChannelMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("channel:")) return false;
  if (!client.userId) {
    send(client, { type: "channel-error", message: "로그인이 필요합니다." });
    return true;
  }
  switch (message.type) {
    case "channel:list":
      sendChannels(client);
      return true;
    case "channel:create": {
      const result = store.createChannel(client.userId, message.name);
      if (result.error) return channelError(client, result.error);
      logServer(`channel create name=${result.channel.name} invite=${result.channel.inviteCode}`, client);
      sendChannels(client);
      send(client, { type: "channel-selected", channelId: result.channel.id });
      return true;
    }
    case "channel:join": {
      const result = store.joinChannelByCode(client.userId, message.code);
      if (result.error) return channelError(client, result.error);
      logServer(`channel join name=${result.channel.name}`, client);
      notifyChannelMembers(result.channel.id);
      send(client, { type: "channel-selected", channelId: result.channel.id });
      return true;
    }
    case "channel:leave": {
      const result = store.removeMember(message.channelId, client.userId);
      if (result.error) return channelError(client, result.error);
      forceLeaveChannelRooms(client, message.channelId);
      sendChannels(client);
      notifyChannelMembers(message.channelId);
      return true;
    }
    case "channel:rename":
      return ownerAction(client, message.channelId, () => {
        const r = store.renameChannel(message.channelId, message.name);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:delete":
      return ownerAction(client, message.channelId, () => {
        const channel = store.getChannel(message.channelId);
        const memberIds = channel ? channel.members.slice() : [];
        // 채널 방들의 실시간 접속 종료
        if (channel) for (const room of channel.rooms) evictRoom(room.id);
        store.deleteChannel(message.channelId);
        for (const c of clients.values()) {
          if (c.userId && memberIds.includes(c.userId)) sendChannels(c);
        }
        return true;
      });
    case "channel:add-room":
      return ownerAction(client, message.channelId, () => {
        const r = store.addRoom(message.channelId, message.name, message.roomType);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:remove-room":
      return ownerAction(client, message.channelId, () => {
        evictRoom(message.roomId);
        const r = store.removeRoom(message.channelId, message.roomId);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:rename-room":
      return ownerAction(client, message.channelId, () => {
        const r = store.renameRoom(message.channelId, message.roomId, message.name);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:kick":
      return ownerAction(client, message.channelId, () => {
        const r = store.removeMember(message.channelId, message.userId);
        if (r.error) return channelError(client, r.error);
        // 쫓겨난 유저를 채널 방에서 강제로 내보내고, 그의 목록을 갱신한다.
        for (const c of clients.values()) {
          if (c.userId === message.userId) {
            forceLeaveChannelRooms(c, message.channelId);
            sendChannels(c);
          }
        }
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-manager":
      return creatorAction(client, message.channelId, () => {
        const r = store.setManager(message.channelId, message.userId, Boolean(message.value));
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-icon":
      return ownerAction(client, message.channelId, () => {
        const r = store.setChannelIcon(message.channelId, message.icon);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    default:
      return false;
  }
}

function channelError(client, messageText) {
  send(client, { type: "channel-error", message: messageText });
  return true;
}

function ownerAction(client, channelId, fn) {
  if (!store.isChannelOwner(channelId, client.userId, client.isAdmin)) {
    return channelError(client, "대표자(또는 관리자)만 할 수 있습니다.");
  }
  return fn();
}

function creatorAction(client, channelId, fn) {
  if (!store.isChannelCreator(channelId, client.userId, client.isAdmin)) {
    return channelError(client, "채널 창설자(또는 관리자)만 할 수 있습니다.");
  }
  return fn();
}

function sendChannels(client) {
  const channels = store.listChannelsForUser(client.userId, client.isAdmin).map(expandChannel);
  send(client, { type: "channels", channels, me: client.userId, isAdmin: Boolean(client.isAdmin) });
}

function expandChannel(summary) {
  const managerSet = new Set(summary.managerIds || []);
  return {
    ...summary,
    members: summary.memberIds.map((id) => {
      const u = store.findById(id);
      const base = u
        ? { id: u.id, displayName: u.displayName, code: u.code, avatar: u.avatar, isAdmin: Boolean(u.isAdmin) }
        : { id, displayName: "(삭제된 계정)", code: "----", avatar: "", isAdmin: false };
      base.isManager = managerSet.has(id);
      base.isCreator = id === summary.ownerId;
      return base;
    }),
  };
}

function refreshChannelsForAll() {
  for (const c of clients.values()) if (c.userId) sendChannels(c);
}

// 채널 멤버(및 관리자) 중 접속자에게 채널 목록을 다시 보낸다.
function notifyChannelMembers(channelId) {
  const channel = store.getChannel(channelId);
  if (!channel) return;
  for (const c of clients.values()) {
    if (!c.userId) continue;
    if (c.isAdmin || channel.members.includes(c.userId)) sendChannels(c);
  }
}

// 특정 통화방의 모든 접속자를 강제로 내보낸다(방 삭제/채널 삭제 시).
function evictRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const clientId of [...room.clients]) {
    const c = clients.get(clientId);
    if (c) {
      leaveRoom(c, true);
    }
  }
  rooms.delete(roomId);
}

// 특정 클라이언트가 해당 채널의 통화방에 있으면 내보낸다.
function forceLeaveChannelRooms(client, channelId) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (room && room.channelId === channelId) {
    leaveRoom(client, true);
  }
}

// ===== 채팅 메시지 =====
const CHAT_TEXT_MAX = 4000;
const CHAT_FILES_MAX = 10;

function handleChatMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("chat:")) return false;
  if (!client.userId) {
    send(client, { type: "chat-error", message: "로그인이 필요합니다." });
    return true;
  }

  switch (message.type) {
    case "chat:open": {
      const ctx = resolveChatRoom(client, message.roomId);
      if (!ctx) return true;
      client.chatRoomId = ctx.room.id;
      send(client, {
        type: "chat:history",
        roomId: ctx.room.id,
        messages: store.getMessages(ctx.room.id),
      });
      return true;
    }
    case "chat:close": {
      client.chatRoomId = "";
      return true;
    }
    case "chat:send": {
      const ctx = resolveChatRoom(client, message.roomId);
      if (!ctx) return true;
      const text = String(message.text || "").slice(0, CHAT_TEXT_MAX).replace(/\s+$/, "");
      const files = cleanChatFiles(message.files);
      if (!text && !files.length) {
        send(client, { type: "chat-error", message: "빈 메시지는 보낼 수 없습니다." });
        return true;
      }
      const user = store.findById(client.userId);
      const msg = {
        id: crypto.randomBytes(8).toString("hex"),
        roomId: ctx.room.id,
        userId: client.userId,
        name: user ? user.displayName : client.name,
        code: user ? user.code : "",
        text,
        files,
        at: Date.now(),
      };
      store.addMessage(ctx.room.id, msg);
      broadcastChat(ctx.channel, { type: "chat:message", message: msg });
      return true;
    }
    case "chat:typing": {
      const ctx = resolveChatRoom(client, message.roomId);
      if (!ctx) return true;
      // 같은 방을 보고 있는 다른 사람에게만 입력중을 알린다.
      for (const c of clients.values()) {
        if (c.id === client.id || c.chatRoomId !== ctx.room.id) continue;
        send(c, { type: "chat:typing", roomId: ctx.room.id, userId: client.userId, name: client.name });
      }
      return true;
    }
    default:
      return false;
  }
}

// roomId 로 채팅방과 채널을 찾고 멤버십을 확인한다. 실패 시 에러 전송 후 null.
function resolveChatRoom(client, roomId) {
  const found = store.findRoom(String(roomId || ""));
  if (!found || found.room.type !== "chat") {
    send(client, { type: "chat-error", message: "채팅방을 찾지 못했습니다." });
    return null;
  }
  if (!store.isChannelMember(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "chat-error", message: "채널 멤버만 이용할 수 있습니다." });
    return null;
  }
  return found;
}

function cleanChatFiles(files) {
  if (!Array.isArray(files)) return [];
  const out = [];
  for (const file of files.slice(0, CHAT_FILES_MAX)) {
    const url = String(file?.url || "");
    // 우리 업로드 엔드포인트가 발급한 경로만 허용한다.
    if (!/^\/uploads\/[a-f0-9]{24}_[A-Za-z0-9._-]+$/.test(url)) continue;
    out.push({
      url,
      name: String(file?.name || "file").slice(0, 200),
      size: Number(file?.size) || 0,
      mime: String(file?.mime || "").slice(0, 100),
      kind: file?.kind === "image" ? "image" : "file",
    });
  }
  return out;
}

// 채널의 온라인 멤버(관리자 포함) 전원에게 채팅 이벤트를 보낸다.
function broadcastChat(channel, payload) {
  for (const c of clients.values()) {
    if (!c.userId) continue;
    if (store.isChannelMember(channel.id, c.userId, c.isAdmin)) send(c, payload);
  }
}

// ===== 공동 메모장 =====
function handleMemoMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("memo:")) return false;
  if (!client.userId) {
    send(client, { type: "memo-error", message: "로그인이 필요합니다." });
    return true;
  }

  switch (message.type) {
    case "memo:open": {
      const ctx = resolveMemoRoom(client, message.roomId);
      if (!ctx) return true;
      client.memoRoomId = ctx.room.id;
      const memo = store.getMemo(ctx.room.id);
      send(client, { type: "memo:state", roomId: ctx.room.id, ...memoPayload(memo) });
      return true;
    }
    case "memo:close": {
      client.memoRoomId = "";
      return true;
    }
    case "memo:update": {
      const ctx = resolveMemoRoom(client, message.roomId);
      if (!ctx) return true;
      const result = store.saveMemo(ctx.room.id, message.text, client.userId);
      if (result.error) {
        send(client, { type: "memo-error", message: result.error });
        return true;
      }
      const memo = result.memo;
      // 저장한 본인에게는 새 rev만 확인(ack), 같은 방을 보는 다른 사람에게는 내용을 반영.
      send(client, { type: "memo:saved", roomId: ctx.room.id, rev: memo.rev });
      const payload = { type: "memo:changed", roomId: ctx.room.id, ...memoPayload(memo) };
      for (const c of clients.values()) {
        if (c.id === client.id || c.memoRoomId !== ctx.room.id) continue;
        send(c, payload);
      }
      return true;
    }
    default:
      return false;
  }
}

function resolveMemoRoom(client, roomId) {
  const found = store.findRoom(String(roomId || ""));
  if (!found || found.room.type !== "memo") {
    send(client, { type: "memo-error", message: "메모장을 찾지 못했습니다." });
    return null;
  }
  if (!store.isChannelMember(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "memo-error", message: "채널 멤버만 이용할 수 있습니다." });
    return null;
  }
  return found;
}

function memoPayload(memo) {
  const user = memo.updatedBy ? store.findById(memo.updatedBy) : null;
  return {
    text: memo.text,
    rev: memo.rev,
    updatedBy: memo.updatedBy,
    updatedByName: user ? user.displayName : "",
    updatedAt: memo.updatedAt,
  };
}

function cleanName(value) {
  return String(value || "Guest").trim().slice(0, 24) || "Guest";
}

function sendJson(res, status, payload) {
  sendCors(res, status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  sendCors(res, status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendCors(res, status, headers = {}) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-file-name, x-auth-token",
    ...headers,
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    // 업로드 파일용
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip",
  }[ext] || "application/octet-stream";
}

function getIceServers() {
  const servers = [];
  const stunUrls = splitUrlList(process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478");
  if (stunUrls.length) servers.push({ urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls });

  const turnUrls = splitUrlList(process.env.TURN_URLS || process.env.TURN_URL || process.env.TURNS_URL || "");
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  }
  return servers;
}

function hasTurnServer() {
  return splitUrlList(process.env.TURN_URLS || process.env.TURN_URL || process.env.TURNS_URL || "").length > 0;
}

function hasStunServer() {
  return splitUrlList(process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478").length > 0;
}

function splitUrlList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function printTurnStatus() {
  const stunUrls = splitUrlList(process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478");
  const turnUrls = splitUrlList(process.env.TURN_URLS || process.env.TURN_URL || process.env.TURNS_URL || "");
  console.log(`ICE: STUN ${stunUrls.length ? stunUrls.join(", ") : "none"}`);
  if (turnUrls.length) {
    console.log(`ICE: TURN ${turnUrls.join(", ")} username=${process.env.TURN_USERNAME ? "set" : "empty"} credential=${process.env.TURN_CREDENTIAL ? "set" : "empty"}`);
    const privateTurn = turnUrls.filter((url) => /(?:^|[:/@])(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url));
    if (privateTurn.length) {
      console.log("경고: TURN 주소가 사설 IP입니다. 외부(친구) 클라이언트는 relay 후보를 만들 수 없어 연결이 실패합니다.");
      console.log("  공인 IP로 재설정: TURN_HOST=<공인IP> ./setup-turn-mac.sh 실행 후 서버 재시작");
      console.log("  공유기 포트포워딩 필요: 3478/TCP+UDP, relay 49160-49200/TCP+UDP → Mac");
    }
    return;
  }
  console.log("ICE: TURN not configured.");
  console.log("Windows/Parallels/external clients can fail without TURN.");
  console.log("Run start-server-mac.command on the Mac server, or create server.env with:");
  console.log("  TURN_URLS=turn:YOUR_MAC_HOST:3478?transport=udp,turn:YOUR_MAC_HOST:3478?transport=tcp");
  console.log("  TURN_USERNAME=your-user");
  console.log("  TURN_CREDENTIAL=your-password");
  console.log("  STUN_URLS=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478");
}

function loadServerEnvFiles() {
  for (const fileName of ["server.env", ".env"]) {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
      process.env[match[1]] = unquoteEnvValue(match[2].trim());
    }
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadTlsOptions() {
  try {
    if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) createCertificate();
    return {
      cert: fs.readFileSync(CERT_FILE),
      key: fs.readFileSync(KEY_FILE),
    };
  } catch {
    return null;
  }
}

function createCertificate() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  const configPath = path.join(CERT_DIR, "openssl.cnf");
  const hosts = ["localhost", "127.0.0.1", "::1", getLanIp()].filter(Boolean);
  const altNames = hosts
    .map((host, index) => {
      const key = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") ? "IP" : "DNS";
      return `${key}.${index + 1} = ${host}`;
    })
    .join("\n");

  fs.writeFileSync(configPath, [
    "[req]",
    "default_bits = 2048",
    "prompt = no",
    "default_md = sha256",
    "distinguished_name = dn",
    "x509_extensions = v3_req",
    "[dn]",
    "CN = Accord Local",
    "[v3_req]",
    "subjectAltName = @alt_names",
    "[alt_names]",
    altNames,
    "",
  ].join("\n"));

  const result = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "3650",
    "-keyout",
    KEY_FILE,
    "-out",
    CERT_FILE,
    "-config",
    configPath,
  ], { stdio: "ignore" });

  if (result.status !== 0) {
    throw new Error("openssl certificate generation failed");
  }
}

function getLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "";
}

function getLanUrl(protocol, port) {
  const ip = getLanIp();
  return ip ? `${protocol}://${ip}:${port}` : "";
}

function cleanHost(value) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function cleanPublicUrl(value, host, port) {
  const raw = String(value || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  if (!host) return "";
  return `https://${host.replace(/:\d+$/, "")}:${port}`;
}
