// Accord 영속 데이터 스토어 (계정/세션).
// - 순수 node:crypto + JSON 파일. 외부 의존성 없음.
// - server-data/ 폴더에 저장되며 .gitignore 로 커밋 금지(비밀번호 해시 포함).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = path.join(__dirname, "server-data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // base36
const MAX_CONN_LOG = 40; // 유저별 접속 로그 보관 개수
const AVATAR_MAX_LEN = 400000; // 프로필 이미지 data URL 최대 길이(약 300KB)

let db = { users: [], codeCounter: 0 };
let sessions = {}; // token -> { userId, createdAt }

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = readJson(USERS_FILE, { users: [], codeCounter: 0 });
  if (!Array.isArray(db.users)) db.users = [];
  if (!Number.isFinite(db.codeCounter)) db.codeCounter = 0;
  sessions = readJson(SESSIONS_FILE, {});
  if (!sessions || typeof sessions !== "object") sessions = {};
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

function createUser({ username, password, displayName, email }) {
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
    avatar: "",
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

function updateProfile(userId, { displayName, avatar, email } = {}) {
  const user = findById(userId);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  if (displayName !== undefined) user.displayName = cleanDisplayName(displayName, user.username);
  if (avatar !== undefined) user.avatar = cleanAvatar(avatar);
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
};
