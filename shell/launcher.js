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
