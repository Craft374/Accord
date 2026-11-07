// 서버 앱 화면. 모든 작업은 비동기(window.host → main 의 ipcMain.handle)라 기다리는 동안에도 화면이 멈추지 않는다.
const $ = (id) => document.getElementById(id);
const PANES = ["server", "users", "settings", "logs"];
const LOG_LIMIT = 500;

document.documentElement.dataset.platform = new URLSearchParams(location.search).get("platform") || "";

let snap = { state: "stopped", info: null, error: "" };
let config = {};
let users = [];
let settingsDirty = false;
let lastUrl = "";

const h = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
};

// ===== 토스트 =====
let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// ===== 탭 =====
let currentPane = "server";
function showPane(name) {
  if (name === currentPane) return;
  const to = PANES.indexOf(name);
  currentPane = name;
  document.querySelector(".segmented").style.setProperty("--tab", to);
  for (const btn of document.querySelectorAll(".segmented button")) btn.setAttribute("aria-selected", String(btn.dataset.pane === name));
  for (const [i, pane] of PANES.entries()) {
    const el = $(`pane-${pane}`);
    // 오른쪽 탭으로 가면 새 패널은 오른쪽에서, 나가는 패널은 왼쪽으로(들어온 길로 돌아간다)
    el.style.setProperty("--from", `${i < to ? -12 : 12}px`);
    el.classList.toggle("active", i === to);
  }
  if (name === "users") loadUsers();
  if (name === "logs") requestAnimationFrame(() => { $("pane-logs").scrollTop = $("pane-logs").scrollHeight; });
}
// 누르는 순간 바뀐다(pointerdown). click 은 키보드(Enter/Space)용.
for (const btn of document.querySelectorAll(".segmented button")) {
  btn.addEventListener("pointerdown", () => showPane(btn.dataset.pane));
  btn.addEventListener("click", () => showPane(btn.dataset.pane));
}
document.querySelector(".segmented").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const next = PANES[(PANES.indexOf(currentPane) + (e.key === "ArrowRight" ? 1 : PANES.length - 1)) % PANES.length];
  showPane(next);
  document.querySelector(`.segmented [data-pane="${next}"]`).focus();
});

// ===== 서버 상태 =====
const STATUS = {
  stopped: ["서버가 꺼져 있습니다", "버튼 하나로 나만의 Accord 서버를 켤 수 있습니다.", "서버 켜기"],
  starting: ["서버를 켜는 중입니다", "잠시만 기다려 주세요.", "켜는 중"],
  running: ["서버가 켜져 있습니다", "", "서버 끄기"],
  stopping: ["서버를 끄는 중입니다", "작업 중인 내용을 저장하고 있습니다.", "끄는 중"],
};

function render(next) {
  const wasRunning = snap.state === "running";
  snap = next;
  const [title, sub, label] = STATUS[snap.state];
  const busy = snap.state === "starting" || snap.state === "stopping";
  $("orb").dataset.state = snap.state;
  $("statusTitle").textContent = title;
  if (snap.state !== "running") $("statusSub").textContent = sub;
  $("powerLabel").textContent = label;
  $("power").classList.toggle("busy", busy);
  $("power").classList.toggle("danger", snap.state === "running");
  $("power").disabled = busy;
  $("error").hidden = !snap.error;
  $("error").textContent = snap.error;
  $("addUser").disabled = snap.state !== "running";

  const urls = snap.info?.urls || [];
  $("addresses").hidden = !urls.length;
  $("urlList").replaceChildren(...urls.map(({ label, url }) => {
    const copy = h("button", { className: "tinted small", textContent: "복사" });
    copy.addEventListener("click", () => { window.host.copy(url); toast("주소를 복사했습니다."); });
    return h("div", { className: "row" }, h("span", { className: "row-text" }, h("span", { className: "row-sub", textContent: label }), h("span", { className: "value", textContent: url })), copy);
  }));
  lastUrl = urls.find((u) => u.label === "같은 네트워크")?.url || "";

  if (snap.state === "stopped") settingsDirty = false; // 다시 켜면 새 설정으로 뜬다
  if (snap.state === "running") {
    if (!wasRunning) {
      pollStatus();
      if (currentPane === "users") loadUsers();
    }
  }
  $("restartBanner").hidden = !(settingsDirty && snap.state === "running");
  if (currentPane === "users") renderUsers();
}

$("power").addEventListener("click", () => {
  if (snap.state === "running") window.host.stop();
  else if (snap.state === "stopped") window.host.start();
});

// 접속 인원은 창이 보일 때만 몇 초마다 물어본다.
let pollTimer = 0;
async function pollStatus() {
  clearTimeout(pollTimer);
  if (snap.state !== "running") return;
  if (!document.hidden) {
    try {
      const { online } = await window.host.request("host:status");
      if (snap.state === "running") $("statusSub").textContent = online ? `지금 ${online}명이 접속해 있습니다.` : "아직 접속한 사람이 없습니다.";
    } catch {}
  }
  pollTimer = setTimeout(pollStatus, 4000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollStatus(); });

// ===== 계정 =====
async function loadUsers() {
  if (snap.state !== "running") return renderUsers();
  try {
    users = (await window.host.request("host:list-users")).users;
  } catch (error) {
    toast(error.message);
  }
  renderUsers();
}

function renderUsers(highlightId) {
  const list = $("userList");
  if (snap.state !== "running") {
    list.replaceChildren(h("div", { className: "empty", textContent: "서버를 켜면 계정을 만들고 관리할 수 있습니다." }));
    return;
  }
  if (!users.length) {
    list.replaceChildren(h("div", { className: "empty", textContent: "아직 만든 계정이 없습니다.\n친구에게 줄 계정을 미리 만들어 두세요." }));
    list.firstChild.style.whiteSpace = "pre-line";
    return;
  }
  list.replaceChildren(...users.map((u) => {
    const pw = h("button", { className: "tinted small", textContent: "비밀번호" });
    pw.addEventListener("click", () => openSheet("password", u));
    const del = h("button", { className: "tinted small destructive", textContent: "삭제" });
    let armed = 0;
    del.addEventListener("click", async () => {
      // 한 번 더 눌러야 지운다(되돌릴 수 없으니까). 3초 지나면 원래대로.
      if (!armed) {
        del.classList.add("confirm");
        del.textContent = "정말 삭제";
        armed = setTimeout(() => { armed = 0; del.classList.remove("confirm"); del.textContent = "삭제"; }, 3000);
        return;
      }
      clearTimeout(armed);
      del.disabled = true;
      try {
        users = (await window.host.request("host:delete-user", { userId: u.id })).users;
        toast(`${u.username} 계정을 지웠습니다.`);
      } catch (error) {
        toast(error.message);
      }
      renderUsers();
    });
    return h("div", { className: `row has-avatar${u.id === highlightId ? " enter" : ""}` },
      h("span", { className: "avatar", textContent: (u.displayName || u.username).slice(0, 1).toUpperCase() }),
      h("span", { className: "row-text" },
        h("span", { className: "row-title", textContent: u.displayName }),
        h("span", { className: "row-sub", textContent: `${u.username} · #${u.code}` })),
      h("span", { className: "row-actions" }, pw, del));
  }));
}

// ===== 시트(계정 추가 / 비밀번호 바꾸기) =====
let sheetMode = "create";
let sheetUser = null;
function openSheet(mode, user = null) {
  sheetMode = mode;
  sheetUser = user;
  const create = mode === "create";
  $("sheetTitle").textContent = create ? "계정 추가" : `${user.username} 비밀번호 바꾸기`;
  $("sheetSubmit").textContent = create ? "만들기" : "바꾸기";
  $("usernameField").hidden = !create;
  $("nameField").hidden = !create;
  $("fUsername").value = "";
  $("fName").value = "";
  $("fPassword").value = makePassword();
  $("sheetError").hidden = true;
  $("sheetSubmit").disabled = false;
  const scrim = $("sheet");
  scrim.hidden = false;
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    (create ? $("fUsername") : $("fPassword")).focus();
  });
}
function closeSheet() {
  $("sheet").classList.remove("open");
  $("sheet").hidden = true;
}
$("addUser").addEventListener("click", () => openSheet("create"));
$("sheetCancel").addEventListener("click", closeSheet);
$("sheet").addEventListener("pointerdown", (e) => { if (e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
$("genPassword").addEventListener("click", () => { $("fPassword").value = makePassword(); });

// 헷갈리는 글자(0/O, 1/l/I)는 뺀다 — 친구에게 불러 주기 쉽게.
function makePassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

$("sheetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("fUsername").value.trim();
  const password = $("fPassword").value;
  $("sheetSubmit").disabled = true;
  try {
    if (sheetMode === "create") {
      const before = new Set(users.map((u) => u.id));
      users = (await window.host.request("host:create-user", { username, password, displayName: $("fName").value.trim() })).users;
      renderUsers(users.find((u) => !before.has(u.id))?.id);
      await window.host.copy(`${lastUrl ? `Accord 서버: ${lastUrl}\n` : ""}아이디: ${username.toLowerCase()}\n비밀번호: ${password}`);
      toast("계정을 만들고 접속 정보를 복사했습니다.");
    } else {
      await window.host.request("host:set-password", { userId: sheetUser.id, password });
      await window.host.copy(password);
      toast("비밀번호를 바꾸고 복사했습니다.");
    }
    closeSheet();
  } catch (error) {
    $("sheetError").textContent = error.message;
    $("sheetError").hidden = false;
    $("sheetSubmit").disabled = false;
  }
});

// ===== 설정 =====
async function saveSetting(patch, needsRestart) {
  $("settingsError").hidden = true;
  try {
    config = await window.host.setConfig(patch);
    if (needsRestart && snap.state !== "stopped") settingsDirty = true;
    $("restartBanner").hidden = !(settingsDirty && snap.state === "running");
  } catch (error) {
    $("settingsError").textContent = error.message;
    $("settingsError").hidden = false;
  }
  fillSettings();
}
function fillSettings() {
  $("port").value = config.port;
  $("allowSignup").checked = config.allowSignup;
  $("openAtLogin").checked = config.openAtLogin;
}
$("port").addEventListener("change", () => saveSetting({ port: Number($("port").value) }, true));
$("port").addEventListener("keydown", (e) => { if (e.key === "Enter") $("port").blur(); });
$("allowSignup").addEventListener("change", () => saveSetting({ allowSignup: $("allowSignup").checked }, true));
$("openAtLogin").addEventListener("change", () => saveSetting({ openAtLogin: $("openAtLogin").checked }, false));
$("restart").addEventListener("click", () => window.host.restart());
$("openData").addEventListener("click", () => window.host.openDataDir());

// ===== 기록 — 줄은 모아 두었다가 한 프레임에 한 번만 붙인다 =====
let queued = [];
function appendLog(line) {
  queued.push(line);
  // 창이 숨어 있으면 rAF 가 안 돌아 쌓이기만 하니, 어차피 보여 줄 만큼만 남긴다.
  if (queued.length > LOG_LIMIT) queued.splice(0, queued.length - LOG_LIMIT);
  if (queued.length === 1) requestAnimationFrame(flushLogs);
}
function flushLogs() {
  const box = $("logs");
  const pane = $("pane-logs");
  const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  box.append(...queued.map((line) => `${line}\n`));
  queued = [];
  while (box.childNodes.length > LOG_LIMIT) box.firstChild.remove();
  if (atBottom) pane.scrollTop = pane.scrollHeight;
}

// ===== 시작 =====
window.host.onState(render);
window.host.onLog(appendLog);
window.host.init().then((data) => {
  config = data.config;
  fillSettings();
  for (const line of data.logs) appendLog(line);
  render(data);
});
