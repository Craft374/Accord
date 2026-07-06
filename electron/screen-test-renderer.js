const video = document.getElementById("screen");
const params = new URLSearchParams(location.search);

const requestedWidth = Number(params.get("w")) || 1920;
const requestedHeight = Number(params.get("h")) || 1080;
const requestedFps = Number(params.get("fps")) || 60;
const display = parseJsonParam("display", {});
const switches = parseJsonParam("switches", []);
const gpuSummary = parseJsonParam("gpuSummary", {});

const requestedConstraints = {
  audio: false,
  video: {
    width: { ideal: requestedWidth },
    height: { ideal: requestedHeight },
    frameRate: { ideal: requestedFps, max: requestedFps },
  },
};

function parseJsonParam(name, fallback) {
  try {
    return JSON.parse(params.get(name) || "");
  } catch {
    return fallback;
  }
}

function log(event, detail = {}) {
  console.log(`[${event}] ${JSON.stringify(detail)}`);
}

function summarizeDisplay() {
  return {
    displayId: params.get("displayId") || "",
    logical: display.size || null,
    physicalEstimate: display.physicalEstimate || null,
    scaleFactor: display.scaleFactor || null,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

async function start() {
  log("minimal-screen-test-start", {
    mode: "minimal-screen-test",
    electron: params.get("electron") || "",
    gpuMode: params.get("gpuMode") || "",
    effectiveGpuMode: params.get("effectiveGpuMode") || "",
    switches,
    gpuSummary,
    display: summarizeDisplay(),
    requested: requestedConstraints,
    preview: "minimal-video-only",
    probe: "not used",
    webRtc: "not used",
  });

  const stream = await navigator.mediaDevices.getDisplayMedia(requestedConstraints);
  const track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  await video.play();

  log("minimal-screen-test-track", {
    actual: track?.getSettings?.() || {},
    requested: requestedConstraints,
    display: summarizeDisplay(),
  });

  measureDisplayedFps();
}

function measureDisplayedFps() {
  const startAt = performance.now();
  let frames = 0;
  let fiveSecondLogged = false;
  let fifteenSecondLogged = false;

  if (typeof video.requestVideoFrameCallback === "function") {
    const onFrame = (now) => {
      frames += 1;
      const elapsed = now - startAt;
      if (!fiveSecondLogged && elapsed >= 5000) {
        fiveSecondLogged = true;
        logDisplayedFps("minimal-screen-test-5s", frames, elapsed);
      }
      if (!fifteenSecondLogged && elapsed >= 15000) {
        fifteenSecondLogged = true;
        logDisplayedFps("minimal-screen-test-15s", frames, elapsed);
      }
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    return;
  }

  const startQuality = video.getVideoPlaybackQuality?.() || {};
  window.setTimeout(() => {
    const quality = video.getVideoPlaybackQuality?.() || {};
    const frameDelta = Number(quality.totalVideoFrames || 0) - Number(startQuality.totalVideoFrames || 0);
    logDisplayedFps("minimal-screen-test-5s", frameDelta, 5000);
  }, 5000);
  window.setTimeout(() => {
    const quality = video.getVideoPlaybackQuality?.() || {};
    const frameDelta = Number(quality.totalVideoFrames || 0) - Number(startQuality.totalVideoFrames || 0);
    logDisplayedFps("minimal-screen-test-15s", frameDelta, 15000);
  }, 15000);
}

function logDisplayedFps(event, frames, elapsedMs) {
  log(event, {
    displayedFps: elapsedMs > 0 ? Number(((frames * 1000) / elapsedMs).toFixed(1)) : 0,
    frames,
    elapsedMs: Math.round(elapsedMs),
    actual: video.srcObject?.getVideoTracks?.()[0]?.getSettings?.() || {},
    display: summarizeDisplay(),
    requested: requestedConstraints,
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});

start().catch((error) => {
  log("minimal-screen-test-error", {
    message: error?.message || String(error),
    name: error?.name || "",
    stack: error?.stack || "",
  });
});
