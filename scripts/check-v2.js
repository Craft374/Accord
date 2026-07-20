const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const syntaxTargets = [
  "server.js",
  "electron/main.js",
  "electron/preload.js",
  "shell/launcher.js",
  "public/app.js",
  "public/noise-gate-worklet.js",
  "public/program-audio-worklet.js",
  "scripts/generate-icons.js",
  "scripts/start-https.js",
  "scripts/build-windows-helper.js",
  "scripts/prune-dist.js",
];

let failed = false;

for (const target of syntaxTargets) {
  const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  } else {
    console.log(`check syntax: ${target}`);
  }
}

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const worklet = fs.readFileSync("public/noise-gate-worklet.js", "utf8");
const main = fs.readFileSync("electron/main.js", "utf8");
const preload = fs.readFileSync("electron/preload.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");
const dataStore = fs.readFileSync("data-store.js", "utf8");
const programWorklet = fs.readFileSync("public/program-audio-worklet.js", "utf8");
const helperSource = fs.readFileSync("native/windows-process-loopback/Program.cs", "utf8");
const serverEnvExample = fs.readFileSync("server.env.example", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const launcherJs = fs.readFileSync("shell/launcher.js", "utf8");
const launcherHtml = fs.readFileSync("shell/index.html", "utf8");
const pruneDist = fs.readFileSync("scripts/prune-dist.js", "utf8");
const startHttps = fs.readFileSync("scripts/start-https.js", "utf8");
const buildWindowsBat = fs.readFileSync("scripts/win/build-windows.bat", "utf8");
const buildWindowsCommand = fs.readFileSync("scripts/win/build-windows.command", "utf8");
const buildMacCommand = fs.readFileSync("scripts/mac/build-mac.command", "utf8");
const startServerMacCommand = fs.readFileSync("start-server-mac.command", "utf8");
const startMacServer = fs.readFileSync("scripts/mac/start-mac-server.sh", "utf8");
const requiredLaunchers = [
  "scripts/win/build-windows.bat",
  "scripts/win/build-windows.command",
  "scripts/mac/build-mac.command",
  "start-server-mac.command",
  "start-server-win.bat",
];
const commandBatFiles = listCommandBatFiles(".");
const iconSvg = fs.readFileSync("assets/icon.svg", "utf8");
const iconPolygonCount = (iconSvg.match(/<polygon\b/g) || []).length;
const bleedSuppressorFunction = app.match(/function shouldUseSystemBleedSuppressor\(\) \{[\s\S]*?\n\}/)?.[0] || "";
const systemAudioDisplayFunction = app.match(/async function getSystemAudioDisplayStream\(\) \{[\s\S]*?\n\}/)?.[0] || "";

function listCommandBatFiles(root) {
  const skipDirs = new Set([".git", ".cert", "dist", "node_modules"]);
  const files = [];
  walk(root);
  return files.sort();

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skipDirs.has(name)) continue;
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(bat|command)$/i.test(name)) continue;
      files.push(path.relative(root, fullPath).replace(/\\/g, "/"));
    }
  }
}

const checks = [
  [app.includes("echoCancellation"), "echo cancellation constraint exists"],
  [app.includes("noiseSuppression"), "noise suppression constraint exists"],
  [html.includes("noiseGateInput") && app.includes("getNoiseGateStrength"), "noise cut strength control exists"],
  [app.includes("autoGainControl"), "auto gain constraint exists"],
  [app.includes("getLegacyWebRtcProcessingConstraints") && app.includes("googNoiseSuppression"), "chromium webrtc processing hints exist"],
  [app.includes("googEchoCancellation") === false, "legacy echo cancellation constraints are removed"],
  [app.includes("getAudioProcessingAdvancedConstraints"), "advanced audio processing constraint helper exists"],
  [app.includes("trackInfo") && app.includes("streamId") && app.includes("role"), "track role signaling exists"],
  [app.includes("scheduleMicRestart") && app.includes("startHealthTimer"), "mic recovery monitor exists"],
  [app.includes("jitterBufferTarget") || app.includes("playoutDelayHint"), "low latency receiver hint exists"],
  [app.includes("selectSafeInputDevice") && app.includes("isVirtualAudioDeviceLabel"), "mac virtual input guard exists"],
  [app.includes("findSafeInputOption") && app.includes("isLikelyMicrophoneLabel"), "mac default input safe selection exists"],
  [app.includes("voiceChatInputDeviceId") && app.includes("voiceChatOutputDeviceId"), "device selection persistence exists"],
  [app.includes("voiceChatSystemInputDeviceId") && html.includes("systemInputDeviceSelect"), "mac system input device selection exists"],
  [app.includes("startVirtualSystemAudioShare") && app.includes("getSystemInputConstraints"), "mac virtual system audio capture exists"],
  [app.includes("selectSafeOutputDeviceForSystemShare") && app.includes("findSafeOutputOption"), "mac echo-safe output selection exists"],
  [app.includes("supportsOutputSinkSelection") && app.includes("outputSink"), "output sink support is tracked"],
  [app.includes("출력 미지원") && app.includes("출력 실패"), "output sink failure status exists"],
  [app.includes("ensureDeviceLabels") && app.includes("getUserMedia({ video: false, audio: true })"), "device label priming exists"],
  [app.includes("checkSenderFlow") && app.includes("senderHealth"), "stalled mic sender recovery exists"],
  [app.includes("checkLocalMicSendLevel") && app.includes("micSendSilentStrikes"), "silent processed mic send recovery exists"],
  [app.includes("mediaStatus") && app.includes("repairRequest"), "remote missing media repair signaling exists"],
  [app.includes("checkRemoteMediaExpectation") && app.includes("requestRemoteRepair"), "remote missing track monitor exists"],
  [app.includes("selectSafeOutputDeviceForEchoGuard"), "mac echo guard output selection exists"],
  [app.includes("assertSafeMacAudioRouting") && app.includes("getMacAudioRoutingIssue"), "mac unsafe routing is blocked before capture"],
  [/function shouldMutePlaybackForEchoGuard\(\) \{\s*return false;\s*\}/.test(app), "echo suspicion playback muting is disabled"],
  [app.includes("runEchoLeakProbe") && app.includes("measureAnalyserRms"), "audio diagnostics measures echo leak"],
  [app.includes("에코 누수") && app.includes("echoProbe"), "echo leak status is tracked"],
  [/function updateLiveEchoGuard\(\) \{\s*return;\s*\}/.test(app), "live echo suspicion guard is disabled"],
  [app.includes("sendMicLevel") && app.includes("rawMicMeterStop"), "raw and send mic levels are tracked separately"],
  [app.includes("stopMicMeters") && app.includes("stopMicOnly()"), "mic meter cleanup exists"],
  [app.includes("startPlaybackLevelProbe") && app.includes("getMaxRemotePlaybackLevel"), "remote playback level is measured"],
  [app.includes("startSystemShareMeter") && app.includes("systemLevel"), "local system share level is measured"],
  [/function shouldUseSystemBleedSuppressor\(\) \{\s*return false;\s*\}/.test(app), "system bleed suppressor is disabled"],
  [/function isMicSendProtected\(\) \{\s*return false;\s*\}/.test(app), "echo suspicion mic protection is disabled"],
  [app.includes("hasRemoteSilentMismatch") && app.includes("remoteSilent"), "remote live-but-silent mic monitor exists"],
  [html.includes("repairAudioButton") && app.includes("async function repairAudio"), "manual audio repair exists"],
  [app.includes("!peer.senders.mic || !peer.localStreams.mic"), "missing mic stream mapping is repaired"],
  [app.includes("!peer.senders.system || !peer.localStreams.system"), "missing system stream mapping is repaired"],
  [app.includes("enforceMicProcessingConstraints") && app.includes("applyConstraints"), "runtime mic processing enforcement exists"],
  [app.includes("createAudioWorkletNoiseGateNode") && app.includes("audioWorklet.addModule"), "audio worklet noise gate exists"],
  [worklet.includes("registerProcessor") && worklet.includes("voice-noise-gate"), "noise gate worklet registers processor"],
  [app.includes("createScriptNoiseGateNode") && app.includes("createScriptProcessor"), "fallback noise gate exists"],
  [app.includes("createDynamicsCompressor") && app.includes("getLocalProcessingText"), "fallback voice compressor status exists"],
  [app.includes("getProcessingHintText") && app.includes("Chromium"), "processing hint status exists"],
  [app.includes("testAudioSettings") && html.includes("testAudioButton"), "audio diagnostics button exists"],
  [html.includes("versionLabel") && app.includes("state.config.version"), "server version label exists"],
  [html.includes("chatMentionMenu") && app.includes("updateChatMentionMenu") && server.includes("cleanChatMentions"), "chat mentions include autocomplete and validated delivery metadata"],
  [app.includes("roomGroupModal") && app.includes("channel:reorder-room-layout") && server.includes("channel:reorder-room-layout") && dataStore.includes("function reorderRoomLayout"), "nested room layout changes are persisted atomically"],
  [app.includes("function normalizedRoomLayout") && dataStore.includes("function legacyRoomLayout") && dataStore.includes("roomLayout"), "legacy flat room groups migrate to the recursive layout"],
  [app.includes("function buildRoomTree") && app.includes("room-tree-children") && app.includes("countLayoutRooms"), "rooms and nested groups share one recursive sibling order"],
  [app.includes("serializeRoomTreeContainer") && app.includes("ensureRoomTreeDropIndicator") && app.includes('window.addEventListener("pointermove"') && app.includes('window.addEventListener("mouseup"') && !app.includes('addEventListener("dragstart"'), "room tree drag uses deterministic pointer events and one stable indicator"],
  [app.includes("canDropRoomTreeIn") && app.includes("drag.source?.contains(container)") && dataStore.includes("ROOM_LAYOUT_MAX_DEPTH"), "room groups cannot be moved into themselves or their descendants"],
  [html.includes("roomModalParent") && app.includes("parentGroupId") && app.includes("fillRoomParentSelect"), "new rooms and groups can be created at a selected tree location"],
  [css.includes(".room-tree-empty") && css.includes(".room-tree-root") && !css.includes(".room-root.empty-root"), "the root drop target stays in normal flow without covering a group heading"],
  [css.includes(".room-group-head:hover .room-group-count") && css.includes("position: absolute"), "room group actions only shift the count on hover"],
  [app.includes('execCommand?.("insertText"') && app.includes('inputType: "insertText"'), "memo color insertion uses undo-aware editing"],
  [app.includes("colors.push({ color, inner })") && app.includes("inlineMarkdown(entry.inner)"), "memo color markup preserves nested markdown"],
  [app.includes("unwrapMemoBlockColor") && app.includes("guard < 32") && app.includes("memoBlockStyle(it.color"), "memo block colors preserve list markers and nested colors"],
  [main.includes('ipcMain.handle("copy-text"') && preload.includes('ipcRenderer.invoke("copy-text"') && app.includes("writeTextToClipboard(code)"), "invite code copy uses desktop clipboard fallback"],
  [css.includes(".rolemgr-list") && css.includes("flex: 1; min-height: 0; overflow-y: auto"), "role creation row stays below the flexible role list"],
  [
    // 클라 버전은 단일 정수. package.json 은 semver("N.0.0")이고 그 major 가 CLIENT_VERSION 과 같아야 한다.
    app.includes(`const CLIENT_VERSION = "${String(parseInt(pkg.version, 10))}"`),
    `client version constant matches package.json major (${String(parseInt(pkg.version, 10))})`,
  ],
  [
    /const VERSION = "\d+\.\d+\.\d+"/.test(server) && preload.includes("appVersion"),
    "server version and client app version are tracked separately",
  ],
  [
    launcherJs.includes("launcherClientVersion") && launcherHtml.includes("launcher-version"),
    "launcher shows client version at bottom left",
  ],
  [html.includes("statProcessing") && html.includes("statInput"), "processing status view exists"],
  [app.includes("/ 출력") && app.includes("outputName"), "quality panel shows output device"],
  [html.includes("statSetup") && app.includes("getSetupStatusText"), "setup risk status view exists"],
  [html.includes("statSecurity") && app.includes("updateSecurityStatus"), "secure context status view exists"],
  [server.includes("secure: Boolean(tlsOptions)") && server.includes("protocol:"), "server exposes TLS status"],
  [pkg.scripts["server:https"] && startHttps.includes("VOICE_CHAT_REQUIRE_HTTPS") && startHttps.includes("getLanIp"), "https server script uses secure LAN mode"],
  [requiredLaunchers.every((file) => fs.existsSync(file)), "required bat and command launchers exist"],
  [
    commandBatFiles.length === requiredLaunchers.length &&
      requiredLaunchers.every((file) => commandBatFiles.includes(file)),
    "only required bat and command launchers remain",
  ],
  [buildWindowsBat.includes("npm run build:win") && buildWindowsBat.includes("Accord Windows x64 Portable.exe"), "windows bat builds windows artifact"],
  [buildWindowsCommand.includes("npm run build:win") && buildWindowsCommand.includes("Accord Windows x64 Portable.exe"), "mac command builds windows artifact"],
  [buildMacCommand.includes("npm run build:mac") && buildMacCommand.includes("Accord Mac arm64.zip"), "mac command builds mac artifact"],
  [startServerMacCommand.includes("./scripts/mac/start-mac-server.sh") && startMacServer.includes("setup-turn-mac.sh") && startMacServer.includes("scripts/start-https.js"), "mac server command starts TURN and HTTPS"],
  [app.includes("ensureSecureAudioContext") && app.includes("window.isSecureContext"), "secure audio context guard exists"],
  [html.includes("statBuffer") && html.includes("statConcealment") && html.includes("statHealth"), "expanded audio quality stats exist"],
  [app.includes("getQualityHealthText") && app.includes("getRemoteRepairStatusText"), "quality health includes recovery diagnostics"],
  [app.includes("previousCounters") && app.includes("getCounterAverageDelta"), "recent quality counter deltas exist"],
  [app.includes("ignoreSystemEndedUntil") && app.includes("ignoreMicEndedUntil"), "intentional track stop guards exist"],
  [app.includes("remoteStreamTracks") && app.includes("acceptedRemoteRoles"), "late track role reassignment exists"],
  [app.includes("waitForStableSignaling") && app.includes("signalingstatechange"), "renegotiation waits for stable signaling"],
  [app.includes("offerChain") && app.includes("makeOfferNow"), "peer offer queue exists"],
  [app.includes("networkPriority") && app.includes("maxptime = dom.lowLatencyToggle.checked ? 10 : 30"), "low latency opus tuning exists"],
  [app.includes("handleLatencySample") && app.includes("nudgePlaybackLatency"), "high latency correction exists"],
  [app.includes("bufferMs > 30") && app.includes("playbackRate = rate"), "more aggressive latency nudge exists"],
  [app.includes("voiceIsolation") || app.includes("getSupportedConstraints"), "supported constraint probing exists"],
  [html.includes("remoteMicVolumeInput") && html.includes("remoteSystemVolumeInput"), "remote volume controls exist"],
  [app.includes("makePlaybackPipeline") && app.includes("outputLevel"), "remote volume boost uses stable playback pipeline"],
  [!app.includes("selectSeparatedWindowsOutputForSystemShare"), "windows system share no longer force-switches the output device"],
  [html.includes("loopbackEchoReductionToggle") && app.includes("voiceChatLoopbackEchoReduction"), "windows headset echo reduction toggle exists"],
  [app.includes("createSystemSendTrack") && app.includes("syncSystemEchoFilterRemoteSources"), "windows loopback echo reducer processes system send track"],
  [app.includes("makeSystemEchoFilterTap") && app.includes("delayTime.value"), "windows loopback echo reducer uses delayed inverse taps"],
  [helperSource.includes("VAD\\\\Process_Loopback") && helperSource.includes("IncludeTargetProcessTree"), "windows native process loopback helper uses include target process tree"],
  [main.includes("start-program-audio-capture") && preload.includes("startProgramAudioCapture"), "electron exposes native program audio capture IPC"],
  [app.includes("startProgramSystemAudioShare") && app.includes("getProgramSystemAudioStream"), "renderer can create program-only system audio track"],
  [programWorklet.includes("registerProcessor") && programWorklet.includes("voice-program-audio"), "program audio worklet registers processor"],
  [html.includes("programAudioList") && app.includes("data-program-audio-pid"), "program audio selection uses checkbox list"],
  [!main.includes("execFile(helper,") && main.includes("execFile(helperInfo.path"), "program audio list helper variable is defined"],
  [main.includes("getProgramLoopbackHelperInfo") && main.includes("makeHelperError") && main.includes("cwd: helperInfo.cwd"), "program audio helper spawn errors include path and cwd"],
  [main.includes("platform=${process.platform}") && main.includes("stack=") && main.includes("args="), "program audio helper errors include platform args and stack"],
  [app.includes("program-audio-list-failed") && app.includes("프로그램별 오디오 목록을 불러오지 못했습니다"), "program audio list failure is shown without crashing"],
  [app.includes("isOwnProgramAudioSource") && app.includes("accordprocessloopback"), "program audio list hides this app and helper"],
  [app.includes("프로그램별 캡처 실패") && !app.includes("getSelectedWindowAudioStream"), "program audio failure does not pretend to use window loopback"],
  [/systemCaptureModeSelect|appAudioSourceSelect/.test(html) === false, "fake program audio selection UI is removed"],
  [/listSystemAudioSources|list-system-audio-sources/.test(preload + main) === false, "fake program audio source IPC is removed"],
  [/getSelectedAppAudioStream|getSelectedWindowAudioStream|voiceChatAppAudioSourceIds/.test(app) === false, "fake selected program audio capture path is removed"],
  [app.includes("getWindowsAudioRoutingIssue") && !app.includes("출력 분리"), "windows headset is not flagged as a routing issue during system share"],
  [main.includes('"loopback"') && !main.includes("loopbackWithMute") && app.includes("getElectronDisplayLoopbackSystemAudioStream"), "windows display loopback uses unmuted capture"],
  [app.includes("enforceSystemAudioTrackConstraints"), "system audio capture constraints are reapplied to tracks"],
  [app.includes("getSystemAudioStreamOrNull") && app.includes("컴퓨터 사운드 캡처 실패"), "system audio capture failures are reported"],
  [/createSendSystemTrack|systemProcess|systemSendGain|반송억제/.test(app) === false, "system share does not volume-gate captured audio"],
  [pkg.build?.icon === "assets/icon" && pkg.build?.files?.includes("assets/**/*"), "desktop build uses local icon assets"],
  [iconPolygonCount > 0 && iconPolygonCount <= 4, "icon svg uses four or fewer polygons"],
  [css.includes("color-scheme: dark"), "dark mode css exists"],
  [main.includes("load-voice-url") && main.includes("loadURL"), "desktop shell loads server UI"],
  [pkg.build?.win?.target?.includes("portable"), "windows build uses portable target"],
  [!pkg.build?.win?.target?.includes("nsis") && !pkg.nsis, "windows installer target is disabled"],
  [!pkg.scripts?.["build:win:arm"] && !pkg.scripts?.build?.includes("build:win:arm"), "windows arm build script is removed"],
  [pkg.scripts?.build?.includes("scripts/prune-dist.js") && pruneDist.includes("Accord Windows x64 Portable.exe") && !pruneDist.includes("Windows arm64"), "build keeps only mac and windows x64 artifacts"],
];

for (const [ok, label] of checks) {
  if (!ok) {
    failed = true;
    console.error(`check failed: ${label}`);
  } else {
    console.log(`check static: ${label}`);
  }
}

const reviews = [
  [/silentSystem|createSilentAudioTrack|getSystemSendTrack/.test(app) === false, "no silent placeholder track"],
  [/shareButton/.test(app + html) === false, "no duplicate sound share button"],
  [/cache-control.+no-store/is.test(server), "server disables stale client cache"],
  [/desktop\.isDesktop \|\| desktop\.platform !== "darwin" \|\| dom\.systemAudioToggle\.checked/.test(app) === false, "mac mic guard does not skip while system share is checked"],
  [/dom\.systemAudioToggle\.checked && isDirectSystemAudioSupported/.test(app) === false, "system share reservation is not limited to direct capture"],
  [/return "출력 확인"/.test(app), "mac system-share output risk is surfaced"],
  [/await replaceMicTrack\(\{ renegotiate: false \}\)[\s\S]+await renegotiatePeers\(\)/.test(app), "manual audio repair batches mic replacement and renegotiation"],
  [/async function replaceMicTrack\(\{ renegotiate = true \} = \{\}\)/.test(app), "mic replacement can defer renegotiation"],
  [/needsRenegotiate && renegotiate/.test(app), "mic replacement respects deferred renegotiation"],
  [/ensureSystemBleedSuppressor\(\)[\s\S]+replaceMicTrack\(\{ renegotiate: false \}\)/.test(app), "system share mic rebuild batches renegotiation"],
  [/restartMic && state\.currentRoom\) await replaceMicTrack\(\{ renegotiate: !renegotiate \}\)/.test(app), "settings restart avoids duplicate renegotiation"],
  [/peer\.offerChain[\s\S]+\.then\(\(\) => makeOfferNow/.test(app), "offer creation is serialized per peer"],
  [/state\.systemTrack && \(!peer\.senders\.system \|\| !peer\.localStreams\.system\)/.test(app), "health check restores missing system sender"],
  [app.includes("echoCancellationToggle") === false && html.includes("echoCancellationToggle") === false, "echo cancellation toggle is fully removed"],
  [/const noiseGate = dom\.noiseSuppressionToggle\.checked/.test(app), "noise suppression toggle always enables backup noise gate"],
  [/const compressor = dom\.autoGainToggle\.checked/.test(app), "auto gain toggle always enables backup compressor"],
  [/getMicConstraints\(\)[\s\S]+getAudioProcessingAdvancedConstraints\(noise, autoGain\)/.test(app), "mic capture requests advanced speech processing"],
  [/enforceMicProcessingConstraints\(\)[\s\S]+getLegacyWebRtcProcessingConstraints\(noise, autoGain\)/.test(app), "runtime mic constraints include chromium processing hints"],
  [/getDisplayMedia\([\s\S]+getLegacyWebRtcProcessingConstraints\(false, false\)/.test(app), "display system audio disables chromium speech processing"],
  [/getSystemInputConstraints\(\)[\s\S]+getLegacyWebRtcProcessingConstraints\(false, false\)/.test(app), "virtual system audio disables chromium speech processing"],
  [/settings\.closedGain/.test(app) && /this\.closedGain/.test(worklet), "noise gate closed strength is configurable"],
  [/shouldUseNativeNoiseSuppression\(\)[\s\S]+getNoiseGateStrength\(\) >= 0\.75/.test(app), "strong noise cut uses native suppression only at high strength"],
  [/parts\.push\("AEC/.test(app) === false, "AEC processing status labels are removed"],
  [/function shouldUseSystemBleedSuppressor\(\) \{\s*return false;\s*\}/.test(app), "system bleed suppressor stays off"],
  [/function getBleedSuppressionStatusText\(\) \{\s*return "";\s*\}/.test(app), "quality health does not show bleed suppression"],
  [/function getBleedSuppressorText\(\) \{\s*return "";\s*\}/.test(app), "processing status does not show bleed suppression"],
  [/유입억제/.test(app) === false, "user-facing bleed suppression text is removed"],
  [/dom\.statProcessing\.textContent = getProcessingText\(state\.rawMicTrack\?\.getSettings\?\.\(\) \|\| \{\}\)/.test(app), "processing status refreshes with live processing state"],
  [/sendMediaStatus\(peer\)[\s\S]+checkRemoteMediaExpectation\(peer\)/.test(app), "health check sends media status and validates remote tracks"],
  [/level: state\.liveEchoGuard\.sendMicLevel \|\| 0/.test(app), "media status uses processed send mic level"],
  [/new MediaStream\(\[state\.rawMicTrack\]\), null/.test(app), "raw mic meter is kept invisible for echo guard"],
  [/const sendTrack = state\.micTrack \|\| state\.rawMicTrack/.test(app), "visible local meter tracks processed mic send"],
  [/수신 \$\{Math\.round\(levelPercent\)\}% \/ 송신/.test(app), "quality panel shows send mic level"],
  [/function stopMicOnly\(\) \{[\s\S]+stopMicMeters\(\)/.test(app), "mic replacement stops old raw and send meters"],
  [/state\.liveEchoGuard\.sendMicLevel = 0/.test(app), "send mic level is reset when mic stops"],
  [/function stopMeters\(\) \{[\s\S]+stopMicMeters\(\)/.test(app), "global meter cleanup includes mic meters"],
  [/if \(role === "system"\) return;[\s\S]+if \(!sender\.getStats\)/.test(app), "system silence does not trigger byte-stall repair"],
  [/applySinkToAudio\(audio\)\.finally\(\(\) =>/.test(app), "remote playback waits for sink selection before play"],
  [/state\.outputSink\.failed = true;[\s\S]+lastError = "failed"/.test(app), "sink apply failure is recorded"],
  [/needsEchoSafeOutput && \(!outputOption\?\.value/.test(app), "mac echo mode requires explicit safe output"],
  [/wantsSystem && state\.outputSink\.failed/.test(app), "output sink failure blocks only mac system sharing"],
  [/const applied = await applyOutputDevice\(\);[\s\S]+운영체제 출력 장치/.test(app), "automatic safe output reports apply failure"],
  [/assertSafeMacAudioRouting\(Boolean\(dom\.systemAudioToggle\.checked\)\)/.test(app), "room entry blocks unsafe mac routing"],
  [/assertSafeMacAudioRouting\(state\.systemSharing\)/.test(app), "mic replacement blocks unsafe mac routing"],
  [/await runEchoLeakProbe\(track\)/.test(app), "audio diagnostics runs echo leak probe"],
  [/probe >= 0\.012[\s\S]+ratio >= 2\.2/.test(app), "echo leak threshold checks absolute and relative rise"],
  [/state\.echoProbe\.status === "leak"[\s\S]+return "에코 누수"/.test(app) === false, "echo probe does not block setup health"],
  [/에코 의심/.test(app) === false, "echo suspicion status text is removed"],
  [/function updateLiveEchoGuard\(\) \{\s*return;\s*\}/.test(app), "live echo guard no longer reacts to music plus speech"],
  [/playback\.levelProbe = startPlaybackLevelProbe/.test(app), "remote playback probe starts with playback"],
  [/ensurePlaybackPipeline\(playback\)[\s\S]+gainNode\.connect\(context\.destination\)[\s\S]+playback\.audio\.volume = 0/.test(app), "remote playback uses stable gain pipeline"],
  [/playback\.pipeline\.context\.resume\(\)[\s\S]+playback\.audio\.play\(\)/.test(app), "boosted remote volume resumes audio context before play"],
  [/getMaxRemotePlaybackLevel\(\)[\s\S]+outputLevel/.test(app), "echo guard uses post-volume remote playback level"],
  [html.includes("clientLogOutput") && html.includes("copyLogButton") && app.includes("addClientLog") && app.includes("getClientLogText"), "client diagnostic log panel can copy and clear logs"],
  [app.includes("callSessionId") && app.includes("call-session-start") && app.includes("sid="), "client diagnostic logs include session id"],
  [app.includes("signal-send") && app.includes("signal-received") && app.includes("getSignalPayloadKind"), "client logs signal send and receive kinds"],
  [html.includes("copyDiagnosticsButton") && app.includes("buildDiagnosticsText") && app.includes("signaling-failed"), "connection diagnostics can be copied with signaling errors"],
  [app.includes("isPeerReadyForMediaHealth") && app.includes("repair-request-blocked") && app.includes("media-status-deferred"), "media repair is blocked until peer is connected and stable"],
  [app.includes("initialOfferSent") && app.includes("shouldDeferOffer") && app.includes("offer-deferred"), "offer creation is deferred during initial ICE connection"],
  [app.includes("syncLocalSendersForPeer(peer, { forceOffer: false })"), "existing peer does not force a second initial offer on peer-joined"],
  [server.includes("TURN_URLS") && server.includes("STUN_URLS") && server.includes("loadServerEnvFiles"), "server supports TURN and STUN env/config files"],
  [server.includes("printTurnStatus") && server.includes("TURN not configured") && serverEnvExample.includes("TURN_URLS="), "https server prints TURN setup guidance"],
  [app.includes("candidateCounts") && app.includes("relay-candidate-local") && app.includes("relay-candidate-remote"), "client logs ICE candidate type counts and relay candidates"],
  [app.includes("getSelectedCandidatePairText") && app.includes("selectedCandidatePair=none"), "client logs selected candidate pair or missing pair"],
  [app.includes("turn-needed") && app.includes("TURN 서버 필요 가능성이 높습니다") && app.includes("shouldRetryIce"), "ICE failure reports TURN need and limits retries"],
  [server.includes("getSignalKind") && server.includes("signal kind=") && server.includes("sid="), "server logs signaling kind and client session id"],
  [main.includes("get-screen-source") && preload.includes("getScreenSource") && app.includes("getElectronDesktopScreenShareStream"), "windows screen share has desktopCapturer getUserMedia fallback"],
  [html.includes("screenCaptureModeSelect") && app.includes("voiceChatScreenCaptureMode") && app.includes("screenCaptureModeField.hidden"), "windows electron screen capture mode can be compared"],
  [app.includes("screen-share-5s") && app.includes("screen-low-fps") && app.includes("bytesSent") && app.includes("bytesReceived"), "screen share stats are logged after start with raw bytes"],
  [/role === "screen"[\s\S]+degradationPreference = "maintain-framerate"[\s\S]+delete params\.degradationPreference/.test(app), "screen sender tuning is separated from audio sender tuning"],
  [/isElectronLoopbackSystemAudioSupported\(\)[\s\S]+desktop\.platform === "win32"/.test(app), "electron loopback is limited to windows"],
  [/getElectronDisplayLoopbackSystemAudioStream\(\)[\s\S]+getSystemAudioCaptureConstraints\(\)/.test(app), "windows system share uses constrained display loopback"],
  [/getSystemAudioStreamOrNull\("Windows display loopback", getElectronDisplayLoopbackSystemAudioStream/.test(systemAudioDisplayFunction), "windows system share tries display loopback first"],
  [/getSystemAudioStreamOrNull\("Windows raw loopback", getElectronLoopbackSystemAudioStream/.test(systemAudioDisplayFunction), "windows system share falls back to raw loopback"],
  [/audio: process\.platform === "darwin" \? undefined : "loopback"/.test(main) && !main.includes("loopbackWithMute"), "electron display handler uses unmuted loopback"],
  [/level: state\.liveEchoGuard\.systemLevel \|\| 0/.test(app), "system share level is still reported in media status"],
  [/function protectMicSend\(durationMs = 1200\) \{[\s\S]+protectUntil = 0/.test(app), "echo suspicion no longer protects mic send"],
  [/requestRemoteRepair\(peer, role, "silent"\)/.test(app), "live-but-silent remote mic requests repair"],
  [/peer\.remoteSilent\[role\] >= 3/.test(app), "live-but-silent remote mic repair waits for sustained silence"],
  [/마이크 무음복구/.test(app) && /마이크 수신복구/.test(app), "quality health shows remote repair progress"],
  [/repairLocalTrackForPeer\(peer, role, \{ restart: request\?\.reason === "silent" \}\)/.test(app), "silent repair request restarts local mic capture"],
  [/repairLocalTrackForPeer\(peer, role, \{ restart: role === "mic" \}\)/.test(app), "stalled mic sender restarts local capture"],
  [/checkLocalMicSendLevel\(\)[\s\S]+rawLevel[\s\S]+sendLevel[\s\S]+replaceMicTrack\(\)/.test(app), "local raw-live but send-silent mic is rebuilt"],
  [/state\.micSendSilentStrikes = 0/.test(app), "local send-silent recovery counter resets"],
  [/const targetMs = dom\.lowLatencyToggle\.checked \? null : 40/.test(app) && /receiver\.jitterBufferTarget = targetMs/.test(app), "low latency receiver target uses milliseconds"],
  [/new RegExp\(`a=fmtp:\$\{opusPayload\} \.\+\\\\r\\\\n`, "g"\)/.test(app) && /new RegExp\(`\(a=fmtp:\$\{opusPayload\} \.\+\\\\r\\\\n\)`, "g"\)/.test(app), "opus tuning applies to every audio m-line"],
  [/const enabled = !state\.muted && !isMicSendProtected\(\)/.test(app), "mic enabled state respects echo protection"],
  [/if \(!state\.muted && state\.rawMicTrack\)/.test(app) === false, "health check does not bypass echo mic protection"],
  [/rebuildLocalStream\(\);\s*\n\s*playUiSound\("soundOn"/.test(app), "system sound-on cue plays before peer renegotiation"],
  [/rebuildLocalStream\(\);\s*\n\s*playUiSound\("screenOn"/.test(app), "camera share sound-on cue plays before peer renegotiation"],
  [/rebuildLocalStream\(\);\s*\n\s*playUiSound\("screenOn"[\s\S]+await setDesktopScreenShareActive\(true\)/.test(app), "full screen share sound-on cue plays before desktop capture setup and renegotiation"],
  [/\[\/\\b\(demi \?light\|semi \?light\)\\b\/i, 350\]/.test(app), "memo font weight parser recognizes DemiLight"],
  [/\{ weight: "1 1000" \}/.test(app), "ungrouped custom memo fonts register a full weight range for variable font files"],
  [/let memoViewPref = MEMO_VIEWS\.includes/.test(app) && /localStorage\.setItem\("accordMemoView", v\)/.test(app), "memo view tab (split/edit/preview/live) is remembered across reopens"],
  [/function setFontMeta\(channelId, fontId, patch\)/.test(dataStore) && /font\.family = /.test(dataStore) && /font\.weightText = /.test(dataStore), "server stores per-font family and weight overrides"],
  [/case "channel:set-font-meta":/.test(server) && /store\.setFontMeta/.test(server), "server wires up the font meta socket message"],
  [/family: f\.family \|\| "", weightText: f\.weightText \|\| ""/.test(dataStore), "channel payload sends font family/weight overrides to clients"],
  [/function resolveWeightText\(text\)/.test(app) && /중간/.test(app) && /굵/.test(app), "manual weight input resolves Korean/letter/number labels"],
  [/function resolveFontMeta\(font\)/.test(app) && /famText \|\| parsed\.family/.test(app), "explicit family/weight overrides win over filename parsing"],
  [/function bindFontFamilyInput\(input, group\)/.test(app) && /function bindFontWeightInput\(input, font\)/.test(app) && /channel:set-font-meta/.test(app), "font manager edits family per card and weight per file"],
  [/const registeredFontFaces = new Map\(\)/.test(app) && /document\.fonts\.delete\(prev\.face\)/.test(app), "font re-registers (dropping stale FontFace) when family/weight changes"],
  [(() => {
    // resolveWeightText 를 소스에서 그대로 뽑아 실제로 실행해 매핑을 검증한다(정적 존재 확인이 아니라 동작 확인).
    try {
      const src = app.match(/const MEMO_WEIGHT_TEXT_CODES =[\s\S]*?function resolveWeightText\(text\) \{[\s\S]*?\n\}/);
      if (!src) return false;
      const fn = new Function(`${src[0]}\nreturn resolveWeightText;`)();
      return fn("가늘게") === 300 && fn("중간") === 500 && fn("굵게") === 700
        && fn("세미볼드") === 600 && fn("Bold") === 700 && fn("700") === 700
        && fn("L") === 300 && fn("") === 400;
    } catch { return false; }
  })(), "resolveWeightText maps Korean/English/letter/number labels to weights (runtime)"],
];

for (const [ok, label] of reviews) {
  if (!ok) {
    failed = true;
    console.error(`review failed: ${label}`);
  } else {
    console.log(`review: ${label}`);
  }
}

if (failed) process.exit(1);
