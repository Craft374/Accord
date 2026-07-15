// Accord 영속 데이터 스토어 (계정/세션).
// - 순수 node:crypto + JSON 파일. 외부 의존성 없음.
// - server-data/ 폴더에 저장되며 .gitignore 로 커밋 금지(비밀번호 해시 포함).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = path.join(__dirname, "server-data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const CHANNELS_FILE = path.join(DATA_DIR, "channels.json");
const MESSAGES_DIR = path.join(DATA_DIR, "messages");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const MEMO_DIR = path.join(DATA_DIR, "memo");
const DRAW_DIR = path.join(DATA_DIR, "draw");
const LOG_DIR = path.join(DATA_DIR, "log");
const DM_DIR = path.join(DATA_DIR, "dm");
const DM_INDEX_FILE = path.join(DATA_DIR, "dm-threads.json");
const MAX_MESSAGES_PER_ROOM = 1000; // 방별 보관 메시지 상한(초과 시 오래된 것부터 정리)
const MAX_LOG_PER_CHANNEL = 500; // 채널별 보관 로그 상한(초과 시 오래된 것부터 정리)
const MAX_DM_PER_THREAD = 2000; // DM 대화별 보관 메시지 상한
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // 파일 업로드 최대 50MB
const MEMO_MAX_LEN = 200000; // 메모장 최대 길이(약 200KB)
const DRAW_MAX_BYTES = 8 * 1024 * 1024; // 그림판 문서 최대 크기(약 8MB, 붙여넣은 이미지 포함)
const DRAW_MIN_SIZE = 200;
const DRAW_MAX_SIZE = 4000;

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // base36
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 혼동 문자 제외
const MAX_CONN_LOG = 40; // 유저별 접속 로그 보관 개수
const AVATAR_MAX_LEN = 400000; // 프로필 이미지 data URL 최대 길이(약 300KB)
const BANNER_MAX_LEN = 900000; // 프로필 배경 이미지 data URL 최대 길이(약 670KB)
const ROOM_TYPES = ["voice", "chat", "memo", "draw", "log"];
const DEFAULT_ROOM_LIMIT = 8; // 통화방 기본 정원
const ROOM_LIMIT_MAX = 99;

let db = { users: [], codeCounter: 0 };
let sessions = {}; // token -> { userId, createdAt }
let channelsDb = { channels: [] };
let dmThreads = []; // [{ id, users:[a,b], lastAt, lastText, lastFrom }]

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = readJson(USERS_FILE, { users: [], codeCounter: 0 });
  if (!Array.isArray(db.users)) db.users = [];
  if (!Number.isFinite(db.codeCounter)) db.codeCounter = 0;
  sessions = readJson(SESSIONS_FILE, {});
  if (!sessions || typeof sessions !== "object") sessions = {};
  channelsDb = readJson(CHANNELS_FILE, { channels: [] });
  if (!Array.isArray(channelsDb.channels)) channelsDb.channels = [];
  const dm = readJson(DM_INDEX_FILE, []);
  dmThreads = Array.isArray(dm) ? dm : [];
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function persistUsers() {
  writeJsonAtomic(USERS_FILE, db);
}

function persistSessions() {
  writeJsonAtomic(SESSIONS_FILE, sessions);
}

// ---- 비밀번호 해시(scrypt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- 고유 코드(#AD19: 영문+숫자 혼합, 순서대로) ----
function codeFromCounter(n) {
  let s = "";
  let x = n;
  for (let i = 0; i < 4; i++) {
    s = CODE_ALPHABET[x % 36] + s;
    x = Math.floor(x / 36);
  }
  return s;
}

function hasLetterAndDigit(code) {
  return /[0-9]/.test(code) && /[A-Z]/.test(code);
}

function isCodeTaken(code) {
  return db.users.some((u) => u.code === code);
}

function nextCode() {
  // 카운터를 올리며 영문+숫자가 모두 있고, 예약(#0000)이 아니며, 중복 없는 코드를 찾는다.
  for (let guard = 0; guard < 36 * 36 * 36 * 36; guard++) {
    db.codeCounter += 1;
    const code = codeFromCounter(db.codeCounter);
    if (code === "0000") continue;
    if (!hasLetterAndDigit(code)) continue;
    if (isCodeTaken(code)) continue;
    return code;
  }
  throw new Error("사용 가능한 고유 코드가 없습니다.");
}

// ---- 유효성 검사 ----
function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
    return "아이디는 영문/숫자/._- 3~20자여야 합니다.";
  }
  return "";
}

function validatePassword(password) {
  if (String(password || "").length < 6) return "비밀번호는 6자 이상이어야 합니다.";
  return "";
}

function cleanDisplayName(value, fallback) {
  const name = String(value || "").trim().slice(0, 24);
  return name || fallback || "이름없음";
}

function cleanAvatar(value) {
  const v = String(value || "");
  if (!v) return "";
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(v)) return "";
  if (v.length > AVATAR_MAX_LEN) return "";
  return v;
}

// 프로필 배경(배너)은 가로로 긴 이미지라 아바타보다 여유를 둔다.
function cleanBanner(value) {
  const v = String(value || "");
  if (!v) return "";
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(v)) return "";
  if (v.length > BANNER_MAX_LEN) return "";
  return v;
}

// 배경 그라데이션 템플릿 키. 실제 그라데이션 CSS는 클라이언트가 키로 매핑한다.
function cleanBannerGradient(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return /^[a-z0-9]{1,20}$/.test(v) ? v : "";
}

// ---- 유저 조회/생성 ----
function findByUsername(username) {
  const u = normalizeUsername(username);
  return db.users.find((x) => x.username === u) || null;
}

function findByCode(code) {
  const c = String(code || "").replace(/^#/, "").toUpperCase();
  return db.users.find((x) => x.code === c) || null;
}

function findById(id) {
  return db.users.find((x) => x.id === id) || null;
}

function createUser({ username, password, displayName, email, avatar }) {
  const uname = normalizeUsername(username);
  const unameError = validateUsername(uname);
  if (unameError) return { error: unameError };
  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };
  if (findByUsername(uname)) return { error: "이미 사용 중인 아이디입니다." };

  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    username: uname,
    displayName: cleanDisplayName(displayName, uname),
    code: nextCode(),
    passwordHash: hashPassword(password),
    email: String(email || "").trim().slice(0, 120),
    emailVerified: false,
    avatar: cleanAvatar(avatar),
    banner: "",
    bannerGradient: "",
    isAdmin: false,
    createdAt: Date.now(),
    lastLoginAt: 0,
    lastIp: "",
    connLog: [],
  };
  db.users.push(user);
  persistUsers();
  return { user };
}

function authenticate(username, password) {
  const user = findByUsername(username);
  if (!user) return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  if (!verifyPassword(password, user.passwordHash)) {
    return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }
  return { user };
}

function changePassword(userId, oldPassword, newPassword) {
  const user = findById(userId);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  if (!verifyPassword(oldPassword, user.passwordHash)) {
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return { error: pwError };
  user.passwordHash = hashPassword(newPassword);
  persistUsers();
  return { user };
}

function updateProfile(userId, { displayName, avatar, banner, bannerGradient, email } = {}) {
  const user = findById(userId);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  if (displayName !== undefined) user.displayName = cleanDisplayName(displayName, user.username);
  if (avatar !== undefined) user.avatar = cleanAvatar(avatar);
  if (banner !== undefined) user.banner = cleanBanner(banner);
  if (bannerGradient !== undefined) user.bannerGradient = cleanBannerGradient(bannerGradient);
  if (email !== undefined) user.email = String(email || "").trim().slice(0, 120);
  persistUsers();
  return { user };
}

function recordConnection(userId, ip, event = "connect") {
  const user = findById(userId);
  if (!user) return;
  user.lastIp = String(ip || "");
  if (event === "login" || event === "register") user.lastLoginAt = Date.now();
  user.connLog = user.connLog || [];
  user.connLog.push({ at: Date.now(), ip: String(ip || ""), event });
  if (user.connLog.length > MAX_CONN_LOG) user.connLog = user.connLog.slice(-MAX_CONN_LOG);
  persistUsers();
}

// ---- 세션 토큰 ----
function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions[token] = { userId, createdAt: Date.now() };
  persistSessions();
  return token;
}

function getUserByToken(token) {
  const s = sessions[String(token || "")];
  if (!s) return null;
  return findById(s.userId);
}

function destroySession(token) {
  if (sessions[token]) {
    delete sessions[token];
    persistSessions();
  }
}

// ---- 관리자 기능 ----
function seedAdmin({ username, password, displayName }) {
  if (!password) return { skipped: "no-password" };
  // 이미 #0000(관리자)가 있으면 건너뛴다.
  if (findByCode("0000")) return { skipped: "exists" };
  const uname = normalizeUsername(username || "admin");
  if (findByUsername(uname)) {
    // 같은 아이디가 있으면 관리자/코드만 승격
    const existing = findByUsername(uname);
    existing.isAdmin = true;
    existing.code = "0000";
    persistUsers();
    return { user: existing, promoted: true };
  }
  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    username: uname,
    displayName: cleanDisplayName(displayName, uname),
    code: "0000",
    passwordHash: hashPassword(password),
    email: "",
    emailVerified: false,
    avatar: "",
    banner: "",
    bannerGradient: "",
    isAdmin: true,
    createdAt: Date.now(),
    lastLoginAt: 0,
    lastIp: "",
    connLog: [],
  };
  db.users.push(user);
  persistUsers();
  return { user, created: true };
}

function listUsers() {
  return db.users.map(sanitizeUserAdmin);
}

function setAdmin(userId, value) {
  const user = findById(userId);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  user.isAdmin = Boolean(value);
  persistUsers();
  return { user };
}

function setUserCode(userId, newCode) {
  const user = findById(userId);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  const code = String(newCode || "").replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(code)) return { error: "코드는 영문/숫자 4자여야 합니다." };
  const owner = findByCode(code);
  if (owner && owner.id !== userId) return { error: "이미 사용 중인 코드입니다." };
  user.code = code;
  persistUsers();
  return { user };
}

// ---- 직렬화(비밀번호 해시 제거) ----
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    code: user.code,
    email: user.email,
    emailVerified: user.emailVerified,
    avatar: user.avatar,
    banner: user.banner || "",
    bannerGradient: user.bannerGradient || "",
    isAdmin: Boolean(user.isAdmin),
    createdAt: user.createdAt,
  };
}

// 관리자용: 접속 IP/로그 포함(비밀번호 해시는 제외)
function sanitizeUserAdmin(user) {
  if (!user) return null;
  return {
    ...sanitizeUser(user),
    lastLoginAt: user.lastLoginAt || 0,
    lastIp: user.lastIp || "",
    connLog: user.connLog || [],
  };
}

// ===== 채널 · 방 =====
function persistChannels() {
  writeJsonAtomic(CHANNELS_FILE, channelsDb);
}

function cleanChannelName(value) {
  return String(value || "").trim().slice(0, 32) || "새 채널";
}

function cleanRoomTypeName(value, type) {
  const fallback = { voice: "통화방", chat: "채팅방", memo: "메모장", draw: "그림판", log: "전역 로그" }[type] || "새 방";
  return String(value || "").trim().slice(0, 32) || fallback;
}

function makeInviteCode() {
  for (let guard = 0; guard < 10000; guard++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
    if (!channelsDb.channels.some((c) => c.inviteCode === code)) return code;
  }
  return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function createChannel(ownerId, name) {
  if (!ownerId) return { error: "로그인이 필요합니다." };
  const channel = {
    id: newId(),
    name: cleanChannelName(name),
    ownerId,
    managers: [], // 추가 대표자(공동 관리자) 목록
    icon: "", // 채널 아이콘 이미지(data URL)
    inviteCode: makeInviteCode(),
    members: [ownerId],
    roles: [], // 권한 역할 목록 [{ id, name, color, memberIds:[], manageEmoji }]
    emojis: [], // 커스텀 이모지 [{ id, name, url, by, at }]
    fonts: [], // 업로드한 공유 글꼴 [{ id, name, url, by, at }]
    rooms: [
      { id: newId(), name: "일반", type: "voice", limit: DEFAULT_ROOM_LIMIT },
      { id: newId(), name: "공지", type: "chat" },
    ],
    createdAt: Date.now(),
  };
  channelsDb.channels.push(channel);
  persistChannels();
  return { channel };
}

function getChannel(channelId) {
  return channelsDb.channels.find((c) => c.id === channelId) || null;
}

function getChannelByInvite(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return channelsDb.channels.find((x) => x.inviteCode === c) || null;
}

// 대표자 권한(방 추가/삭제, 강퇴, 이름변경 등). 창설자 + 공동대표 + 관리자.
function isChannelOwner(channelId, userId, isAdmin = false) {
  if (isAdmin) return true;
  const channel = getChannel(channelId);
  if (!channel) return false;
  return channel.ownerId === userId || (channel.managers || []).includes(userId);
}

// 창설자 전용(채널 삭제, 공동대표 지정/해제). 창설자 + 관리자만.
function isChannelCreator(channelId, userId, isAdmin = false) {
  if (isAdmin) return true;
  const channel = getChannel(channelId);
  return Boolean(channel && channel.ownerId === userId);
}

function setManager(channelId, userId, value) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (channel.ownerId === userId) return { error: "창설자는 항상 대표자입니다." };
  if (!channel.members.includes(userId)) return { error: "채널 멤버만 대표자로 지정할 수 있습니다." };
  channel.managers = channel.managers || [];
  if (value) {
    if (!channel.managers.includes(userId)) channel.managers.push(userId);
  } else {
    channel.managers = channel.managers.filter((id) => id !== userId);
  }
  persistChannels();
  return { channel };
}

function setChannelIcon(channelId, icon) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  channel.icon = cleanAvatar(icon); // 아바타와 동일한 data URL 검증 재사용
  persistChannels();
  return { channel };
}

function isChannelMember(channelId, userId, isAdmin = false) {
  if (isAdmin) return true;
  const channel = getChannel(channelId);
  return Boolean(channel && channel.members.includes(userId));
}

function listChannelsForUser(userId, isAdmin = false) {
  const list = isAdmin
    ? channelsDb.channels
    : channelsDb.channels.filter((c) => c.members.includes(userId));
  return list.map(channelSummary);
}

function joinChannelByCode(userId, code) {
  const channel = getChannelByInvite(code);
  if (!channel) return { error: "코드에 해당하는 채널을 찾지 못했습니다." };
  if (!channel.members.includes(userId)) {
    channel.members.push(userId);
    persistChannels();
  }
  return { channel };
}

function addMember(channelId, userId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (!channel.members.includes(userId)) {
    channel.members.push(userId);
    persistChannels();
  }
  return { channel };
}

function removeMember(channelId, userId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (channel.ownerId === userId) return { error: "창설자는 내보낼 수 없습니다." };
  channel.members = channel.members.filter((id) => id !== userId);
  channel.managers = (channel.managers || []).filter((id) => id !== userId);
  persistChannels();
  return { channel };
}

function addRoom(channelId, name, type) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const roomType = ROOM_TYPES.includes(type) ? type : "voice";
  const room = { id: newId(), name: cleanRoomTypeName(name, roomType), type: roomType };
  if (roomType === "voice") room.limit = DEFAULT_ROOM_LIMIT;
  channel.rooms.push(room);
  persistChannels();
  return { channel, room };
}

function removeRoom(channelId, roomId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  channel.rooms = channel.rooms.filter((r) => r.id !== roomId);
  persistChannels();
  deleteRoomMessages(roomId); // 방 삭제 시 저장된 채팅도 정리
  deleteRoomMemo(roomId);
  deleteRoomDraw(roomId);
  return { channel };
}

function renameRoom(channelId, roomId, name) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "방을 찾을 수 없습니다." };
  room.name = cleanRoomTypeName(name, room.type);
  persistChannels();
  return { channel, room };
}

// 읽기 전용 토글(채팅/메모/그림만). 통화방은 P2P라 서버가 발언을 막을 수 없어 제외.
function setRoomReadOnly(channelId, roomId, value) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "방을 찾을 수 없습니다." };
  if (!["chat", "memo", "draw"].includes(room.type)) {
    return { error: "채팅·메모·그림 방만 읽기 전용으로 설정할 수 있습니다." };
  }
  if (value) room.readOnly = true;
  else delete room.readOnly;
  persistChannels();
  return { channel, room };
}

// ===== 권한 역할(Role) =====
const ROLE_COLORS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#9b59b6", "#1abc9c", "#e67e22"];
// 방별 권한: 접근 / 사용(채팅·그리기·메모편집) / 통화방 세부(마이크·스피커·소리공유·화면공유)
const ROOM_PERM_KEYS = ["access", "use", "voice", "sound", "screen"];

function cleanRoleName(value) {
  return String(value || "").trim().slice(0, 24) || "새 역할";
}

function cleanColor(value, fallback) {
  const v = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : (fallback || ROLE_COLORS[0]);
}

// 채널의 역할 배열을 항상 배열로 보장(레거시 채널 마이그레이션).
function rolesOf(channel) {
  if (!Array.isArray(channel.roles)) channel.roles = [];
  return channel.roles;
}

function createRole(channelId, name) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const roles = rolesOf(channel);
  if (roles.length >= 30) return { error: "역할은 최대 30개까지 만들 수 있습니다." };
  const role = { id: newId(), name: cleanRoleName(name), color: ROLE_COLORS[roles.length % ROLE_COLORS.length], memberIds: [] };
  roles.push(role);
  persistChannels();
  return { channel, role };
}

function updateRole(channelId, roleId, { name, color, manageEmoji, addEmoji, removeEmoji, useEmoji, attachFile, renameRoom, manageFont } = {}) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const role = rolesOf(channel).find((r) => r.id === roleId);
  if (!role) return { error: "역할을 찾을 수 없습니다." };
  if (name !== undefined) role.name = cleanRoleName(name);
  if (color !== undefined) role.color = cleanColor(color, role.color);
  if (manageEmoji !== undefined) role.manageEmoji = Boolean(manageEmoji);
  // 세분화된 이모지/첨부 권한. 하나라도 명시되면 레거시 manageEmoji는 정리한다.
  if (addEmoji !== undefined) role.addEmoji = Boolean(addEmoji);
  if (removeEmoji !== undefined) role.removeEmoji = Boolean(removeEmoji);
  if (useEmoji !== undefined) role.useEmoji = Boolean(useEmoji);
  if (attachFile !== undefined) role.attachFile = Boolean(attachFile);
  if (renameRoom !== undefined) role.renameRoom = Boolean(renameRoom);
  if (manageFont !== undefined) role.manageFont = Boolean(manageFont);
  if ((addEmoji !== undefined || removeEmoji !== undefined) && role.manageEmoji !== undefined) delete role.manageEmoji;
  persistChannels();
  return { channel, role };
}

// 채널 단위 사용 제한 플래그(대표자 전용): 커스텀 이모지 사용/파일 첨부를 역할 보유자로 제한할지.
function setChannelPerms(channelId, { emojiUseRestricted, attachRestricted } = {}) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (emojiUseRestricted !== undefined) channel.emojiUseRestricted = Boolean(emojiUseRestricted);
  if (attachRestricted !== undefined) channel.attachRestricted = Boolean(attachRestricted);
  persistChannels();
  return { channel };
}

function deleteRole(channelId, roleId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  channel.roles = rolesOf(channel).filter((r) => r.id !== roleId);
  // 각 방의 권한 오버라이드에서도 해당 역할을 제거한다.
  for (const room of channel.rooms) {
    if (room.perms && room.perms.roles) delete room.perms.roles[roleId];
  }
  persistChannels();
  return { channel };
}

// 역할에 유저를 추가/제거한다(채널 멤버만 가능).
function setRoleMember(channelId, roleId, userId, value) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const role = rolesOf(channel).find((r) => r.id === roleId);
  if (!role) return { error: "역할을 찾을 수 없습니다." };
  if (value && !channel.members.includes(userId)) return { error: "채널 멤버만 역할을 부여할 수 있습니다." };
  role.memberIds = Array.isArray(role.memberIds) ? role.memberIds : [];
  if (value) {
    if (!role.memberIds.includes(userId)) role.memberIds.push(userId);
  } else {
    role.memberIds = role.memberIds.filter((id) => id !== userId);
  }
  persistChannels();
  return { channel, role };
}

// 방별 권한 오버라이드를 설정한다. kind: "role" | "user", value: true(허용)/false(거부)/null(상속).
function setRoomPerm(channelId, roomId, kind, targetId, perm, value) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "방을 찾을 수 없습니다." };
  if (!ROOM_PERM_KEYS.includes(perm)) return { error: "알 수 없는 권한입니다." };
  const bucket = kind === "user" ? "users" : "roles";
  if (!room.perms) room.perms = {};
  if (!room.perms[bucket]) room.perms[bucket] = {};
  if (!room.perms[bucket][targetId]) room.perms[bucket][targetId] = {};
  const entry = room.perms[bucket][targetId];
  if (value === null || value === undefined) delete entry[perm];
  else entry[perm] = Boolean(value);
  if (Object.keys(entry).length === 0) delete room.perms[bucket][targetId];
  persistChannels();
  return { channel, room };
}

// 특정 역할/유저의 방 권한 오버라이드를 통째로 제거한다(권한 표에서 "삭제" 버튼).
function clearRoomPerm(channelId, roomId, kind, targetId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "방을 찾을 수 없습니다." };
  const bucket = kind === "user" ? "users" : "roles";
  if (room.perms && room.perms[bucket]) delete room.perms[bucket][targetId];
  persistChannels();
  return { channel, room };
}

// 방 타입별 권한 기본값. 로그방만 접근이 기본 비공개, 나머지는 모두 허용.
function defaultRoomPerm(roomType, perm) {
  if (perm === "access") return roomType !== "log";
  return true;
}

// 특정 유저의 방 권한을 해석한다. 반환: { access, use }.
// 우선순위: 관리자/대표 > 유저 오버라이드 > 역할 오버라이드(허용이 거부보다 우선) > 기본값.
function resolveRoomPerms(channel, room, userId, isAdmin = false) {
  if (isAdmin || channel.ownerId === userId || (channel.managers || []).includes(userId)) {
    return { access: true, use: true };
  }
  const roleIds = rolesOf(channel).filter((r) => (r.memberIds || []).includes(userId)).map((r) => r.id);
  return resolveWithRoles(room, roleIds, userId);
}

// 명시적 역할 집합/유저로 권한을 계산한다(미리보기·해석 공용).
function resolveWithRoles(room, roleIds, userId) {
  const perms = room.perms || {};
  const resolveOne = (perm) => {
    if (userId) {
      const uo = perms.users && perms.users[userId];
      if (uo && uo[perm] !== undefined) return Boolean(uo[perm]);
    }
    let allow = false, deny = false;
    for (const rid of roleIds) {
      const ro = perms.roles && perms.roles[rid];
      if (ro && ro[perm] !== undefined) { if (ro[perm]) allow = true; else deny = true; }
    }
    if (allow) return true;
    if (deny) return false;
    return defaultRoomPerm(room.type, perm);
  };
  return {
    access: resolveOne("access"),
    use: resolveOne("use"),
    voice: resolveOne("voice"),
    sound: resolveOne("sound"),
    screen: resolveOne("screen"),
  };
}

function canAccessRoom(channelId, roomId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  return resolveRoomPerms(channel, room, userId, isAdmin).access;
}

function canUseRoom(channelId, roomId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  const p = resolveRoomPerms(channel, room, userId, isAdmin);
  return p.access && p.use;
}

// ===== 커스텀 이모지 =====
const EMOJI_MAX_PER_CHANNEL = 100;

function emojisOf(channel) {
  if (!Array.isArray(channel.emojis)) channel.emojis = [];
  return channel.emojis;
}

// 역할별 능력 판정(레거시 manageEmoji=추가·삭제 겸용을 addEmoji/removeEmoji 미설정 시 폴백).
const roleCanAdd = (r) => Boolean(r.addEmoji ?? r.manageEmoji);
const roleCanRemove = (r) => Boolean(r.removeEmoji ?? r.manageEmoji);
const roleHasMember = (r, userId) => (r.memberIds || []).includes(userId);
// 유저별 개별 허용(역할과 별개). channel.userPerms[userId][cap] === true.
const userPermGranted = (channel, userId, cap) => Boolean(channel.userPerms && channel.userPerms[userId] && channel.userPerms[userId][cap]);

// 이모지 추가(업로드) 권한: 관리자·대표 또는 addEmoji 역할 보유자·개별허용 유저.
function canAddEmoji(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "addEmoji")) return true;
  return rolesOf(channel).some((r) => roleCanAdd(r) && roleHasMember(r, userId));
}
// 이모지 삭제 권한: 관리자·대표 또는 removeEmoji 역할 보유자·개별허용 유저.
function canRemoveEmoji(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "removeEmoji")) return true;
  return rolesOf(channel).some((r) => roleCanRemove(r) && roleHasMember(r, userId));
}
// 이모지 사용 권한: 제한 안 걸려있으면 전원 허용, 걸려있으면 대표·useEmoji 역할·개별허용 유저만.
function canUseEmoji(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (!channel.emojiUseRestricted) return true;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "useEmoji")) return true;
  return rolesOf(channel).some((r) => Boolean(r.useEmoji) && roleHasMember(r, userId));
}
// 파일(이미지 포함) 첨부 권한: 제한 안 걸려있으면 전원 허용, 걸려있으면 대표·attachFile 역할·개별허용 유저만.
function canAttach(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (!channel.attachRestricted) return true;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "attachFile")) return true;
  return rolesOf(channel).some((r) => Boolean(r.attachFile) && roleHasMember(r, userId));
}

const USER_PERM_CAPS = ["addEmoji", "removeEmoji", "useEmoji", "attachFile", "renameRoom", "manageFont"];

// 방 이름 변경 권한: 관리자·대표 또는 renameRoom 역할 보유자·개별허용 유저.
function canRenameRoom(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "renameRoom")) return true;
  return rolesOf(channel).some((r) => Boolean(r.renameRoom) && roleHasMember(r, userId));
}
// 공유 글꼴 업로드·삭제 권한: 관리자·대표 또는 manageFont 역할 보유자·개별허용 유저.
function canManageFont(channelId, userId, isAdmin = false) {
  const channel = getChannel(channelId);
  if (!channel) return false;
  if (isChannelOwner(channelId, userId, isAdmin)) return true;
  if (userPermGranted(channel, userId, "manageFont")) return true;
  return rolesOf(channel).some((r) => Boolean(r.manageFont) && roleHasMember(r, userId));
}
// 유저 개별 권한 오버라이드 설정(대표자 전용). value=true면 허용, false면 제거.
function setUserPerm(channelId, userId, cap, value) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (!USER_PERM_CAPS.includes(cap)) return { error: "알 수 없는 권한입니다." };
  if (!channel.members.includes(userId)) return { error: "채널 멤버만 설정할 수 있습니다." };
  if (!channel.userPerms) channel.userPerms = {};
  if (!channel.userPerms[userId]) channel.userPerms[userId] = {};
  if (value) channel.userPerms[userId][cap] = true;
  else delete channel.userPerms[userId][cap];
  if (Object.keys(channel.userPerms[userId]).length === 0) delete channel.userPerms[userId];
  persistChannels();
  return { channel };
}
// 하위호환: 이모지 추가/삭제 둘 중 하나라도 가능한지(구 호출부용).
function canManageEmoji(channelId, userId, isAdmin = false) {
  return canAddEmoji(channelId, userId, isAdmin) || canRemoveEmoji(channelId, userId, isAdmin);
}

// 이모지 이름 정리: 소문자 영문/숫자/밑줄 2~32자. 앞뒤 콜론은 제거.
function cleanEmojiName(value) {
  return String(value || "").trim().replace(/^:+|:+$/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
}

function addEmoji(channelId, name, url) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const list = emojisOf(channel);
  if (list.length >= EMOJI_MAX_PER_CHANNEL) return { error: `이모지는 최대 ${EMOJI_MAX_PER_CHANNEL}개까지 만들 수 있습니다.` };
  const clean = cleanEmojiName(name);
  if (clean.length < 2) return { error: "이모지 이름은 영문/숫자/밑줄 2자 이상이어야 합니다." };
  if (list.some((e) => e.name === clean)) return { error: "이미 같은 이름의 이모지가 있습니다." };
  const safeUrl = String(url || "");
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(safeUrl)) return { error: "이모지 이미지가 올바르지 않습니다." };
  const emoji = { id: newId(), name: clean, url: safeUrl, by: "", at: Date.now() };
  list.push(emoji);
  persistChannels();
  return { channel, emoji };
}

function removeEmoji(channelId, emojiId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const removed = emojisOf(channel).find((e) => e.id === emojiId);
  if (!removed) return { error: "이모지를 찾을 수 없습니다." };
  channel.emojis = emojisOf(channel).filter((e) => e.id !== emojiId);
  persistChannels();
  deleteUpload(removed.url); // 삭제한 이모지 이미지는 서버 저장소에서도 지운다(용량 확보)
  return { channel, emoji: removed };
}

// ===== 공유 글꼴(업로드) =====
const FONT_MAX_PER_CHANNEL = 30;
const FONT_URL_RE = /^\/uploads\/[a-f0-9]{24}_[A-Za-z0-9._-]+\.(ttf|otf|woff|woff2)$/i;

function fontsOf(channel) {
  if (!Array.isArray(channel.fonts)) channel.fonts = [];
  return channel.fonts;
}

function cleanFontName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function addFont(channelId, name, url) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const list = fontsOf(channel);
  if (list.length >= FONT_MAX_PER_CHANNEL) return { error: `글꼴은 최대 ${FONT_MAX_PER_CHANNEL}개까지 올릴 수 있습니다.` };
  const clean = cleanFontName(name) || "글꼴";
  const safeUrl = String(url || "");
  if (!FONT_URL_RE.test(safeUrl)) return { error: "글꼴 파일 형식이 올바르지 않습니다(ttf·otf·woff·woff2)." };
  const font = { id: newId(), name: clean, url: safeUrl, by: "", at: Date.now() };
  list.push(font);
  persistChannels();
  return { channel, font };
}

function removeFont(channelId, fontId) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const removed = fontsOf(channel).find((f) => f.id === fontId);
  if (!removed) return { error: "글꼴을 찾을 수 없습니다." };
  channel.fonts = fontsOf(channel).filter((f) => f.id !== fontId);
  persistChannels();
  deleteUpload(removed.url); // 삭제한 글꼴 파일도 서버 저장소에서 제거
  return { channel, font: removed };
}

function setRoomLimit(channelId, roomId, limit) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  const room = channel.rooms.find((r) => r.id === roomId);
  if (!room) return { error: "방을 찾을 수 없습니다." };
  if (room.type !== "voice") return { error: "통화방만 인원을 설정할 수 있습니다." };
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1 || n > ROOM_LIMIT_MAX) {
    return { error: `인원은 1~${ROOM_LIMIT_MAX}명이어야 합니다.` };
  }
  room.limit = n;
  persistChannels();
  return { channel, room };
}

function renameChannel(channelId, name) {
  const channel = getChannel(channelId);
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  channel.name = cleanChannelName(name);
  persistChannels();
  return { channel };
}

function deleteChannel(channelId) {
  const channel = getChannel(channelId);
  if (channel) {
    for (const room of channel.rooms) { deleteRoomMessages(room.id); deleteRoomMemo(room.id); deleteRoomDraw(room.id); }
    // 채널의 커스텀 이모지·공유 글꼴 파일도 서버 저장소에서 정리한다.
    for (const e of emojisOf(channel)) deleteUpload(e.url);
    for (const f of fontsOf(channel)) deleteUpload(f.url);
  }
  deleteChannelLog(channelId);
  const before = channelsDb.channels.length;
  channelsDb.channels = channelsDb.channels.filter((c) => c.id !== channelId);
  if (channelsDb.channels.length !== before) persistChannels();
  return { ok: true };
}

// roomId 로 소속 채널과 방을 찾는다(시그널링 권한 확인용).
function findRoom(roomId) {
  for (const channel of channelsDb.channels) {
    const room = channel.rooms.find((r) => r.id === roomId);
    if (room) return { channel, room };
  }
  return null;
}

function channelSummary(channel) {
  return {
    id: channel.id,
    name: channel.name,
    ownerId: channel.ownerId,
    managerIds: (channel.managers || []).slice(),
    icon: channel.icon || "",
    inviteCode: channel.inviteCode,
    memberIds: channel.members.slice(),
    roles: rolesOf(channel).map((r) => ({
      id: r.id, name: r.name, color: r.color, memberIds: (r.memberIds || []).slice(),
      manageEmoji: Boolean(r.manageEmoji),
      addEmoji: roleCanAdd(r), removeEmoji: roleCanRemove(r),
      useEmoji: Boolean(r.useEmoji), attachFile: Boolean(r.attachFile),
      renameRoom: Boolean(r.renameRoom), manageFont: Boolean(r.manageFont),
    })),
    emojiUseRestricted: Boolean(channel.emojiUseRestricted),
    attachRestricted: Boolean(channel.attachRestricted),
    userPerms: Object.fromEntries(Object.entries(channel.userPerms || {}).map(([k, v]) => [k, { ...v }])),
    emojis: emojisOf(channel).map((e) => ({ id: e.id, name: e.name, url: e.url })),
    fonts: fontsOf(channel).map((f) => ({ id: f.id, name: f.name, url: f.url })),
    rooms: channel.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      ...(r.type === "voice" ? { limit: r.limit || DEFAULT_ROOM_LIMIT } : {}),
      ...(r.readOnly ? { readOnly: true } : {}),
      ...(r.perms ? { perms: r.perms } : {}),
    })),
    createdAt: channel.createdAt,
  };
}

// ===== 채팅 메시지 =====
// 방 단위로 server-data/messages/<roomId>.json 에 저장한다(방마다 파일 1개).
function isSafeRoomId(roomId) {
  return /^[a-f0-9]{4,64}$/.test(String(roomId || ""));
}

function messagesFile(roomId) {
  return path.join(MESSAGES_DIR, `${roomId}.json`);
}

function getMessages(roomId, limit = MAX_MESSAGES_PER_ROOM) {
  if (!isSafeRoomId(roomId)) return [];
  const list = readJson(messagesFile(roomId), []);
  if (!Array.isArray(list)) return [];
  return limit && list.length > limit ? list.slice(-limit) : list;
}

function addMessage(roomId, message) {
  if (!isSafeRoomId(roomId)) return { error: "잘못된 방입니다." };
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  const list = readJson(messagesFile(roomId), []);
  const messages = Array.isArray(list) ? list : [];
  messages.push(message);
  if (messages.length > MAX_MESSAGES_PER_ROOM) {
    messages.splice(0, messages.length - MAX_MESSAGES_PER_ROOM);
  }
  writeJsonAtomic(messagesFile(roomId), messages);
  return { message };
}

function deleteRoomMessages(roomId) {
  if (!isSafeRoomId(roomId)) return;
  // 방 삭제 시 이 방 메시지들이 참조하던 첨부 파일도 저장소에서 정리한다.
  const list = readJson(messagesFile(roomId), []);
  if (Array.isArray(list)) for (const m of list) deleteUploadsFromFiles(m && m.files);
  try {
    fs.unlinkSync(messagesFile(roomId));
  } catch {
    /* 파일 없으면 무시 */
  }
}

// 본인 메시지의 텍스트를 수정한다. { message } 또는 { error }.
function editMessage(roomId, msgId, userId, text) {
  if (!isSafeRoomId(roomId)) return { error: "잘못된 방입니다." };
  const list = readJson(messagesFile(roomId), []);
  if (!Array.isArray(list)) return { error: "메시지를 찾을 수 없습니다." };
  const msg = list.find((m) => m.id === msgId);
  if (!msg) return { error: "메시지를 찾을 수 없습니다." };
  if (msg.userId !== userId) return { error: "본인 메시지만 수정할 수 있습니다." };
  msg.text = text;
  msg.editedAt = Date.now();
  writeJsonAtomic(messagesFile(roomId), list);
  return { message: msg };
}

// 메시지 하나를 삭제한다. 삭제된 메시지를 돌려주고, 없으면 null.
function deleteMessage(roomId, msgId) {
  if (!isSafeRoomId(roomId)) return null;
  const list = readJson(messagesFile(roomId), []);
  if (!Array.isArray(list)) return null;
  const idx = list.findIndex((m) => m.id === msgId);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  writeJsonAtomic(messagesFile(roomId), list);
  deleteUploadsFromFiles(removed.files); // 첨부 파일도 서버 저장소에서 정리
  return removed;
}

// ===== 파일 업로드 =====
function sanitizeUploadName(name) {
  let base = String(name || "file").split(/[/\\]/).pop() || "file";
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+/, "");
  if (base.length > 60) {
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot) : "";
    base = base.slice(0, Math.max(1, 60 - ext.length)) + ext;
  }
  return base || "file";
}

function saveUpload({ buffer, name, mime }) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString("hex"); // 24 hex chars
  const safe = sanitizeUploadName(name);
  const fileName = `${id}_${safe}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  return {
    id,
    fileName,
    name: String(name || safe).slice(0, 200),
    size: buffer.length,
    mime: String(mime || "application/octet-stream").slice(0, 100),
  };
}

// 업로드 파일명을 검증해 안전한 절대경로를 돌려준다(경로 탈출 차단).
function getUploadPath(fileName) {
  const name = String(fileName || "");
  if (!/^[a-f0-9]{24}_[A-Za-z0-9._-]+$/.test(name)) return null;
  const filePath = path.normalize(path.join(UPLOADS_DIR, name));
  const rel = path.relative(UPLOADS_DIR, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return filePath;
}

// 업로드 파일 삭제(용량 확보). /uploads/<파일명> URL 을 받아 실제 파일을 지운다.
// 우리 업로드 엔드포인트가 발급한 경로만 지우고, 없는 파일은 조용히 무시한다.
function deleteUpload(url) {
  const raw = String(url || "");
  if (!raw.startsWith("/uploads/")) return false;
  const filePath = getUploadPath(raw.slice("/uploads/".length));
  if (!filePath) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false; // 이미 없으면 무시
  }
}

// 여러 첨부를 한 번에 정리(메시지/방 삭제 시). files: [{ url }] 배열.
function deleteUploadsFromFiles(files) {
  if (!Array.isArray(files)) return;
  for (const f of files) if (f && f.url) deleteUpload(f.url);
}

// ===== 공동 메모장 =====
// 방 단위 공유 마크다운 텍스트. server-data/memo/<roomId>.json 에 저장.
function memoFile(roomId) {
  return path.join(MEMO_DIR, `${roomId}.json`);
}

function getMemo(roomId) {
  if (!isSafeRoomId(roomId)) return { text: "", font: "", rev: 0, updatedBy: "", updatedAt: 0 };
  const memo = readJson(memoFile(roomId), null);
  if (!memo || typeof memo !== "object") return { text: "", font: "", rev: 0, updatedBy: "", updatedAt: 0 };
  return {
    text: String(memo.text || ""),
    font: String(memo.font || ""),
    rev: Number(memo.rev) || 0,
    updatedBy: String(memo.updatedBy || ""),
    updatedAt: Number(memo.updatedAt) || 0,
  };
}

// font 를 넘기지 않으면(undefined) 기존 값 유지 — 텍스트만 저장하는 호출과 글꼴 저장을 겸한다.
function saveMemo(roomId, text, userId, font) {
  if (!isSafeRoomId(roomId)) return { error: "잘못된 방입니다." };
  fs.mkdirSync(MEMO_DIR, { recursive: true });
  const current = getMemo(roomId);
  const memo = {
    text: String(text || "").slice(0, MEMO_MAX_LEN),
    font: font !== undefined ? String(font || "").slice(0, 32) : current.font,
    rev: current.rev + 1,
    updatedBy: String(userId || ""),
    updatedAt: Date.now(),
  };
  writeJsonAtomic(memoFile(roomId), memo);
  return { memo };
}

function deleteRoomMemo(roomId) {
  if (!isSafeRoomId(roomId)) return;
  try {
    fs.unlinkSync(memoFile(roomId));
  } catch {
    /* 파일 없으면 무시 */
  }
}

// ===== 공동 그림판 =====
// 방 단위 공유 캔버스. server-data/draw/<roomId>.json 에 레이어별 stroke를 저장.
function drawFile(roomId) {
  return path.join(DRAW_DIR, `${roomId}.json`);
}

function clampSize(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(DRAW_MIN_SIZE, Math.min(DRAW_MAX_SIZE, n));
}

function defaultDrawDoc() {
  return {
    width: 900,
    height: 600,
    layers: [{ id: "L1", name: "레이어 1", visible: true, locked: false, strokes: [] }],
    seq: 1,
  };
}

// 저장/로딩 시 문서 형태를 검증·정규화한다(레거시/손상 파일 방어).
function normalizeDrawDoc(raw) {
  if (!raw || typeof raw !== "object") return defaultDrawDoc();
  const doc = defaultDrawDoc();
  doc.width = clampSize(raw.width, 900);
  doc.height = clampSize(raw.height, 600);
  doc.seq = Number(raw.seq) || 1;
  if (Array.isArray(raw.layers) && raw.layers.length) {
    doc.layers = raw.layers.slice(0, 20).map((layer, i) => ({
      id: String(layer && layer.id ? layer.id : `L${i + 1}`).slice(0, 32),
      name: String(layer && layer.name ? layer.name : `레이어 ${i + 1}`).slice(0, 40),
      visible: layer && layer.visible === false ? false : true,
      locked: layer && layer.locked === true ? true : false,
      strokes: Array.isArray(layer && layer.strokes) ? layer.strokes : [],
    }));
  }
  return doc;
}

function getDraw(roomId) {
  if (!isSafeRoomId(roomId)) return defaultDrawDoc();
  const raw = readJson(drawFile(roomId), null);
  if (!raw) return defaultDrawDoc();
  return normalizeDrawDoc(raw);
}

// 반환: { ok } 또는 { error }. 용량 초과 시 저장하지 않는다(호출측이 롤백 판단).
function saveDraw(roomId, doc) {
  if (!isSafeRoomId(roomId)) return { error: "잘못된 방입니다." };
  const normalized = normalizeDrawDoc(doc);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > DRAW_MAX_BYTES) {
    return { error: "그림 용량이 너무 큽니다." };
  }
  fs.mkdirSync(DRAW_DIR, { recursive: true });
  writeJsonAtomic(drawFile(roomId), normalized);
  return { ok: true };
}

function deleteRoomDraw(roomId) {
  if (!isSafeRoomId(roomId)) return;
  try {
    fs.unlinkSync(drawFile(roomId));
  } catch {
    /* 파일 없으면 무시 */
  }
}

// ===== 전역 로그 =====
// 채널 단위 이벤트 타임라인. 방이 아니라 채널에 종속되므로(로그방 여러 개여도 같은 피드),
// server-data/log/<channelId>.json 에 저장한다. isSafeRoomId 는 id 형식 검사라 채널에도 재사용.
function logFile(channelId) {
  return path.join(LOG_DIR, `${channelId}.json`);
}

function getChannelLog(channelId, limit = MAX_LOG_PER_CHANNEL) {
  if (!isSafeRoomId(channelId)) return [];
  const list = readJson(logFile(channelId), []);
  if (!Array.isArray(list)) return [];
  return limit && list.length > limit ? list.slice(-limit) : list;
}

function appendChannelLog(channelId, entry) {
  if (!isSafeRoomId(channelId)) return { error: "잘못된 채널입니다." };
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const list = readJson(logFile(channelId), []);
  const logs = Array.isArray(list) ? list : [];
  logs.push(entry);
  if (logs.length > MAX_LOG_PER_CHANNEL) {
    logs.splice(0, logs.length - MAX_LOG_PER_CHANNEL);
  }
  writeJsonAtomic(logFile(channelId), logs);
  return { entry };
}

function deleteChannelLog(channelId) {
  if (!isSafeRoomId(channelId)) return;
  try {
    fs.unlinkSync(logFile(channelId));
  } catch {
    /* 파일 없으면 무시 */
  }
}

// ===== 다이렉트 메시지(1:1 DM) =====
// 대화 id 는 두 userId 를 정렬해 결합한다(항상 동일). 메시지는 대화별 파일에, 스레드 목록은 인덱스에.
function dmConvId(a, b) {
  const x = String(a || ""), y = String(b || "");
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

function isSafeConvId(id) {
  return /^[a-f0-9]{16}_[a-f0-9]{16}$/.test(String(id || ""));
}

function dmFile(convId) {
  return path.join(DM_DIR, `${convId}.json`);
}

function persistDmThreads() {
  writeJsonAtomic(DM_INDEX_FILE, dmThreads);
}

function getDmMessages(userA, userB, limit = 300) {
  const convId = dmConvId(userA, userB);
  if (!isSafeConvId(convId)) return [];
  const list = readJson(dmFile(convId), []);
  if (!Array.isArray(list)) return [];
  return limit && list.length > limit ? list.slice(-limit) : list;
}

function addDmMessage(userA, userB, message) {
  const convId = dmConvId(userA, userB);
  if (!isSafeConvId(convId)) return { error: "잘못된 대화입니다." };
  fs.mkdirSync(DM_DIR, { recursive: true });
  const list = readJson(dmFile(convId), []);
  const msgs = Array.isArray(list) ? list : [];
  msgs.push(message);
  if (msgs.length > MAX_DM_PER_THREAD) msgs.splice(0, msgs.length - MAX_DM_PER_THREAD);
  writeJsonAtomic(dmFile(convId), msgs);
  // 스레드 인덱스 upsert(최근 메시지 미리보기 저장)
  let thread = dmThreads.find((t) => t.id === convId);
  if (!thread) {
    thread = { id: convId, users: [String(userA), String(userB)] };
    dmThreads.push(thread);
  }
  thread.lastAt = message.at;
  thread.lastText = message.text ? String(message.text).slice(0, 120) : (message.files && message.files.length ? "[파일]" : "");
  thread.lastFrom = message.userId;
  persistDmThreads();
  return { message, convId };
}

// userId 가 참여한 대화 목록(최근 순).
function listDmThreads(userId) {
  return dmThreads
    .filter((t) => Array.isArray(t.users) && t.users.includes(String(userId)))
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

// 본인 메시지 하나 삭제. 삭제된 메시지 반환, 없으면 null.
function deleteDmMessage(userA, userB, msgId) {
  const convId = dmConvId(userA, userB);
  if (!isSafeConvId(convId)) return null;
  const list = readJson(dmFile(convId), []);
  if (!Array.isArray(list)) return null;
  const idx = list.findIndex((m) => m.id === msgId);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  writeJsonAtomic(dmFile(convId), list);
  return removed;
}

module.exports = {
  init,
  createUser,
  authenticate,
  changePassword,
  updateProfile,
  recordConnection,
  createSession,
  getUserByToken,
  destroySession,
  findByUsername,
  findByCode,
  findById,
  seedAdmin,
  listUsers,
  setAdmin,
  setUserCode,
  sanitizeUser,
  sanitizeUserAdmin,
  // 채널 · 방
  createChannel,
  getChannel,
  getChannelByInvite,
  isChannelOwner,
  isChannelCreator,
  setManager,
  setChannelIcon,
  isChannelMember,
  listChannelsForUser,
  joinChannelByCode,
  addMember,
  removeMember,
  addRoom,
  removeRoom,
  renameRoom,
  setRoomLimit,
  setRoomReadOnly,
  // 권한 역할
  createRole,
  updateRole,
  deleteRole,
  setRoleMember,
  setRoomPerm,
  clearRoomPerm,
  setChannelPerms,
  setUserPerm,
  resolveRoomPerms,
  canAccessRoom,
  canUseRoom,
  // 커스텀 이모지
  canManageEmoji,
  canAddEmoji,
  canRemoveEmoji,
  canUseEmoji,
  canAttach,
  addEmoji,
  removeEmoji,
  // 공유 글꼴 · 추가 권한
  addFont,
  removeFont,
  canRenameRoom,
  canManageFont,
  renameChannel,
  deleteChannel,
  findRoom,
  channelSummary,
  // 채팅 · 업로드
  getMessages,
  addMessage,
  editMessage,
  deleteMessage,
  deleteRoomMessages,
  saveUpload,
  getUploadPath,
  deleteUpload,
  UPLOAD_MAX_BYTES,
  // 메모장
  getMemo,
  saveMemo,
  deleteRoomMemo,
  // 그림판
  getDraw,
  saveDraw,
  deleteRoomDraw,
  DRAW_MAX_BYTES,
  // 전역 로그
  getChannelLog,
  appendChannelLog,
  deleteChannelLog,
  // 다이렉트 메시지
  dmConvId,
  getDmMessages,
  addDmMessage,
  listDmThreads,
  deleteDmMessage,
};
