const form = document.querySelector("#serverForm");
const input = document.querySelector("#serverInput");
const message = document.querySelector("#message");
const clientVersionEl = document.querySelector("#launcherClientVersion");
const serverVersionEl = document.querySelector("#launcherServerVersion");
const savedList = document.querySelector("#savedServers");
const SAVED_SERVERS_KEY = "accordSavedServers";

input.value = localStorage.getItem("voiceChatServerUrl") || "https://localhost:25565";

showVersions();
renderSavedServers();

// 저장된 서버 목록: 들어가기를 누른 주소가 맨 앞에 쌓인다. 누르면 바로 접속, ✕ 로 삭제.
function loadSavedServers() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_SERVERS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((url) => typeof url === "string") : [];
  } catch {
    return [];
  }
}

function saveSavedServers(list) {
  localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(list));
  renderSavedServers();
}

function renderSavedServers() {
  savedList.replaceChildren(
    ...loadSavedServers().map((url) => {
      const item = document.createElement("li");
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "saved-server-pick";
      pick.textContent = url.replace(/^https?:\/\//i, "");
      pick.title = url;
      pick.addEventListener("click", () => {
        input.value = url;
        form.requestSubmit();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "saved-server-remove";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", `${url} 삭제`);
      remove.addEventListener("click", () => saveSavedServers(loadSavedServers().filter((saved) => saved !== url)));
      item.append(pick, remove);
      return item;
    })
  );
}

// 좌하단 버전 표시: 클라이언트 버전은 앱에서, 서버 버전은 저장된 주소에 물어본다(실패하면 생략).
function showVersions() {
  // package.json 은 semver("N.0.0")지만, 표시는 서버 버전과 헷갈리지 않게 major 정수만 쓴다.
  const raw = window.voiceDesktop?.appVersion || "";
  const clientVersion = raw ? String(parseInt(raw, 10) || raw) : "";
  if (clientVersionEl) clientVersionEl.textContent = `클라이언트 v${clientVersion || "?"}`;
  const saved = normalizeServerUrl(input.value);
  if (!saved || !serverVersionEl) return;
  fetch(`${saved}/version`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.version) serverVersionEl.textContent = `서버 v${data.version}`;
    })
    .catch(() => {});
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeServerUrl(input.value);
  if (!url) {
    message.textContent = "서버 주소를 확인해 주세요.";
    return;
  }

  localStorage.setItem("voiceChatServerUrl", url);
  saveSavedServers([url, ...loadSavedServers().filter((saved) => saved !== url)]);
  message.textContent = "연결 중...";
  const submitButton = form.querySelector("button[type=submit], button:not([type])");
  if (submitButton) submitButton.disabled = true;

  try {
    if (window.voiceDesktop?.loadServer) {
      const result = await window.voiceDesktop.loadServer(url);
      // 성공 시엔 창이 서버 페이지로 넘어가므로 아래 코드는 실행되지 않는다.
      if (!result?.ok) message.textContent = result?.error || "서버에 들어가지 못했습니다.";
      return;
    }
    location.href = url;
  } catch (error) {
    message.textContent = "서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.";
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
