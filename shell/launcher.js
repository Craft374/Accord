const form = document.querySelector("#serverForm");
const input = document.querySelector("#serverInput");
const message = document.querySelector("#message");

input.value = localStorage.getItem("voiceChatServerUrl") || "https://localhost:25565";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeServerUrl(input.value);
  if (!url) {
    message.textContent = "서버 주소를 확인해 주세요.";
    return;
  }

  localStorage.setItem("voiceChatServerUrl", url);
  message.textContent = "연결 중...";

  if (window.voiceDesktop?.loadServer) {
    const result = await window.voiceDesktop.loadServer(url);
    if (!result?.ok) message.textContent = result?.error || "서버에 들어가지 못했습니다.";
    return;
  }

  location.href = url;
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
