const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const store = require("./data-store");
const ot = require("./public/ot-text.js");

loadServerEnvFiles();
store.init();
seedAdminAccount();

const VERSION = "2.2.1";
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

  // 유휴 상태에서 연결이 끊기지 않도록: 소켓 타임아웃 해제 + TCP keepalive.
  // (아무 것도 안 하고 가만히 있으면 WebSocket이 닫히는 문제 방지)
  socket.setTimeout(0);
  socket.setKeepAlive(true, 30000);
  socket.setNoDelay(true);

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
    drawRoomId: "", // 현재 보고 있는 그림판(실시간 동기화 대상 판별용)
    logRoomId: "", // 현재 보고 있는 로그방(실시간 로그 대상 판별용)
    logChannelId: "", // 그 로그방이 속한 채널(채널 단위 피드라 따로 보관)
    dmUserId: "", // 현재 보고 있는 DM 상대(읽음 판별용)
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
  if (handleDrawMessage(client, message)) return;
  if (handleLogMessage(client, message)) return;
  if (handleDmMessage(client, message)) return;

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

  if (message.type === "room:force-mute" || message.type === "room:kick-user") {
    handleRoomModeration(client, message);
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
        avatar: message.avatar,
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
        banner: message.banner,
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
  if (!store.canAccessRoom(found.channel.id, found.room.id, client.userId, client.isAdmin)) {
    send(client, { type: "error", message: "이 방에 접근할 권한이 없습니다." });
    return;
  }

  const limit = roomLimitOf(found.room);
  // 정원 초과 검사(이미 이 방에 있던 경우는 제외).
  const existing = rooms.get(roomId);
  const alreadyIn = existing && existing.clients.has(client.id);
  if (existing && !alreadyIn && existing.clients.size >= limit) {
    send(client, { type: "error", message: `통화방이 가득 찼습니다 (최대 ${limit}명).` });
    return;
  }

  leaveRoom(client, false);

  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, name: found.room.name, channelId: found.channel.id, clients: new Set(), startedAt: Date.now() };
    rooms.set(roomId, room);
  }
  room.limit = limit;
  room.clients.add(client.id);
  client.roomId = roomId;
  logServer(`joined room=${room.name} peers=${room.clients.size - 1}`, client);

  const peers = [...room.clients]
    .filter((id) => id !== client.id)
    .map((id) => {
      const peer = clients.get(id);
      return { id, name: peer?.name || "Guest", userId: peer?.userId || "" };
    });

  send(client, { type: "joined", id: client.id, room: liveRoomInfo(room), peers });

  for (const peerId of room.clients) {
    if (peerId === client.id) continue;
    send(clients.get(peerId), {
      type: "peer-joined",
      peer: { id: client.id, name: client.name, userId: client.userId },
      room: liveRoomInfo(room),
    });
  }

  logChannelEvent(found.channel.id, client, "voice-join", { roomName: room.name });
  broadcastPresence();
}

function leaveRoom(client, notify) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  client.roomId = "";
  if (!room) return;

  room.clients.delete(client.id);
  logServer(`left room=${room.name} remaining=${room.clients.size}`, client);
  logChannelEvent(room.channelId, client, "voice-leave", { roomName: room.name });
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

// 통화방 대표자의 강제 음소거 / 내보내기. 대표자(창설자·공동대표·관리자)만 가능하고,
// 다른 대표자는 대상이 될 수 없다. 결과는 전역 로그에도 기록된다.
function handleRoomModeration(client, message) {
  if (!client.userId) {
    send(client, { type: "error", message: "로그인이 필요합니다." });
    return;
  }
  const roomId = String(message.roomId || "");
  const found = store.findRoom(roomId);
  if (!found || found.room.type !== "voice") return;
  if (!store.isChannelOwner(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "error", message: "대표자만 사용할 수 있습니다." });
    return;
  }
  const target = clients.get(String(message.targetId || ""));
  if (!target || target.roomId !== roomId || target.id === client.id) return;
  // 다른 대표자(창설자·공동대표)는 강제 대상에서 제외해 서로 못 건드리게 한다.
  if (target.userId && store.isChannelOwner(found.channel.id, target.userId, target.isAdmin)) {
    send(client, { type: "error", message: "다른 대표자에게는 사용할 수 없습니다." });
    return;
  }

  if (message.type === "room:force-mute") {
    send(target, { type: "force-muted", roomId, roomName: found.room.name, byName: client.name });
    logChannelEvent(found.channel.id, target, "force-mute", { roomName: found.room.name, byName: client.name });
  } else {
    send(target, { type: "kicked-from-room", roomId, roomName: found.room.name, byName: client.name });
    logChannelEvent(found.channel.id, target, "voice-kick", { roomName: found.room.name, byName: client.name });
    leaveRoom(target, true); // 강제 퇴장(target 에겐 'left' 가 전달됨)
  }
}

function removeClient(client) {
  if (client.closed) return;
  client.closed = true;
  logServer("client disconnected", client);
  if (client.userId) store.recordConnection(client.userId, client.ip, "disconnect");
  leaveMemo(client);
  leaveDraw(client);
  client.logRoomId = "";
  client.logChannelId = "";
  client.dmUserId = "";
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

// 유휴 연결이 NAT·프록시·OS 타임아웃으로 끊기지 않도록 주기적으로 ping 프레임(opcode 9)을 보낸다.
// 브라우저 WebSocket은 자동으로 pong으로 응답하고, 서버는 pong(opcode 10)을 무시한다.
const PING_FRAME = Buffer.from([0x89, 0x00]);
setInterval(() => {
  for (const client of clients.values()) {
    if (client.closed || !client.socket.writable) continue;
    try {
      client.socket.write(PING_FRAME);
    } catch {
      /* 다음 write 실패는 socket 'error'/'close'에서 정리된다 */
    }
  }
}, 25000).unref();

// 실시간 통화방 접속 현황 + 온라인 유저를 모든 로그인 클라이언트에 알린다.
function broadcastPresence() {
  const presence = {};
  const roomsMeta = {};
  for (const room of rooms.values()) {
    presence[room.id] = [...room.clients].map((id) => {
      const c = clients.get(id);
      return { clientId: id, userId: c?.userId || "", name: c?.name || "Guest" };
    });
    roomsMeta[room.id] = { startedAt: room.startedAt || 0 };
  }
  const online = onlineUserIds();
  const payload = { type: "presence", rooms: presence, roomsMeta, online };
  for (const client of clients.values()) if (client.userId) send(client, payload);
}

function liveRoomInfo(room) {
  return {
    id: room.id,
    name: room.name,
    channelId: room.channelId || "",
    limit: room.limit || MAX_ROOM_LIMIT,
    count: room.clients.size,
    startedAt: room.startedAt || 0,
    participants: [...room.clients].map((id) => clients.get(id)?.name || "Guest"),
  };
}

// 방 메타의 정원(없으면 기본값). 1~99로 제한.
function roomLimitOf(room) {
  const n = Number(room && room.limit);
  if (!Number.isFinite(n) || n < 1) return MAX_ROOM_LIMIT;
  return Math.min(99, Math.floor(n));
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
      // 관리자는 모든 채널을 보므로, 접속 중인 다른 관리자에게도 새 채널을 즉시 반영한다.
      notifyAdmins(client.id);
      return true;
    }
    case "channel:join": {
      // 새로 들어온 경우에만 로그를 남기기 위해 참가 전 멤버 여부를 확인한다.
      const target = store.getChannelByInvite(message.code);
      const wasMember = target ? store.isChannelMember(target.id, client.userId) : false;
      const result = store.joinChannelByCode(client.userId, message.code);
      if (result.error) return channelError(client, result.error);
      logServer(`channel join name=${result.channel.name}`, client);
      notifyChannelMembers(result.channel.id);
      if (!wasMember) logChannelEvent(result.channel.id, client, "member-join", {});
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
        if (!channel) return channelError(client, "채널을 찾을 수 없습니다.");
        // 다른 멤버가 남아 있으면 삭제 불가(창설자 혼자일 때만).
        if (channel.members.length > 1) {
          return channelError(client, "다른 멤버가 있는 채널은 삭제할 수 없습니다. 먼저 모두 내보내세요.");
        }
        const memberIds = channel.members.slice();
        // 채널 방들의 실시간 접속 종료
        for (const room of channel.rooms) evictRoom(room.id);
        store.deleteChannel(message.channelId);
        for (const c of clients.values()) {
          if (c.userId && memberIds.includes(c.userId)) sendChannels(c);
        }
        // 삭제한 본인(멤버가 아닌 관리자일 수 있음)과 다른 관리자 목록도 갱신
        sendChannels(client);
        notifyAdmins(client.id);
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
    case "channel:set-room-limit":
      return ownerAction(client, message.channelId, () => {
        const r = store.setRoomLimit(message.channelId, message.roomId, message.limit);
        if (r.error) return channelError(client, r.error);
        // 이미 열려 있는 실시간 방에도 새 정원을 반영한다.
        const live = rooms.get(message.roomId);
        if (live) live.limit = roomLimitOf(r.room);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-room-readonly":
      return ownerAction(client, message.channelId, () => {
        const r = store.setRoomReadOnly(message.channelId, message.roomId, Boolean(message.value));
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
    case "channel:create-role":
      return ownerAction(client, message.channelId, () => {
        const r = store.createRole(message.channelId, message.name);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:update-role":
      return ownerAction(client, message.channelId, () => {
        const r = store.updateRole(message.channelId, message.roleId, {
          name: message.name, color: message.color, manageEmoji: message.manageEmoji,
          addEmoji: message.addEmoji, removeEmoji: message.removeEmoji,
          useEmoji: message.useEmoji, attachFile: message.attachFile,
        });
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-perms":
      return ownerAction(client, message.channelId, () => {
        const r = store.setChannelPerms(message.channelId, {
          emojiUseRestricted: message.emojiUseRestricted,
          attachRestricted: message.attachRestricted,
        });
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-user-perm":
      return ownerAction(client, message.channelId, () => {
        const r = store.setUserPerm(message.channelId, message.userId, message.cap, Boolean(message.value));
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:delete-role":
      return ownerAction(client, message.channelId, () => {
        const r = store.deleteRole(message.channelId, message.roleId);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-role-member":
      return ownerAction(client, message.channelId, () => {
        const r = store.setRoleMember(message.channelId, message.roleId, message.userId, Boolean(message.value));
        if (r.error) return channelError(client, r.error);
        // 권한이 바뀐 유저의 방 목록(접근 가능 방)이 달라질 수 있으니 대상 유저도 강제 정리 후 갱신.
        refreshRoomAccess(message.channelId, message.userId);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:set-room-perm":
      return ownerAction(client, message.channelId, () => {
        const value = message.value === null || message.value === undefined ? null : Boolean(message.value);
        const r = store.setRoomPerm(message.channelId, message.roomId, message.kind, message.targetId, message.perm, value);
        if (r.error) return channelError(client, r.error);
        // 접근 권한이 바뀌면 이미 방에 접속 중인, 이제 권한 없는 유저를 내보낸다.
        refreshRoomAccess(message.channelId);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:clear-room-perm":
      return ownerAction(client, message.channelId, () => {
        const r = store.clearRoomPerm(message.channelId, message.roomId, message.kind, message.targetId);
        if (r.error) return channelError(client, r.error);
        refreshRoomAccess(message.channelId);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:add-emoji":
      return emojiAddAction(client, message.channelId, () => {
        const r = store.addEmoji(message.channelId, message.name, message.url);
        if (r.error) return channelError(client, r.error);
        logServer(`emoji add name=:${r.emoji.name}: channel=${message.channelId}`, client);
        notifyChannelMembers(message.channelId);
        return true;
      });
    case "channel:remove-emoji":
      return emojiRemoveAction(client, message.channelId, () => {
        const r = store.removeEmoji(message.channelId, message.emojiId);
        if (r.error) return channelError(client, r.error);
        notifyChannelMembers(message.channelId);
        return true;
      });
    default:
      return false;
  }
}

// 권한 변경 후, 해당 채널의 방에 접속(통화)해 있으나 이제 접근 권한이 없는 유저를 내보낸다.
// onlyUserId 를 주면 그 유저만 검사한다.
function refreshRoomAccess(channelId, onlyUserId = "") {
  const channel = store.getChannel(channelId);
  if (!channel) return;
  for (const c of clients.values()) {
    if (!c.userId || !c.roomId) continue;
    if (onlyUserId && c.userId !== onlyUserId) continue;
    const room = rooms.get(c.roomId);
    if (!room || room.channelId !== channelId) continue;
    if (!store.canAccessRoom(channelId, c.roomId, c.userId, c.isAdmin)) {
      leaveRoom(c, true);
    }
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

// 이모지 추가(업로드): 대표·관리자 또는 addEmoji 역할 보유자만.
function emojiAddAction(client, channelId, fn) {
  if (!store.canAddEmoji(channelId, client.userId, client.isAdmin)) {
    return channelError(client, "이모지를 추가할 권한이 없습니다.");
  }
  return fn();
}
// 이모지 삭제: 대표·관리자 또는 removeEmoji 역할 보유자만.
function emojiRemoveAction(client, channelId, fn) {
  if (!store.canRemoveEmoji(channelId, client.userId, client.isAdmin)) {
    return channelError(client, "이모지를 삭제할 권한이 없습니다.");
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
        ? { id: u.id, displayName: u.displayName || u.username || `유저#${u.code}`, code: u.code, avatar: u.avatar, banner: u.banner || "", isAdmin: Boolean(u.isAdmin) }
        : { id, displayName: "(삭제된 계정)", code: "----", avatar: "", banner: "", isAdmin: false };
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

// 접속 중인 관리자 전원(선택적으로 한 명 제외)에게 채널 목록을 다시 보낸다.
// 관리자는 모든 채널을 볼 수 있으므로, 채널 생성/삭제 시 목록을 즉시 맞춘다.
function notifyAdmins(exceptClientId = "") {
  for (const c of clients.values()) {
    if (c.userId && c.isAdmin && c.id !== exceptClientId) sendChannels(c);
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

// 방에 쓰기(채팅·메모편집·그리기)가 가능한지. 읽기 전용 방은 대표자만,
// 그 외에는 권한 시스템의 사용(use) 권한을 따른다. 대표자/관리자는 항상 허용.
function isRoomWritable(ctx, client) {
  if (ctx.room.readOnly && !store.isChannelOwner(ctx.channel.id, client.userId, client.isAdmin)) {
    return false;
  }
  return store.canUseRoom(ctx.channel.id, ctx.room.id, client.userId, client.isAdmin);
}

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
      if (!isRoomWritable(ctx, client)) {
        send(client, { type: "chat-error", message: "읽기 전용 방입니다. 대표자만 작성할 수 있습니다." });
        return true;
      }
      const text = String(message.text || "").slice(0, CHAT_TEXT_MAX).replace(/\s+$/, "");
      const files = cleanChatFiles(message.files);
      if (!text && !files.length) {
        send(client, { type: "chat-error", message: "빈 메시지는 보낼 수 없습니다." });
        return true;
      }
      // 파일 첨부 권한
      if (files.length && !store.canAttach(ctx.channel.id, client.userId, client.isAdmin)) {
        send(client, { type: "chat-error", message: "파일을 첨부할 권한이 없습니다." });
        return true;
      }
      // 커스텀 이모지 사용 권한: 텍스트에 이 채널의 커스텀 이모지 토큰이 있으면 권한 필요
      if (text && !store.canUseEmoji(ctx.channel.id, client.userId, client.isAdmin)) {
        const emojis = (store.getChannel(ctx.channel.id)?.emojis) || [];
        if (emojis.some((e) => e && e.name && new RegExp(`:${e.name}:`).test(text))) {
          send(client, { type: "chat-error", message: "커스텀 이모지를 사용할 권한이 없습니다." });
          return true;
        }
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
    case "chat:delete": {
      const ctx = resolveChatRoom(client, message.roomId);
      if (!ctx) return true;
      const list = store.getMessages(ctx.room.id);
      const target = list.find((m) => m.id === message.msgId);
      if (!target) return true; // 이미 삭제됨
      // 대표자(또는 관리자)는 모든 메시지, 일반 유저는 본인 메시지만 삭제 가능.
      const isOwner = store.isChannelOwner(ctx.channel.id, client.userId, client.isAdmin);
      if (target.userId !== client.userId && !isOwner) {
        send(client, { type: "chat-error", message: "본인 메시지만 삭제할 수 있습니다." });
        return true;
      }
      store.deleteMessage(ctx.room.id, message.msgId);
      broadcastChat(ctx.channel, { type: "chat:deleted", roomId: ctx.room.id, msgId: message.msgId });
      return true;
    }
    case "chat:edit": {
      const ctx = resolveChatRoom(client, message.roomId);
      if (!ctx) return true;
      if (!isRoomWritable(ctx, client)) {
        send(client, { type: "chat-error", message: "읽기 전용 방입니다." });
        return true;
      }
      const text = String(message.text || "").slice(0, CHAT_TEXT_MAX).replace(/\s+$/, "");
      if (!text) {
        send(client, { type: "chat-error", message: "빈 메시지로 수정할 수 없습니다." });
        return true;
      }
      // 커스텀 이모지 사용 권한 재확인(사용 제한 채널에서 우회 방지)
      if (!store.canUseEmoji(ctx.channel.id, client.userId, client.isAdmin)) {
        const emojis = (store.getChannel(ctx.channel.id)?.emojis) || [];
        if (emojis.some((e) => e && e.name && new RegExp(`:${e.name}:`).test(text))) {
          send(client, { type: "chat-error", message: "커스텀 이모지를 사용할 권한이 없습니다." });
          return true;
        }
      }
      const r = store.editMessage(ctx.room.id, message.msgId, client.userId, text);
      if (r.error) { send(client, { type: "chat-error", message: r.error }); return true; }
      broadcastChat(ctx.channel, { type: "chat:edited", roomId: ctx.room.id, msgId: message.msgId, text: r.message.text, editedAt: r.message.editedAt });
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
  if (!store.canAccessRoom(found.channel.id, found.room.id, client.userId, client.isAdmin)) {
    send(client, { type: "chat-error", message: "이 방에 접근할 권한이 없습니다." });
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

// ===== 공동 메모장 (OT 실시간 협업) =====
// 방별 메모 문서를 메모리에 두고 OT로 동시편집을 병합한다. history는 서버 실행 중에만 유지되고
// 텍스트는 디바운스로 파일에 저장된다(서버 재시작 시 파일에서 재적재, rev는 0부터).
const memoDocs = new Map(); // roomId -> { text, history:[], cursors:Map(clientId->cursor), saveTimer }
const MEMO_PERSIST_DEBOUNCE = 1500;

function getMemoDoc(roomId) {
  let d = memoDocs.get(roomId);
  if (!d) {
    const saved = store.getMemo(roomId);
    d = { text: saved.text || "", history: [], cursors: new Map(), saveTimer: 0 };
    memoDocs.set(roomId, d);
  }
  return d;
}

function scheduleMemoPersist(roomId, userId) {
  const d = memoDocs.get(roomId);
  if (!d) return;
  if (d.saveTimer) clearTimeout(d.saveTimer);
  d.saveTimer = setTimeout(() => {
    d.saveTimer = 0;
    store.saveMemo(roomId, d.text, userId);
  }, MEMO_PERSIST_DEBOUNCE);
}

function flushMemoPersist(roomId, userId) {
  const d = memoDocs.get(roomId);
  if (!d) return;
  if (d.saveTimer) { clearTimeout(d.saveTimer); d.saveTimer = 0; }
  store.saveMemo(roomId, d.text, userId || "");
}

function memoViewerCount(roomId) {
  let n = 0;
  for (const c of clients.values()) if (c.memoRoomId === roomId) n++;
  return n;
}

// 클라이언트가 메모방 보기를 그만둘 때(닫기/연결종료) 정리.
function leaveMemo(client) {
  const roomId = client.memoRoomId;
  if (!roomId) return;
  client.memoRoomId = "";
  const d = memoDocs.get(roomId);
  if (d) {
    d.cursors.delete(client.id);
    for (const c of clients.values()) {
      if (c.memoRoomId === roomId) send(c, { type: "memo:cursor-leave", roomId, clientId: client.id });
    }
    if (memoViewerCount(roomId) === 0) {
      flushMemoPersist(roomId, client.userId);
      memoDocs.delete(roomId); // 아무도 안 보면 메모리에서 내림(다음 open 시 파일에서 재적재)
    }
  }
}

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
      const d = getMemoDoc(ctx.room.id);
      const cursors = [...d.cursors.values()].filter((cur) => cur.clientId !== client.id);
      send(client, { type: "memo:state", roomId: ctx.room.id, text: d.text, rev: d.history.length, cursors });
      return true;
    }
    case "memo:close": {
      leaveMemo(client);
      return true;
    }
    case "memo:op": {
      const ctx = resolveMemoRoom(client, message.roomId);
      if (!ctx) return true;
      if (!isRoomWritable(ctx, client)) {
        send(client, { type: "memo-error", message: "읽기 전용 메모입니다. 대표자만 편집할 수 있습니다." });
        return true;
      }
      const d = getMemoDoc(ctx.room.id);
      let o = message.ops;
      if (!Array.isArray(o)) return true;
      const baseRev = Math.max(0, Math.min(d.history.length, Number(message.rev) || 0));
      try {
        for (let i = baseRev; i < d.history.length; i++) o = ot.transform(o, d.history[i], "right");
        d.text = ot.apply(d.text, o);
      } catch (err) {
        send(client, { type: "memo-error", message: "동기화 오류가 발생했습니다. 새로고침 해주세요." });
        return true;
      }
      d.history.push(o);
      const rev = d.history.length;
      scheduleMemoPersist(ctx.room.id, client.userId);
      // 키 입력마다가 아니라, 편집 세션당 한 번꼴로만 로그를 남긴다(2분 스로틀).
      if (logThrottleOk(`memo-edit:${ctx.room.id}:${client.userId}`, 120000)) {
        logChannelEvent(ctx.channel.id, client, "memo-edit", { roomName: ctx.room.name });
      }
      const payload = { type: "memo:op", roomId: ctx.room.id, rev, ops: o, by: client.id };
      for (const c of clients.values()) {
        if (c.memoRoomId === ctx.room.id) send(c, payload); // 발신자 포함(ack 겸용)
      }
      return true;
    }
    case "memo:cursor": {
      const ctx = resolveMemoRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getMemoDoc(ctx.room.id);
      const pos = Math.max(0, Number(message.pos) || 0);
      const sel = Number.isFinite(Number(message.sel)) ? Math.max(0, Number(message.sel)) : pos;
      const cur = { clientId: client.id, userId: client.userId, name: client.name, pos, sel };
      d.cursors.set(client.id, cur);
      for (const c of clients.values()) {
        if (c.id === client.id || c.memoRoomId !== ctx.room.id) continue;
        send(c, { type: "memo:cursor", roomId: ctx.room.id, ...cur });
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
  if (!store.canAccessRoom(found.channel.id, found.room.id, client.userId, client.isAdmin)) {
    send(client, { type: "memo-error", message: "이 방에 접근할 권한이 없습니다." });
    return null;
  }
  return found;
}

// ===== 공동 그림판 =====
// 방별 캔버스 문서를 메모리에 두고, stroke/레이어 변경을 그리는 사람 전원에게 브로드캐스트한다.
// 텍스트 메모(OT)와 달리 그림은 append-only(획 추가) + 레이어 조작이라 last-write 병합이 필요 없다.
// 늦게 들어온 사람은 draw:open 시 전체 문서를 받아 그대로 리플레이한다.
const drawDocs = new Map(); // roomId -> { doc, saveTimer }
const DRAW_PERSIST_DEBOUNCE = 2000;

function getDrawDoc(roomId) {
  let d = drawDocs.get(roomId);
  if (!d) {
    d = { doc: store.getDraw(roomId), saveTimer: 0, cursors: new Map() };
    drawDocs.set(roomId, d);
  }
  return d;
}

function scheduleDrawPersist(roomId) {
  const d = drawDocs.get(roomId);
  if (!d) return;
  if (d.saveTimer) clearTimeout(d.saveTimer);
  d.saveTimer = setTimeout(() => {
    d.saveTimer = 0;
    store.saveDraw(roomId, d.doc);
  }, DRAW_PERSIST_DEBOUNCE);
}

function flushDrawPersist(roomId) {
  const d = drawDocs.get(roomId);
  if (!d) return;
  if (d.saveTimer) { clearTimeout(d.saveTimer); d.saveTimer = 0; }
  store.saveDraw(roomId, d.doc);
}

function drawViewerCount(roomId) {
  let n = 0;
  for (const c of clients.values()) if (c.drawRoomId === roomId) n++;
  return n;
}

// 그리는 사람 전원(옵션으로 발신자 제외)에게 전달.
function broadcastDraw(roomId, payload, exceptId) {
  for (const c of clients.values()) {
    if (c.drawRoomId !== roomId) continue;
    if (exceptId && c.id === exceptId) continue;
    send(c, payload);
  }
}

function leaveDraw(client) {
  const roomId = client.drawRoomId;
  if (!roomId) return;
  client.drawRoomId = "";
  const d = drawDocs.get(roomId);
  if (d && d.cursors.delete(client.id)) {
    broadcastDraw(roomId, { type: "draw:cursor-leave", roomId, clientId: client.id });
  }
  if (drawViewerCount(roomId) === 0) {
    flushDrawPersist(roomId);
    drawDocs.delete(roomId); // 아무도 안 보면 메모리에서 내림(다음 open 시 파일에서 재적재)
  }
}

function drawNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function drawClampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanDrawColor(value) {
  const s = String(value || "").slice(0, 32);
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\([\d.,\s]+\)$/.test(s)) return s;
  return "#000000";
}

// 신뢰할 수 없는 stroke를 정규화. 실패하면 null.
function sanitizeStroke(raw, authorId) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").slice(0, 64);
  if (!id) return null;
  if (raw.tool === "image") {
    const src = String(raw.src || "");
    if (!src.startsWith("data:image/") || src.length > 6000000) return null;
    return {
      id, tool: "image", by: authorId, src,
      x: drawNum(raw.x, 0), y: drawNum(raw.y, 0),
      w: Math.max(1, drawNum(raw.w, 100)), h: Math.max(1, drawNum(raw.h, 100)),
    };
  }
  const tool = raw.tool === "eraser" ? "eraser" : "pen";
  const src = Array.isArray(raw.points) ? raw.points.slice(0, 8000) : [];
  const points = [];
  for (const p of src) {
    if (!Array.isArray(p)) continue;
    points.push([drawNum(p[0], 0), drawNum(p[1], 0)]);
  }
  if (!points.length) return null;
  return {
    id, tool, by: authorId,
    color: cleanDrawColor(raw.color),
    size: drawClampNum(raw.size, 1, 300, 4),
    points,
  };
}

function findDrawLayer(doc, layerId) {
  return doc.layers.find((l) => l.id === String(layerId || ""));
}

const DRAW_WRITE_TYPES = new Set([
  "draw:stroke", "draw:undo", "draw:clear", "draw:resize",
  "draw:layer-add", "draw:layer-remove", "draw:layer-update", "draw:layer-reorder",
  "draw:layer-replace",
]);

function handleDrawMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("draw:")) return false;
  if (!client.userId) {
    send(client, { type: "draw-error", message: "로그인이 필요합니다." });
    return true;
  }

  // 읽기 전용 그림판이면 대표자가 아닌 사람의 쓰기 동작을 막는다(열람/상태 수신은 허용).
  if (DRAW_WRITE_TYPES.has(message.type)) {
    const ctx = resolveDrawRoom(client, message.roomId);
    if (!ctx) return true;
    if (!isRoomWritable(ctx, client)) {
      send(client, { type: "draw-error", message: "읽기 전용 그림판입니다. 대표자만 그릴 수 있습니다." });
      return true;
    }
  }

  switch (message.type) {
    case "draw:open": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const wasViewing = client.drawRoomId === ctx.room.id;
      client.drawRoomId = ctx.room.id;
      const d = getDrawDoc(ctx.room.id);
      const cursors = [...d.cursors.values()].filter((cur) => cur.clientId !== client.id);
      send(client, { type: "draw:state", roomId: ctx.room.id, doc: d.doc, cursors });
      // 재접속/재열기 도배를 막기 위해 30초 스로틀. 이미 보던 방을 다시 열면 기록 안 함.
      if (!wasViewing && logThrottleOk(`draw-join:${ctx.room.id}:${client.userId}`, 30000)) {
        logChannelEvent(ctx.channel.id, client, "draw-join", { roomName: ctx.room.name });
      }
      return true;
    }
    case "draw:close": {
      leaveDraw(client);
      return true;
    }
    case "draw:stroke": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const layer = findDrawLayer(d.doc, message.layerId);
      if (!layer) return true;
      const stroke = sanitizeStroke(message.stroke, client.userId);
      if (!stroke) return true;
      layer.strokes.push(stroke);
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:stroke", roomId: ctx.room.id, layerId: layer.id, stroke }, client.id);
      return true;
    }
    case "draw:undo": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const strokeId = String(message.strokeId || "");
      for (const layer of d.doc.layers) {
        const idx = layer.strokes.findIndex((s) => s.id === strokeId && s.by === client.userId);
        if (idx >= 0) {
          layer.strokes.splice(idx, 1);
          scheduleDrawPersist(ctx.room.id);
          broadcastDraw(ctx.room.id, { type: "draw:remove", roomId: ctx.room.id, strokeId });
          break;
        }
      }
      return true;
    }
    case "draw:clear": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const layerId = String(message.layerId || "");
      if (layerId === "*") {
        for (const layer of d.doc.layers) layer.strokes = [];
      } else {
        const layer = findDrawLayer(d.doc, layerId);
        if (!layer) return true;
        layer.strokes = [];
      }
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:clear", roomId: ctx.room.id, layerId }, client.id);
      return true;
    }
    case "draw:resize": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      d.doc.width = drawClampNum(message.width, 200, 4000, d.doc.width);
      d.doc.height = drawClampNum(message.height, 200, 4000, d.doc.height);
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:resize", roomId: ctx.room.id, width: d.doc.width, height: d.doc.height }, client.id);
      return true;
    }
    case "draw:layer-add": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      if (d.doc.layers.length >= 20) { send(client, { type: "draw-error", message: "레이어는 최대 20개입니다." }); return true; }
      const raw = message.layer || {};
      const id = String(raw.id || "").slice(0, 32) || `L${Date.now().toString(36)}`;
      if (findDrawLayer(d.doc, id)) return true;
      const layer = { id, name: String(raw.name || `레이어 ${d.doc.layers.length + 1}`).slice(0, 40), visible: true, strokes: [] };
      d.doc.layers.push(layer);
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:layer-add", roomId: ctx.room.id, layer }, client.id);
      return true;
    }
    case "draw:layer-remove": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      if (d.doc.layers.length <= 1) { send(client, { type: "draw-error", message: "최소 한 개의 레이어가 필요합니다." }); return true; }
      const layerId = String(message.layerId || "");
      const before = d.doc.layers.length;
      d.doc.layers = d.doc.layers.filter((l) => l.id !== layerId);
      if (d.doc.layers.length === before) return true;
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:layer-remove", roomId: ctx.room.id, layerId }, client.id);
      return true;
    }
    case "draw:layer-update": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const layer = findDrawLayer(d.doc, message.layerId);
      if (!layer) return true;
      if (typeof message.visible === "boolean") layer.visible = message.visible;
      if (typeof message.locked === "boolean") layer.locked = message.locked;
      if (typeof message.name === "string") layer.name = message.name.slice(0, 40) || layer.name;
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:layer-update", roomId: ctx.room.id, layerId: layer.id, visible: layer.visible, locked: layer.locked, name: layer.name }, client.id);
      return true;
    }
    case "draw:layer-replace": {
      // 레이어의 모든 획을 통째로 교체(이동/크기 변형 확정용). 신뢰할 수 없는 획을 정규화한다.
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const layer = findDrawLayer(d.doc, message.layerId);
      if (!layer) return true;
      const src = Array.isArray(message.strokes) ? message.strokes.slice(0, 20000) : [];
      const cleaned = [];
      for (const raw of src) {
        const s = sanitizeStroke(raw, raw && raw.by ? String(raw.by).slice(0, 64) : client.userId);
        if (s) cleaned.push(s);
      }
      layer.strokes = cleaned;
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:layer-replace", roomId: ctx.room.id, layerId: layer.id, strokes: cleaned }, client.id);
      return true;
    }
    case "draw:layer-reorder": {
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      const d = getDrawDoc(ctx.room.id);
      const order = Array.isArray(message.order) ? message.order.map(String) : [];
      const map = new Map(d.doc.layers.map((l) => [l.id, l]));
      const reordered = [];
      for (const id of order) if (map.has(id)) { reordered.push(map.get(id)); map.delete(id); }
      for (const l of map.values()) reordered.push(l); // 누락된 레이어는 뒤에 유지
      if (reordered.length !== d.doc.layers.length) return true;
      d.doc.layers = reordered;
      scheduleDrawPersist(ctx.room.id);
      broadcastDraw(ctx.room.id, { type: "draw:layer-reorder", roomId: ctx.room.id, order: d.doc.layers.map((l) => l.id) }, client.id);
      return true;
    }
    case "draw:cursor": {
      // 실시간 커서/그리는 위치 공유(비영속). 발신자를 제외한 열람자에게 그대로 릴레이한다.
      const ctx = resolveDrawRoom(client, message.roomId);
      if (!ctx) return true;
      if (client.drawRoomId !== ctx.room.id) return true; // 열람 중일 때만
      const d = getDrawDoc(ctx.room.id);
      const cur = {
        clientId: client.id,
        name: client.name || "게스트",
        x: drawNum(message.x, 0),
        y: drawNum(message.y, 0),
        tool: String(message.tool || "pen").slice(0, 12),
        color: cleanDrawColor(message.color),
        size: drawClampNum(message.size, 1, 300, 4),
        drawing: Boolean(message.drawing),
        active: message.active !== false,
      };
      d.cursors.set(client.id, cur);
      broadcastDraw(ctx.room.id, { type: "draw:cursor", roomId: ctx.room.id, ...cur }, client.id);
      return true;
    }
    case "draw:cursor-leave": {
      const roomId = client.drawRoomId;
      if (!roomId) return true;
      const d = drawDocs.get(roomId);
      if (d && d.cursors.delete(client.id)) {
        broadcastDraw(roomId, { type: "draw:cursor-leave", roomId, clientId: client.id }, client.id);
      }
      return true;
    }
    default:
      return false;
  }
}

function resolveDrawRoom(client, roomId) {
  const found = store.findRoom(String(roomId || ""));
  if (!found || found.room.type !== "draw") {
    send(client, { type: "draw-error", message: "그림판을 찾지 못했습니다." });
    return null;
  }
  if (!store.isChannelMember(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "draw-error", message: "채널 멤버만 이용할 수 있습니다." });
    return null;
  }
  if (!store.canAccessRoom(found.channel.id, found.room.id, client.userId, client.isAdmin)) {
    send(client, { type: "draw-error", message: "이 방에 접근할 권한이 없습니다." });
    return null;
  }
  return found;
}

// ===== 전역 로그 =====
// 채널 단위 이벤트 타임라인(통화 입/퇴장·그림판 참여·메모 편집·채널 참여). 방이 아니라 채널에 종속되므로
// 로그방이 여러 개여도 같은 피드를 본다. 이벤트마다 파일에 append 하고, 그 채널의 로그방을 보고 있는
// 클라이언트에게만 실시간 전달한다(안 보는 사람은 다음에 열 때 전체 history 를 받는다).
const LOG_THROTTLE = new Map(); // key -> lastTs. 연속 이벤트(편집·재접속) 도배 방지.

// windowMs 안에 같은 key 이벤트가 또 오면 false(기록 생략), 아니면 true 로 통과시키고 시각을 갱신.
function logThrottleOk(key, windowMs) {
  const now = Date.now();
  const last = LOG_THROTTLE.get(key) || 0;
  if (now - last < windowMs) return false;
  LOG_THROTTLE.set(key, now);
  return true;
}

function logChannelEvent(channelId, actor, type, extra = {}) {
  if (!channelId || !type) return;
  const user = actor && actor.userId ? store.findById(actor.userId) : null;
  const entry = {
    id: crypto.randomBytes(6).toString("hex"),
    type,
    at: Date.now(),
    userId: actor ? actor.userId : "",
    name: user ? (user.displayName || user.username || "") : (actor ? actor.name : ""),
    ...extra,
  };
  store.appendChannelLog(channelId, entry);
  for (const c of clients.values()) {
    if (c.logChannelId === channelId) send(c, { type: "log:entry", channelId, entry });
  }
}

function resolveLogRoom(client, roomId) {
  const found = store.findRoom(String(roomId || ""));
  if (!found || found.room.type !== "log") {
    send(client, { type: "log-error", message: "로그방을 찾지 못했습니다." });
    return null;
  }
  if (!store.isChannelMember(found.channel.id, client.userId, client.isAdmin)) {
    send(client, { type: "log-error", message: "채널 멤버만 이용할 수 있습니다." });
    return null;
  }
  if (!store.canAccessRoom(found.channel.id, found.room.id, client.userId, client.isAdmin)) {
    send(client, { type: "log-error", message: "로그방에 접근할 권한이 없습니다." });
    return null;
  }
  return found;
}

function handleLogMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("log:")) return false;
  if (!client.userId) {
    send(client, { type: "log-error", message: "로그인이 필요합니다." });
    return true;
  }
  switch (message.type) {
    case "log:open": {
      const ctx = resolveLogRoom(client, message.roomId);
      if (!ctx) return true;
      client.logRoomId = ctx.room.id;
      client.logChannelId = ctx.channel.id;
      send(client, {
        type: "log:history",
        roomId: ctx.room.id,
        channelId: ctx.channel.id,
        entries: store.getChannelLog(ctx.channel.id),
      });
      return true;
    }
    case "log:close": {
      client.logRoomId = "";
      client.logChannelId = "";
      return true;
    }
    default:
      return false;
  }
}

// ===== 다이렉트 메시지(1:1 DM) =====
// 채널과 무관한 개인 대화. 유저 코드(#XXXX)로 상대를 찾고, 대화별 파일에 영속한다.
const DM_TEXT_MAX = 4000;

// DM 상대에게 보여줄 공개 정보(email 등 민감정보 제외).
function dmUserView(user) {
  if (!user) return null;
  return { id: user.id, displayName: user.displayName || user.username || `유저#${user.code}`, code: user.code, avatar: user.avatar || "", banner: user.banner || "" };
}

// 특정 userId 로 로그인한 모든 접속에 전달(같은 계정 여러 탭 대응).
function deliverToUser(userId, payload) {
  if (!userId) return;
  for (const c of clients.values()) if (c.userId === userId) send(c, payload);
}

// 스레드마다 상대 유저 정보를 붙여서 반환.
function dmThreadsFor(userId) {
  return store.listDmThreads(userId).map((t) => {
    const otherId = (t.users || []).find((u) => u !== userId) || "";
    const other = store.findById(otherId);
    return {
      id: t.id,
      userId: otherId,
      partner: other ? dmUserView(other) : { id: otherId, displayName: "(삭제된 계정)", code: "----", avatar: "", banner: "" },
      lastAt: t.lastAt || 0,
      lastText: t.lastText || "",
      lastFrom: t.lastFrom || "",
    };
  });
}

function sendDmThreads(userId) {
  const threads = dmThreadsFor(userId);
  deliverToUser(userId, { type: "dm:threads", threads });
}

function handleDmMessage(client, message) {
  if (typeof message.type !== "string" || !message.type.startsWith("dm:")) return false;
  if (!client.userId) {
    send(client, { type: "dm-error", message: "로그인이 필요합니다." });
    return true;
  }
  switch (message.type) {
    case "dm:list": {
      send(client, { type: "dm:threads", threads: dmThreadsFor(client.userId) });
      return true;
    }
    case "dm:find": {
      const user = store.findByCode(message.code);
      if (!user) {
        send(client, { type: "dm-error", action: "find", message: "해당 코드의 유저를 찾지 못했습니다." });
        return true;
      }
      if (user.id === client.userId) {
        send(client, { type: "dm-error", action: "find", message: "자기 자신에게는 보낼 수 없습니다." });
        return true;
      }
      send(client, { type: "dm:user", user: dmUserView(user) });
      return true;
    }
    case "dm:open": {
      const partner = store.findById(String(message.userId || ""));
      if (!partner || partner.id === client.userId) {
        send(client, { type: "dm-error", message: "상대를 찾지 못했습니다." });
        return true;
      }
      client.dmUserId = partner.id;
      send(client, {
        type: "dm:history",
        userId: partner.id,
        partner: dmUserView(partner),
        messages: store.getDmMessages(client.userId, partner.id),
      });
      return true;
    }
    case "dm:close": {
      client.dmUserId = "";
      return true;
    }
    case "dm:send": {
      const partner = store.findById(String(message.userId || ""));
      if (!partner || partner.id === client.userId) {
        send(client, { type: "dm-error", message: "상대를 찾지 못했습니다." });
        return true;
      }
      const text = String(message.text || "").slice(0, DM_TEXT_MAX).replace(/\s+$/, "");
      if (!text) {
        send(client, { type: "dm-error", message: "빈 메시지는 보낼 수 없습니다." });
        return true;
      }
      const me = store.findById(client.userId);
      const msg = {
        id: crypto.randomBytes(8).toString("hex"),
        userId: client.userId,
        name: me ? me.displayName : client.name,
        code: me ? me.code : "",
        text,
        at: Date.now(),
      };
      const res = store.addDmMessage(client.userId, partner.id, msg);
      if (res.error) {
        send(client, { type: "dm-error", message: res.error });
        return true;
      }
      const payload = { type: "dm:message", users: [client.userId, partner.id], message: msg };
      deliverToUser(client.userId, payload);
      deliverToUser(partner.id, payload);
      sendDmThreads(client.userId);
      sendDmThreads(partner.id);
      return true;
    }
    case "dm:delete": {
      const partner = store.findById(String(message.userId || ""));
      if (!partner) return true;
      const list = store.getDmMessages(client.userId, partner.id);
      const target = list.find((m) => m.id === message.msgId);
      if (!target) return true; // 이미 삭제됨
      if (target.userId !== client.userId) {
        send(client, { type: "dm-error", message: "본인 메시지만 삭제할 수 있습니다." });
        return true;
      }
      store.deleteDmMessage(client.userId, partner.id, message.msgId);
      const payload = { type: "dm:deleted", users: [client.userId, partner.id], msgId: message.msgId };
      deliverToUser(client.userId, payload);
      deliverToUser(partner.id, payload);
      return true;
    }
    default:
      return false;
  }
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
