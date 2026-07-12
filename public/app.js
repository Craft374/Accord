const desktop = window.voiceDesktop || { isDesktop: false, platform: "" };
const serverUrl = location.origin;

const ROOM_TYPE_META = {
  voice: { icon: "🔊", label: "통화방" },
  chat: { icon: "#", label: "채팅방" },
  memo: { icon: "📝", label: "메모장" },
  draw: { icon: "🎨", label: "그림판" },
  log: { icon: "📜", label: "전역 로그" },
};

const state = {
  config: { iceServers: [], maxRoomLimit: 8, version: "0.2.42", secure: false, protocol: "https" },
  socket: null,
  clientId: "",
  rooms: [],
  currentRoom: null,
  peers: new Map(),
  rawMicStream: null,
  rawMicTrack: null,
  micTrack: null,
  micProcess: null,
  systemStream: null,
  systemCaptureTrack: null,
  systemTrack: null,
  systemEchoFilter: null,
  systemCaptureMode: localStorage.getItem("voiceChatSystemCaptureMode") === "program" ? "program" : "full",
  systemCaptureKind: "",
  screenStream: null,
  screenTrack: null,
  screenSharing: false,
  selectedScreenPeerId: "",
  screenResolution: localStorage.getItem("voiceChatScreenResolution") || "1080",
  screenFps: localStorage.getItem("voiceChatScreenFps") || "30",
  screenCaptureMode: ["auto", "handler", "browser", "electron"].includes(localStorage.getItem("voiceChatScreenCaptureMode"))
    ? localStorage.getItem("voiceChatScreenCaptureMode")
    : "auto",
  screenPreviewEnabled: localStorage.getItem("voiceChatScreenPreview") !== "off",
  screenProbeEnabled: localStorage.getItem("voiceChatScreenProbe") !== "off",
  screenFitMode: localStorage.getItem("voiceChatScreenFitMode") === "cover" ? "cover" : "contain",
  screenControlsHideTimer: 0,
  screenStats: { capture: "", sender: "", receiver: "", bottleneck: "" },
  screenCaptureMethod: "",
  screenCaptureSource: null,
  screenCaptureRequested: null,
  screenDesktopDiagnostics: null,
  screenCaptureProbe: { stop: null, fps: 0, method: "", frames: 0, enabled: true, sampling: false },
  lastScreenStatsLogAt: 0,
  screenLowFpsStrikes: 0,
  ignoreScreenEndedUntil: 0,
  programAudioSources: [],
  programAudioSourcesLoaded: false,
  selectedProgramAudioPids: new Set(readStoredProgramAudioPids()),
  programAudioProcess: null,
  programAudioSilenceTimer: 0,
  peerVolumes: readStoredPeerVolumes(),
  localStream: null,
  muted: false,
  systemSharing: false,
  localMeterStop: null,
  rawMicMeterStop: null,
  remoteMeterStop: null,
  systemMeterStop: null,
  statsTimer: 0,
  healthTimer: 0,
  callSessionId: makeSessionId(),
  previousStats: new Map(),
  previousCounters: new Map(),
  senderHealth: new Map(),
  micSendSilentStrikes: 0,
  latencyHealth: new Map(),
  latencyNudges: new Map(),
  mediaRepairCooldowns: new Map(),
  mediaZeroHealth: new Map(),
  recentErrors: [],
  clientLogs: [],
  lastErrorAt: 0,
  outputSink: { supported: false, failed: false, lastError: "" },
  echoProbe: { status: "", ratio: 0, baseline: 0, probe: 0 },
  liveEchoGuard: {
    status: "",
    micLevel: 0,
    sendMicLevel: 0,
    remoteLevel: 0,
    systemLevel: 0,
    strikes: 0,
    lastDetectedAt: 0,
    lastSampleAt: 0,
    protectUntil: 0,
    protectionTimer: 0,
    bleedGain: 1,
  },
  applyingSettings: false,
  ignoreMicEndedUntil: 0,
  ignoreSystemEndedUntil: 0,
  micRestartTimer: 0,
  healthChecking: false,
  repairingAudio: false,
  auth: {
    token: localStorage.getItem("accordAuthToken") || "",
    user: null,
    authed: false,
    adminUiEnabled: localStorage.getItem("accordAdminUiEnabled") !== "off",
    pendingRegisterAvatar: "",
  },
  adminUsers: [],
  adminOnline: [],
  adminCodeTarget: "",
  codeChangePending: false,
  channels: [],
  currentChannelId: "",
  presence: {},
  online: [],
  // 채팅
  activeChat: null, // { roomId, channelId, name }
  chatMessages: [],
  chatPendingFiles: [], // 업로드 완료돼 전송 대기 중인 파일 메타
  chatUnread: {}, // roomId -> 안 읽은 메시지 수
  chatTypers: new Map(), // userId -> { name, timer }
  chatTypingSentAt: 0,
  // 메모장
  memo: null, // { roomId, channelId, name, rev, remotePending, saveTimer, view }
};

const dom = {
  launcherButton: document.querySelector("#launcherButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  roomLimitLiveSelect: document.querySelector("#roomLimitLiveSelect"),
  versionLabel: document.querySelector("#versionLabel"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  nameInput: document.querySelector("#nameInput"),
  channelRail: document.querySelector("#channelRail"),
  channelName: document.querySelector("#channelName"),
  channelMenuButton: document.querySelector("#channelMenuButton"),
  channelEmpty: document.querySelector("#channelEmpty"),
  memberList: document.querySelector("#memberList"),
  roomList: document.querySelector("#roomList"),
  channelModal: document.querySelector("#channelModal"),
  channelModalClose: document.querySelector("#channelModalClose"),
  channelTabCreate: document.querySelector("#channelTabCreate"),
  channelTabJoin: document.querySelector("#channelTabJoin"),
  channelCreateForm: document.querySelector("#channelCreateForm"),
  channelCreateName: document.querySelector("#channelCreateName"),
  channelJoinForm: document.querySelector("#channelJoinForm"),
  channelJoinCode: document.querySelector("#channelJoinCode"),
  channelModalMessage: document.querySelector("#channelModalMessage"),
  roomModal: document.querySelector("#roomModal"),
  roomModalClose: document.querySelector("#roomModalClose"),
  roomModalName: document.querySelector("#roomModalName"),
  roomModalConfirm: document.querySelector("#roomModalConfirm"),
  roomModalMessage: document.querySelector("#roomModalMessage"),
  roomRenameModal: document.querySelector("#roomRenameModal"),
  roomRenameClose: document.querySelector("#roomRenameClose"),
  roomRenameInput: document.querySelector("#roomRenameInput"),
  roomRenameConfirm: document.querySelector("#roomRenameConfirm"),
  roomRenameMessage: document.querySelector("#roomRenameMessage"),
  roomLimitField: document.querySelector("#roomLimitField"),
  roomLimitInput: document.querySelector("#roomLimitInput"),
  chatPanel: document.querySelector("#chatPanel"),
  chatRoomName: document.querySelector("#chatRoomName"),
  chatSubtitle: document.querySelector("#chatSubtitle"),
  chatScroll: document.querySelector("#chatScroll"),
  chatMessages: document.querySelector("#chatMessages"),
  chatTyping: document.querySelector("#chatTyping"),
  chatAttachments: document.querySelector("#chatAttachments"),
  chatAttachButton: document.querySelector("#chatAttachButton"),
  chatFileInput: document.querySelector("#chatFileInput"),
  chatInput: document.querySelector("#chatInput"),
  chatSendButton: document.querySelector("#chatSendButton"),
  chatComposerHint: document.querySelector("#chatComposerHint"),
  chatDropOverlay: document.querySelector("#chatDropOverlay"),
  memoPanel: document.querySelector("#memoPanel"),
  memoRoomName: document.querySelector("#memoRoomName"),
  memoStatus: document.querySelector("#memoStatus"),
  memoBody: document.querySelector("#memoBody"),
  memoEditor: document.querySelector("#memoEditor"),
  memoPreview: document.querySelector("#memoPreview"),
  memoRemoteNotice: document.querySelector("#memoRemoteNotice"),
  memoRemoteText: document.querySelector("#memoRemoteText"),
  memoApplyRemote: document.querySelector("#memoApplyRemote"),
  memoViewSplit: document.querySelector("#memoViewSplit"),
  memoViewEdit: document.querySelector("#memoViewEdit"),
  memoViewPreview: document.querySelector("#memoViewPreview"),
  channelMenuModal: document.querySelector("#channelMenuModal"),
  channelMenuClose: document.querySelector("#channelMenuClose"),
  channelInviteCode: document.querySelector("#channelInviteCode"),
  copyInviteButton: document.querySelector("#copyInviteButton"),
  channelRenameInput: document.querySelector("#channelRenameInput"),
  channelRenameButton: document.querySelector("#channelRenameButton"),
  channelLeaveButton: document.querySelector("#channelLeaveButton"),
  channelDeleteButton: document.querySelector("#channelDeleteButton"),
  channelMenuMessage: document.querySelector("#channelMenuMessage"),
  channelIconRow: document.querySelector("#channelIconRow"),
  channelIconPreview: document.querySelector("#channelIconPreview"),
  channelIconInput: document.querySelector("#channelIconInput"),
  cropModal: document.querySelector("#cropModal"),
  cropCanvas: document.querySelector("#cropCanvas"),
  cropCancel: document.querySelector("#cropCancel"),
  cropApply: document.querySelector("#cropApply"),
  cropZoom: document.querySelector("#cropZoom"),
  cropZoomValue: document.querySelector("#cropZoomValue"),
  currentRoomName: document.querySelector("#currentRoomName"),
  currentRoomMeta: document.querySelector("#currentRoomMeta"),
  leaveButton: document.querySelector("#leaveButton"),
  inputDeviceSelect: document.querySelector("#inputDeviceSelect"),
  outputDeviceSelect: document.querySelector("#outputDeviceSelect"),
  systemInputField: document.querySelector("#systemInputField"),
  systemInputDeviceSelect: document.querySelector("#systemInputDeviceSelect"),
  micGainInput: document.querySelector("#micGainInput"),
  micGainValue: document.querySelector("#micGainValue"),
  noiseGateInput: document.querySelector("#noiseGateInput"),
  noiseGateValue: document.querySelector("#noiseGateValue"),
  refreshDevicesButton: document.querySelector("#refreshDevicesButton"),
  testAudioButton: document.querySelector("#testAudioButton"),
  noiseSuppressionToggle: document.querySelector("#noiseSuppressionToggle"),
  echoCancellationToggle: document.querySelector("#echoCancellationToggle"),
  autoGainToggle: document.querySelector("#autoGainToggle"),
  systemAudioToggle: document.querySelector("#systemAudioToggle"),
  systemAudioAction: document.querySelector("#systemAudioAction"),
  screenShareButton: document.querySelector("#screenShareButton"),
  screenSharePanel: document.querySelector("#screenSharePanel"),
  screenResolutionSelect: document.querySelector("#screenResolutionSelect"),
  screenFpsSelect: document.querySelector("#screenFpsSelect"),
  screenCaptureModeField: document.querySelector("#screenCaptureModeField"),
  screenCaptureModeSelect: document.querySelector("#screenCaptureModeSelect"),
  screenPreviewToggle: document.querySelector("#screenPreviewToggle"),
  screenProbeToggle: document.querySelector("#screenProbeToggle"),
  openScreenTestButton: document.querySelector("#openScreenTestButton"),
  screenStage: document.querySelector("#screenStage"),
  screenViewer: document.querySelector("#screenViewer"),
  screenViewerTitle: document.querySelector("#screenViewerTitle"),
  screenFitButton: document.querySelector("#screenFitButton"),
  screenFullscreenButton: document.querySelector("#screenFullscreenButton"),
  screenViewerCloseButton: document.querySelector("#screenViewerCloseButton"),
  screenShareList: document.querySelector("#screenShareList"),
  systemCaptureFullRadio: document.querySelector("#systemCaptureFullRadio"),
  systemCaptureProgramRadio: document.querySelector("#systemCaptureProgramRadio"),
  programAudioPanel: document.querySelector("#programAudioPanel"),
  programAudioSearchInput: document.querySelector("#programAudioSearchInput"),
  refreshProgramAudioButton: document.querySelector("#refreshProgramAudioButton"),
  programAudioList: document.querySelector("#programAudioList"),
  programAudioSelectedList: document.querySelector("#programAudioSelectedList"),
  programAudioStatus: document.querySelector("#programAudioStatus"),
  loopbackEchoReductionToggle: document.querySelector("#loopbackEchoReductionToggle"),
  lowLatencyToggle: document.querySelector("#lowLatencyToggle"),
  highQualityToggle: document.querySelector("#highQualityToggle"),
  localState: document.querySelector("#localState"),
  remoteState: document.querySelector("#remoteState"),
  localMeter: document.querySelector("#localMeter"),
  systemMeter: document.querySelector("#systemMeter"),
  remoteMeter: document.querySelector("#remoteMeter"),
  remoteMicVolumeInput: document.querySelector("#remoteMicVolumeInput"),
  remoteMicVolumeValue: document.querySelector("#remoteMicVolumeValue"),
  remoteSystemVolumeInput: document.querySelector("#remoteSystemVolumeInput"),
  remoteSystemVolumeValue: document.querySelector("#remoteSystemVolumeValue"),
  muteButton: document.querySelector("#muteButton"),
  repairAudioButton: document.querySelector("#repairAudioButton"),
  participantList: document.querySelector("#participantList"),
  statSend: document.querySelector("#statSend"),
  statReceive: document.querySelector("#statReceive"),
  statRtt: document.querySelector("#statRtt"),
  statJitter: document.querySelector("#statJitter"),
  statLoss: document.querySelector("#statLoss"),
  statCodec: document.querySelector("#statCodec"),
  statBuffer: document.querySelector("#statBuffer"),
  statConcealment: document.querySelector("#statConcealment"),
  statAudioLevel: document.querySelector("#statAudioLevel"),
  qualitySummary: document.querySelector("#qualitySummary"),
  statSampleRate: document.querySelector("#statSampleRate"),
  statChannels: document.querySelector("#statChannels"),
  statProcessing: document.querySelector("#statProcessing"),
  statInput: document.querySelector("#statInput"),
  statSetup: document.querySelector("#statSetup"),
  statSecurity: document.querySelector("#statSecurity"),
  statScreenShare: document.querySelector("#statScreenShare"),
  statConnection: document.querySelector("#statConnection"),
  statLastError: document.querySelector("#statLastError"),
  statHealth: document.querySelector("#statHealth"),
  copyDiagnosticsButton: document.querySelector("#copyDiagnosticsButton"),
  copyLogButton: document.querySelector("#copyLogButton"),
  clearLogButton: document.querySelector("#clearLogButton"),
  clientLogOutput: document.querySelector("#clientLogOutput"),
  message: document.querySelector("#message"),
  localMonitor: document.querySelector("#localMonitor"),
  remoteAudios: document.querySelector("#remoteAudios"),
  // 인증 · 프로필 · 관리자
  authOverlay: document.querySelector("#authOverlay"),
  authHeading: document.querySelector("#authHeading"),
  authTabLogin: document.querySelector("#authTabLogin"),
  authTabRegister: document.querySelector("#authTabRegister"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  registerForm: document.querySelector("#registerForm"),
  registerUsername: document.querySelector("#registerUsername"),
  registerDisplayName: document.querySelector("#registerDisplayName"),
  registerPassword: document.querySelector("#registerPassword"),
  registerPassword2: document.querySelector("#registerPassword2"),
  registerEmail: document.querySelector("#registerEmail"),
  registerAvatar: document.querySelector("#registerAvatar"),
  registerAvatarPreview: document.querySelector("#registerAvatarPreview"),
  authMessage: document.querySelector("#authMessage"),
  profileChipButton: document.querySelector("#profileChipButton"),
  profileChipAvatar: document.querySelector("#profileChipAvatar"),
  profileChipName: document.querySelector("#profileChipName"),
  profileChipCode: document.querySelector("#profileChipCode"),
  accountSection: document.querySelector("#accountSection"),
  accountAvatar: document.querySelector("#accountAvatar"),
  accountName: document.querySelector("#accountName"),
  accountCode: document.querySelector("#accountCode"),
  accountDisplayNameInput: document.querySelector("#accountDisplayNameInput"),
  accountEmailInput: document.querySelector("#accountEmailInput"),
  accountAvatarInput: document.querySelector("#accountAvatarInput"),
  saveProfileButton: document.querySelector("#saveProfileButton"),
  currentPasswordInput: document.querySelector("#currentPasswordInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  logoutButton: document.querySelector("#logoutButton"),
  accountMessage: document.querySelector("#accountMessage"),
  adminPanelButton: document.querySelector("#adminPanelButton"),
  adminModal: document.querySelector("#adminModal"),
  adminCloseButton: document.querySelector("#adminCloseButton"),
  adminUiToggle: document.querySelector("#adminUiToggle"),
  adminUiToggleRow: document.querySelector("#adminUiToggleRow"),
  codePromptModal: document.querySelector("#codePromptModal"),
  codePromptCancel: document.querySelector("#codePromptCancel"),
  codePromptSubtitle: document.querySelector("#codePromptSubtitle"),
  codePromptInput: document.querySelector("#codePromptInput"),
  codePromptMessage: document.querySelector("#codePromptMessage"),
  codePromptConfirm: document.querySelector("#codePromptConfirm"),
  adminSearchInput: document.querySelector("#adminSearchInput"),
  adminRefreshButton: document.querySelector("#adminRefreshButton"),
  adminUserList: document.querySelector("#adminUserList"),
  adminMessage: document.querySelector("#adminMessage"),
};

init().catch((error) => {
  setStatus("오류", "bad");
  recordClientError("init-failed", error.message || String(error));
  setMessage(error.message || "초기화에 실패했습니다.");
});

async function init() {
  dom.nameInput.value = localStorage.getItem("voiceChatName") || makeDefaultName();
  dom.launcherButton.hidden = !desktop.isDesktop;
  restoreLoopbackEchoReductionSetting();
  restoreSystemCaptureModeSetting();
  restoreScreenShareSettings();
  state.outputSink.supported = supportsOutputSinkSelection();
  bindEvents();
  bindClientDiagnostics();
  bindScreenTestDiagnostics();
  applyMicGainLabel();
  applyNoiseGateLabel();
  applyRemoteVolumes();
  updateSystemAudioAvailability();
  updateControls();
  renderProgramAudioSources();
  renderChannels();
  renderParticipants();
  await refreshDevices();
  refreshProgramAudioSources({ silent: true });
  await connect();
}

function bindEvents() {
  dom.launcherButton.addEventListener("click", () => desktop.backToLauncher?.());
  dom.settingsButton?.addEventListener("click", () => toggleSettingsModal(true));
  dom.settingsCloseButton?.addEventListener("click", () => toggleSettingsModal(false));
  dom.settingsModal?.addEventListener("click", (event) => {
    if (event.target === dom.settingsModal) toggleSettingsModal(false);
  });
  document.addEventListener("keydown", handleGlobalHotkeys);
  dom.refreshDevicesButton.addEventListener("click", () => refreshDevices());
  dom.leaveButton.addEventListener("click", () => leaveRoom("방에서 나갔습니다."));
  dom.muteButton.addEventListener("click", toggleMute);
  dom.repairAudioButton.addEventListener("click", repairAudio);
  dom.copyDiagnosticsButton?.addEventListener("click", copyDiagnostics);
  dom.copyLogButton?.addEventListener("click", copyClientLogs);
  dom.clearLogButton?.addEventListener("click", clearClientLogs);
  dom.screenShareButton.addEventListener("click", toggleScreenShare);
  dom.screenViewerCloseButton.addEventListener("click", () => {
    closeScreenViewer();
  });
  dom.screenFitButton.addEventListener("click", toggleScreenFitMode);
  dom.screenFullscreenButton.addEventListener("click", enterScreenFullscreen);
  dom.screenStage.addEventListener("mousemove", revealScreenControls);
  dom.screenStage.addEventListener("pointermove", revealScreenControls);
  dom.screenStage.addEventListener("touchstart", revealScreenControls, { passive: true });
  document.addEventListener("fullscreenchange", () => {
    updateScreenFullscreenButton();
    revealScreenControls();
  });

  bindAuthEvents();
  bindChannelEvents();
  bindChatEvents();
  bindMemoEvents();

  dom.inputDeviceSelect.addEventListener("change", () => {
    resetEchoProbe();
    localStorage.setItem("voiceChatInputDeviceId", dom.inputDeviceSelect.value);
    applyAudioSettings({ restartMic: true });
  });
  dom.outputDeviceSelect.addEventListener("change", async () => {
    resetEchoProbe();
    localStorage.setItem("voiceChatOutputDeviceId", dom.outputDeviceSelect.value);
    if (state.systemSharing || dom.systemAudioToggle.checked) {
      await selectSafeOutputDeviceForSystemShare();
      if (state.systemSharing) await restartSystemAudio();
    } else {
      await applyOutputDevice();
    }
    applyRemoteVolumes();
    updateTrackStats();
  });
  dom.systemInputDeviceSelect.addEventListener("change", () => {
    resetEchoProbe();
    localStorage.setItem("voiceChatSystemInputDeviceId", dom.systemInputDeviceSelect.value);
    if (state.currentRoom && state.systemSharing && isVirtualSystemAudioSupported()) restartSystemAudio();
  });
  dom.micGainInput.addEventListener("input", applyMicGainLabel);
  dom.micGainInput.addEventListener("change", () => applyAudioSettings({ restartMic: true }));
  dom.noiseGateInput.addEventListener("input", applyNoiseGateLabel);
  dom.noiseGateInput.addEventListener("change", () => applyAudioSettings({ restartMic: true }));
  dom.testAudioButton.addEventListener("click", testAudioSettings);
  dom.remoteMicVolumeInput?.addEventListener("input", applyRemoteVolumes);
  dom.remoteSystemVolumeInput?.addEventListener("input", applyRemoteVolumes);
  dom.participantList.addEventListener("input", (event) => {
    const input = event.target;
    if (!input?.matches?.("input[data-peer-volume-role]")) return;
    updatePeerVolumeFromInput(input);
  });
  dom.participantList.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-screen-peer-id]");
    if (!button) return;
    state.selectedScreenPeerId = button.dataset.screenPeerId || "";
    renderScreenStage();
    renderParticipants();
  });
  dom.screenShareList.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-screen-peer-id]");
    if (!button) return;
    state.selectedScreenPeerId = button.dataset.screenPeerId || "";
    renderScreenStage();
    renderParticipants();
  });
  dom.systemAudioToggle.addEventListener("change", () => {
    resetEchoProbe();
    handleSystemAudioToggle();
  });
  dom.screenResolutionSelect.addEventListener("change", () => {
    state.screenResolution = dom.screenResolutionSelect.value || "1080";
    localStorage.setItem("voiceChatScreenResolution", state.screenResolution);
    if (state.screenSharing) restartScreenShare();
  });
  dom.screenFpsSelect.addEventListener("change", () => {
    state.screenFps = dom.screenFpsSelect.value || "30";
    localStorage.setItem("voiceChatScreenFps", state.screenFps);
    if (state.screenSharing) restartScreenShare();
  });
  dom.screenCaptureModeSelect?.addEventListener("change", () => {
    state.screenCaptureMode = dom.screenCaptureModeSelect.value || "auto";
    localStorage.setItem("voiceChatScreenCaptureMode", state.screenCaptureMode);
    logClientEvent("screen-capture-mode", state.screenCaptureMode);
    if (state.screenSharing) restartScreenShare();
  });
  dom.screenPreviewToggle?.addEventListener("change", () => {
    state.screenPreviewEnabled = Boolean(dom.screenPreviewToggle.checked);
    localStorage.setItem("voiceChatScreenPreview", state.screenPreviewEnabled ? "on" : "off");
    if (!state.screenPreviewEnabled && state.selectedScreenPeerId === "local") state.selectedScreenPeerId = "";
    if (state.screenPreviewEnabled && state.screenSharing && !state.selectedScreenPeerId) state.selectedScreenPeerId = "local";
    logClientEvent("screen-preview-toggle", getScreenPreviewDebugText());
    renderScreenStage();
    state.screenStats.capture = getScreenCaptureStatsText();
    updateScreenStatsLabel();
  });
  dom.screenProbeToggle?.addEventListener("change", () => {
    state.screenProbeEnabled = Boolean(dom.screenProbeToggle.checked);
    localStorage.setItem("voiceChatScreenProbe", state.screenProbeEnabled ? "on" : "off");
    logClientEvent("screen-probe-toggle", getScreenProbeDebugText());
    if (state.screenSharing && state.screenTrack?.readyState === "live") startScreenCaptureProbe(state.screenTrack);
    else stopScreenCaptureProbe();
    state.screenStats.capture = getScreenCaptureStatsText();
    updateScreenStatsLabel();
  });
  dom.openScreenTestButton?.addEventListener("click", openMinimalScreenTest);
  dom.systemCaptureFullRadio?.addEventListener("change", () => setSystemCaptureMode("full"));
  dom.systemCaptureProgramRadio?.addEventListener("change", () => setSystemCaptureMode("program"));
  dom.programAudioSearchInput?.addEventListener("input", () => renderProgramAudioSources());
  dom.refreshProgramAudioButton?.addEventListener("click", () => refreshProgramAudioSources());
  dom.programAudioList?.addEventListener("change", (event) => {
    const input = event.target;
    if (!input?.matches?.("input[data-program-audio-pid]")) return;
    const pid = Number(input.dataset.programAudioPid);
    if (!Number.isInteger(pid)) return;
    if (input.checked) state.selectedProgramAudioPids.add(pid);
    else state.selectedProgramAudioPids.delete(pid);
    saveProgramAudioSelection();
    renderProgramAudioSources();
    if (state.systemSharing && isProgramSystemAudioMode()) restartSystemAudio();
  });
  dom.loopbackEchoReductionToggle.addEventListener("change", () => {
    resetEchoProbe();
    localStorage.setItem("voiceChatLoopbackEchoReduction", dom.loopbackEchoReductionToggle.checked ? "1" : "0");
    if (state.systemSharing) restartSystemAudio();
    updateSetupStatus();
  });

  for (const toggle of [
    dom.noiseSuppressionToggle,
    dom.echoCancellationToggle,
    dom.autoGainToggle,
    dom.lowLatencyToggle,
    dom.highQualityToggle,
  ]) {
    toggle.addEventListener("change", () => {
      resetEchoProbe();
      applyAudioSettings({
        restartMic: true,
        renegotiate: toggle === dom.lowLatencyToggle || toggle === dom.highQualityToggle,
      });
    });
  }
}

function restoreLoopbackEchoReductionSetting() {
  dom.loopbackEchoReductionToggle.checked = false;
  localStorage.setItem("voiceChatLoopbackEchoReduction", "0");
}

function restoreSystemCaptureModeSetting() {
  if (dom.systemCaptureFullRadio) dom.systemCaptureFullRadio.checked = state.systemCaptureMode !== "program";
  if (dom.systemCaptureProgramRadio) dom.systemCaptureProgramRadio.checked = state.systemCaptureMode === "program";
}

function restoreScreenShareSettings() {
  if (dom.screenResolutionSelect) dom.screenResolutionSelect.value = ["720", "1080", "1440", "2160", "native"].includes(state.screenResolution) ? state.screenResolution : "1080";
  if (dom.screenFpsSelect) dom.screenFpsSelect.value = ["15", "30", "60"].includes(state.screenFps) ? state.screenFps : "30";
  if (dom.screenCaptureModeField) dom.screenCaptureModeField.hidden = !isElectronDesktopScreenCaptureSupported();
  if (dom.screenCaptureModeSelect) dom.screenCaptureModeSelect.value = ["auto", "handler", "browser", "electron"].includes(state.screenCaptureMode) ? state.screenCaptureMode : "auto";
  if (dom.screenPreviewToggle) dom.screenPreviewToggle.checked = state.screenPreviewEnabled;
  if (dom.screenProbeToggle) dom.screenProbeToggle.checked = state.screenProbeEnabled;
  state.screenResolution = dom.screenResolutionSelect?.value || "1080";
  state.screenFps = dom.screenFpsSelect?.value || "30";
  state.screenCaptureMode = isElectronDesktopScreenCaptureSupported() ? (dom.screenCaptureModeSelect?.value || "auto") : "browser";
  state.screenPreviewEnabled = dom.screenPreviewToggle ? Boolean(dom.screenPreviewToggle.checked) : state.screenPreviewEnabled;
  state.screenProbeEnabled = dom.screenProbeToggle ? Boolean(dom.screenProbeToggle.checked) : state.screenProbeEnabled;
  applyScreenFitMode();
}

function setSystemCaptureMode(mode) {
  const nextMode = mode === "program" && isProgramSystemAudioSupported() ? "program" : "full";
  if (state.systemCaptureMode === nextMode) {
    restoreSystemCaptureModeSetting();
    return;
  }

  state.systemCaptureMode = nextMode;
  localStorage.setItem("voiceChatSystemCaptureMode", nextMode);
  restoreSystemCaptureModeSetting();
  updateSystemAudioAvailability();
  updateTrackStats();
  if (nextMode === "program") refreshProgramAudioSources({ silent: true });
  if (state.systemSharing) restartSystemAudio();
}

async function connect() {
  setStatus("연결 중", "idle");
  setMessage("");
  state.config = await fetchJson(`${serverUrl}/config`);
  dom.versionLabel.textContent = `Accord ${state.config.version || ""}`.trim();
  updateSecurityStatus();
  await openSocket();
  attemptAuthResume();
  logClientEvent("client-env", getClientEnvironmentSummary());
  logClientEvent("ice-server-config", getIceServerSummary());
  if (!hasTurnServer()) logClientEvent("turn-missing", "No TURN server configured; symmetric NAT or VM networks may fail.");
  setStatus("서버 연결", "good");
  updateControls();
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/signal";
    url.search = "";

    state.socket = new WebSocket(url.toString());
    const failTimer = window.setTimeout(() => reject(new Error("시그널링 서버에 연결하지 못했습니다.")), 6000);

    state.socket.addEventListener("open", () => {
      window.clearTimeout(failTimer);
      logClientEvent("websocket-open", url.toString());
      resolve();
    });

    state.socket.addEventListener("message", (event) => {
      handleSocketMessage(JSON.parse(event.data)).catch((error) => {
        logClientEvent("socket-message-error", error.message || String(error));
        recordClientError("socket-message-error", error.message || String(error));
        setStatus("오류", "bad");
        setMessage(error.message || "연결 처리 중 오류가 발생했습니다.");
      });
    });

    state.socket.addEventListener("close", () => {
      logClientEvent("socket-close", "server connection closed");
      recordClientError("socket-close", "서버 WebSocket 연결이 닫혔습니다.");
      setStatus("서버 끊김", "bad");
      setMessage("서버와 연결이 끊겼습니다.");
      resetRoomState();
      updateControls();
    });

    state.socket.addEventListener("error", () => {
      logClientEvent("socket-error", "websocket error");
      recordClientError("socket-error", `WebSocket 실패: ${url.toString()}`);
      reject(new Error("서버 연결을 확인해 주세요."));
    });
  });
}

// ===== 계정 · 인증 · 관리자 =====

function bindAuthEvents() {
  dom.authTabLogin?.addEventListener("click", () => setAuthTab("login"));
  dom.authTabRegister?.addEventListener("click", () => setAuthTab("register"));
  dom.loginForm?.addEventListener("submit", submitLogin);
  dom.registerForm?.addEventListener("submit", submitRegister);
  dom.registerAvatar?.addEventListener("change", () => {
    const file = dom.registerAvatar.files?.[0];
    if (!file) return;
    openCropModal(file, (dataUrl) => {
      state.auth.pendingRegisterAvatar = dataUrl;
      setAvatar(dom.registerAvatarPreview, { avatar: dataUrl, displayName: dom.registerDisplayName.value });
    });
    dom.registerAvatar.value = "";
  });

  dom.profileChipButton?.addEventListener("click", () => toggleSettingsModal(true));
  dom.saveProfileButton?.addEventListener("click", saveProfile);
  dom.changePasswordButton?.addEventListener("click", changePassword);
  dom.logoutButton?.addEventListener("click", logout);
  dom.accountAvatarInput?.addEventListener("change", () => {
    const file = dom.accountAvatarInput.files?.[0];
    if (!file) return;
    openCropModal(file, (dataUrl) => {
      state.auth.pendingProfileAvatar = dataUrl;
      setAvatar(dom.accountAvatar, { avatar: dataUrl, displayName: dom.accountDisplayNameInput.value });
      setAccountMessage("저장을 누르면 프로필 이미지가 적용됩니다.", true);
    });
    dom.accountAvatarInput.value = "";
  });

  dom.adminPanelButton?.addEventListener("click", () => toggleAdminModal(true));
  dom.adminCloseButton?.addEventListener("click", () => toggleAdminModal(false));
  dom.adminModal?.addEventListener("click", (event) => {
    if (event.target === dom.adminModal) toggleAdminModal(false);
  });
  dom.adminRefreshButton?.addEventListener("click", () => sendSocket({ type: "admin:list-users" }));
  dom.adminSearchInput?.addEventListener("input", renderAdminUsers);
  dom.adminUiToggle?.addEventListener("change", () => {
    state.auth.adminUiEnabled = Boolean(dom.adminUiToggle.checked);
    localStorage.setItem("accordAdminUiEnabled", state.auth.adminUiEnabled ? "on" : "off");
    applyAdminVisibility();
  });
  dom.adminUserList?.addEventListener("click", handleAdminListClick);

  dom.codePromptCancel?.addEventListener("click", closeCodePrompt);
  dom.codePromptConfirm?.addEventListener("click", confirmCodePrompt);
  dom.codePromptModal?.addEventListener("click", (event) => {
    if (event.target === dom.codePromptModal) closeCodePrompt();
  });
  dom.codePromptInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmCodePrompt();
    }
  });
}

function attemptAuthResume() {
  if (state.auth.token) {
    sendSocket({ type: "auth-token", token: state.auth.token });
  } else {
    showAuthOverlay();
  }
}

function handleAuthSocketMessage(message) {
  switch (message.type) {
    case "auth-ok":
      onAuthOk(message);
      return true;
    case "auth-error":
      onAuthError(message);
      return true;
    case "auth-expired":
      state.auth.token = "";
      localStorage.removeItem("accordAuthToken");
      setAuthMessage("세션이 만료되었습니다. 다시 로그인해 주세요.");
      showAuthOverlay();
      return true;
    case "admin-users":
      state.adminUsers = message.users || [];
      state.adminOnline = message.online || [];
      if (state.codeChangePending) closeCodePrompt();
      renderAdminUsers();
      return true;
    case "admin-error":
      if (state.codeChangePending) {
        // 코드 변경 모달이 열려 있으면 그 안에 오류를 표시하고 유지한다.
        state.codeChangePending = false;
        if (dom.codePromptMessage) {
          dom.codePromptMessage.textContent = message.message || "코드를 변경하지 못했습니다.";
          dom.codePromptMessage.classList.remove("ok");
        }
      } else {
        setAdminMessage(message.message || "관리자 작업에 실패했습니다.");
      }
      return true;
    case "account-updated":
      // 관리자가 내 권한/코드를 바꾼 경우 즉시 반영(재접속 불필요).
      state.auth.user = message.user;
      applyAuthedUser(message.user);
      return true;
    default:
      return false;
  }
}

function onAuthOk(message) {
  if (message.action === "change-password") {
    setAccountMessage("비밀번호가 변경되었습니다.", true);
    if (dom.currentPasswordInput) dom.currentPasswordInput.value = "";
    if (dom.newPasswordInput) dom.newPasswordInput.value = "";
    return;
  }
  if (message.action === "update-profile") {
    state.auth.user = message.user;
    state.auth.pendingProfileAvatar = undefined;
    applyAuthedUser(message.user);
    setAccountMessage("프로필이 저장되었습니다.", true);
    return;
  }
  // login / register / resume
  if (message.token) {
    state.auth.token = message.token;
    localStorage.setItem("accordAuthToken", message.token);
  }
  state.auth.user = message.user;
  state.auth.authed = true;
  applyAuthedUser(message.user);
  hideAuthOverlay();
  setStatus("서버 연결", "good");
  updateControls();
  // 로그인 시점 채널 목록 요청(서버가 auth-ok 직후 자동으로도 보내지만 안전하게 한 번 더).
  sendSocket({ type: "channel:list" });
}

function onAuthError(message) {
  const text = message.message || "요청을 처리하지 못했습니다.";
  if (message.action === "change-password" || message.action === "update-profile") {
    setAccountMessage(text);
  } else {
    setAuthMessage(text);
  }
}

function applyAuthedUser(user) {
  if (!user) return;
  dom.nameInput.value = user.displayName || "";
  localStorage.setItem("voiceChatName", user.displayName || "");
  // 프로필 칩
  if (dom.profileChipButton) dom.profileChipButton.hidden = false;
  if (dom.profileChipName) dom.profileChipName.textContent = user.displayName || "-";
  if (dom.profileChipCode) dom.profileChipCode.textContent = `#${user.code || "----"}`;
  setAvatar(dom.profileChipAvatar, user);
  // 계정 설정 섹션
  if (dom.accountName) dom.accountName.textContent = user.displayName || "-";
  if (dom.accountCode) dom.accountCode.textContent = `#${user.code || "----"}`;
  if (dom.accountDisplayNameInput) dom.accountDisplayNameInput.value = user.displayName || "";
  if (dom.accountEmailInput) dom.accountEmailInput.value = user.email || "";
  setAvatar(dom.accountAvatar, user);
  // 관리자 UI
  applyAdminVisibility();
  renderParticipants();
}

function applyAdminVisibility() {
  const isAdmin = Boolean(state.auth.user?.isAdmin);
  const show = isAdmin && state.auth.adminUiEnabled;
  if (dom.adminPanelButton) dom.adminPanelButton.hidden = !show;
  if (dom.adminUiToggle) dom.adminUiToggle.checked = state.auth.adminUiEnabled;
  // 관리자 UI 토글은 설정창(항상 접근 가능)에 있고, 관리자에게만 보인다.
  if (dom.adminUiToggleRow) dom.adminUiToggleRow.hidden = !isAdmin;
  // 관리자가 아니게 되면 열려 있던 관리자 창을 닫는다.
  if (!isAdmin && dom.adminModal && !dom.adminModal.hidden) toggleAdminModal(false);
}

function submitLogin(event) {
  event.preventDefault();
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;
  if (!username || !password) {
    setAuthMessage("아이디와 비밀번호를 입력해 주세요.");
    return;
  }
  setAuthMessage("로그인 중...", true);
  sendSocket({ type: "login", username, password });
}

function submitRegister(event) {
  event.preventDefault();
  const username = dom.registerUsername.value.trim();
  const displayName = dom.registerDisplayName.value.trim() || username;
  const password = dom.registerPassword.value;
  const password2 = dom.registerPassword2.value;
  const email = dom.registerEmail.value.trim();
  if (!username || !password) {
    setAuthMessage("아이디와 비밀번호를 입력해 주세요.");
    return;
  }
  if (password !== password2) {
    setAuthMessage("비밀번호가 일치하지 않습니다.");
    return;
  }
  setAuthMessage("가입 중...", true);
  sendSocket({
    type: "register",
    username,
    displayName,
    password,
    email,
    avatar: state.auth.pendingRegisterAvatar || "",
  });
}

function saveProfile() {
  if (!state.auth.authed) return;
  const payload = {
    type: "update-profile",
    displayName: dom.accountDisplayNameInput.value.trim(),
    email: dom.accountEmailInput.value.trim(),
  };
  if (state.auth.pendingProfileAvatar !== undefined) payload.avatar = state.auth.pendingProfileAvatar;
  setAccountMessage("저장 중...", true);
  sendSocket(payload);
}

function changePassword() {
  if (!state.auth.authed) return;
  const oldPassword = dom.currentPasswordInput.value;
  const newPassword = dom.newPasswordInput.value;
  if (!oldPassword || !newPassword) {
    setAccountMessage("현재/새 비밀번호를 입력해 주세요.");
    return;
  }
  setAccountMessage("변경 중...", true);
  sendSocket({ type: "change-password", oldPassword, newPassword });
}

function logout() {
  sendSocket({ type: "logout", token: state.auth.token });
  state.auth.token = "";
  state.auth.user = null;
  state.auth.authed = false;
  localStorage.removeItem("accordAuthToken");
  if (dom.profileChipButton) dom.profileChipButton.hidden = true;
  if (dom.adminPanelButton) dom.adminPanelButton.hidden = true;
  toggleSettingsModal(false);
  toggleAdminModal(false);
  if (state.currentRoom) leaveRoom("로그아웃했습니다.");
  // 채널/멤버 화면을 비워 다음 로그인 전까지 이전 계정 정보가 남지 않게 한다.
  state.channels = [];
  state.currentChannelId = "";
  state.presence = {};
  state.online = [];
  renderChannels();
  showAuthOverlay();
  setAuthMessage("로그아웃되었습니다.", true);
}

function setAuthTab(tab) {
  const login = tab !== "register";
  dom.authTabLogin?.classList.toggle("active", login);
  dom.authTabRegister?.classList.toggle("active", !login);
  if (dom.loginForm) dom.loginForm.hidden = !login;
  if (dom.registerForm) dom.registerForm.hidden = login;
  if (dom.authHeading) dom.authHeading.textContent = login ? "로그인" : "회원가입";
  setAuthMessage("");
}

function showAuthOverlay() {
  if (dom.authOverlay) dom.authOverlay.hidden = false;
}

function hideAuthOverlay() {
  if (dom.authOverlay) dom.authOverlay.hidden = true;
  setAuthMessage("");
}

function setAuthMessage(text, ok = false) {
  if (!dom.authMessage) return;
  dom.authMessage.textContent = text || "";
  dom.authMessage.classList.toggle("ok", Boolean(ok));
}

function setAccountMessage(text, ok = false) {
  if (!dom.accountMessage) return;
  dom.accountMessage.textContent = text || "";
  dom.accountMessage.classList.toggle("ok", Boolean(ok));
}

function setAdminMessage(text, ok = false) {
  if (!dom.adminMessage) return;
  dom.adminMessage.textContent = text || "";
  dom.adminMessage.classList.toggle("ok", Boolean(ok));
}

function toggleAdminModal(show) {
  if (!dom.adminModal) return;
  const isAdmin = Boolean(state.auth.user?.isAdmin);
  if (show && !isAdmin) return;
  dom.adminModal.hidden = !show;
  if (show) {
    setAdminMessage("");
    sendSocket({ type: "admin:list-users" });
  }
}

function handleAdminListClick(event) {
  const button = event.target?.closest?.("button[data-admin-action]");
  if (!button) return;
  const userId = button.dataset.userId || "";
  const action = button.dataset.adminAction;
  if (action === "toggle-admin") {
    sendSocket({ type: "admin:set-admin", userId, value: button.dataset.value === "1" });
  } else if (action === "set-code") {
    const user = (state.adminUsers || []).find((u) => u.id === userId);
    openCodePrompt(userId, button.dataset.code || "", user);
  }
}

function openCodePrompt(userId, currentCode, user) {
  if (!dom.codePromptModal) return;
  state.adminCodeTarget = userId;
  state.codeChangePending = false;
  const label = user ? `${user.displayName || user.username} (@${user.username})` : "";
  if (dom.codePromptSubtitle) dom.codePromptSubtitle.textContent = `${label} · 현재 #${currentCode}`;
  if (dom.codePromptInput) dom.codePromptInput.value = currentCode;
  if (dom.codePromptMessage) {
    dom.codePromptMessage.textContent = "";
    dom.codePromptMessage.classList.remove("ok");
  }
  dom.codePromptModal.hidden = false;
  dom.codePromptInput?.focus();
  dom.codePromptInput?.select();
}

function closeCodePrompt() {
  if (dom.codePromptModal) dom.codePromptModal.hidden = true;
  state.adminCodeTarget = "";
  state.codeChangePending = false;
}

function confirmCodePrompt() {
  const code = (dom.codePromptInput?.value || "").trim().toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(code)) {
    if (dom.codePromptMessage) {
      dom.codePromptMessage.textContent = "코드는 영문/숫자 4자여야 합니다.";
      dom.codePromptMessage.classList.remove("ok");
    }
    return;
  }
  state.codeChangePending = true;
  if (dom.codePromptMessage) {
    dom.codePromptMessage.textContent = "변경 중...";
    dom.codePromptMessage.classList.add("ok");
  }
  sendSocket({ type: "admin:set-code", userId: state.adminCodeTarget, code });
}

function renderAdminUsers() {
  if (!dom.adminUserList) return;
  const query = (dom.adminSearchInput?.value || "").trim().toLowerCase();
  const online = new Set(state.adminOnline || []);
  const users = (state.adminUsers || []).filter((u) => {
    if (!query) return true;
    return (
      u.username.toLowerCase().includes(query) ||
      (u.displayName || "").toLowerCase().includes(query) ||
      (u.code || "").toLowerCase().includes(query)
    );
  });
  dom.adminUserList.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "유저가 없습니다.";
    dom.adminUserList.append(empty);
    return;
  }
  const selfId = state.auth.user?.id;
  for (const user of users) {
    dom.adminUserList.append(buildAdminUserRow(user, online.has(user.id), user.id === selfId));
  }
}

function buildAdminUserRow(user, isOnline, isSelf) {
  const row = document.createElement("div");
  row.className = "admin-user-row";

  const avatar = document.createElement("span");
  avatar.className = "account-avatar";
  setAvatar(avatar, user);

  const main = document.createElement("div");
  main.className = "admin-user-main";
  const nameLine = document.createElement("b");
  const dot = document.createElement("span");
  dot.className = `admin-online-dot${isOnline ? " online" : ""}`;
  nameLine.append(dot, document.createTextNode(user.displayName || user.username));
  if (user.isAdmin) {
    const badge = document.createElement("span");
    badge.className = "admin-badge";
    badge.textContent = "관리자";
    badge.style.marginLeft = "6px";
    nameLine.append(badge);
  }
  const codeLine = document.createElement("span");
  codeLine.className = "admin-user-code";
  codeLine.textContent = `@${user.username} · #${user.code}`;
  const metaLine = document.createElement("span");
  metaLine.className = "admin-user-meta";
  metaLine.textContent = `IP ${user.lastIp || "-"} · 최근접속 ${formatTimestamp(user.lastLoginAt)}`;
  main.append(nameLine, codeLine, metaLine);

  if (Array.isArray(user.connLog) && user.connLog.length) {
    const log = document.createElement("details");
    log.className = "admin-conn-log";
    const summary = document.createElement("summary");
    summary.textContent = `접속 로그 (${user.connLog.length})`;
    const pre = document.createElement("pre");
    pre.textContent = user.connLog
      .slice()
      .reverse()
      .map((e) => `${formatTimestamp(e.at)}  ${e.event}  ${e.ip || "-"}`)
      .join("\n");
    log.append(summary, pre);
    main.append(log);
  }

  const actions = document.createElement("div");
  actions.className = "admin-user-actions";
  const adminBtn = document.createElement("button");
  adminBtn.className = "secondary";
  adminBtn.dataset.adminAction = "toggle-admin";
  adminBtn.dataset.userId = user.id;
  adminBtn.dataset.value = user.isAdmin ? "0" : "1";
  adminBtn.textContent = user.isAdmin ? "관리자 해제" : "관리자 지정";
  if (isSelf) adminBtn.disabled = true;
  const codeBtn = document.createElement("button");
  codeBtn.className = "secondary";
  codeBtn.dataset.adminAction = "set-code";
  codeBtn.dataset.userId = user.id;
  codeBtn.dataset.code = user.code;
  codeBtn.textContent = "코드 변경";
  actions.append(adminBtn, codeBtn);

  row.append(avatar, main, actions);
  return row;
}

function setAvatar(el, user) {
  if (!el) return;
  const avatar = user?.avatar || "";
  if (avatar) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.display = "inline-flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.fontWeight = "700";
    el.style.color = "#fff";
    el.textContent = (user?.displayName || user?.username || "?").trim().charAt(0).toUpperCase();
  }
}

function formatTimestamp(ms) {
  if (!ms) return "-";
  try {
    return new Date(ms).toLocaleString("ko-KR", { hour12: false });
  } catch {
    return "-";
  }
}

function fileToDataUrl(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (maxBytes && file.size > maxBytes) {
      reject(new Error(`이미지가 너무 큽니다. ${Math.round(maxBytes / 1000)}KB 이하로 올려주세요.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

// ===== 이미지 크롭(정사각형) — 프로필/채널 아이콘 공용 =====
const cropState = { img: null, scale: 1, fitScale: 1, offX: 0, offY: 0, dragging: false, lastX: 0, lastY: 0, onDone: null };
const CROP_SIZE = 256;

function bindCropEvents() {
  const c = dom.cropCanvas;
  if (!c) return;
  c.addEventListener("pointerdown", (e) => {
    cropState.dragging = true;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    c.setPointerCapture?.(e.pointerId);
  });
  c.addEventListener("pointermove", (e) => {
    if (!cropState.dragging) return;
    const rect = c.getBoundingClientRect();
    const sx = CROP_SIZE / rect.width;
    cropState.offX += (e.clientX - cropState.lastX) * sx;
    cropState.offY += (e.clientY - cropState.lastY) * sx;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    clampCrop();
    renderCrop();
  });
  const stop = () => { cropState.dragging = false; };
  c.addEventListener("pointerup", stop);
  c.addEventListener("pointercancel", stop);
  dom.cropZoom?.addEventListener("input", () => {
    const zoom = Number(dom.cropZoom.value || 100) / 100;
    if (dom.cropZoomValue) dom.cropZoomValue.textContent = `${zoom.toFixed(1)}x`;
    const prev = cropState.scale;
    cropState.scale = cropState.fitScale * zoom;
    // 중심 기준으로 확대되도록 오프셋 보정
    const k = cropState.scale / prev;
    cropState.offX = CROP_SIZE / 2 - (CROP_SIZE / 2 - cropState.offX) * k;
    cropState.offY = CROP_SIZE / 2 - (CROP_SIZE / 2 - cropState.offY) * k;
    clampCrop();
    renderCrop();
  });
  dom.cropCancel?.addEventListener("click", () => { dom.cropModal.hidden = true; cropState.onDone = null; });
  dom.cropModal?.addEventListener("click", (e) => { if (e.target === dom.cropModal) { dom.cropModal.hidden = true; cropState.onDone = null; } });
  dom.cropApply?.addEventListener("click", () => {
    const url = dom.cropCanvas.toDataURL("image/jpeg", 0.85);
    const done = cropState.onDone;
    dom.cropModal.hidden = true;
    cropState.onDone = null;
    if (done) done(url);
  });
}

function openCropModal(file, onDone) {
  if (!file || !dom.cropModal) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      cropState.img = img;
      cropState.fitScale = CROP_SIZE / Math.min(img.width, img.height);
      cropState.scale = cropState.fitScale;
      cropState.offX = (CROP_SIZE - img.width * cropState.scale) / 2;
      cropState.offY = (CROP_SIZE - img.height * cropState.scale) / 2;
      cropState.onDone = onDone;
      if (dom.cropZoom) dom.cropZoom.value = "100";
      if (dom.cropZoomValue) dom.cropZoomValue.textContent = "1.0x";
      dom.cropModal.hidden = false;
      renderCrop();
    };
    img.onerror = () => setMessage("이미지를 불러오지 못했습니다.");
    img.src = String(reader.result || "");
  };
  reader.onerror = () => setMessage("이미지를 읽지 못했습니다.");
  reader.readAsDataURL(file);
}

function clampCrop() {
  if (!cropState.img) return;
  const w = cropState.img.width * cropState.scale;
  const h = cropState.img.height * cropState.scale;
  cropState.offX = Math.min(0, Math.max(CROP_SIZE - w, cropState.offX));
  cropState.offY = Math.min(0, Math.max(CROP_SIZE - h, cropState.offY));
}

function renderCrop() {
  const ctx = dom.cropCanvas?.getContext("2d");
  if (!ctx || !cropState.img) return;
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(
    cropState.img,
    cropState.offX,
    cropState.offY,
    cropState.img.width * cropState.scale,
    cropState.img.height * cropState.scale,
  );
}

function bindClientDiagnostics() {
  window.addEventListener("error", (event) => {
    recordClientError("window-error", event.message || "unknown error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordClientError("unhandled-rejection", event.reason?.message || String(event.reason || "unknown rejection"));
  });
}

function bindScreenTestDiagnostics() {
  if (!desktop.isDesktop || typeof desktop.onScreenTestLog !== "function") return;
  desktop.onScreenTestLog((payload) => {
    addClientLog("info", payload?.event || "minimal-screen-test-log", payload?.detail || "");
  });
}

async function openMinimalScreenTest() {
  if (!desktop.isDesktop || typeof desktop.openScreenTestWindow !== "function") {
    setMessage("최소 화면 테스트는 데스크톱 앱에서만 사용할 수 있습니다.");
    return;
  }
  try {
    logClientEvent("minimal-screen-test-request", [
      `electron=${desktop.electronVersion || "-"}`,
      `captureMode=separate-window`,
      `preview=not used`,
      `probe=not used`,
      `webRtc=not used`,
    ].join(" "));
    await desktop.openScreenTestWindow();
    setMessage("최소 화면 테스트 창을 열었습니다. 닫으려면 테스트 창에서 Esc를 누르세요.");
  } catch (error) {
    recordClientError("minimal-screen-test-open-failed", getErrorText(error));
    setMessage(error.message || "최소 화면 테스트를 열지 못했습니다.");
  }
}

async function handleSocketMessage(message) {
  if (handleAuthSocketMessage(message)) return;

  if (message.type === "hello") {
    state.clientId = message.id;
    return;
  }

  if (message.type === "channels") {
    state.channels = message.channels || [];
    reconcileCurrentChannel(message.selectId);
    renderChannels();
    verifyActiveChat();
    verifyActiveMemo();
    return;
  }

  if (message.type === "channel-selected") {
    state.currentChannelId = message.channelId || state.currentChannelId;
    renderChannels();
    closeChannelModal();
    return;
  }

  if (message.type === "channel-error") {
    setChannelModalMessage(message.message || "채널 작업에 실패했습니다.");
    setChannelMenuMessage(message.message || "채널 작업에 실패했습니다.");
    setRoomModalMessage(message.message || "방 작업에 실패했습니다.");
    return;
  }

  if (message.type === "chat:history") {
    if (state.activeChat?.roomId === message.roomId) {
      state.chatMessages = message.messages || [];
      renderChatMessages();
      scrollChatToBottom();
    }
    return;
  }

  if (message.type === "chat:message") {
    handleIncomingChat(message.message);
    return;
  }

  if (message.type === "chat:typing") {
    handleChatTyping(message);
    return;
  }

  if (message.type === "chat-error") {
    if (state.activeChat) setChatHint(message.message || "채팅 오류가 발생했습니다.");
    return;
  }

  if (message.type === "memo:state") {
    handleMemoState(message);
    return;
  }

  if (message.type === "memo:saved") {
    if (state.memo?.roomId === message.roomId && message.rev > state.memo.rev) {
      state.memo.rev = message.rev;
      // 내 저장이 더 최신이면, 쌓여 있던 원격 변경 알림은 낡은 것이므로 치운다.
      if (state.memo.remotePending && state.memo.remotePending.rev <= message.rev) {
        state.memo.remotePending = null;
        hideMemoRemoteNotice();
      }
    }
    setMemoStatus("저장됨", "ok");
    return;
  }

  if (message.type === "memo:changed") {
    handleMemoChanged(message);
    return;
  }

  if (message.type === "memo-error") {
    if (state.memo) setMemoStatus(message.message || "메모 오류", "bad");
    return;
  }

  if (message.type === "presence") {
    state.presence = message.rooms || {};
    state.online = message.online || [];
    renderRooms();
    renderMemberList();
    renderParticipants();
    return;
  }

  if (message.type === "joined") {
    state.clientId = message.id || state.clientId;
    state.currentRoom = message.room;
    logClientEvent("joined", `room=${message.room?.id || ""} peers=${(message.peers || []).length}`);
    setStatus("통화 중", "good");
    setMessage(`${message.room.name}에 들어왔습니다.`);
    renderCurrentRoom();
    renderParticipants();
    updateControls();
    startStatsTimer();
    startHealthTimer();
    for (const peer of message.peers || []) {
      await createOfferForPeer(peer);
    }
    return;
  }

  if (message.type === "peer-joined") {
    state.currentRoom = message.room || state.currentRoom;
    const peer = ensurePeer(message.peer.id, message.peer.name);
    logClientEvent("peer-joined", makePeerDebugDetail(peer));
    renderCurrentRoom();
    renderParticipants();
    setMessage(`${message.peer.name}님이 들어왔습니다.`);
    syncLocalSendersForPeer(peer, { forceOffer: false }).catch((error) => {
      logClientEvent("peer-joined-sync-error", error.message || String(error));
    });
    return;
  }

  if (message.type === "peer-left") {
    removePeer(message.peerId);
    state.currentRoom = message.room || state.currentRoom;
    renderCurrentRoom();
    renderParticipants();
    return;
  }

  if (message.type === "left") {
    resetRoomState();
    renderRooms();
    return;
  }

  if (message.type === "signal") {
    await handleSignal(message.from, message.fromName, message.data);
    return;
  }

  if (message.type === "error") {
    setStatus("오류", "bad");
    recordClientError("server-error", message.message || "unknown server error");
    setMessage(message.message || "서버 오류가 발생했습니다.");
    if (!state.currentRoom) stopLocalMedia();
  }
}

async function joinRoom(roomId) {
  if (state.currentRoom?.id === roomId) return;
  if (!await prepareForRoom()) return;
  sendSocket({ type: "join-room", roomId });
}

async function prepareForRoom() {
  leaveRoom("", false);
  try {
    state.callSessionId = makeSessionId();
    logClientEvent("call-session-start", state.callSessionId);
    ensureSecureAudioContext();
    await openLocalMedia();
    return true;
  } catch (error) {
    setStatus("마이크 실패", "bad");
    setMessage(describeMediaError(error));
    stopLocalMedia();
    return false;
  }
}

function ensureSecureAudioContext() {
  if (window.isSecureContext || isLocalHost(location.hostname)) return;
  throw new Error("HTTPS가 아니라서 마이크/오디오 처리 기능이 막힐 수 있습니다. 서버를 HTTPS로 열어 주세요.");
}

async function openLocalMedia() {
  stopLocalMedia();
  await ensureDeviceLabels();
  await refreshDevices();
  selectSafeInputDevice();
  if (dom.systemAudioToggle.checked && !await selectSafeOutputDeviceForSystemShare()) {
    throw new Error(getWindowsSystemShareOutputMessage());
  }
  assertSafeMacAudioRouting(Boolean(dom.systemAudioToggle.checked));
  await openMic();
  rebuildLocalStream();
  dom.localMonitor.srcObject = new MediaStream([state.rawMicTrack]);
  startLocalMeter();
  updateTrackStats();
  updateControls();
  warnIfVirtualInputBleeds();

  if (dom.systemAudioToggle.checked) {
    await startSystemAudioShare();
  }
}

async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("이 브라우저에서는 마이크를 사용할 수 없습니다. HTTPS 주소로 접속했는지 확인해 주세요.");
  }
  state.rawMicStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: getMicConstraints(),
  });

  state.rawMicTrack = state.rawMicStream.getAudioTracks()[0] || null;
  if (!state.rawMicTrack) throw new Error("마이크 트랙이 없습니다.");

  await enforceMicProcessingConstraints();
  state.rawMicTrack.contentHint = "speech";
  applyMicTrackEnabled();
  state.rawMicTrack.addEventListener("ended", () => scheduleMicRestart("마이크 연결이 끊겨 다시 여는 중입니다."));
  state.micTrack = await createSendMicTrack();
  applyMicTrackEnabled();
}

function getSpeechProcessingConstraints(echo, noise, autoGain) {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const constraints = {
    echoCancellation: echo,
    noiseSuppression: noise,
    autoGainControl: autoGain,
  };
  if (supported.voiceIsolation) constraints.voiceIsolation = noise;
  return constraints;
}

function getLegacyWebRtcProcessingConstraints(echo, noise, autoGain) {
  return {
    googEchoCancellation: echo,
    googEchoCancellation2: echo,
    googDAEchoCancellation: echo,
    googNoiseSuppression: noise,
    googNoiseSuppression2: noise,
    googAutoGainControl: autoGain,
    googAutoGainControl2: autoGain,
    googHighpassFilter: noise,
    googTypingNoiseDetection: noise,
  };
}

function getAudioProcessingAdvancedConstraints(echo, noise, autoGain) {
  return [
    getSpeechProcessingConstraints(echo, noise, autoGain),
    getLegacyWebRtcProcessingConstraints(echo, noise, autoGain),
  ];
}

function getMicConstraints() {
  const deviceId = dom.inputDeviceSelect.value;
  const echo = dom.echoCancellationToggle.checked;
  const noise = shouldUseNativeNoiseSuppression();
  const autoGain = dom.autoGainToggle.checked;
  const constraints = {
    ...getSpeechProcessingConstraints(echo, noise, autoGain),
    ...getLegacyWebRtcProcessingConstraints(echo, noise, autoGain),
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    latency: { ideal: dom.lowLatencyToggle.checked ? 0.01 : 0.02 },
    channelCount: { ideal: dom.highQualityToggle.checked && !echo ? 2 : 1 },
    advanced: getAudioProcessingAdvancedConstraints(echo, noise, autoGain),
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}

async function enforceMicProcessingConstraints() {
  if (!state.rawMicTrack?.applyConstraints) return;
  const echo = dom.echoCancellationToggle.checked;
  const noise = shouldUseNativeNoiseSuppression();
  const autoGain = dom.autoGainToggle.checked;
  const constraints = {
    ...getSpeechProcessingConstraints(echo, noise, autoGain),
    ...getLegacyWebRtcProcessingConstraints(echo, noise, autoGain),
    latency: { ideal: dom.lowLatencyToggle.checked ? 0.01 : 0.02 },
    sampleRate: { ideal: 48000 },
    advanced: getAudioProcessingAdvancedConstraints(echo, noise, autoGain),
  };
  await state.rawMicTrack.applyConstraints(constraints).catch(() => {});
}

async function createSendMicTrack() {
  closeMicProcess();
  const gain = getMicGain();
  const fallback = getMicFallbackProcessing(state.rawMicTrack?.getSettings?.() || {});
  if (!fallback.enabled) return state.rawMicTrack;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return state.rawMicTrack;

  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
  const source = context.createMediaStreamSource(new MediaStream([state.rawMicTrack]));
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const gainNode = context.createGain();
  const destination = context.createMediaStreamDestination();

  highpass.type = "highpass";
  highpass.frequency.value = 85;
  highpass.Q.value = 0.7;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 12000;
  lowpass.Q.value = 0.7;
  gainNode.gain.value = gain;

  source.connect(highpass);
  highpass.connect(lowpass);
  let tail = lowpass;
  const nodes = [source, highpass, lowpass];

  const gateNode = fallback.noiseGate ? await createNoiseGateNode(context) : null;
  if (gateNode) {
    tail.connect(gateNode);
    tail = gateNode;
    nodes.push(gateNode);
  }

  const compressor = fallback.compressor ? context.createDynamicsCompressor() : null;
  if (compressor) {
    compressor.threshold.value = -34;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    tail.connect(compressor);
    tail = compressor;
    nodes.push(compressor);
  }

  const bleedSuppressorNode = fallback.bleedSuppressor ? context.createGain() : null;
  if (bleedSuppressorNode) {
    bleedSuppressorNode.gain.value = 1;
    tail.connect(bleedSuppressorNode);
    tail = bleedSuppressorNode;
    nodes.push(bleedSuppressorNode);
  }

  tail.connect(gainNode);
  gainNode.connect(destination);
  nodes.push(gainNode, destination);
  context.resume().catch(() => {});

  state.micProcess = { context, nodes, source, gainNode, destination, gateNode, compressor, bleedSuppressorNode };
  updateSystemBleedSuppressor();
  const track = destination.stream.getAudioTracks()[0];
  track.contentHint = "speech";
  return track;
}

function getMicFallbackProcessing(settings = {}) {
  const manualGain = Math.abs(getMicGain() - 1) >= 0.001;
  const nativeNoise = settings.noiseSuppression === true;
  const nativeGain = settings.autoGainControl === true;
  const noiseGate = dom.noiseSuppressionToggle.checked && getNoiseGateStrength() > 0 && !nativeNoise;
  const compressor = dom.autoGainToggle.checked && settings.autoGainControl === false;
  const bleedSuppressor = shouldUseSystemBleedSuppressor();

  return {
    enabled: manualGain || noiseGate || compressor || bleedSuppressor,
    noiseGate,
    compressor,
    bleedSuppressor,
    nativeNoise,
    nativeGain,
  };
}

function shouldUseSystemBleedSuppressor() {
  return false;
}

async function createNoiseGateNode(context) {
  const workletNode = await createAudioWorkletNoiseGateNode(context);
  if (workletNode) return workletNode;
  return createScriptNoiseGateNode(context);
}

async function createAudioWorkletNoiseGateNode(context) {
  if (!context.audioWorklet || !window.AudioWorkletNode) return null;

  try {
    await context.audioWorklet.addModule("noise-gate-worklet.js");
    return new AudioWorkletNode(context, "voice-noise-gate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: getNoiseGateSettings(),
    });
  } catch {
    return null;
  }
}

function createScriptNoiseGateNode(context) {
  if (!context.createScriptProcessor) return null;

  const node = context.createScriptProcessor(256, 1, 1);
  const settings = getNoiseGateSettings();
  let noiseFloor = settings.noiseFloor;
  let gateGain = 1;

  node.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    let sum = 0;
    for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index];

    const rms = Math.sqrt(sum / input.length);
    if (rms < noiseFloor * settings.noiseAdaptRatio) {
      noiseFloor = Math.min(settings.maxNoiseFloor, Math.max(settings.minNoiseFloor, noiseFloor * 0.985 + rms * 0.015));
    }

    const threshold = Math.max(settings.minThreshold, noiseFloor * settings.thresholdScale);
    const openThreshold = threshold * settings.openScale;
    const target = rms < threshold ? settings.closedGain : rms < openThreshold ? settings.holdGain : 1;
    gateGain += (target - gateGain) * (target > gateGain ? settings.attack : settings.release);

    for (let index = 0; index < input.length; index += 1) {
      output[index] = input[index] * gateGain;
    }
  };

  return node;
}

async function replaceMicTrack({ renegotiate = true } = {}) {
  stopMicOnly();
  selectSafeInputDevice();
  if ((state.systemSharing || dom.systemAudioToggle.checked) && !await selectSafeOutputDeviceForSystemShare()) {
    throw new Error(getWindowsSystemShareOutputMessage());
  }
  assertSafeMacAudioRouting(state.systemSharing);
  await openMic();
  rebuildLocalStream();
  dom.localMonitor.srcObject = new MediaStream([state.rawMicTrack]);

  let needsRenegotiate = false;
  for (const peer of state.peers.values()) {
    if (!peer.senders.mic || !peer.localStreams.mic) {
      if (peer.senders.mic) peer.pc.removeTrack(peer.senders.mic);
      peer.senders.mic = addLocalTrack(peer, state.micTrack, "mic");
      needsRenegotiate = true;
    } else {
      await peer.senders.mic.replaceTrack(state.micTrack);
      sendTrackInfo(peer, peer.localStreams.mic.id, "mic");
    }
    tuneSender(peer.senders.mic, "mic");
  }
  if (needsRenegotiate && renegotiate) await renegotiatePeers();

  startLocalMeter();
  updateTrackStats();
  warnIfVirtualInputBleeds();
}

function rebuildLocalStream() {
  const tracks = [];
  if (state.micTrack) tracks.push(state.micTrack);
  if (state.systemTrack) tracks.push(state.systemTrack);
  if (state.screenTrack) tracks.push(state.screenTrack);
  state.localStream = new MediaStream(tracks);
  dom.localState.textContent = getLocalStateText();
}

async function handleSystemAudioToggle() {
  if (!dom.systemAudioToggle.checked) {
    if (state.currentRoom) await stopSystemAudio();
    return;
  }

  if (!state.currentRoom) {
    setMessage("방에 들어가면 컴퓨터 사운드가 같이 켜집니다.");
    return;
  }

  await startSystemAudioShare();
}

async function startSystemAudioShare(options = {}) {
  if (state.systemSharing) return;

  if (isProgramSystemAudioMode()) {
    await startProgramSystemAudioShare(options);
    return;
  }

  if (isVirtualSystemAudioSupported()) {
    await startVirtualSystemAudioShare(options);
    return;
  }

  if (!isDirectSystemAudioSupported()) {
    dom.systemAudioToggle.checked = false;
    setMessage("이 환경에서는 컴퓨터 사운드 공유를 지원하지 않습니다.");
    return;
  }

  await startDisplaySystemAudioShare(options);
}

async function startProgramSystemAudioShare(options = {}) {
  try {
    dom.systemAudioToggle.disabled = true;
    const stream = await getProgramSystemAudioStream();
    const track = stream.getAudioTracks()[0];
    if (!track) {
      await stopProgramAudioProcess();
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("프로그램별 오디오 트랙을 만들지 못했습니다.");
    }

    await attachSystemTrack(stream, track, "선택한 프로그램 소리만 공유 중입니다.", "program", options);
  } catch (error) {
    dom.systemAudioToggle.checked = false;
    recordClientError("program-audio-start-failed", error.message || String(error));
    setMessage(`프로그램별 캡처 실패: ${error.message || "시작하지 못했습니다."}`);
    await stopProgramAudioProcess();
  } finally {
    updateControls();
  }
}

async function getProgramSystemAudioStream() {
  if (!state.programAudioSourcesLoaded) {
    await refreshProgramAudioSources({ silent: true });
  }

  const pids = getSelectedProgramAudioCapturePids();
  if (!pids.length) throw new Error("공유할 프로그램을 선택하세요.");
  if (!isProgramSystemAudioSupported()) throw new Error("Windows 프로그램별 캡처를 사용할 수 없습니다.");

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !window.AudioWorkletNode) throw new Error("AudioWorklet을 사용할 수 없습니다.");

  await stopProgramAudioProcess();

  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
  const destination = context.createMediaStreamDestination();
  let node = null;
  let portListener = null;
  let unsubscribeData = null;
  let unsubscribeStopped = null;

  try {
    await context.audioWorklet.addModule("program-audio-worklet.js");
    // 단일 워클릿 노드가 모든 pid 큐를 합산한다.
    node = new AudioWorkletNode(context, "voice-program-audio", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { channels: 2 },
    });
    node.connect(destination);

    // 메인 프로세스가 MessagePort를 보내오면 워클릿(오디오 스레드)에 직결한다.
    // 렌더러 메인 스레드가 바빠도(화면공유 등) PCM 전달이 밀리지 않는다.
    const workletNode = node;
    portListener = (event) => {
      if (!event.data?.accordProgramAudioPort) return;
      const port = event.ports?.[0];
      if (port) workletNode.port.postMessage({ type: "port", port }, [port]);
    };
    window.addEventListener("message", portListener);

    // 포트를 못 받는 구버전 클라이언트/실패 시 폴백 경로
    unsubscribeData = desktop.onProgramAudioData?.((payload) => {
      const data = toTransferableAudioBuffer(payload.data);
      if (!data) return;
      workletNode.port.postMessage({ type: "pcm", pid: Number(payload?.pid), data }, [data]);
    });

    unsubscribeStopped = desktop.onProgramAudioStopped?.((payload) => {
      const pid = Number(payload?.pid);
      if (!pids.includes(pid) || !state.programAudioProcess) return;
      if (state.programAudioProcess.stopping) return;
      const error = payload?.error || `PID ${pid} 캡처가 종료되었습니다.`;
      recordClientError("program-audio-helper-stopped", error);
      setMessage(`프로그램별 캡처 실패: ${error}`);
      stopSystemAudio();
    });

    await desktop.startProgramAudioCapture(pids);
    await context.resume().catch(() => {});

    state.programAudioProcess = { context, destination, node, portListener, unsubscribeData, unsubscribeStopped, pids, stopping: false };
    return destination.stream;
  } catch (error) {
    if (portListener) window.removeEventListener("message", portListener);
    unsubscribeData?.();
    unsubscribeStopped?.();
    if (node) {
      node.disconnect();
      node.port.close();
    }
    await context.close().catch(() => {});
    await desktop.stopProgramAudioCapture?.().catch(() => {});
    throw error;
  }
}

function toTransferableAudioBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  if (Array.isArray(value?.data)) return new Uint8Array(value.data).buffer;
  return null;
}

async function startDisplaySystemAudioShare(options = {}) {
  try {
    dom.systemAudioToggle.disabled = true;
    await ensureDeviceLabels();
    await refreshDevices();
    const outputReady = await selectSafeOutputDeviceForSystemShare();
    if (!outputReady && isWindowsSystemAudioShareActive()) {
      throw new Error(getWindowsSystemShareOutputMessage());
    }
    const stream = await getSystemAudioDisplayStream();
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("컴퓨터 사운드 트랙을 가져오지 못했습니다.");
    }

    await attachSystemTrack(stream, track, "컴퓨터 사운드를 공유 중입니다.", "device", options);
  } catch (error) {
    dom.systemAudioToggle.checked = false;
    setMessage(error.message || "컴퓨터 사운드를 공유하지 못했습니다.");
  } finally {
    updateControls();
  }
}

async function getSystemAudioDisplayStream() {
  const failures = [];

  if (isElectronLoopbackSystemAudioSupported()) {
    const displayStream = await getSystemAudioStreamOrNull("Windows display loopback", getElectronDisplayLoopbackSystemAudioStream, failures);
    if (displayStream?.getAudioTracks().length) return displayStream;

    const rawStream = await getSystemAudioStreamOrNull("Windows raw loopback", getElectronLoopbackSystemAudioStream, failures);
    if (rawStream?.getAudioTracks().length) return rawStream;
  }

  try {
    return await getBrowserSystemAudioDisplayStream();
  } catch (error) {
    if (failures.length) {
      throw new Error(`컴퓨터 사운드 캡처 실패: ${failures.join(" / ")} / 기본 캡처: ${getErrorText(error)}`);
    }
    throw error;
  }
}

async function getSystemAudioStreamOrNull(label, factory, failures) {
  let stream = null;
  try {
    stream = await factory();
    if (stream?.getAudioTracks().length) return stream;
    cleanupStream(stream);
    failures.push(`${label}: 오디오 트랙 없음`);
  } catch (error) {
    cleanupStream(stream);
    failures.push(`${label}: ${getErrorText(error)}`);
  }
  return null;
}

function cleanupStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

function getErrorText(error) {
  return String(error?.message || error?.name || error || "실패");
}

async function getBrowserSystemAudioDisplayStream() {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...getLegacyWebRtcProcessingConstraints(false, false, false),
      suppressLocalAudioPlayback: true,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      advanced: getAudioProcessingAdvancedConstraints(false, false, false),
    },
  });
}

function isElectronLoopbackSystemAudioSupported() {
  return desktop.isDesktop &&
    desktop.platform === "win32" &&
    typeof desktop.getSystemAudioSource === "function";
}

async function getElectronDisplayLoopbackSystemAudioStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: getSystemAudioCaptureConstraints(),
  });
  if (stream.getAudioTracks().length) return stream;
  stream.getTracks().forEach((track) => track.stop());
  throw new Error("컴퓨터 사운드 loopback 트랙을 가져오지 못했습니다.");
}

async function getElectronLoopbackSystemAudioStream() {
  const source = await desktop.getSystemAudioSource();
  if (!source?.id) throw new Error("공유할 화면 소스를 찾지 못했습니다.");

  const videoMandatory = {
    chromeMediaSource: "desktop",
    chromeMediaSourceId: source.id,
    maxFrameRate: 1,
  };
  const attempts = [
    {
      video: { mandatory: videoMandatory },
      audio: getElectronRawLoopbackAudioConstraints({ chromeMediaSource: "desktop", chromeMediaSourceId: source.id }),
    },
    {
      video: { mandatory: videoMandatory },
      audio: getElectronRawLoopbackAudioConstraints({ chromeMediaSource: "desktop" }),
    },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (stream.getAudioTracks().length) return stream;
      for (const track of stream.getTracks()) track.stop();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("컴퓨터 사운드 트랙을 가져오지 못했습니다.");
}

function getElectronRawLoopbackAudioConstraints(mandatory) {
  return { mandatory };
}

function getSystemAudioCaptureConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...getLegacyWebRtcProcessingConstraints(false, false, false),
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    channelCount: { ideal: 2 },
    latency: { ideal: 0.005 },
    suppressLocalAudioPlayback: false,
    advanced: getAudioProcessingAdvancedConstraints(false, false, false),
  };
}

async function startVirtualSystemAudioShare(options = {}) {
  try {
    dom.systemAudioToggle.disabled = true;
    await ensureDeviceLabels();
    await refreshDevices();
    selectSafeInputDevice();
    const systemOption = selectDefaultSystemInputDevice();
    if (!systemOption || !dom.systemInputDeviceSelect.value) {
      throw new Error("BlackHole 또는 Loopback 같은 컴퓨터 사운드 입력 장치를 선택해 주세요.");
    }
    if (dom.systemInputDeviceSelect.value === dom.inputDeviceSelect.value) {
      throw new Error("마이크 입력과 컴퓨터 입력은 서로 다른 장치여야 합니다.");
    }
    if (!await selectSafeOutputDeviceForSystemShare()) {
      throw new Error(getWindowsSystemShareOutputMessage());
    }
    assertSafeMacAudioRouting(true);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: getSystemInputConstraints(),
    });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("컴퓨터 사운드 입력 트랙을 가져오지 못했습니다.");
    }

    await attachSystemTrack(stream, track, "macOS 컴퓨터 사운드 입력을 공유 중입니다.", "device", options);
  } catch (error) {
    dom.systemAudioToggle.checked = false;
    setMessage(error.message || "컴퓨터 사운드를 공유하지 못했습니다.");
  } finally {
    updateControls();
  }
}

function getSystemInputConstraints() {
  const deviceId = dom.systemInputDeviceSelect.value;
  const constraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...getLegacyWebRtcProcessingConstraints(false, false, false),
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    latency: { ideal: 0.01 },
    channelCount: { ideal: 2 },
    advanced: getAudioProcessingAdvancedConstraints(false, false, false),
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}

async function attachSystemTrack(stream, track, message, captureKind = "device", { renegotiate = true, notify = true } = {}) {
  state.systemStream = stream;
  state.systemCaptureTrack = track;
  state.systemCaptureKind = captureKind;
  await enforceSystemAudioTrackConstraints(state.systemCaptureTrack);
  state.systemTrack = await createSystemSendTrack(state.systemCaptureTrack);
  state.systemTrack.contentHint = "music";
  state.systemSharing = true;
  state.systemCaptureTrack.addEventListener("ended", () => {
    if (Date.now() < state.ignoreSystemEndedUntil) return;
    stopSystemAudio();
  });
  startSystemShareMeter();
  await ensureSystemBleedSuppressor();
  rebuildLocalStream();

  for (const peer of state.peers.values()) {
    peer.senders.system = addLocalTrack(peer, state.systemTrack, "system");
    tuneSender(peer.senders.system, "system");
  }
  if (renegotiate) await renegotiatePeers();
  updateTrackStats();
  updateSetupStatus();
  if (notify) setMessage(message);
  if (captureKind === "program") scheduleProgramAudioSilenceWarning();
}

async function createSystemSendTrack(track) {
  closeSystemEchoFilter();
  if (!shouldUseWindowsLoopbackEchoReducer()) return track;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return track;

  try {
    const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    state.systemEchoFilter = { context, source, destination, remoteNodes: new Map() };
    syncSystemEchoFilterRemoteSources();
    context.resume().catch(() => {});
    const sendTrack = destination.stream.getAudioTracks()[0];
    if (sendTrack) {
      sendTrack.contentHint = "music";
      return sendTrack;
    }
  } catch {}

  closeSystemEchoFilter();
  return track;
}

async function enforceSystemAudioTrackConstraints(track) {
  if (!track?.applyConstraints) return;
  await track.applyConstraints(getSystemAudioCaptureConstraints()).catch(() => {});
}

async function stopSystemAudio({ renegotiate = true, notify = true } = {}) {
  state.ignoreSystemEndedUntil = Date.now() + 1200;
  clearProgramAudioSilenceWarning();
  stopSystemShareMeter();
  await stopProgramAudioProcess();
  for (const track of state.systemStream?.getTracks() || []) track.stop();
  closeSystemEchoFilter();
  state.systemStream = null;
  state.systemCaptureTrack = null;
  state.systemTrack = null;
  state.systemCaptureKind = "";
  state.systemSharing = false;
  rebuildLocalStream();

  for (const peer of state.peers.values()) {
    if (!peer.senders.system) continue;
    peer.pc.removeTrack(peer.senders.system);
    peer.senders.system = null;
    peer.localStreams.system = null;
  }
  if (renegotiate) await renegotiatePeers();
  updateTrackStats();
  updateControls();
  if (notify) setMessage("컴퓨터 사운드 공유를 껐습니다.");
}

async function stopProgramAudioProcess() {
  clearProgramAudioSilenceWarning();
  const process = state.programAudioProcess;
  state.programAudioProcess = null;
  if (!process) {
    await desktop.stopProgramAudioCapture?.().catch(() => {});
    return;
  }

  process.stopping = true;
  if (process.portListener) window.removeEventListener("message", process.portListener);
  process.unsubscribeData?.();
  process.unsubscribeStopped?.();
  if (process.node) {
    process.node.disconnect();
    process.node.port.close();
  }
  for (const node of process.nodes?.values?.() || []) {
    node.disconnect();
    node.port.close();
  }
  await desktop.stopProgramAudioCapture?.().catch(() => {});
  await process.context?.close?.().catch(() => {});
}

async function restartSystemAudio() {
  if (!state.currentRoom || !state.systemSharing) return;
  await stopSystemAudio();
  dom.systemAudioToggle.checked = true;
  await startSystemAudioShare();
}

async function toggleScreenShare() {
  if (state.screenSharing) {
    await stopScreenShare();
    return;
  }
  await startScreenShare();
}

async function startScreenShare() {
  if (state.screenSharing) return;
  if (!state.currentRoom) {
    setMessage("방에 들어가면 화면 공유를 켤 수 있습니다.");
    return;
  }
  if (!isScreenShareSendSupported()) {
    setMessage("이 환경에서는 화면 공유 송출을 지원하지 않습니다.");
    updateControls();
    return;
  }

  let stream = null;
  try {
    dom.screenShareButton.disabled = true;
    stream = await getScreenShareStream();
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("화면 영상 트랙을 가져오지 못했습니다.");
    assertFullScreenShareTrack(track);
    await applyScreenShareTrackConstraints(track);

    state.screenStream = stream;
    state.screenTrack = track;
    state.screenSharing = true;
    state.selectedScreenPeerId = state.screenPreviewEnabled ? "local" : "";
    track.contentHint = Number(state.screenFps || 30) >= 60 ? "motion" : "detail";
    track.addEventListener("ended", () => {
      if (Date.now() < state.ignoreScreenEndedUntil) return;
      stopScreenShare().catch(() => {});
    });
    startScreenCaptureProbe(track);
    rebuildLocalStream();
    await setDesktopScreenShareActive(true);
    state.screenStats.capture = getScreenCaptureStatsText();
    updateScreenStatsLabel();
    await logScreenDesktopDiagnostics();
    logScreenShareSetup("screen-share-setup");

    for (const peer of state.peers.values()) {
      peer.senders.screen = addLocalTrack(peer, state.screenTrack, "screen");
      tuneSender(peer.senders.screen, "screen");
    }
    await renegotiatePeers();
    renderParticipants();
    renderScreenStage();
    logScreenShareStats("screen-share-start");
    scheduleScreenShareStatsLog("screen-share-5s");
    setMessage(Number(state.screenFps || 30) >= 60
      ? "전체 화면 공유를 시작했습니다. 60fps는 PC 상태에 따라 불안정할 수 있습니다."
      : "전체 화면 공유를 시작했습니다. 소리는 컴퓨터 사운드 공유를 따로 사용합니다.");
  } catch (error) {
    cleanupStream(stream);
    stopScreenCaptureProbe();
    state.screenSharing = false;
    state.screenStream = null;
    state.screenTrack = null;
    await setDesktopScreenShareActive(false);
    updateScreenStatsLabel();
    setMessage(error.message || "화면 공유를 시작하지 못했습니다.");
  } finally {
    updateControls();
  }
}

async function stopScreenShare({ renegotiate = true, message = "화면 공유를 껐습니다." } = {}) {
  if (!state.screenSharing && !state.screenTrack && !state.screenStream) return;
  cleanupLocalScreenShare();

  for (const peer of state.peers.values()) {
    if (!peer.senders.screen) continue;
    peer.pc.removeTrack(peer.senders.screen);
    peer.senders.screen = null;
    peer.localStreams.screen = null;
  }
  if (renegotiate) await renegotiatePeers();
  renderParticipants();
  renderScreenStage();
  updateControls();
  setMessage(message);
}

async function restartScreenShare() {
  if (!state.currentRoom || !state.screenSharing) return;
  let stream = null;
  const oldStream = state.screenStream;
  const oldTrack = state.screenTrack;
  try {
    dom.screenShareButton.disabled = true;
    stream = await getScreenShareStream();
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("화면 영상 트랙을 가져오지 못했습니다.");
    assertFullScreenShareTrack(track);
    await applyScreenShareTrackConstraints(track);
    track.contentHint = Number(state.screenFps || 30) >= 60 ? "motion" : "detail";
    track.addEventListener("ended", () => {
      if (Date.now() < state.ignoreScreenEndedUntil) return;
      stopScreenShare().catch(() => {});
    });

    state.ignoreScreenEndedUntil = Date.now() + 1200;
    state.screenStream = stream;
    state.screenTrack = track;
    state.screenSharing = true;
    state.selectedScreenPeerId = state.screenPreviewEnabled ? "local" : "";
    startScreenCaptureProbe(track);
    rebuildLocalStream();

    let needsOffer = false;
    for (const peer of state.peers.values()) {
      if (!peer.senders.screen || !peer.localStreams.screen) {
        if (peer.senders.screen) peer.pc.removeTrack(peer.senders.screen);
        peer.senders.screen = addLocalTrack(peer, state.screenTrack, "screen");
        needsOffer = true;
      } else {
        await peer.senders.screen.replaceTrack(state.screenTrack);
        sendTrackInfo(peer, peer.localStreams.screen.id, "screen");
      }
      tuneSender(peer.senders.screen, "screen");
    }
    if (needsOffer) await renegotiatePeers();

    cleanupStream(oldStream);
    if (oldTrack && oldStream?.getTracks?.().includes(oldTrack) === false) oldTrack.stop();
    await logScreenDesktopDiagnostics();
    logScreenShareSetup("screen-share-restart-setup");
    updateTrackStats();
    renderParticipants();
    renderScreenStage();
    logScreenShareStats("screen-share-restart");
    scheduleScreenShareStatsLog("screen-share-restart-5s");
    setMessage("화면 공유 설정을 적용했습니다. 오디오 설정은 변경하지 않았습니다.");
  } catch (error) {
    cleanupStream(stream);
    if (state.screenTrack !== oldTrack) {
      state.screenStream = oldStream;
      state.screenTrack = oldTrack;
      state.screenSharing = Boolean(oldTrack && oldTrack.readyState === "live");
      stopScreenCaptureProbe();
      if (oldTrack?.readyState === "live") startScreenCaptureProbe(oldTrack);
    }
    recordClientError("screen-restart-failed", getErrorText(error));
    setMessage(error.message || "화면 공유 설정을 바꾸지 못했습니다.");
  } finally {
    updateControls();
  }
}

function cleanupLocalScreenShare() {
  const tracks = state.screenStream?.getTracks?.() || [];
  const screenTrack = state.screenTrack;
  state.ignoreScreenEndedUntil = Date.now() + 1200;
  state.screenStream = null;
  state.screenTrack = null;
  state.screenSharing = false;
  state.screenStats.capture = "";
  state.screenStats.sender = "";
  state.screenStats.receiver = "";
  state.screenStats.bottleneck = "";
  state.screenCaptureMethod = "";
  state.screenCaptureSource = null;
  state.screenCaptureRequested = null;
  state.lastScreenStatsLogAt = 0;
  if (state.selectedScreenPeerId === "local") state.selectedScreenPeerId = "";
  stopScreenCaptureProbe();
  rebuildLocalStream();
  setDesktopScreenShareActive(false).catch(() => {});
  for (const track of tracks) track.stop();
  if (screenTrack && !tracks.includes(screenTrack)) {
    screenTrack.stop();
  }
  updateScreenStatsLabel();
}

function getScreenShareVideoConstraints() {
  const fps = Math.max(15, Math.min(60, Number(state.screenFps || 30)));
  const video = {
    frameRate: { ideal: fps, max: fps },
    displaySurface: "monitor",
  };
  if (state.screenResolution === "720") {
    video.width = { ideal: 1280 };
    video.height = { ideal: 720 };
  } else if (state.screenResolution === "1080") {
    video.width = { ideal: 1920 };
    video.height = { ideal: 1080 };
  } else if (state.screenResolution === "1440") {
    video.width = { ideal: 2560 };
    video.height = { ideal: 1440 };
  } else if (state.screenResolution === "2160") {
    video.width = { ideal: 3840 };
    video.height = { ideal: 2160 };
  }
  return video;
}

async function getScreenShareStream() {
  state.screenCaptureMethod = "";
  state.screenCaptureSource = null;
  state.screenCaptureRequested = null;
  state.screenDesktopDiagnostics = null;

  if ((state.screenCaptureMode === "auto" || state.screenCaptureMode === "handler") && isElectronDisplayMediaHandlerSupported()) {
    try {
      return await getElectronDisplayMediaHandlerScreenShareStream();
    } catch (error) {
      recordClientError("screen-handler-capture-failed", getErrorDetail(error));
      if (state.screenCaptureMode === "handler") throw error;
    }
  }

  if (state.screenCaptureMode === "electron" && isElectronDesktopScreenCaptureSupported()) {
    try {
      const stream = await getElectronDesktopScreenShareStream();
      state.screenCaptureMethod = "electron-desktopCapturer-getUserMedia";
      logClientEvent("screen-capture-path", "electron-desktopCapturer-getUserMedia");
      return stream;
    } catch (error) {
      recordClientError("screen-electron-capture-failed", getErrorDetail(error));
      if (state.screenCaptureMode === "electron") throw error;
    }
  }

  logClientEvent("screen-capture-path", "getDisplayMedia");
  const constraints = getScreenShareVideoConstraints();
  state.screenCaptureMethod = "getDisplayMedia";
  state.screenCaptureRequested = { video: constraints, audio: false };
  return navigator.mediaDevices.getDisplayMedia({
    video: constraints,
    audio: false,
  });
}

function isElectronDesktopScreenCaptureSupported() {
  return desktop.isDesktop && desktop.platform === "win32" && typeof desktop.getScreenSource === "function";
}

function isElectronDisplayMediaHandlerSupported() {
  return desktop.isDesktop &&
    desktop.platform === "win32" &&
    typeof desktop.getScreenSource === "function" &&
    typeof desktop.setScreenCaptureConfig === "function";
}

async function getElectronDisplayMediaHandlerScreenShareStream() {
  const source = await desktop.getScreenSource();
  rememberScreenCaptureSource(source);
  await desktop.setScreenCaptureConfig({
    mode: "screen-share",
    displayId: source.source?.displayId || "",
  });
  const constraints = getScreenTestDisplayMediaConstraints();
  state.screenCaptureMethod = "electron-display-media-handler";
  state.screenCaptureRequested = { audio: false, video: constraints };
  logClientEvent("screen-capture-path", "electron-display-media-handler");
  logClientEvent("screen-capture-source", getScreenCaptureSourceText());
  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: constraints,
  });
}

async function getElectronDesktopScreenShareStream() {
  const source = await desktop.getScreenSource();
  rememberScreenCaptureSource(source);
  const constraints = getElectronScreenCaptureConstraints(source.id);
  state.screenCaptureRequested = { audio: false, video: constraints };
  logClientEvent("screen-capture-source", getScreenCaptureSourceText());
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints,
  });
}

function rememberScreenCaptureSource(source) {
  state.screenCaptureSource = {
    id: source.id,
    name: source.name,
    detail: source.source || null,
  };
  state.screenDesktopDiagnostics = source.diagnostics || null;
}

function getScreenTestDisplayMediaConstraints() {
  const fps = Math.max(15, Math.min(60, Number(state.screenFps || 30)));
  const constraints = {
    frameRate: { ideal: fps, max: fps },
    displaySurface: "monitor",
  };
  const size = getScreenShareTargetSize() || getScreenCapturePhysicalSize();
  if (size) {
    constraints.width = { ideal: size.width };
    constraints.height = { ideal: size.height };
  }
  return constraints;
}

function getScreenCapturePhysicalSize() {
  const display = state.screenCaptureSource?.detail?.display || getPrimaryDisplayDiagnostics();
  if (display?.physicalEstimate?.width && display?.physicalEstimate?.height) {
    return {
      width: display.physicalEstimate.width,
      height: display.physicalEstimate.height,
    };
  }
  if (display?.size?.width && display?.size?.height && display.scaleFactor) {
    return {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    };
  }
  return null;
}

function getElectronScreenCaptureConstraints(sourceId) {
  const fps = Math.max(15, Math.min(60, Number(state.screenFps || 30)));
  const mandatory = {
    chromeMediaSource: "desktop",
    chromeMediaSourceId: sourceId,
    minFrameRate: Math.min(15, fps),
    maxFrameRate: fps,
  };
  const size = getScreenShareTargetSize();
  if (size) {
    mandatory.maxWidth = size.width;
    mandatory.maxHeight = size.height;
  }
  return { mandatory };
}

function getScreenShareTargetSize() {
  if (state.screenResolution === "720") return { width: 1280, height: 720 };
  if (state.screenResolution === "1080") return { width: 1920, height: 1080 };
  if (state.screenResolution === "1440") return { width: 2560, height: 1440 };
  if (state.screenResolution === "2160") return { width: 3840, height: 2160 };
  return null;
}

function getScreenShareTrackConstraints() {
  const constraints = { ...getScreenShareVideoConstraints() };
  delete constraints.displaySurface;
  return constraints;
}

async function applyScreenShareTrackConstraints(track) {
  if (!track?.applyConstraints) return;
  await track.applyConstraints(getScreenShareTrackConstraints()).catch((error) => {
    logClientEvent("screen-constraints-error", error.message || String(error));
  });
}

function assertFullScreenShareTrack(track) {
  const surface = track.getSettings?.().displaySurface;
  if (!surface || surface === "monitor") return;
  track.stop();
  throw new Error("전체 화면 공유만 지원합니다. 창 공유는 사용할 수 없습니다.");
}

function startScreenCaptureProbe(track) {
  stopScreenCaptureProbe();
  state.screenCaptureProbe = { stop: null, fps: 0, method: "", frames: 0, enabled: state.screenProbeEnabled, sampling: false };
  if (!state.screenProbeEnabled) {
    state.screenCaptureProbe.method = "disabled";
    logClientEvent("screen-capture-probe", getScreenProbeDebugText());
    return;
  }
  if (!track || track.readyState !== "live") return;

  if (typeof window.MediaStreamTrackProcessor !== "function") {
    state.screenCaptureProbe.method = "unsupported";
    logClientEvent("screen-capture-probe", "MediaStreamTrackProcessor unsupported");
    return;
  }

  let stopped = false;
  let sampleTimer = 0;
  let currentReader = null;
  let currentProbeTrack = null;
  state.screenCaptureProbe = {
    fps: 0,
    method: "track-processor-sampled",
    frames: 0,
    enabled: true,
    sampling: false,
    stop: () => {
      stopped = true;
      if (sampleTimer) window.clearInterval(sampleTimer);
      currentReader?.cancel?.().catch(() => {});
      currentProbeTrack?.stop?.();
    },
  };

  const runSample = async () => {
    if (stopped || state.screenCaptureProbe.sampling || track.readyState !== "live") return;
    state.screenCaptureProbe.sampling = true;
    const probeTrack = track.clone();
    currentProbeTrack = probeTrack;
    let reader = null;
    try {
      const processor = new window.MediaStreamTrackProcessor({ track: probeTrack });
      reader = processor.readable.getReader();
      currentReader = reader;
      const startAt = performance.now();
      const stopAt = startAt + 1600;
      let frames = 0;
      while (!stopped && performance.now() < stopAt) {
        const result = await reader.read();
        if (result.done) break;
        frames += 1;
        state.screenCaptureProbe.frames += 1;
        result.value?.close?.();
      }
      const elapsed = performance.now() - startAt;
      if (elapsed > 0 && frames > 0) state.screenCaptureProbe.fps = (frames * 1000) / elapsed;
    } catch (error) {
      if (!stopped) recordClientError("screen-capture-probe-read-failed", getErrorText(error));
    } finally {
      reader?.cancel?.().catch(() => {});
      probeTrack.stop();
      if (currentReader === reader) currentReader = null;
      if (currentProbeTrack === probeTrack) currentProbeTrack = null;
      state.screenCaptureProbe.sampling = false;
    }
  };

  runSample();
  sampleTimer = window.setInterval(runSample, 10000);
  logClientEvent("screen-capture-probe", getScreenProbeDebugText());
}

function stopScreenCaptureProbe() {
  state.screenCaptureProbe?.stop?.();
  state.screenCaptureProbe = { stop: null, fps: 0, method: "", frames: 0, enabled: state.screenProbeEnabled, sampling: false };
}

async function logScreenDesktopDiagnostics() {
  if (!desktop.isDesktop || typeof desktop.getScreenDiagnostics !== "function") return;
  try {
    state.screenDesktopDiagnostics = state.screenDesktopDiagnostics || await desktop.getScreenDiagnostics();
    logClientEvent("screen-desktop-diagnostics", getScreenDesktopDiagnosticsText());
  } catch (error) {
    recordClientError("screen-diagnostics-failed", getErrorText(error));
  }
}

function logScreenShareSetup(event) {
  logClientEvent(event, [
    `captureMode=${state.screenCaptureMode}`,
    `captureMethod=${state.screenCaptureMethod || "-"}`,
    `electron=${desktop.electronVersion || state.screenDesktopDiagnostics?.electronVersion || "-"}`,
    `resolutionSetting=${state.screenResolution}`,
    `fpsSetting=${state.screenFps}`,
    getScreenPreviewDebugText(),
    getScreenProbeDebugText(),
    getScreenCaptureSourceText(),
    `requested=${formatCompactJson(state.screenCaptureRequested)}`,
    `actual=${getScreenSettingsDebugText()}`,
    getScreenCaptureSizeComparisonText(),
    `contentHint=${state.screenTrack?.contentHint || "-"}`,
    `devicePixelRatio=${window.devicePixelRatio || 1}`,
  ].filter(Boolean).join(" / "));
}

function getScreenPreviewDebugText() {
  return `localPreview=${state.screenPreviewEnabled ? "on" : "off"} viewer=${dom.screenViewer?.srcObject ? "attached" : "detached"} stage=${dom.screenStage?.hidden ? "hidden" : "visible"}`;
}

function getScreenProbeDebugText() {
  const probe = state.screenCaptureProbe || {};
  if (!state.screenProbeEnabled || probe.method === "disabled") {
    return "captureProbe=off method=disabled sampling=0 fps=not measured";
  }
  const fpsText = Number(probe.fps || 0) > 0 ? Number(probe.fps || 0).toFixed(1) : "not measured";
  return `captureProbe=on method=${probe.method || "-"} sampling=${probe.sampling ? "1" : "0"} fps=${fpsText}`;
}

function getScreenCaptureSourceText() {
  if (!state.screenCaptureSource) return "source=-";
  const detail = state.screenCaptureSource.detail || {};
  const thumbnail = detail.thumbnailSize ? `${detail.thumbnailSize.width}x${detail.thumbnailSize.height}` : "";
  const display = detail.display;
  const logical = display?.size ? `${display.size.width}x${display.size.height}` : "";
  const physical = display?.physicalEstimate ? `${display.physicalEstimate.width}x${display.physicalEstimate.height}` : "";
  return [
    `source=${state.screenCaptureSource.name || "-"}`,
    `id=${state.screenCaptureSource.id || "-"}`,
    detail.displayId ? `displayId=${detail.displayId}` : "",
    thumbnail ? `thumbnail=${thumbnail}` : "",
    logical ? `displayLogical=${logical}` : "",
    physical ? `displayPhysicalEstimate=${physical}` : "",
    display?.scaleFactor ? `displayScaleFactor=${display.scaleFactor}` : "",
  ].filter(Boolean).join(" ");
}

function getScreenSettingsDebugText() {
  const settings = state.screenTrack?.getSettings?.() || {};
  return formatCompactJson(settings);
}

function getScreenCaptureSizeComparisonText() {
  const settings = state.screenTrack?.getSettings?.() || {};
  const width = Number(settings.width || 0);
  const height = Number(settings.height || 0);
  const display = state.screenCaptureSource?.detail?.display || getPrimaryDisplayDiagnostics();
  const logical = display?.size;
  const physical = display?.physicalEstimate;
  const parts = [];
  if (width && height) parts.push(`trackSize=${width}x${height}`);
  if (logical?.width && logical?.height) parts.push(`displayLogical=${logical.width}x${logical.height}`);
  if (physical?.width && physical?.height) {
    parts.push(`displayPhysicalEstimate=${physical.width}x${physical.height}`);
    if (width && height) {
      parts.push(`trackVsPhysical=${(width / physical.width).toFixed(2)}x${(height / physical.height).toFixed(2)}`);
    }
  }
  if (display?.scaleFactor) parts.push(`displayScaleFactor=${display.scaleFactor}`);
  return parts.join(" ");
}

function getPrimaryDisplayDiagnostics() {
  const displays = state.screenDesktopDiagnostics?.displays || [];
  return displays[0] || null;
}

function getScreenDesktopDiagnosticsText() {
  const diagnostics = state.screenDesktopDiagnostics || {};
  const switches = (diagnostics.switches || [])
    .map((item) => `${item.name}:${item.enabled ? "1" : "0"}${item.value ? `=${item.value}` : ""}`)
    .join(",");
  const displays = (diagnostics.displays || [])
    .map((display) => {
      const size = display.size ? `${display.size.width}x${display.size.height}` : "";
      const physical = display.physicalEstimate ? `${display.physicalEstimate.width}x${display.physicalEstimate.height}` : "";
      const bounds = display.bounds ? `${display.bounds.width}x${display.bounds.height}@${display.bounds.x},${display.bounds.y}` : "";
      const workArea = display.workArea ? `${display.workArea.width}x${display.workArea.height}@${display.workArea.x},${display.workArea.y}` : "";
      return [
        `id=${display.id}`,
        display.label ? `label=${display.label}` : "",
        size ? `size=${size}` : "",
        physical ? `physicalEstimate=${physical}` : "",
        bounds ? `bounds=${bounds}` : "",
        workArea ? `workArea=${workArea}` : "",
        `scaleFactor=${display.scaleFactor}`,
        `rotation=${display.rotation}`,
        `colorDepth=${display.colorDepth}`,
        `depthPerComponent=${display.depthPerComponent}`,
        `internal=${display.internal ? "1" : "0"}`,
      ].filter(Boolean).join(" ");
    })
    .join(" | ");
  return [
    `platform=${diagnostics.platform || desktop.platform || "-"}`,
    `electron=${desktop.electronVersion || diagnostics.electronVersion || "-"}`,
    `hardwareAcceleration=${diagnostics.hardwareAcceleration === false ? "off" : "on"}`,
    diagnostics.windowsGpuMode ? `windowsGpuMode=${diagnostics.windowsGpuMode}` : "",
    diagnostics.effectiveWindowsGpuMode ? `effectiveGpuMode=${diagnostics.effectiveWindowsGpuMode}` : "",
    `devicePixelRatio=${window.devicePixelRatio || 1}`,
    `switches=${switches || "-"}`,
    `displays=${displays || "-"}`,
    `gpuSummary=${formatCompactJson(diagnostics.gpuSummary)}`,
    `gpuFeatureStatus=${formatCompactJson(diagnostics.gpuFeatureStatus, 500)}`,
    `gpuInfo=${formatCompactJson(diagnostics.gpuInfo, 500)}`,
    diagnostics.gpuInfoError ? `gpuInfoError=${diagnostics.gpuInfoError}` : "",
  ].filter(Boolean).join(" / ");
}

function summarizeSenderParameters(params) {
  const encoding = params?.encodings?.[0] || {};
  return [
    `maxBitrate=${encoding.maxBitrate ?? "-"}`,
    `maxFramerate=${encoding.maxFramerate ?? "-"}`,
    `scaleResolutionDownBy=${encoding.scaleResolutionDownBy ?? "-"}`,
    `priority=${encoding.priority || "-"}`,
    `networkPriority=${encoding.networkPriority || "-"}`,
    `degradationPreference=${params?.degradationPreference || "-"}`,
  ].join(",");
}

function formatCompactJson(value, limit = 900) {
  if (value === null || value === undefined || value === "") return "-";
  try {
    const text = JSON.stringify(value);
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  } catch {
    return String(value);
  }
}

function createPeer(peerId, peerName) {
  const polite = state.clientId > peerId;
  const pc = new RTCPeerConnection({
    iceServers: state.config.iceServers || [],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 4,
  });

  const peer = {
    id: peerId,
    name: peerName || "Guest",
    pc,
    polite,
    createdAt: Date.now(),
    connectedAt: 0,
    initialOfferSent: false,
    handlingRemoteDescription: false,
    makingOffer: false,
    offerChain: Promise.resolve(),
    offerRetryTimer: 0,
    reconnectTimer: 0,
    pendingOfferOptions: null,
    signalChain: Promise.resolve(),
    ignoredOffer: false,
    pendingCandidates: [],
    candidateCounts: {
      local: { host: 0, srflx: 0, relay: 0, prflx: 0, other: 0 },
      remote: { host: 0, srflx: 0, relay: 0, prflx: 0, other: 0 },
    },
    iceRestartAttempts: 0,
    lastIceFailureAt: 0,
    lastSelectedPairText: "",
    trackRoles: new Map(),
    pendingRemoteTracks: new Map(),
    remoteStreamTracks: new Map(),
    acceptedRemoteRoles: new Map(),
    remoteStatus: {
      mic: { live: false, streamId: "", muted: false, level: 0 },
      system: { live: false, streamId: "", muted: false, level: 0 },
      screen: { live: false, streamId: "", muted: false, level: 0 },
      updatedAt: 0,
    },
    remoteMissing: { mic: 0, system: 0, screen: 0 },
    remoteSilent: { mic: 0, system: 0 },
    senders: { mic: null, system: null, screen: null },
    localStreams: { mic: null, system: null, screen: null },
    remote: { mic: null, system: null, screen: null },
    state: "연결 중",
  };

  if (state.micTrack) {
    peer.senders.mic = addLocalTrack(peer, state.micTrack, "mic");
    tuneSender(peer.senders.mic, "mic");
  }
  if (state.systemTrack) {
    peer.senders.system = addLocalTrack(peer, state.systemTrack, "system");
    tuneSender(peer.senders.system, "system");
  }
  if (state.screenTrack) {
    peer.senders.screen = addLocalTrack(peer, state.screenTrack, "screen");
    tuneSender(peer.senders.screen, "screen");
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const type = countIceCandidate(peer, "local", event.candidate);
      logClientEvent("ice-candidate-send", `${peer.name} ${type} ${event.candidate.protocol || ""} ${getCandidateCountText(peer)}`.trim());
      if (type === "relay") logClientEvent("relay-candidate-local", makePeerDebugDetail(peer));
      sendSignal(peer.id, { candidate: event.candidate });
    } else {
      logClientEvent("ice-gathering-complete", makePeerDebugDetail(peer, getCandidateCountText(peer)));
      logClientEvent("candidate-counts", makePeerDebugDetail(peer, getCandidateCountText(peer)));
      if (!hasRelayCandidate(peer)) logClientEvent("relay-candidate-missing", makePeerDebugDetail(peer));
    }
  };

  pc.ontrack = (event) => {
    const streamId = event.streams[0]?.id || event.track.id;
    peer.remoteStreamTracks.set(streamId, event.track);
    const role = peer.trackRoles.get(streamId) || (event.track.kind === "video" ? "screen" : (!peer.remote.mic ? "mic" : "system"));
    if (peer.trackRoles.has(streamId)) {
      acceptRemoteTrack(peer, event.track, role, streamId);
    } else {
      peer.pendingRemoteTracks.set(streamId, event.track);
      window.setTimeout(() => {
        const pendingTrack = peer.pendingRemoteTracks.get(streamId);
        if (!pendingTrack) return;
        peer.pendingRemoteTracks.delete(streamId);
        const fallbackRole = peer.trackRoles.get(streamId) || (pendingTrack.kind === "video" ? "screen" : (!peer.remote.mic ? "mic" : "system"));
        acceptRemoteTrack(peer, pendingTrack, fallbackRole, streamId);
      }, 150);
    }
  };

  pc.onconnectionstatechange = () => {
    logClientEvent("peer-connection-state", makePeerDebugDetail(peer, `connection=${pc.connectionState}`));
    updatePeerConnectionState(peer);
  };

  pc.oniceconnectionstatechange = () => {
    logClientEvent("peer-ice-state", makePeerDebugDetail(peer, `ice=${pc.iceConnectionState}`));
    updatePeerConnectionState(peer);
  };

  pc.onsignalingstatechange = () => {
    logClientEvent("peer-signaling-state", makePeerDebugDetail(peer, `signaling=${pc.signalingState}`));
  };

  pc.onnegotiationneeded = () => {
    schedulePeerOffer(peer, {}, 150);
  };

  state.peers.set(peerId, peer);
  renderParticipants();
  return peer;
}

function addLocalTrack(peer, track, role) {
  const stream = new MediaStream([track]);
  peer.localStreams[role] = stream;
  const sender = peer.pc.addTrack(track, stream);
  if (role === "screen") preferScreenShareCodecs(peer, sender);
  sendTrackInfo(peer, stream.id, role);
  return sender;
}

function preferScreenShareCodecs(peer, sender) {
  // 기본 협상은 VP8(libvpx 소프트웨어 인코더)이 선택되어 4K에서 CPU를 소진한다.
  // H.264를 앞세우면 Windows(NVENC/QuickSync)·macOS(VideoToolbox) 하드웨어 인코더를 탄다.
  try {
    const transceiver = peer.pc.getTransceivers().find((item) => item.sender === sender);
    if (!transceiver?.setCodecPreferences) return;
    const codecs = window.RTCRtpReceiver?.getCapabilities?.("video")?.codecs || [];
    const isH264 = (codec) => /video\/h264/i.test(codec.mimeType || "");
    if (!codecs.some(isH264)) return;
    const rank = (codec) => {
      if (!isH264(codec)) return 2;
      return /packetization-mode=1/i.test(codec.sdpFmtpLine || "") ? 0 : 1;
    };
    const preferred = codecs
      .map((codec, index) => ({ codec, index }))
      .sort((a, b) => rank(a.codec) - rank(b.codec) || a.index - b.index)
      .map((item) => item.codec);
    transceiver.setCodecPreferences(preferred);
    logClientEvent("screen-codec-preference", preferred.slice(0, 3)
      .map((codec) => `${codec.mimeType}${codec.sdpFmtpLine ? `(${codec.sdpFmtpLine})` : ""}`)
      .join(" | "));
  } catch (error) {
    recordClientError("screen-codec-preference-failed", getErrorText(error));
  }
}

async function syncLocalSendersForPeer(peer, { forceOffer = false } = {}) {
  if (!peer || peer.pc.signalingState === "closed") return false;
  applyMicTrackEnabled();

  let needsOffer = false;
  needsOffer = await ensureLocalSender(peer, "mic", state.micTrack) || needsOffer;
  needsOffer = await ensureLocalSender(peer, "system", state.systemTrack) || needsOffer;
  needsOffer = await ensureLocalSender(peer, "screen", state.screenTrack) || needsOffer;

  sendMediaStatus(peer);
  if (needsOffer || forceOffer) schedulePeerOffer(peer, {}, 150);
  return needsOffer;
}

async function ensureLocalSender(peer, role, track) {
  const sender = peer.senders[role];
  const localStream = peer.localStreams[role];
  if (!track || track.readyState !== "live") {
    if (!sender) return false;
    peer.pc.removeTrack(sender);
    peer.senders[role] = null;
    peer.localStreams[role] = null;
    return true;
  }

  if (!sender || !localStream) {
    if (sender) peer.pc.removeTrack(sender);
    peer.senders[role] = addLocalTrack(peer, track, role);
    tuneSender(peer.senders[role], role);
    return true;
  }

  if (sender.track !== track || sender.track?.readyState !== "live") {
    await sender.replaceTrack(track);
    sendTrackInfo(peer, localStream.id, role);
    tuneSender(sender, role);
  }
  return false;
}

function sendTrackInfo(peer, streamId, role) {
  sendSignal(peer.id, { trackInfo: { streamId, role } });
}

function acceptRemoteTrack(peer, track, role, streamId = track.id) {
  const previousRole = peer.acceptedRemoteRoles.get(streamId);
  if (previousRole && previousRole !== role) {
    cleanupRemoteRole(peer, previousRole);
    peer.remote[previousRole] = null;
  }

  peer.acceptedRemoteRoles.set(streamId, role);
  if (role === "screen" || track.kind === "video") {
    setupRemoteScreenPlayback(peer, track, streamId);
    peer.state = "연결됨";
    updateCallStatus();
    renderParticipants();
    renderScreenStage();
    return;
  }
  setupRemotePlayback(peer, track, role, streamId);
  applyReceiverLatency(peer);
  peer.state = "연결됨";
  updateCallStatus();
  startRemoteMeter();
  renderParticipants();
}

function cleanupRemoteRole(peer, role) {
  if (role === "screen") cleanupScreenPlayback(peer.remote.screen);
  else cleanupPlayback(peer.remote[role]);
}

function ensurePeer(peerId, peerName) {
  if (state.peers.has(peerId)) {
    const peer = state.peers.get(peerId);
    peer.name = peerName || peer.name;
    return peer;
  }
  return createPeer(peerId, peerName);
}

async function createOfferForPeer(peerInfo, options = {}) {
  const peer = ensurePeer(peerInfo.id, peerInfo.name);
  await syncLocalSendersForPeer(peer);
  await makeOffer(peer, options);
}

async function makeOffer(peer, options = {}) {
  if (shouldDeferOffer(peer, options)) {
    deferPeerOffer(peer, options, "initial-connection-not-ready");
    return peer.offerChain;
  }
  if (peer.makingOffer || peer.handlingRemoteDescription) {
    deferPeerOffer(peer, options, peer.makingOffer ? "offer-in-progress" : "remote-description-in-progress");
    return peer.offerChain;
  }
  peer.offerChain = peer.offerChain
    .catch(() => {})
    .then(() => makeOfferNow(peer, options));
  return peer.offerChain;
}

function schedulePeerOffer(peer, options = {}, delay = 350) {
  if (!peer || peer.pc.signalingState === "closed" || peer.pc.connectionState === "closed") return;
  peer.pendingOfferOptions = { ...(peer.pendingOfferOptions || {}), ...options };
  if (shouldDeferOffer(peer, options)) {
    logClientEvent("offer-deferred", makePeerDebugDetail(peer, "initial-connection-not-ready"));
    return;
  }
  if (peer.offerRetryTimer) return;

  peer.offerRetryTimer = window.setTimeout(() => {
    const retryOptions = peer.pendingOfferOptions || {};
    peer.pendingOfferOptions = null;
    peer.offerRetryTimer = 0;
    makeOffer(peer, retryOptions).catch((error) => {
      logClientEvent("offer-retry-error", error.message || String(error));
    });
  }, delay);
}

function shouldDeferOffer(peer, options = {}) {
  if (!peer || peer.pc.signalingState === "closed") return true;
  if (peer.handlingRemoteDescription || peer.makingOffer) return true;
  if ((peer.pc.connectionState === "failed" || peer.pc.iceConnectionState === "failed" || peer.pc.iceConnectionState === "disconnected") && !shouldRetryIce(peer)) return true;
  if (peer.pc.signalingState !== "stable") return true;
  if (options.iceRestart) return false;
  if (!peer.initialOfferSent && !peer.pc.localDescription) return false;
  return isPeerInInitialConnectionWindow(peer);
}

function isPeerInInitialConnectionWindow(peer) {
  if (isPeerConnected(peer)) return false;
  const connection = peer.pc.connectionState;
  const ice = peer.pc.iceConnectionState;
  return connection === "new" ||
    connection === "connecting" ||
    ice === "new" ||
    ice === "checking";
}

function deferPeerOffer(peer, options, reason) {
  peer.pendingOfferOptions = { ...(peer.pendingOfferOptions || {}), ...(options || {}) };
  logClientEvent("offer-deferred", makePeerDebugDetail(peer, reason));
}

function flushDeferredPeerOffer(peer) {
  if (!peer?.pendingOfferOptions || shouldDeferOffer(peer, peer.pendingOfferOptions)) return;
  const options = peer.pendingOfferOptions;
  peer.pendingOfferOptions = null;
  schedulePeerOffer(peer, options, 100);
}

async function makeOfferNow(peer, options = {}) {
  if (peer.pc.signalingState === "closed") return;
  if (shouldDeferOffer(peer, options)) {
    deferPeerOffer(peer, options, "initial-connection-not-ready");
    return;
  }

  const stable = await waitForStableSignaling(peer.pc);
  if (!stable) {
    schedulePeerOffer(peer, options, 700);
    return;
  }

  try {
    peer.makingOffer = true;
    if (peer.pc.signalingState !== "stable") {
      schedulePeerOffer(peer, options, 350);
      return;
    }
    const offer = await peer.pc.createOffer(options);
    offer.sdp = tuneOpus(offer.sdp);
    if (peer.pc.signalingState !== "stable") {
      schedulePeerOffer(peer, options, 350);
      return;
    }
    await peer.pc.setLocalDescription(offer);
    peer.initialOfferSent = true;
    logClientEvent("offer-created", makePeerDebugDetail(peer));
    sendSignal(peer.id, { description: peer.pc.localDescription });
    sendMediaStatus(peer);
  } catch (error) {
    if (isRetryableOfferError(error)) {
      logClientEvent("offer-retryable-error", error.message || String(error));
      schedulePeerOffer(peer, options, 700);
      return;
    }
    peer.state = "협상 실패";
    setMessage(error.message || "연결 재협상에 실패했습니다.");
    renderParticipants();
    throw error;
  } finally {
    peer.makingOffer = false;
  }
}

function isRetryableOfferError(error) {
  const text = String(error?.message || error?.name || error || "").toLowerCase();
  return text.includes("wrong state") ||
    text.includes("invalidstate") ||
    text.includes("signaling") ||
    text.includes("have-remote-offer");
}

function waitForStableSignaling(pc, timeout = 5000) {
  if (pc.signalingState === "stable") return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    const onChange = () => {
      if (pc.signalingState !== "stable") return;
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      pc.removeEventListener("signalingstatechange", onChange);
    };

    pc.addEventListener("signalingstatechange", onChange);
  });
}

async function handleSignal(peerId, peerName, data) {
  if (!data || !peerId) return;
  const peer = ensurePeer(peerId, peerName);
  peer.signalChain = peer.signalChain
    .catch(() => {})
    .then(() => handleSignalNow(peer, data).catch((error) => {
      recordClientError("signaling-failed", `${getErrorText(error)} / ${makePeerDebugDetail(peer)}`);
      throw error;
    }));
  await peer.signalChain;
}

async function handleSignalNow(peer, data) {
  addClientLog("info", "signal-received", `${getSignalPayloadKind(data)} from=${peer.name || peer.id} ${makePeerDebugDetail(peer)}`);

  if (data.trackInfo) {
    peer.trackRoles.set(data.trackInfo.streamId, data.trackInfo.role);
    const pendingTrack = peer.pendingRemoteTracks.get(data.trackInfo.streamId);
    if (pendingTrack) {
      peer.pendingRemoteTracks.delete(data.trackInfo.streamId);
      acceptRemoteTrack(peer, pendingTrack, data.trackInfo.role, data.trackInfo.streamId);
      return;
    }

    const acceptedTrack = peer.remoteStreamTracks.get(data.trackInfo.streamId);
    const acceptedRole = peer.acceptedRemoteRoles.get(data.trackInfo.streamId);
    if (acceptedTrack && acceptedRole && acceptedRole !== data.trackInfo.role) {
      acceptRemoteTrack(peer, acceptedTrack, data.trackInfo.role, data.trackInfo.streamId);
    }
    return;
  }

  if (data.mediaStatus) {
    await handleMediaStatus(peer, data.mediaStatus);
    return;
  }

  if (data.repairRequest) {
    await handleRepairRequest(peer, data.repairRequest);
    return;
  }

  if (data.description) {
    const description = new RTCSessionDescription(data.description);
    logClientEvent(`${description.type}-received`, makePeerDebugDetail(peer));
    if (description.type === "answer" && peer.pc.signalingState !== "have-local-offer") {
      logClientEvent("stale-answer-ignored", `${peer.name}:${peer.pc.signalingState}`);
      return;
    }
    peer.handlingRemoteDescription = true;
    const offerCollision =
      description.type === "offer" &&
      (peer.makingOffer || peer.pc.signalingState !== "stable");

    peer.ignoredOffer = !peer.polite && offerCollision;
    if (peer.ignoredOffer) {
      logClientEvent("offer-ignored", makePeerDebugDetail(peer, "impolite-glare"));
      peer.handlingRemoteDescription = false;
      return;
    }

    try {
      if (offerCollision) {
        logClientEvent("offer-rollback", makePeerDebugDetail(peer, "polite-glare"));
        await peer.pc.setLocalDescription({ type: "rollback" }).catch(() => {});
      }

      await peer.pc.setRemoteDescription(description);
      logClientEvent(`${description.type}-remote-set`, makePeerDebugDetail(peer));
      await flushPendingCandidates(peer);

      if (description.type === "offer") {
        await syncLocalSendersForPeer(peer);
        const answer = await peer.pc.createAnswer();
        answer.sdp = tuneOpus(answer.sdp);
        if (peer.pc.signalingState !== "have-remote-offer") return;
        await peer.pc.setLocalDescription(answer);
        logClientEvent("answer-created", makePeerDebugDetail(peer));
        sendSignal(peer.id, { description: peer.pc.localDescription });
        sendMediaStatus(peer);
      }
    } finally {
      peer.handlingRemoteDescription = false;
    }
    return;
  }

  if (data.candidate) {
    const candidate = new RTCIceCandidate(data.candidate);
    const type = countIceCandidate(peer, "remote", candidate);
    logClientEvent("ice-candidate-received", `${peer.name} ${type} ${candidate.protocol || ""} ${getCandidateCountText(peer)}`.trim());
    if (type === "relay") logClientEvent("relay-candidate-remote", makePeerDebugDetail(peer));
    if (peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(candidate).catch((error) => {
        recordClientError("ice-candidate-failed", `${getErrorText(error)} / ${makePeerDebugDetail(peer)}`);
      });
    } else {
      peer.pendingCandidates.push(candidate);
    }
  }
}

async function flushPendingCandidates(peer) {
  const candidates = peer.pendingCandidates.splice(0);
  for (const candidate of candidates) {
    await peer.pc.addIceCandidate(candidate).catch((error) => {
      recordClientError("pending-ice-candidate-failed", `${getErrorText(error)} / ${makePeerDebugDetail(peer)}`);
    });
  }
}

function countIceCandidate(peer, direction, candidate) {
  const type = getIceCandidateType(candidate);
  const bucket = peer?.candidateCounts?.[direction];
  if (bucket) bucket[type] = (bucket[type] || 0) + 1;
  return type;
}

function getIceCandidateType(candidate) {
  const explicit = String(candidate?.type || candidate?.candidateType || "").toLowerCase();
  if (["host", "srflx", "relay", "prflx"].includes(explicit)) return explicit;
  const text = String(candidate?.candidate || "");
  const match = text.match(/\btyp\s+(host|srflx|relay|prflx)\b/i);
  return match ? match[1].toLowerCase() : "other";
}

function getCandidateCountText(peer) {
  const local = peer?.candidateCounts?.local || {};
  const remote = peer?.candidateCounts?.remote || {};
  return [
    `local host=${local.host || 0} srflx=${local.srflx || 0} relay=${local.relay || 0}`,
    `remote host=${remote.host || 0} srflx=${remote.srflx || 0} relay=${remote.relay || 0}`,
  ].join(" / ");
}

function hasRelayCandidate(peer) {
  return Boolean((peer?.candidateCounts?.local?.relay || 0) + (peer?.candidateCounts?.remote?.relay || 0));
}

async function renegotiatePeers() {
  await Promise.all([...state.peers.values()].map((peer) => makeOffer(peer).catch((error) => {
    logClientEvent("renegotiate-error", error.message || String(error));
  })));
}

async function restartPeerIce(peer) {
  if (!shouldRetryIce(peer)) {
    logClientEvent("ice-restart-skipped", makePeerDebugDetail(peer, getIceFailureReason(peer)));
    return;
  }
  if (peer.pc.signalingState !== "stable") {
    schedulePeerOffer(peer, { iceRestart: true }, 800);
    return;
  }
  peer.iceRestartAttempts += 1;
  logClientEvent("ice-restart", makePeerDebugDetail(peer, `attempt=${peer.iceRestartAttempts}`));
  await makeOffer(peer, { iceRestart: true }).catch(() => {});
}

function updatePeerConnectionState(peer) {
  if (!peer || peer.pc.signalingState === "closed") return;
  const connection = peer.pc.connectionState;
  const ice = peer.pc.iceConnectionState;

  if (isPeerConnected(peer)) {
    clearPeerReconnectTimer(peer);
    if (!peer.connectedAt) peer.connectedAt = Date.now();
    flushDeferredPeerOffer(peer);
    peer.state = "연결됨";
    logSelectedCandidatePair(peer, "selected-candidate-pair").catch((error) => {
      logClientEvent("selected-candidate-pair-error", error.message || String(error));
    });
    updateCallStatus();
    syncLocalSendersForPeer(peer).catch((error) => {
      logClientEvent("connected-sync-error", error.message || String(error));
    });
    renderParticipants();
    return;
  }

  if (connection === "failed" || ice === "failed") {
    peer.state = getIceFailureReason(peer) === "turn-needed" ? "TURN 설정 필요" : "재연결 중";
    cleanupStalePeerScreen(peer);
    reportIceFailure(peer).catch((error) => {
      logClientEvent("ice-failed-report-error", error.message || String(error));
    });
    if (shouldRetryIce(peer)) schedulePeerReconnect(peer, 1200);
  } else if (connection === "disconnected" || ice === "disconnected") {
    peer.state = hasPeerLiveRemoteTrack(peer) ? "연결 확인 중" : "재연결 중";
    if (shouldRetryIce(peer)) schedulePeerReconnect(peer, 3500);
  } else if (connection === "connecting" || ice === "checking") {
    peer.state = hasPeerLiveRemoteTrack(peer) ? "연결 확인 중" : "연결 중";
  } else if (connection === "closed") {
    peer.state = "종료";
  }

  updateCallStatus();
  renderParticipants();
}

function cleanupStalePeerScreen(peer) {
  if (!peer?.remote?.screen) return;
  cleanupScreenPlayback(peer.remote.screen);
  peer.remote.screen = null;
  if (state.selectedScreenPeerId === peer.id) state.selectedScreenPeerId = "";
  renderScreenStage();
}

function isPeerConnected(peer) {
  const connection = peer?.pc?.connectionState;
  const ice = peer?.pc?.iceConnectionState;
  return connection === "connected" || ice === "connected" || ice === "completed";
}

function hasPeerLiveRemoteTrack(peer) {
  return ["mic", "system", "screen"].some((role) => peer?.remote?.[role]?.track?.readyState === "live");
}

function shouldRetryIce(peer) {
  if (!peer || peer.pc.signalingState === "closed") return false;
  if (getIceFailureReason(peer) === "turn-needed") return false;
  return (peer.iceRestartAttempts || 0) < 1;
}

function getIceFailureReason(peer) {
  if (!hasTurnServer() && !hasRelayCandidate(peer)) return "turn-needed";
  if (hasTurnServer() && !hasRelayCandidate(peer)) return "relay-missing";
  return "ice-failed";
}

async function reportIceFailure(peer) {
  const now = Date.now();
  if (now - (peer.lastIceFailureAt || 0) < 3000) return;
  peer.lastIceFailureAt = now;
  const selectedPair = await getSelectedCandidatePairText(peer);
  const reason = getIceFailureReason(peer);
  const detail = [
    makePeerDebugDetail(peer, reason),
    getCandidateCountText(peer),
    selectedPair,
  ].join(" / ");
  logClientEvent("selected-candidate-pair", makePeerDebugDetail(peer, selectedPair));
  if (reason === "turn-needed") {
    recordClientError("turn-needed", detail);
    setMessage("TURN 서버 필요 가능성이 높습니다. Mac 서버에 TURN 설정이 없어 Windows/Parallels 접속 실패 가능성이 높습니다. start-server-mac.command를 실행하세요.");
    return;
  }
  if (reason === "relay-missing") {
    recordClientError("relay-missing", detail);
    setMessage("ICE failed인데 relay candidate가 없습니다. Mac TURN 서버/포트/계정 확인 필요");
    return;
  }
  recordClientError("ice-failed", detail);
}

async function getSelectedCandidatePairText(peer) {
  try {
    const stats = await peer.pc.getStats();
    let selectedPair = null;
    stats.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        selectedPair = stats.get(report.selectedCandidatePairId) || selectedPair;
      }
    });
    if (!selectedPair) {
      stats.forEach((report) => {
        if (report.type !== "candidate-pair") return;
        if (report.selected || report.nominated || report.state === "succeeded") selectedPair = selectedPair || report;
      });
    }
    if (!selectedPair) return "selectedCandidatePair=none";
    const local = stats.get(selectedPair.localCandidateId);
    const remote = stats.get(selectedPair.remoteCandidateId);
    return [
      `selectedCandidatePair=${formatCandidate(local)}->${formatCandidate(remote)}`,
      selectedPair.state ? `state=${selectedPair.state}` : "",
      typeof selectedPair.currentRoundTripTime === "number" ? `rtt=${Math.round(selectedPair.currentRoundTripTime * 1000)}ms` : "",
      typeof selectedPair.bytesSent === "number" ? `bytesSent=${selectedPair.bytesSent}` : "",
      typeof selectedPair.bytesReceived === "number" ? `bytesReceived=${selectedPair.bytesReceived}` : "",
    ].filter(Boolean).join(" ");
  } catch (error) {
    return `selectedCandidatePair=error:${getErrorText(error)}`;
  }
}

async function logSelectedCandidatePair(peer, event = "selected-candidate-pair") {
  const selectedPair = await getSelectedCandidatePairText(peer);
  if (event === "selected-candidate-pair" && peer.lastSelectedPairText === selectedPair) return;
  peer.lastSelectedPairText = selectedPair;
  logClientEvent(event, makePeerDebugDetail(peer, selectedPair));
}

function schedulePeerReconnect(peer, delay) {
  if (!peer || peer.pc.signalingState === "closed") return;
  if (!shouldRetryIce(peer)) return;
  if (peer.reconnectTimer) return;
  peer.reconnectTimer = window.setTimeout(() => {
    peer.reconnectTimer = 0;
    if (!state.currentRoom || peer.pc.signalingState === "closed") return;
    if (isPeerConnected(peer)) {
      updatePeerConnectionState(peer);
      return;
    }
    restartPeerIce(peer).catch((error) => {
      logClientEvent("ice-restart-error", error.message || String(error));
    });
  }, delay);
}

function clearPeerReconnectTimer(peer) {
  if (!peer?.reconnectTimer) return;
  window.clearTimeout(peer.reconnectTimer);
  peer.reconnectTimer = 0;
}

function updateCallStatus() {
  if (!state.currentRoom) return;
  if ([...state.peers.values()].some((peer) => peer.state === "재연결 중")) {
    setStatus("재연결 중", "idle");
    dom.remoteState.textContent = "재연결 중";
    return;
  }
  setStatus("통화 중", "good");
  dom.remoteState.textContent = state.peers.size ? "연결됨" : "대기";
}

function setupRemotePlayback(peer, track, role, streamId = track.id) {
  const key = role === "system" ? "system" : "mic";
  cleanupPlayback(peer.remote[key]);

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.dataset.peerId = peer.id;
  audio.dataset.role = key;

  const sourceStream = new MediaStream([track]);
  const playback = {
    peerId: peer.id,
    role: key,
    streamId,
    track,
    audio,
    sourceStream,
    renderStream: sourceStream,
    pipeline: null,
    volumeGain: 1,
    level: 0,
    outputLevel: 0,
    levelProbe: null,
  };
  peer.remote[key] = playback;
  audio.srcObject = sourceStream;
  dom.remoteAudios.append(audio);
  playback.levelProbe = startPlaybackLevelProbe(playback);
  applyPlaybackVolume(playback);
  syncSystemEchoFilterRemoteSources();
  applySinkToAudio(audio).finally(() => {
    audio.play().catch(() => {});
  });

  track.addEventListener("ended", () => {
    cleanupPlayback(playback);
    if (peer.remote[key] === playback) peer.remote[key] = null;
    if (key === "mic") {
      dom.remoteState.textContent = "대기";
      dom.remoteMeter.style.setProperty("--level", "0%");
    }
  });
}

function setupRemoteScreenPlayback(peer, track, streamId = track.id) {
  cleanupScreenPlayback(peer.remote.screen);
  const sourceStream = new MediaStream([track]);
  const playback = {
    peerId: peer.id,
    role: "screen",
    streamId,
    track,
    sourceStream,
  };
  const isNewShare = !peer.remote.screen;
  peer.remote.screen = playback;
  // 자동 시청 금지 — 사용자가 직접 "화면 보기"를 눌러야 시청 상태가 된다.
  if (isNewShare) setMessage(`${peer.name}님이 화면 공유를 시작했습니다.`);
  renderParticipants();
  renderScreenStage();
  track.addEventListener("ended", () => {
    cleanupScreenPlayback(playback);
    // 공유 재시작으로 이미 새 트랙이 붙었다면 시청 상태를 건드리지 않는다.
    if (peer.remote.screen !== playback) return;
    peer.remote.screen = null;
    if (state.selectedScreenPeerId === peer.id) state.selectedScreenPeerId = "";
    renderParticipants();
    renderScreenStage();
  });
}

function cleanupScreenPlayback(playback) {
  if (!playback) return;
  if (dom.screenViewer?.srcObject === playback.sourceStream) {
    dom.screenViewer.pause?.();
    dom.screenViewer.srcObject = null;
  }
}

function applyReceiverLatency(peer) {
  // jitterBufferTarget 단위는 밀리초(0~4000). 초 단위 값(0.005 등)을 넣으면 0ms로
  // 잘려 지터버퍼가 최소로 강제되고 오디오가 계속 끊긴다.
  // 저지연 모드는 null(NetEq 적응 최소 지연)로 두고, 일반 모드는 40ms 바닥을 준다.
  // 바닥은 목표치일 뿐이라 네트워크 지터가 크면 NetEq가 알아서 더 키운다.
  const targetMs = dom.lowLatencyToggle.checked ? null : 40;
  const hint = dom.lowLatencyToggle.checked ? 0 : 0.02;
  for (const receiver of peer.pc.getReceivers()) {
    if (receiver.track?.kind !== "audio") continue;
    if ("jitterBufferTarget" in receiver) {
      try {
        receiver.jitterBufferTarget = targetMs;
      } catch {}
    }
    if ("playoutDelayHint" in receiver) {
      try {
        receiver.playoutDelayHint = hint;
      } catch {}
    }
  }
}

function cleanupPlayback(playback) {
  if (!playback) return;
  detachSystemEchoFilterPlayback(playback);
  playback.audio?.remove();
  playback.levelProbe?.stop?.();
  closePlaybackPipeline(playback);
}

function closePlaybackPipeline(playback) {
  if (!playback?.pipeline) return;
  playback.pipeline?.source?.disconnect?.();
  playback.pipeline?.gainNode?.disconnect?.();
  playback.pipeline = null;
}

function ensurePlaybackPipeline(playback) {
  if (playback.pipeline?.context?.state === "closed") playback.pipeline = null;
  if (playback.pipeline) return playback.pipeline;
  playback.pipeline = makePlaybackPipeline(playback.sourceStream);
  return playback.pipeline;
}

// 모바일 브라우저(특히 iOS)는 동시에 살아있는 AudioContext 수가 제한되어,
// 재생마다 새 컨텍스트를 만들면 늦게 생성된 것부터 suspended로 남아 무음이 된다.
// 모든 재생 파이프라인과 레벨 프로브는 이 공유 컨텍스트 하나를 사용한다.
function getPlaybackAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (state.playbackAudioContext?.state === "closed") state.playbackAudioContext = null;
  if (!state.playbackAudioContext) {
    try {
      state.playbackAudioContext = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    applyPlaybackContextSink();
    const resume = () => {
      state.playbackAudioContext?.resume?.().catch(() => {});
    };
    document.addEventListener("pointerdown", resume, { passive: true });
    document.addEventListener("keydown", resume);
  }
  if (state.playbackAudioContext.state !== "running") {
    state.playbackAudioContext.resume().catch(() => {});
  }
  return state.playbackAudioContext;
}

function applyPlaybackContextSink() {
  const context = state.playbackAudioContext;
  if (!context || typeof context.setSinkId !== "function") return;
  context.setSinkId(dom.outputDeviceSelect.value || "").catch(() => {});
}

function makePlaybackPipeline(stream) {
  const context = getPlaybackAudioContext();
  if (!context) return null;
  try {
    const source = context.createMediaStreamSource(stream);
    const gainNode = context.createGain();
    gainNode.gain.value = 1;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    return { context, source, gainNode };
  } catch {
    return null;
  }
}

function syncSystemEchoFilterRemoteSources() {
  const filter = state.systemEchoFilter;
  if (!filter) return;

  const active = new Set();
  for (const peer of state.peers.values()) {
    for (const playback of [peer.remote.mic, peer.remote.system]) {
      if (!playback?.sourceStream || playback.track?.readyState !== "live") continue;
      active.add(playback);
      attachSystemEchoFilterPlayback(playback);
    }
  }

  for (const playback of [...filter.remoteNodes.keys()]) {
    if (!active.has(playback)) detachSystemEchoFilterPlayback(playback);
  }
}

function attachSystemEchoFilterPlayback(playback) {
  const filter = state.systemEchoFilter;
  if (!filter || filter.remoteNodes.has(playback)) return;

  try {
    const source = filter.context.createMediaStreamSource(playback.sourceStream);
    const inputGain = filter.context.createGain();
    const taps = [
      makeSystemEchoFilterTap(filter.context, 0.035, -0.34),
      makeSystemEchoFilterTap(filter.context, 0.075, -0.28),
      makeSystemEchoFilterTap(filter.context, 0.12, -0.18),
      makeSystemEchoFilterTap(filter.context, 0.17, -0.1),
    ];

    source.connect(inputGain);
    for (const tap of taps) {
      inputGain.connect(tap.delay);
      tap.delay.connect(tap.gain);
      tap.gain.connect(filter.destination);
    }

    filter.remoteNodes.set(playback, { source, inputGain, taps });
    updateSystemEchoFilterPlaybackGain(playback);
  } catch {}
}

function makeSystemEchoFilterTap(context, delaySeconds, gainValue) {
  const delay = context.createDelay(0.24);
  const gain = context.createGain();
  delay.delayTime.value = delaySeconds;
  gain.gain.value = gainValue;
  return { delay, gain };
}

function detachSystemEchoFilterPlayback(playback) {
  const filter = state.systemEchoFilter;
  const nodes = filter?.remoteNodes?.get(playback);
  if (!nodes) return;

  nodes.source.disconnect?.();
  nodes.inputGain.disconnect?.();
  for (const tap of nodes.taps || []) {
    tap.delay.disconnect?.();
    tap.gain.disconnect?.();
  }
  filter.remoteNodes.delete(playback);
}

function updateSystemEchoFilterPlaybackGain(playback) {
  const filter = state.systemEchoFilter;
  const nodes = filter?.remoteNodes?.get(playback);
  if (!nodes) return;

  const target = getSystemEchoFilterPlaybackGain(playback);
  try {
    nodes.inputGain.gain.setTargetAtTime(target, filter.context.currentTime, 0.035);
  } catch {
    nodes.inputGain.gain.value = target;
  }
}

function getSystemEchoFilterPlaybackGain(playback) {
  if (!shouldUseWindowsLoopbackEchoReducer()) return 0;
  if (!playback || playback.audio?.muted || playback.track?.readyState !== "live") return 0;
  if (!playback.pipeline && playback.audio?.volume === 0) return 0;
  const gain = Math.max(0, Math.min(2, playback.volumeGain ?? 1));
  return gain * 0.86;
}

function closeSystemEchoFilter() {
  const filter = state.systemEchoFilter;
  if (!filter) return;
  for (const playback of [...filter.remoteNodes.keys()]) detachSystemEchoFilterPlayback(playback);
  for (const track of filter.destination?.stream?.getTracks?.() || []) track.stop();
  filter.source?.disconnect?.();
  filter.context?.close?.().catch(() => {});
  state.systemEchoFilter = null;
}

function tuneSender(sender, role) {
  if (!sender?.setParameters) return;
  const params = sender.getParameters();
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  const encoding = params.encodings[0];
  const high = dom.highQualityToggle.checked;
  const before = role === "screen" ? summarizeSenderParameters(params) : "";
  if (role === "screen") {
    const fps = Math.max(15, Math.min(60, Number(state.screenFps || 30)));
    encoding.maxBitrate = getScreenShareBitrate();
    encoding.maxFramerate = fps;
    encoding.scaleResolutionDownBy = 1;
    // 오디오보다 낮은 우선순위: 화면공유 비디오가 대역폭을 다 차지해
    // 통화/컴퓨터 사운드가 밀리는 것을 막는다.
    encoding.priority = "medium";
    encoding.networkPriority = "medium";
    params.degradationPreference = "maintain-framerate";
  } else {
    encoding.maxBitrate = role === "system" ? high ? 510000 : 320000 : high ? 192000 : 96000;
    encoding.priority = "high";
    encoding.networkPriority = "high";
    delete encoding.maxFramerate;
    delete encoding.scaleResolutionDownBy;
    delete params.degradationPreference;
  }
  sender.setParameters(params)
    .then(() => {
      if (role === "screen") {
        logClientEvent("screen-sender-parameters", `before=${before} after=${summarizeSenderParameters(sender.getParameters())}`);
      }
    })
    .catch((error) => {
      if (role === "screen") recordClientError("screen-set-parameters-failed", `${getErrorText(error)} before=${before}`);
    });
}

function getScreenShareBitrate() {
  const fps = Number(state.screenFps || 30);
  if (state.screenResolution === "720") return fps >= 60 ? 4500000 : 2800000;
  if (state.screenResolution === "1080") return fps >= 60 ? 9000000 : 6000000;
  if (state.screenResolution === "1440") return fps >= 60 ? 18000000 : 11000000;
  if (state.screenResolution === "2160") return fps >= 60 ? 34000000 : 22000000;
  if (state.screenResolution === "native") {
    const pixels = getScreenSharePixelCount();
    if (pixels >= 3840 * 2160) return fps >= 60 ? 34000000 : 22000000;
    if (pixels >= 2560 * 1440) return fps >= 60 ? 18000000 : 11000000;
    if (pixels >= 1920 * 1080) return fps >= 60 ? 9000000 : 6000000;
    return fps >= 60 ? 4500000 : 2800000;
  }
  return fps >= 60 ? 9000000 : 6000000;
}

function getScreenSharePixelCount() {
  const settings = state.screenTrack?.getSettings?.() || {};
  const width = Number(settings.width || 0);
  const height = Number(settings.height || 0);
  return width > 0 && height > 0 ? width * height : 1920 * 1080;
}

function tuneOpus(sdp) {
  const opusPayload = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)?.[1];
  if (!opusPayload) return sdp;

  const bitrate = dom.highQualityToggle.checked ? 510000 : 256000;
  const ptime = dom.lowLatencyToggle.checked ? 10 : 20;
  const maxptime = dom.lowLatencyToggle.checked ? 10 : 30;
  // 스테레오와 FEC는 항상 켠다. 모노 강제는 컴퓨터 사운드(음악) 음질을 크게 떨어뜨리고,
  // FEC를 끄면 화면공유로 링크가 바빠질 때 패킷 손실이 그대로 잡음이 된다.
  // cbr=1은 같은 비트레이트에서 VBR보다 음질이 나빠 제거.
  const params = [
    `minptime=${ptime}`,
    "maxplaybackrate=48000",
    "useinbandfec=1",
    "stereo=1",
    "sprop-stereo=1",
    `maxaveragebitrate=${bitrate}`,
    "usedtx=0",
  ].join(";");

  const fmtp = new RegExp(`a=fmtp:${opusPayload} .+\\r\\n`, "g");
  if (fmtp.test(sdp)) {
    fmtp.lastIndex = 0;
    sdp = sdp.replace(fmtp, (line) => `${line.trim()};${params}\r\n`);
  } else {
    sdp = sdp.replace(
      new RegExp(`(a=rtpmap:${opusPayload} opus/48000/2\\r\\n)`, "gi"),
      `$1a=fmtp:${opusPayload} ${params}\r\n`,
    );
  }

  sdp = sdp.replace(/a=ptime:\d+\r\n/g, "");
  sdp = sdp.replace(/a=maxptime:\d+\r\n/g, "");
  sdp = sdp.replace(
    new RegExp(`(a=fmtp:${opusPayload} .+\\r\\n)`, "g"),
    `$1a=ptime:${ptime}\r\na=maxptime:${maxptime}\r\n`,
  );
  return sdp;
}

async function applyAudioSettings({ restartMic = false, renegotiate = false } = {}) {
  if (state.applyingSettings) return;
  state.applyingSettings = true;
  try {
    if (restartMic && state.currentRoom) await replaceMicTrack({ renegotiate: !renegotiate });
    for (const peer of state.peers.values()) {
      tuneSender(peer.senders.mic, "mic");
      tuneSender(peer.senders.system, "system");
      applyReceiverLatency(peer);
    }
    if (renegotiate && state.currentRoom) await renegotiatePeers();
    applyRemoteVolumes();
    updateTrackStats();
    setMessage(state.currentRoom ? "오디오 설정을 적용했습니다." : "");
  } catch (error) {
    setMessage(error.message || "오디오 설정을 적용하지 못했습니다.");
  } finally {
    state.applyingSettings = false;
    updateControls();
  }
}

async function repairAudio() {
  if (!state.currentRoom || state.applyingSettings || state.repairingAudio) return;

  const wantsSystem = state.systemSharing || dom.systemAudioToggle.checked;
  const selectedScreenPeerId = state.selectedScreenPeerId;
  const screenViewerStream = dom.screenViewer?.srcObject || null;
  state.applyingSettings = true;
  state.repairingAudio = true;
  state.senderHealth.clear();
  state.latencyHealth.clear();
  setMessage("오디오를 다시 연결하는 중입니다.");
  updateControls();

  try {
    logClientEvent("audio-repair-start", getCallDebugSummary());
    if (state.systemSharing) await stopSystemAudio({ renegotiate: false, notify: false });
    await replaceMicTrack({ renegotiate: false });

    for (const peer of state.peers.values()) {
      tuneSender(peer.senders.mic, "mic");
      applyReceiverLatency(peer);
    }

    if (wantsSystem) {
      dom.systemAudioToggle.checked = true;
      await startSystemAudioShare({ renegotiate: false, notify: false });
    }

    await renegotiatePeers();
    updateTrackStats();
    renderScreenStage();
    setMessage("오디오 복구를 완료했습니다.");
  } catch (error) {
    recordClientError("audio-repair-failed", `${getErrorText(error)} / ${getCallDebugSummary()}`);
    setMessage(error.message || "오디오 복구에 실패했습니다.");
  } finally {
    if (selectedScreenPeerId && getActiveScreenShares().some((item) => item.id === selectedScreenPeerId)) {
      state.selectedScreenPeerId = selectedScreenPeerId;
    }
    if (screenViewerStream && dom.screenViewer && !dom.screenViewer.srcObject) {
      renderScreenStage();
    }
    state.applyingSettings = false;
    state.repairingAudio = false;
    updateControls();
  }
}

async function testAudioSettings() {
  let stream = null;
  let track = state.rawMicTrack?.readyState === "live" ? state.rawMicTrack : null;
  try {
    if (!track) {
      await ensureDeviceLabels();
      await refreshDevices();
      selectSafeInputDevice();
      if (dom.systemAudioToggle.checked) await selectSafeOutputDeviceForSystemShare();
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: getMicConstraints(),
      });
      track = stream.getAudioTracks()[0];
    }
    if (!track) throw new Error("마이크 트랙을 가져오지 못했습니다.");

    const settings = track.getSettings?.() || {};
    setCompactStat(dom.statSampleRate, formatSampleRate(settings.sampleRate));
    setCompactStat(dom.statChannels, settings.channelCount ? `${settings.channelCount}ch` : "-");
    setCompactStat(dom.statProcessing, getProcessingText(settings));
    setCompactStat(dom.statInput, `${dom.inputDeviceSelect.selectedOptions[0]?.textContent || "-"} / 출력 ${dom.outputDeviceSelect.selectedOptions[0]?.textContent || "-"}`);

    setMessage("짧은 테스트음으로 에코 누수를 확인하는 중입니다.");
    await runEchoLeakProbe(track);
    updateSetupStatus();
    applyRemoteVolumes();
    setMessage(`오디오 진단 완료. ${getEchoProbeMessage()}`);
  } catch (error) {
    setMessage(describeMediaError(error));
  } finally {
    for (const track of stream?.getTracks() || []) track.stop();
  }
}

async function runEchoLeakProbe(track) {
  resetEchoProbe();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !track || track.readyState !== "live") {
    state.echoProbe.status = "unknown";
    return;
  }

  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
  const micSource = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const destination = context.createMediaStreamDestination();
  const audio = document.createElement("audio");

  try {
    analyser.fftSize = 1024;
    micSource.connect(analyser);
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.055;
    oscillator.connect(gainNode);
    gainNode.connect(destination);
    audio.autoplay = false;
    audio.playsInline = true;
    audio.srcObject = destination.stream;

    if (!await applySinkToAudio(audio)) {
      state.echoProbe.status = "unknown";
      return;
    }

    await context.resume().catch(() => {});
    const baseline = await measureAnalyserRms(analyser, 280);
    await audio.play();
    oscillator.start();
    const probe = await measureAnalyserRms(analyser, 520);
    oscillator.stop();

    const floor = Math.max(0.0005, baseline);
    const ratio = probe / floor;
    const leaked = probe >= 0.012 && (ratio >= 2.2 || probe - baseline >= 0.008);
    state.echoProbe.status = leaked ? "leak" : "ok";
    state.echoProbe.ratio = ratio;
    state.echoProbe.baseline = baseline;
    state.echoProbe.probe = probe;
  } catch {
    state.echoProbe.status = "unknown";
  } finally {
    audio.remove();
    micSource.disconnect();
    oscillator.disconnect();
    gainNode.disconnect();
    context.close().catch(() => {});
    updateSetupStatus();
  }
}

async function measureAnalyserRms(analyser, durationMs) {
  const samples = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  let sum = 0;
  let count = 0;

  while (performance.now() - startedAt < durationMs) {
    analyser.getFloatTimeDomainData(samples);
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index];
      sum += value * value;
    }
    count += samples.length;
    await wait(24);
  }

  return count ? Math.sqrt(sum / count) : 0;
}

function resetEchoProbe() {
  state.echoProbe.status = "";
  state.echoProbe.ratio = 0;
  state.echoProbe.baseline = 0;
  state.echoProbe.probe = 0;
  resetLiveEchoGuard();
  updateSetupStatus();
}

function resetLiveEchoGuard() {
  if (state.liveEchoGuard.protectionTimer) {
    window.clearTimeout(state.liveEchoGuard.protectionTimer);
    state.liveEchoGuard.protectionTimer = 0;
  }
  state.liveEchoGuard.status = "";
  state.liveEchoGuard.micLevel = 0;
  state.liveEchoGuard.sendMicLevel = 0;
  state.liveEchoGuard.remoteLevel = 0;
  state.liveEchoGuard.strikes = 0;
  state.liveEchoGuard.lastDetectedAt = 0;
  state.liveEchoGuard.lastSampleAt = 0;
  state.liveEchoGuard.protectUntil = 0;
  applyMicTrackEnabled();
}

function getEchoProbeMessage() {
  if (state.echoProbe.status === "leak") {
    return "에코 누수가 감지됐습니다. 출력 소리가 마이크로 들어오고 있습니다.";
  }
  if (state.echoProbe.status === "ok") return "에코 누수는 감지되지 않았습니다.";
  return "에코 누수 측정은 확인하지 못했습니다.";
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toggleSettingsModal(open) {
  if (!dom.settingsModal) return;
  dom.settingsModal.hidden = !open;
  if (open) refreshDevices().catch(() => {});
}

function handleGlobalHotkeys(event) {
  if (event.key === "Escape" && dom.settingsModal && !dom.settingsModal.hidden) {
    toggleSettingsModal(false);
    return;
  }
  if (event.ctrlKey && event.shiftKey && event.code === "KeyM") {
    if (!state.currentRoom || !state.rawMicTrack) return;
    event.preventDefault();
    toggleMute();
    setMessage(state.muted ? "마이크를 껐습니다. (Ctrl+Shift+M)" : "마이크를 켰습니다. (Ctrl+Shift+M)");
  }
}

function toggleMute() {
  state.muted = !state.muted;
  applyMicTrackEnabled();
  dom.muteButton.textContent = state.muted ? "마이크 켜기" : "마이크 끄기";
  dom.localState.textContent = getLocalStateText();
  // 상태 변화를 즉시 반영 — 주기 전송(~2초)만 기다리면 표시가 어긋난다.
  renderParticipants();
  for (const peer of state.peers.values()) sendMediaStatus(peer);
  syncMobileMicCapture().catch(() => {});
}

function applyMicTrackEnabled() {
  const enabled = !state.muted && !isMicSendProtected();
  if (state.rawMicTrack) state.rawMicTrack.enabled = enabled;
  if (state.micTrack) state.micTrack.enabled = enabled;
  dom.localState.textContent = getLocalStateText();
}

function updateSystemBleedSuppressor() {
  const node = state.micProcess?.bleedSuppressorNode;
  if (!node) {
    state.liveEchoGuard.bleedGain = 1;
    return;
  }

  const target = getSystemBleedSuppressorGain();
  state.liveEchoGuard.bleedGain = target;
  try {
    const currentTime = state.micProcess.context.currentTime;
    node.gain.setTargetAtTime(target, currentTime, target < node.gain.value ? 0.025 : 0.08);
  } catch {
    node.gain.value = target;
  }
}

function getSystemBleedSuppressorGain() {
  if (!state.currentRoom || !shouldUseSystemBleedSuppressor()) return 1;
  const system = state.systemSharing ? state.liveEchoGuard.systemLevel || 0 : 0;
  const remote = getMaxRemotePlaybackLevel();
  const reference = Math.max(system, remote);
  const mic = state.liveEchoGuard.micLevel || 0;
  if (reference < 0.025 || mic < 0.012) return 1;
  if (state.liveEchoGuard.status === "suspect") return 0.12;

  const ratio = mic / Math.max(reference, 0.001);
  if (ratio < 0.4) return 0.18;
  if (ratio < 0.75) return 0.35;
  if (ratio < 1.1 && reference > 0.05) return 0.55;
  return 1;
}

function isMicSendProtected() {
  return false;
}

function protectMicSend(durationMs = 1200) {
  state.liveEchoGuard.protectUntil = 0;
}

function leaveRoom(message = "방에서 나갔습니다.", notifyServer = true) {
  if (notifyServer && state.currentRoom) sendSocket({ type: "leave-room" });
  resetRoomState();
  setMessage(message);
}

function resetRoomState() {
  for (const peerId of [...state.peers.keys()]) removePeer(peerId);
  stopLocalMedia();
  stopStatsTimer();
  stopHealthTimer();
  state.currentRoom = null;
  state.muted = false;
  dom.remoteState.textContent = "대기";
  dom.remoteMeter.style.setProperty("--level", "0%");
  resetStatsView();
  renderCurrentRoom();
  renderParticipants();
  updateControls();
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (peer.offerRetryTimer) window.clearTimeout(peer.offerRetryTimer);
  clearPeerReconnectTimer(peer);
  cleanupPlayback(peer.remote.mic);
  cleanupPlayback(peer.remote.system);
  cleanupScreenPlayback(peer.remote.screen);
  peer.pc.close();
  state.peers.delete(peerId);
  state.senderHealth.delete(`${peerId}:mic`);
  state.senderHealth.delete(`${peerId}:system`);
  state.senderHealth.delete(`${peerId}:screen`);
  state.mediaRepairCooldowns.delete(`${peerId}:mic`);
  state.mediaRepairCooldowns.delete(`${peerId}:system`);
  state.mediaRepairCooldowns.delete(`${peerId}:screen`);
  state.latencyHealth.delete(peerId);
  state.latencyNudges.delete(peerId);
  if (state.peers.size === 0) {
    dom.remoteState.textContent = "대기";
    dom.remoteMeter.style.setProperty("--level", "0%");
  }
  if (state.selectedScreenPeerId === peerId) {
    state.selectedScreenPeerId = "";
    renderScreenStage();
  }
  updateCallStatus();
}

function stopLocalMedia() {
  stopMeters();
  clearProgramAudioSilenceWarning();
  cleanupLocalScreenShare();
  stopMicOnly();
  state.ignoreSystemEndedUntil = Date.now() + 1200;
  for (const track of state.systemStream?.getTracks() || []) track.stop();
  closeSystemEchoFilter();
  state.systemStream = null;
  state.systemCaptureTrack = null;
  state.systemTrack = null;
  state.systemSharing = false;
  state.localStream = null;
  state.senderHealth.clear();
  state.micSendSilentStrikes = 0;
  state.latencyHealth.clear();
  state.latencyNudges.clear();
  state.mediaRepairCooldowns.clear();
  resetLiveEchoGuard();
  dom.localMonitor.srcObject = null;
  dom.localState.textContent = "꺼짐";
  dom.localMeter.style.setProperty("--level", "0%");
}

// 모바일 브라우저는 마이크 캡처가 살아있는 동안 OS가 통화 모드로 전환해
// 볼륨 버튼이 미디어 볼륨 대신 통화 볼륨을 조절한다.
// 뮤트 중에는 캡처를 완전히 놓아 미디어 볼륨 조절이 되게 한다.
function shouldReleaseMicWhileMuted() {
  return isMobileWeb() && state.muted && Boolean(state.currentRoom);
}

async function syncMobileMicCapture() {
  if (!isMobileWeb() || !state.currentRoom) return;
  if (state.muted && state.rawMicTrack) {
    for (const peer of state.peers.values()) {
      if (!peer.senders.mic) continue;
      await peer.senders.mic.replaceTrack(null).catch(() => {});
    }
    stopMicOnly();
    rebuildLocalStream();
    updateTrackStats();
    return;
  }
  if (!state.muted && !state.rawMicTrack) {
    try {
      await replaceMicTrack({ renegotiate: true });
    } catch (error) {
      recordClientError("mobile-mic-reacquire-failed", getErrorText(error));
      setMessage(error.message || "마이크를 다시 켜지 못했습니다.");
    }
  }
}

function stopMicOnly() {
  stopMicMeters();
  state.ignoreMicEndedUntil = Date.now() + 1200;
  if (state.micRestartTimer) {
    window.clearTimeout(state.micRestartTimer);
    state.micRestartTimer = 0;
  }
  closeMicProcess();
  const stopped = new Set();
  for (const stream of [state.rawMicStream]) {
    for (const track of stream?.getTracks() || []) {
      if (stopped.has(track)) continue;
      stopped.add(track);
      track.stop();
    }
  }
  if (state.micTrack && !stopped.has(state.micTrack)) state.micTrack.stop();
  state.rawMicStream = null;
  state.rawMicTrack = null;
  state.micTrack = null;
  state.liveEchoGuard.micLevel = 0;
  state.liveEchoGuard.sendMicLevel = 0;
  updateSystemBleedSuppressor();
}

function closeMicProcess() {
  for (const node of state.micProcess?.nodes || []) {
    node.disconnect?.();
  }
  state.micProcess?.gateNode?.port?.close?.();
  state.micProcess?.context?.close?.().catch(() => {});
  state.micProcess = null;
}

async function scheduleMicRestart(message) {
  if (!state.currentRoom || state.applyingSettings) return;
  if (Date.now() < state.ignoreMicEndedUntil) return;
  if (state.micRestartTimer) return;
  setMessage(message);
  state.micRestartTimer = window.setTimeout(() => {
    state.micRestartTimer = 0;
    applyAudioSettings({ restartMic: true });
  }, 250);
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    renderDeviceOptions(
      dom.inputDeviceSelect,
      audioInputs,
      "기본 입력",
      "voiceChatInputDeviceId",
    );
    renderDeviceOptions(
      dom.systemInputDeviceSelect,
      audioInputs,
      "선택 안 함",
      "voiceChatSystemInputDeviceId",
    );
    renderDeviceOptions(
      dom.outputDeviceSelect,
      devices.filter((device) => device.kind === "audiooutput"),
      "기본 출력",
      "voiceChatOutputDeviceId",
    );
    selectSafeInputDevice();
    selectDefaultSystemInputDevice();
    if (state.systemSharing || dom.systemAudioToggle.checked) await selectSafeOutputDeviceForSystemShare();
    if (state.currentRoom) await selectSafeOutputDeviceForEchoGuard();
    await applyOutputDevice();
    applyRemoteVolumes();
    updateSetupStatus();
    updateSecurityStatus();
  } catch {
    setMessage("오디오 장치 목록을 불러오지 못했습니다.");
  }
}

async function ensureDeviceLabels() {
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  if (devices.some((device) => device.kind === "audioinput" && device.label)) return;

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
  } finally {
    for (const track of stream?.getTracks() || []) track.stop();
  }
}

function renderDeviceOptions(select, devices, fallbackLabel, storageKey) {
  const saved = localStorage.getItem(storageKey || "");
  const previous = select.value || saved || "";
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = fallbackLabel;
  select.append(defaultOption);

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });

  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

async function applyOutputDevice() {
  state.outputSink.supported = supportsOutputSinkSelection();
  state.outputSink.failed = false;
  state.outputSink.lastError = "";

  if (!state.outputSink.supported) {
    if (dom.outputDeviceSelect.value) {
      state.outputSink.failed = true;
      state.outputSink.lastError = "unsupported";
      setMessage("이 환경에서는 앱 안에서 출력 장치를 바꿀 수 없습니다. 운영체제 출력 장치를 확인해 주세요.");
    }
    updateSetupStatus();
    return !state.outputSink.failed;
  }

  const audios = [dom.localMonitor, ...dom.remoteAudios.querySelectorAll("audio")];
  let ok = true;
  for (const audio of audios) {
    if (!await applySinkToAudio(audio)) ok = false;
  }
  updateSetupStatus();
  return ok;
}

async function applySinkToAudio(audio) {
  state.outputSink.supported = supportsOutputSinkSelection();
  applyPlaybackContextSink();
  if (!audio) return true;
  if (!audio.setSinkId) {
    state.outputSink.failed = Boolean(dom.outputDeviceSelect.value);
    state.outputSink.lastError = state.outputSink.failed ? "unsupported" : "";
    return !state.outputSink.failed;
  }
  try {
    await audio.setSinkId(dom.outputDeviceSelect.value || "");
    return true;
  } catch {
    state.outputSink.failed = true;
    state.outputSink.lastError = "failed";
    setMessage("선택한 출력 장치를 적용하지 못했습니다.");
    return false;
  }
}

function supportsOutputSinkSelection() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

function startPlaybackLevelProbe(playback) {
  const context = getPlaybackAudioContext();
  if (!context || !playback?.sourceStream) return null;

  try {
    const source = context.createMediaStreamSource(playback.sourceStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let stopped = false;

    source.connect(analyser);

    const tick = () => {
      playback.level = readAnalyserLevel(analyser, samples);
      const now = Date.now();
      playback.levelUpdatedAt = now;
      // 무음 오탐 방지용 최근(~3초) 피크 레벨 — 순간 값만 보면 말 사이 쉬는 구간을 무음으로 오판한다.
      if (playback.level >= (playback.recentPeakLevel || 0) || now - (playback.recentPeakAt || 0) > 3000) {
        playback.recentPeakLevel = playback.level;
        playback.recentPeakAt = now;
      }
      updatePlaybackOutputLevel(playback);
      updateSystemBleedSuppressor();
      updateLiveEchoGuard();
      updateParticipantMeters();
      frame = requestAnimationFrame(tick);
    };
    tick();

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        source.disconnect();
        analyser.disconnect();
      },
    };
  } catch {
    return null;
  }
}

function startMeter(stream, element, onLevel) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !stream) return null;
  const context = new AudioContext({ latencyHint: "interactive" });
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;
  source.connect(analyser);
  context.resume().catch(() => {});

  const tick = () => {
    const level = readAnalyserLevel(analyser, samples);
    onLevel?.(level);
    element?.style?.setProperty("--level", `${Math.min(100, Math.round(level * 420))}%`);
    frame = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    source.disconnect();
    context.close().catch(() => {});
  };
}

function startLocalMeter() {
  stopMicMeters(false);

  state.rawMicMeterStop = startMeter(new MediaStream([state.rawMicTrack]), null, (level) => {
    state.liveEchoGuard.micLevel = level;
    updateSystemBleedSuppressor();
    updateLiveEchoGuard();
    updateParticipantMeters();
  });

  const sendTrack = state.micTrack || state.rawMicTrack;
  state.localMeterStop = startMeter(new MediaStream([sendTrack]), dom.localMeter, (level) => {
    state.liveEchoGuard.sendMicLevel = level;
    updateParticipantMeters();
  });
}

function stopMicMeters(resetDisplay = true) {
  state.localMeterStop?.();
  state.rawMicMeterStop?.();
  state.localMeterStop = null;
  state.rawMicMeterStop = null;
  state.liveEchoGuard.micLevel = 0;
  state.liveEchoGuard.sendMicLevel = 0;
  if (resetDisplay) dom.localMeter.style.setProperty("--level", "0%");
}

function startRemoteMeter() {
  state.remoteMeterStop?.();
  state.remoteMeterStop = null;
  updateParticipantMeters();
}

function startSystemShareMeter() {
  stopSystemShareMeter();
  if (!state.systemTrack) return;
  state.systemMeterStop = startMeter(new MediaStream([state.systemTrack]), dom.systemMeter, (level) => {
    state.liveEchoGuard.systemLevel = level;
    updateSystemBleedSuppressor();
    updateLiveEchoGuard();
    updateParticipantMeters();
  });
}

function stopSystemShareMeter() {
  state.systemMeterStop?.();
  state.systemMeterStop = null;
  state.liveEchoGuard.systemLevel = 0;
  dom.systemMeter?.style?.setProperty("--level", "0%");
  updateSystemBleedSuppressor();
  updateParticipantMeters();
}

function scheduleProgramAudioSilenceWarning() {
  clearProgramAudioSilenceWarning();
  state.programAudioSilenceTimer = window.setTimeout(() => {
    state.programAudioSilenceTimer = 0;
    if (!state.systemSharing || state.systemCaptureKind !== "program") return;
    if ((state.liveEchoGuard.systemLevel || 0) >= 0.006) return;
    setMessage("선택한 프로그램 소리가 감지되지 않습니다. 보호된 오디오이거나 보조 프로세스에서 재생되는 앱이면 전체 컴퓨터 공유를 사용하세요.");
  }, 4500);
}

function clearProgramAudioSilenceWarning() {
  if (!state.programAudioSilenceTimer) return;
  window.clearTimeout(state.programAudioSilenceTimer);
  state.programAudioSilenceTimer = 0;
}

async function ensureSystemBleedSuppressor() {
  if (!shouldUseSystemBleedSuppressor()) return;
  if (state.micProcess?.bleedSuppressorNode) {
    updateSystemBleedSuppressor();
    return;
  }
  if (!state.currentRoom || state.applyingSettings) return;
  await replaceMicTrack({ renegotiate: false });
}

function readAnalyserLevel(analyser, samples) {
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

function updateLiveEchoGuard() {
  return;
}

function getMaxRemotePlaybackLevel() {
  let level = 0;
  for (const peer of state.peers.values()) {
    level = Math.max(level, peer.remote.mic?.outputLevel || 0, peer.remote.system?.outputLevel || 0);
  }
  return level;
}

function stopMeters() {
  stopMicMeters();
  state.remoteMeterStop?.();
  stopSystemShareMeter();
  state.remoteMeterStop = null;
}

function startStatsTimer() {
  stopStatsTimer();
  state.statsTimer = window.setInterval(updateStats, 1000);
  updateStats().catch(() => {});
}

function stopStatsTimer() {
  if (state.statsTimer) window.clearInterval(state.statsTimer);
  state.statsTimer = 0;
  state.previousStats.clear();
  state.previousCounters.clear();
}

function startHealthTimer() {
  stopHealthTimer();
  state.healthTimer = window.setInterval(() => {
    checkMediaHealth().catch(() => {});
  }, 2200);
  checkMediaHealth().catch(() => {});
}

function stopHealthTimer() {
  if (state.healthTimer) window.clearInterval(state.healthTimer);
  state.healthTimer = 0;
  state.healthChecking = false;
  state.senderHealth.clear();
  state.mediaRepairCooldowns.clear();
}

async function checkMediaHealth() {
  if (!state.currentRoom || state.applyingSettings || state.healthChecking) return;
  state.healthChecking = true;
  try {
    // 모바일 뮤트 상태에선 마이크 캡처를 의도적으로 놓아둔다 — 재시작 금지.
    const micReleased = shouldReleaseMicWhileMuted();
    if (!micReleased) {
      if (
        !state.rawMicTrack ||
        state.rawMicTrack.readyState !== "live" ||
        !state.micTrack ||
        state.micTrack.readyState !== "live"
      ) {
        scheduleMicRestart("마이크가 끊겨 다시 연결합니다.");
        return;
      }

      if (await checkLocalMicSendLevel()) return;
    }

    for (const peer of state.peers.values()) {
      if (!isPeerReadyForMediaHealth(peer)) {
        logClientEvent("media-health-skipped", makePeerDebugDetail(peer, getPeerHealthBlockReason(peer)));
        continue;
      }

      let needsOffer = false;
      applyMicTrackEnabled();

      if (micReleased) {
        // 해제 상태에서는 mic sender를 손대지 않는다.
      } else if (!peer.senders.mic || !peer.localStreams.mic) {
        if (peer.senders.mic) peer.pc.removeTrack(peer.senders.mic);
        peer.senders.mic = addLocalTrack(peer, state.micTrack, "mic");
        tuneSender(peer.senders.mic, "mic");
        needsOffer = true;
      } else if (peer.senders.mic.track !== state.micTrack || peer.senders.mic.track?.readyState !== "live") {
        await peer.senders.mic.replaceTrack(state.micTrack);
        sendTrackInfo(peer, peer.localStreams.mic.id, "mic");
        tuneSender(peer.senders.mic, "mic");
      }

      if (state.systemTrack && (!peer.senders.system || !peer.localStreams.system)) {
        if (peer.senders.system) peer.pc.removeTrack(peer.senders.system);
        peer.senders.system = addLocalTrack(peer, state.systemTrack, "system");
        tuneSender(peer.senders.system, "system");
        needsOffer = true;
      } else if (
        state.systemTrack &&
        (peer.senders.system.track !== state.systemTrack || peer.senders.system.track?.readyState !== "live")
      ) {
        await peer.senders.system.replaceTrack(state.systemTrack);
        sendTrackInfo(peer, peer.localStreams.system.id, "system");
        tuneSender(peer.senders.system, "system");
      }

      if (state.screenTrack && (!peer.senders.screen || !peer.localStreams.screen)) {
        if (peer.senders.screen) peer.pc.removeTrack(peer.senders.screen);
        peer.senders.screen = addLocalTrack(peer, state.screenTrack, "screen");
        tuneSender(peer.senders.screen, "screen");
        needsOffer = true;
      } else if (
        state.screenTrack &&
        (peer.senders.screen.track !== state.screenTrack || peer.senders.screen.track?.readyState !== "live")
      ) {
        await peer.senders.screen.replaceTrack(state.screenTrack);
        sendTrackInfo(peer, peer.localStreams.screen.id, "screen");
        tuneSender(peer.senders.screen, "screen");
      }

      if (needsOffer) await makeOffer(peer);
      await checkSenderFlow(peer, "mic");
      await checkSenderFlow(peer, "system");
      await checkSenderFlow(peer, "screen");
      sendMediaStatus(peer);
      checkRemoteMediaExpectation(peer);
    }
  } finally {
    state.healthChecking = false;
  }
}

function shouldSendMediaStatus(peer) {
  if (!peer) return false;
  if (!peer.initialOfferSent && !peer.pc.remoteDescription) return false;
  return peer.pc.signalingState === "stable";
}

function isPeerReadyForMediaHealth(peer) {
  if (!peer || !isPeerConnected(peer)) return false;
  if (peer.pc.signalingState !== "stable") return false;
  if (!peer.connectedAt) return false;
  return Date.now() - peer.connectedAt >= 5000;
}

function getPeerHealthBlockReason(peer) {
  if (!peer) return "no-peer";
  if (!isPeerConnected(peer)) return "not-connected";
  if (peer.pc.signalingState !== "stable") return `signaling-${peer.pc.signalingState}`;
  if (!peer.connectedAt) return "no-connected-time";
  const remaining = Math.max(0, 5000 - (Date.now() - peer.connectedAt));
  return remaining > 0 ? `grace-${remaining}ms` : "ready";
}

async function checkLocalMicSendLevel() {
  if (state.muted || isMicSendProtected()) {
    state.micSendSilentStrikes = 0;
    return false;
  }

  const rawLevel = state.liveEchoGuard.micLevel || 0;
  const sendLevel = state.liveEchoGuard.sendMicLevel || 0;
  if (rawLevel < 0.035) {
    state.micSendSilentStrikes = 0;
    return false;
  }

  if (sendLevel >= Math.max(0.005, rawLevel * 0.1)) {
    state.micSendSilentStrikes = 0;
    return false;
  }

  state.micSendSilentStrikes += 1;
  if (state.micSendSilentStrikes < 2) return false;

  state.micSendSilentStrikes = 0;
  setMessage("마이크 입력은 있지만 송신 레벨이 없어 마이크 송신을 다시 연결합니다.");
  await replaceMicTrack();
  return true;
}

async function checkSenderFlow(peer, role) {
  if ((role === "mic" && state.muted) || !isPeerConnected(peer)) return;
  const sender = peer.senders[role];
  if (!sender) return;

  if (sender.track?.readyState !== "live") {
    state.senderHealth.delete(`${peer.id}:${role}`);
    await repairLocalTrackForPeer(peer, role, { restart: role === "mic" });
    return;
  }

  if (role === "system") return;
  if (role === "screen") return;
  if (!sender.getStats) return;

  const stats = await sender.getStats();
  let bytes = 0;
  stats.forEach((report) => {
    if (report.type === "outbound-rtp" && report.kind === "audio") {
      bytes += report.bytesSent || 0;
    }
  });
  const key = `${peer.id}:${role}`;
  const previous = state.senderHealth.get(key);
  if (!previous || bytes > previous.bytes) {
    state.senderHealth.set(key, { bytes, stalled: 0 });
    return;
  }

  const stalled = previous.stalled + 1;
  state.senderHealth.set(key, { bytes, stalled });
  if (stalled < 2) return;

  state.senderHealth.delete(key);
  setMessage(role === "mic"
    ? "마이크 송신이 멈춰 자동으로 다시 연결합니다."
    : "컴퓨터 사운드 송신이 멈춰 자동으로 다시 연결합니다.");
  await repairLocalTrackForPeer(peer, role, { restart: role === "mic" });
}

function sendMediaStatus(peer) {
  if (!shouldSendMediaStatus(peer)) {
    logClientEvent("media-status-deferred", makePeerDebugDetail(peer, getPeerHealthBlockReason(peer)));
    return;
  }
  sendSignal(peer.id, {
    mediaStatus: {
      mic: {
        live: state.micTrack?.readyState === "live",
        streamId: peer.localStreams.mic?.id || "",
        muted: state.muted,
        level: state.liveEchoGuard.sendMicLevel || 0,
      },
      system: {
        live: state.systemSharing && state.systemTrack?.readyState === "live",
        streamId: peer.localStreams.system?.id || "",
        muted: false,
        level: state.liveEchoGuard.systemLevel || 0,
      },
      screen: {
        live: state.screenSharing && state.screenTrack?.readyState === "live",
        streamId: peer.localStreams.screen?.id || "",
        muted: false,
        level: 0,
      },
    },
  });
}

async function handleMediaStatus(peer, status) {
  const wasMicMuted = Boolean(peer.remoteStatus?.mic?.muted);
  peer.remoteStatus.updatedAt = Date.now();
  for (const role of ["mic", "system", "screen"]) {
    const value = normalizeRemoteMediaStatus(status[role]);
    peer.remoteStatus[role] = value;
    if (role === "screen" && !value.live && peer.remote.screen) {
      cleanupScreenPlayback(peer.remote.screen);
      peer.remote.screen = null;
      if (state.selectedScreenPeerId === peer.id) state.selectedScreenPeerId = "";
      renderParticipants();
      renderScreenStage();
    }
    if (value.streamId) {
      peer.trackRoles.set(value.streamId, role);
      acceptRemoteStatusTrack(peer, role, value.streamId);
    }
  }
  if (wasMicMuted !== Boolean(peer.remoteStatus?.mic?.muted)) renderParticipants();
  checkRemoteMediaExpectation(peer);
}

function acceptRemoteStatusTrack(peer, role, streamId) {
  const track = peer.remoteStreamTracks.get(streamId);
  if (!track) return;
  const acceptedRole = peer.acceptedRemoteRoles.get(streamId);
  if (acceptedRole === role && peer.remote[role]?.track === track) return;
  acceptRemoteTrack(peer, track, role, streamId);
}

function normalizeRemoteMediaStatus(value) {
  return {
    live: Boolean(value?.live),
    streamId: String(value?.streamId || ""),
    muted: Boolean(value?.muted),
    level: clampAudioLevel(value?.level),
  };
}

function clampAudioLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function checkRemoteMediaExpectation(peer) {
  if (!isPeerReadyForMediaHealth(peer)) {
    logClientEvent("remote-expectation-deferred", makePeerDebugDetail(peer, getPeerHealthBlockReason(peer)));
    return;
  }

  for (const role of ["mic", "system", "screen"]) {
    const expected = peer.remoteStatus[role];
    if (!expected?.live || expected.muted) {
      peer.remoteMissing[role] = 0;
      if (role !== "screen") peer.remoteSilent[role] = 0;
      continue;
    }

    const playback = peer.remote[role];
    const live = playback?.track?.readyState === "live";
    const streamMatches = !expected.streamId || playback?.streamId === expected.streamId;
    if (live && streamMatches) {
      peer.remoteMissing[role] = 0;
      if (role === "screen") continue;
      if (hasRemoteSilentMismatch(role, expected, playback)) {
        peer.remoteSilent[role] += 1;
        // 무음 복구는 상대 마이크를 통째로 재시작하므로 3회(~6.6초) 연속일 때만 요청한다.
        if (peer.remoteSilent[role] >= 3) {
          peer.remoteSilent[role] = 0;
          requestRemoteRepair(peer, role, "silent");
        }
      } else {
        peer.remoteSilent[role] = 0;
      }
      continue;
    }

    peer.remoteMissing[role] += 1;
    if (peer.remoteMissing[role] < 2) continue;
    requestRemoteRepair(peer, role, "missing");
  }
}

function hasRemoteSilentMismatch(role, expected, playback) {
  if (role !== "mic") return false;
  if (expected.level < 0.035) return false;
  // 레벨 프로브가 없거나 멈춰 있으면(백그라운드 스로틀, 컨텍스트 suspended 등) 판단 불가 —
  // 이 상태에서 무음으로 단정하면 상대 마이크가 이유 없이 재시작된다.
  if (!playback?.levelProbe) return false;
  if (!playback.levelUpdatedAt || Date.now() - playback.levelUpdatedAt > 1500) return false;
  const receivedLevel = Math.max(playback.level || 0, playback.recentPeakLevel || 0);
  return receivedLevel < Math.max(0.004, expected.level * 0.08);
}

function requestRemoteRepair(peer, role, reason = "missing") {
  if (!isPeerReadyForMediaHealth(peer)) {
    logClientEvent("repair-request-blocked", makePeerDebugDetail(peer, `${role}:${reason}:${getPeerHealthBlockReason(peer)}`));
    return;
  }
  const key = `${peer.id}:${role}`;
  const now = Date.now();
  const last = state.mediaRepairCooldowns.get(key) || 0;
  if (now - last < 6000) return;

  state.mediaRepairCooldowns.set(key, now);
  sendSignal(peer.id, { repairRequest: { role, reason } });
  // 복구는 조용히 진행한다 — 토스트로 알리면 오탐 때마다 사용자만 불안해진다.
  logClientEvent("repair-request-sent", makePeerDebugDetail(peer, `${role}:${reason}`));
}

async function handleRepairRequest(peer, request) {
  if (!state.currentRoom || state.applyingSettings) return;
  const role = request?.role === "screen" ? "screen" : request?.role === "system" ? "system" : "mic";
  if (!isPeerReadyForMediaHealth(peer)) {
    logClientEvent("repair-request-received-blocked", makePeerDebugDetail(peer, `${role}:${request?.reason || "missing"}:${getPeerHealthBlockReason(peer)}`));
    return;
  }
  logClientEvent("repair-request", makePeerDebugDetail(peer, `${role}:${request?.reason || "missing"}`));
  await repairLocalTrackForPeer(peer, role, { restart: request?.reason === "silent" });
}

async function repairLocalTrackForPeer(peer, role, options = {}) {
  if (role === "mic") {
    if (
      options.restart ||
      !state.rawMicTrack ||
      state.rawMicTrack.readyState !== "live" ||
      !state.micTrack ||
      state.micTrack.readyState !== "live"
    ) {
      await replaceMicTrack();
    }
    if (!state.micTrack) return;

    if (!peer.senders.mic || !peer.localStreams.mic) {
      if (peer.senders.mic) peer.pc.removeTrack(peer.senders.mic);
      peer.senders.mic = addLocalTrack(peer, state.micTrack, "mic");
    } else {
      await peer.senders.mic.replaceTrack(state.micTrack);
      sendTrackInfo(peer, peer.localStreams.mic.id, "mic");
    }
    tuneSender(peer.senders.mic, "mic");
    await makeOffer(peer);
    sendMediaStatus(peer);
    return;
  }

  if (role === "screen") {
    if (!state.screenSharing) return;
    if (!state.screenTrack || state.screenTrack.readyState !== "live") {
      sendMediaStatus(peer);
      return;
    }

    if (!peer.senders.screen || !peer.localStreams.screen) {
      if (peer.senders.screen) peer.pc.removeTrack(peer.senders.screen);
      peer.senders.screen = addLocalTrack(peer, state.screenTrack, "screen");
    } else {
      await peer.senders.screen.replaceTrack(state.screenTrack);
      sendTrackInfo(peer, peer.localStreams.screen.id, "screen");
    }
    tuneSender(peer.senders.screen, "screen");
    await makeOffer(peer);
    sendMediaStatus(peer);
    return;
  }

  if (!state.systemSharing) return;
  if (!state.systemTrack || state.systemTrack.readyState !== "live") {
    await restartSystemAudio();
    sendMediaStatus(peer);
    return;
  }

  if (!peer.senders.system || !peer.localStreams.system) {
    if (peer.senders.system) peer.pc.removeTrack(peer.senders.system);
    peer.senders.system = addLocalTrack(peer, state.systemTrack, "system");
  } else {
    await peer.senders.system.replaceTrack(state.systemTrack);
    sendTrackInfo(peer, peer.localStreams.system.id, "system");
  }
  tuneSender(peer.senders.system, "system");
  await makeOffer(peer);
  sendMediaStatus(peer);
}

async function updateStats() {
  let sendBps = 0;
  let receiveBps = 0;
  let rttTotal = 0;
  let rttCount = 0;
  let jitterTotal = 0;
  let jitterCount = 0;
  let bufferTotal = 0;
  let bufferCount = 0;
  let concealedSamples = 0;
  let totalSamples = 0;
  let audioLevelTotal = 0;
  let audioLevelCount = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let codec = "";
  let screenSendBps = 0;
  let screenReceiveBps = 0;
  let screenBytesSent = 0;
  let screenBytesReceived = 0;
  let screenSenderFps = 0;
  let screenReceiverFps = 0;
  let screenFramesEncoded = 0;
  let screenFramesSent = 0;
  let screenFramesDecoded = 0;
  let screenFramesDropped = 0;
  let screenFreezeCount = 0;
  let screenHugeFrames = 0;
  let screenQpSum = 0;
  let screenBytesSentDelta = 0;
  let screenFramesEncodedDelta = 0;
  let screenFramesSentDelta = 0;
  let screenQpSumDelta = 0;
  let screenEncodeTimeDelta = 0;
  let screenQualityDurations = {};
  const screenQualityReasons = new Set();
  const screenEncoders = new Set();
  const screenPowerEfficientEncoders = new Set();
  const screenSenderDiagnostics = [];
  const processedScreenOutboundReports = new Set();
  let screenOutboundReportCount = 0;
  let candidateText = "";

  const processScreenOutboundReport = (peer, report, now, source) => {
    if (!isVideoOutboundReport(report)) return;
    const reportKey = `${peer.id}:${report.id}`;
    if (processedScreenOutboundReports.has(reportKey)) return;
    processedScreenOutboundReports.add(reportKey);
    screenOutboundReportCount += 1;
    const bytesSent = Number(report.bytesSent || 0);
    const framesEncoded = Number(report.framesEncoded || 0);
    const framesSent = Number(report.framesSent || 0);
    const qpSum = Number(report.qpSum || 0);
    const totalEncodeTime = Number(report.totalEncodeTime || 0);
    screenBytesSent += bytesSent;
    screenSendBps += getBitrate(`${peer.id}:${report.id}:video`, bytesSent, now);
    screenSenderFps = Math.max(screenSenderFps, Number(report.framesPerSecond || 0));
    screenFramesEncoded += framesEncoded;
    screenFramesSent += framesSent;
    screenHugeFrames += Number(report.hugeFramesSent || 0);
    screenQpSum += qpSum;
    screenBytesSentDelta += getStatsCounterDelta(`${peer.id}:${report.id}:screen-bytesSent`, bytesSent);
    screenFramesEncodedDelta += getStatsCounterDelta(`${peer.id}:${report.id}:screen-framesEncoded`, framesEncoded);
    screenFramesSentDelta += getStatsCounterDelta(`${peer.id}:${report.id}:screen-framesSent`, framesSent);
    screenQpSumDelta += getStatsCounterDelta(`${peer.id}:${report.id}:screen-qpSum`, qpSum);
    screenEncodeTimeDelta += getStatsCounterDelta(`${peer.id}:${report.id}:screen-totalEncodeTime`, totalEncodeTime);
    if (report.qualityLimitationReason) screenQualityReasons.add(report.qualityLimitationReason);
    addQualityLimitationDurations(screenQualityDurations, report.qualityLimitationDurations);
    if (report.encoderImplementation) screenEncoders.add(report.encoderImplementation);
    if (typeof report.powerEfficientEncoder === "boolean") screenPowerEfficientEncoders.add(String(report.powerEfficientEncoder));
    if (source) screenSenderDiagnostics.push(`peer=${peer.name || peer.id} stats=${source}`);
  };

  for (const peer of state.peers.values()) {
    const now = Date.now();
    if (state.screenSharing) {
      screenSenderDiagnostics.push(getScreenSenderDiagnostic(peer));
      const sender = peer.senders?.screen;
      if (sender?.getStats) {
        try {
          const senderStats = await sender.getStats();
          senderStats.forEach((report) => processScreenOutboundReport(peer, report, now, "sender.getStats"));
        } catch (error) {
          screenSenderDiagnostics.push(`peer=${peer.name || peer.id} senderStatsError=${getErrorText(error)}`);
        }
      } else if (sender) {
        screenSenderDiagnostics.push(`peer=${peer.name || peer.id} senderStatsApi=missing`);
      }
    }

    const stats = await peer.pc.getStats();

    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "audio") {
        sendBps += getBitrate(`${peer.id}:${report.id}`, report.bytesSent, now);
      }
      processScreenOutboundReport(peer, report, now, "pc.getStats");
      if (report.type === "inbound-rtp" && report.kind === "audio") {
        receiveBps += getBitrate(`${peer.id}:${report.id}`, report.bytesReceived, now);
        packetsLost += report.packetsLost || 0;
        packetsReceived += report.packetsReceived || 0;
        const concealDelta = getCounterDelta(`${peer.id}:${report.id}:conceal`, report.concealedSamples || 0, report.totalSamplesReceived || 0);
        concealedSamples += concealDelta.value;
        totalSamples += concealDelta.count;
        if (typeof report.audioLevel === "number") {
          audioLevelTotal += report.audioLevel;
          audioLevelCount += 1;
        }
        if (
          typeof report.jitterBufferDelay === "number" &&
          typeof report.jitterBufferEmittedCount === "number" &&
          report.jitterBufferEmittedCount > 0
        ) {
          const bufferSeconds = getCounterAverageDelta(
            `${peer.id}:${report.id}:jitter-buffer`,
            report.jitterBufferDelay,
            report.jitterBufferEmittedCount,
          );
          if (typeof bufferSeconds === "number") {
            const bufferMs = bufferSeconds * 1000;
            bufferTotal += bufferMs;
            bufferCount += 1;
            handleLatencySample(peer, bufferMs);
          }
        }
        if (typeof report.jitter === "number") {
          jitterTotal += report.jitter;
          jitterCount += 1;
        }
        const codecReport = stats.get(report.codecId);
        if (codecReport?.mimeType) codec = codecReport.mimeType.replace("audio/", "");
      }
      if (report.type === "inbound-rtp" && report.kind === "video") {
        screenBytesReceived += Number(report.bytesReceived || 0);
        screenReceiveBps += getBitrate(`${peer.id}:${report.id}:video`, report.bytesReceived || 0, now);
        screenReceiverFps = Math.max(screenReceiverFps, Number(report.framesPerSecond || 0));
        screenFramesDecoded += Number(report.framesDecoded || 0);
        screenFramesDropped += Number(report.framesDropped || 0);
        screenFreezeCount += Number(report.freezeCount || 0);
      }
      if (report.type === "candidate-pair" && report.state === "succeeded" && typeof report.currentRoundTripTime === "number") {
        rttTotal += report.currentRoundTripTime;
        rttCount += 1;
        const local = stats.get(report.localCandidateId);
        const remote = stats.get(report.remoteCandidateId);
        if (!candidateText && local && remote) {
          candidateText = `${peer.name} ${formatCandidate(local)} -> ${formatCandidate(remote)}`;
        }
      }
      if (report.type === "remote-inbound-rtp" && typeof report.roundTripTime === "number") {
        rttTotal += report.roundTripTime;
        rttCount += 1;
      }
    });
  }

  dom.statSend.textContent = `${Math.round(sendBps / 1000)} kbps`;
  dom.statReceive.textContent = `${Math.round(receiveBps / 1000)} kbps`;
  dom.statRtt.textContent = rttCount ? `${Math.round((rttTotal / rttCount) * 1000)} ms` : "-";
  dom.statJitter.textContent = jitterCount ? `${Math.round((jitterTotal / jitterCount) * 1000)} ms` : "-";
  const totalPackets = packetsLost + packetsReceived;
  const lossPercent = totalPackets ? (packetsLost / totalPackets) * 100 : 0;
  const concealPercent = totalSamples ? (concealedSamples / totalSamples) * 100 : 0;
  const bufferMs = bufferCount ? bufferTotal / bufferCount : 0;
  const levelPercent = audioLevelCount ? (audioLevelTotal / audioLevelCount) * 100 : 0;
  const sendLevelPercent = Math.round((state.liveEchoGuard.sendMicLevel || 0) * 100);
  setCompactStat(dom.statLoss, totalPackets ? `${((packetsLost / totalPackets) * 100).toFixed(1)}%` : "-");
  setCompactStat(dom.statCodec, codec || "-");
  setCompactStat(dom.statBuffer, bufferCount ? `${Math.round(bufferMs)} ms` : "-");
  setCompactStat(dom.statConcealment, totalSamples ? `${concealPercent.toFixed(1)}%` : "-");
  setCompactStat(dom.statAudioLevel, audioLevelCount
    ? `수신 ${Math.round(levelPercent)}% / 송신 ${sendLevelPercent}%`
    : `송신 ${sendLevelPercent}%`);
  dom.statProcessing.textContent = getProcessingText(state.rawMicTrack?.getSettings?.() || {});
  dom.statProcessing.title = dom.statProcessing.textContent;
  state.screenStats.capture = getScreenCaptureStatsText();
  state.screenStats.sender = screenSendBps || screenBytesSent || screenFramesEncoded || screenSenderFps || screenQpSum
    ? [
      `sender bitrate=${Math.round(screenSendBps / 1000)}kbps`,
      `bytesSent=${screenBytesSent}`,
      `bytesDelta=${screenBytesSentDelta}`,
      `framesPerSecond=${Math.round(screenSenderFps) || 0}`,
      `framesEncoded=${screenFramesEncoded}`,
      `framesEncodedDelta=${screenFramesEncodedDelta}`,
      screenFramesSent ? `framesSent=${screenFramesSent}` : "",
      screenFramesSentDelta ? `framesSentDelta=${screenFramesSentDelta}` : "",
      screenHugeFrames ? `hugeFramesSent=${screenHugeFrames}` : "",
      `qpSum=${screenQpSum}`,
      screenQpSumDelta ? `qpSumDelta=${screenQpSumDelta}` : "",
      screenEncodeTimeDelta ? `encodeTimeDelta=${screenEncodeTimeDelta.toFixed(3)}s` : "",
      screenQualityReasons.size ? `qualityLimitationReason=${[...screenQualityReasons].join("+")}` : "",
      formatQualityLimitationDurations(screenQualityDurations),
      screenEncoders.size ? `encoderImplementation=${[...screenEncoders].join("+")}` : "",
      screenPowerEfficientEncoders.size ? `powerEfficientEncoder=${[...screenPowerEfficientEncoders].join("+")}` : "",
    ].filter(Boolean).join(" ")
    : getScreenSenderUnavailableText(screenSenderDiagnostics);
  state.screenStats.receiver = screenReceiveBps || screenBytesReceived || screenFramesDecoded || screenFramesDropped || screenFreezeCount
    ? `receiver bitrate=${Math.round(screenReceiveBps / 1000)}kbps bytesReceived=${screenBytesReceived} framesPerSecond=${Math.round(screenReceiverFps) || 0} framesDecoded=${screenFramesDecoded} framesDropped=${screenFramesDropped} freezeCount=${screenFreezeCount}`
    : "";
  state.screenStats.bottleneck = getScreenBottleneckText(screenSenderFps, screenOutboundReportCount);
  updateScreenStatsLabel();
  logScreenShareStatsIfNeeded();
  updateConnectionStatsLabel({ candidateText, sendBps, receiveBps });
  checkMediaByteFlow({ sendBps, receiveBps, candidateText });
  handleScreenSenderPerformance(screenSenderFps);
  const health = getQualityHealthText({
    receiveBps,
    rttMs: rttCount ? (rttTotal / rttCount) * 1000 : 0,
    jitterMs: jitterCount ? (jitterTotal / jitterCount) * 1000 : 0,
    bufferMs,
    lossPercent,
    concealPercent,
    levelPercent,
  });
  setCompactStat(dom.statHealth, health);
  if (dom.qualitySummary) {
    const sendText = `${Math.round(sendBps / 1000)}↑`;
    const receiveText = `${Math.round(receiveBps / 1000)}↓`;
    const rttText = rttCount ? `${Math.round((rttTotal / rttCount) * 1000)}ms` : "-";
    dom.qualitySummary.textContent = `${sendText} ${receiveText} ${rttText} ${health}`;
  }
}

function getScreenCaptureStatsText() {
  const settings = state.screenTrack?.getSettings?.();
  if (!settings) return "";
  const width = Math.round(Number(settings.width || 0));
  const height = Math.round(Number(settings.height || 0));
  const frameRate = Math.round(Number(settings.frameRate || 0));
  const size = width && height ? `${width}x${height}` : "크기 확인";
  const probeFps = Number(state.screenCaptureProbe?.fps || 0);
  const probeText = state.screenProbeEnabled ? ` captureProbe=${probeFps.toFixed(1)}fps` : " captureProbe=off";
  const probeMethod = state.screenCaptureProbe?.method ? ` probe=${state.screenCaptureProbe.method}` : "";
  return `캡처 ${size}${frameRate ? ` ${frameRate}fps` : ""}${probeText}${probeMethod} ${getScreenPreviewDebugText()} ${getScreenProbeDebugText()}`;
}

function updateScreenStatsLabel() {
  const parts = [
    state.screenStats.capture,
    state.screenStats.sender,
    state.screenStats.receiver,
    state.screenStats.bottleneck,
  ].filter(Boolean);
  setCompactStat(dom.statScreenShare, parts.length ? parts.join(" / ") : "-");
}

function scheduleScreenShareStatsLog(event) {
  window.setTimeout(() => {
    if (!hasAnyScreenShareStats()) return;
    logScreenShareStats(event);
  }, 5000);
}

function logScreenShareStatsIfNeeded() {
  if (!hasAnyScreenShareStats()) {
    state.lastScreenStatsLogAt = 0;
    return;
  }
  const now = Date.now();
  if (now - state.lastScreenStatsLogAt < 5000) return;
  logScreenShareStats("screen-stats");
}

function logScreenShareStats(event) {
  if (!hasAnyScreenShareStats()) return;
  state.lastScreenStatsLogAt = Date.now();
  logClientEvent(event, [
    `captureMode=${state.screenCaptureMode}`,
    `captureMethod=${state.screenCaptureMethod || "-"}`,
    `electron=${desktop.electronVersion || state.screenDesktopDiagnostics?.electronVersion || "-"}`,
    `resolutionSetting=${state.screenResolution}`,
    `fpsSetting=${state.screenFps}`,
    getScreenPreviewDebugText(),
    getScreenProbeDebugText(),
    getScreenCaptureSourceText(),
    `requested=${formatCompactJson(state.screenCaptureRequested)}`,
    getScreenCaptureStatsText(),
    getScreenCaptureSizeComparisonText(),
    state.screenStats.sender || "sender=-",
    state.screenStats.receiver || "receiver=-",
    state.screenStats.bottleneck || "bottleneck=pending",
    `track=${getTrackDebugText(state.screenTrack)}`,
    `devicePixelRatio=${window.devicePixelRatio || 1}`,
  ].filter(Boolean).join(" / "));
}

function hasAnyScreenShareStats() {
  return state.screenSharing ||
    hasActiveRemoteScreen() ||
    Boolean(state.screenStats.sender) ||
    Boolean(state.screenStats.receiver);
}

function hasActiveRemoteScreen() {
  for (const peer of state.peers.values()) {
    if (peer.remote?.screen?.track?.readyState === "live") return true;
  }
  return false;
}

function handleScreenSenderPerformance(senderFps) {
  if (!state.screenSharing || Number(state.screenFps || 30) < 60) {
    state.screenLowFpsStrikes = 0;
    return;
  }
  if (!senderFps || senderFps >= 45) {
    state.screenLowFpsStrikes = 0;
    return;
  }

  state.screenLowFpsStrikes += 1;
  if (state.screenLowFpsStrikes < 3) return;
  state.screenLowFpsStrikes = 0;
  logClientEvent("screen-low-fps", state.screenStats.sender || getScreenCaptureStatsText());
  setMessage("화면공유 60fps 인코딩 FPS가 낮습니다. 끊기면 30fps로 낮추는 게 안정적입니다.");
}

function updateConnectionStatsLabel({ candidateText, sendBps, receiveBps }) {
  const turnText = hasTurnServer() ? "TURN 있음" : "TURN 없음";
  const bytesText = `A ${Math.round(sendBps / 1000)}↑/${Math.round(receiveBps / 1000)}↓`;
  setCompactStat(dom.statConnection, [candidateText, bytesText, turnText].filter(Boolean).join(" / ") || "-");
}

function formatCandidate(candidate) {
  const type = candidate.candidateType || candidate.type || "?";
  const protocol = candidate.protocol || "";
  const address = candidate.address || candidate.ip || "";
  return [type, protocol, address].filter(Boolean).join(":");
}

function isVideoOutboundReport(report) {
  return report?.type === "outbound-rtp" &&
    (report.kind === "video" || report.mediaType === "video") &&
    !report.isRemote;
}

function getScreenSenderDiagnostic(peer) {
  const pc = peer?.pc;
  const pcState = pc
    ? `pc=${pc.connectionState}/${pc.iceConnectionState}/${pc.signalingState}`
    : "pc=none";
  const name = peer?.name || peer?.id || "unknown";
  const sender = peer?.senders?.screen;
  if (!sender) return `peer=${name} screenSender=missing ${pcState}`;
  const track = sender.track;
  if (!track) return `peer=${name} screenSender=no-track ${pcState}`;
  if (track !== state.screenTrack) {
    return `peer=${name} screenSender=track-mismatch senderTrack=${getTrackDebugText(track)} localTrack=${getTrackDebugText(state.screenTrack)} ${pcState}`;
  }
  const connected = pc?.connectionState === "connected" || pc?.iceConnectionState === "connected" || pc?.iceConnectionState === "completed";
  return `peer=${name} screenSender=ok connected=${connected ? "1" : "0"} track=${getTrackDebugText(track)} ${pcState}`;
}

function getScreenSenderUnavailableText(diagnostics) {
  if (!state.screenSharing) return "";
  const reasons = diagnostics.length ? diagnostics.join("; ") : "peer=none";
  return `sender stats unavailable reason=${reasons}`;
}

function getScreenBottleneckText(senderFps, screenOutboundReportCount) {
  if (!state.screenSharing) return "";
  const captureFps = Number(state.screenCaptureProbe?.fps || 0);
  const targetFps = Math.max(15, Math.min(60, Number(state.screenFps || 30)));
  const lowThreshold = Math.min(45, targetFps * 0.75);
  if (!screenOutboundReportCount) return "bottleneck=pending sender stats unavailable";
  if (!state.screenProbeEnabled || !captureFps) return "bottleneck=pending capture probe unavailable";
  if (captureFps < lowThreshold && senderFps < lowThreshold) return "bottleneck=capture-gpu";
  if (captureFps >= lowThreshold && senderFps < lowThreshold) return "bottleneck=encoder-sender";
  if (senderFps >= lowThreshold) return "bottleneck=no-low-fps";
  return "bottleneck=pending";
}

function checkMediaByteFlow({ sendBps, receiveBps, candidateText }) {
  if (!state.currentRoom || ![...state.peers.values()].some(isPeerConnected)) {
    state.mediaZeroHealth.clear();
    return;
  }

  const expectedSend = !state.muted && state.micTrack?.readyState === "live";
  updateMediaZeroStrike("audio-send", expectedSend && sendBps <= 0, `WebRTC connected but audio bytesSent is 0. ${candidateText || getCallDebugSummary()}`);
  updateMediaZeroStrike("audio-receive", state.peers.size > 0 && receiveBps <= 0, `WebRTC connected but audio bytesReceived is 0. ${candidateText || getCallDebugSummary()}`);
}

function updateMediaZeroStrike(key, active, detail) {
  const next = active ? (state.mediaZeroHealth.get(key) || 0) + 1 : 0;
  if (next <= 0) {
    state.mediaZeroHealth.delete(key);
    return;
  }
  state.mediaZeroHealth.set(key, next);
  if (next === 3) recordClientError(`media-${key}-zero`, detail);
}

function handleLatencySample(peer, bufferMs) {
  if (!dom.lowLatencyToggle.checked || !Number.isFinite(bufferMs)) return;
  const previous = state.latencyHealth.get(peer.id) || { high: 0 };
  const high = bufferMs > 30 ? previous.high + 1 : 0;
  state.latencyHealth.set(peer.id, { high });
  if (high < 1) return;

  applyReceiverLatency(peer);
  nudgePlaybackLatency(peer, bufferMs);
  state.latencyHealth.set(peer.id, { high: 0 });
}

function nudgePlaybackLatency(peer, bufferMs = 0) {
  const key = peer.id;
  if (state.latencyNudges.get(key)) return;
  const playbacks = [peer.remote.mic, peer.remote.system].filter(Boolean);
  if (!playbacks.length) return;

  const rate = bufferMs >= 180 ? 1.26 : bufferMs >= 90 ? 1.18 : 1.1;
  const duration = bufferMs >= 180 ? 3000 : bufferMs >= 90 ? 2200 : 1300;
  state.latencyNudges.set(key, true);
  for (const playback of playbacks) {
    try {
      playback.audio.preservesPitch = false;
      playback.audio.playbackRate = rate;
    } catch {}
  }
  window.setTimeout(() => {
    for (const playback of playbacks) {
      try {
        playback.audio.playbackRate = 1;
      } catch {}
    }
    state.latencyNudges.delete(key);
  }, duration);
}

function getQualityHealth(stats) {
  if (!state.currentRoom) return "-";
  if (stats.receiveBps === 0 && state.peers.size > 0) return "수신 없음";
  if (stats.lossPercent >= 5 || stats.concealPercent >= 8) return "손실 높음";
  if (stats.bufferMs >= 180 || stats.rttMs >= 220) return "지연 높음";
  if (stats.jitterMs >= 45) return "지터 높음";
  if (stats.levelPercent > 0 && stats.levelPercent < 1) return "입력 약함";
  return "좋음";
}

function getQualityHealthText(stats) {
  const parts = [getQualityHealth(stats)];
  const repair = getRemoteRepairStatusText();
  const bleed = getBleedSuppressionStatusText();
  if (repair) parts.push(repair);
  if (bleed) parts.push(bleed);
  return parts.join(" / ");
}

function getRemoteRepairStatusText() {
  let missing = 0;
  let silent = 0;
  let screenMissing = 0;
  for (const peer of state.peers.values()) {
    missing = Math.max(missing, peer.remoteMissing?.mic || 0);
    silent = Math.max(silent, peer.remoteSilent?.mic || 0);
    screenMissing = Math.max(screenMissing, peer.remoteMissing?.screen || 0);
  }
  if (silent > 0) return `마이크 무음복구 ${silent}/3`;
  if (missing > 0) return `마이크 수신복구 ${missing}/2`;
  if (screenMissing > 0) return `화면 수신복구 ${screenMissing}/2`;
  return "";
}

function getBleedSuppressionStatusText() {
  return "";
}

function getBitrate(key, bytes, now) {
  const previous = state.previousStats.get(key);
  state.previousStats.set(key, { bytes, now });
  if (!previous) return 0;
  const diff = bytes - previous.bytes;
  const elapsed = now - previous.now;
  return elapsed > 0 ? (diff * 8 * 1000) / elapsed : 0;
}

function getCounterAverageDelta(key, value, count) {
  const previous = state.previousCounters.get(key);
  state.previousCounters.set(key, { value, count });
  if (!previous) return null;
  const valueDiff = value - previous.value;
  const countDiff = count - previous.count;
  if (valueDiff < 0 || countDiff <= 0) return null;
  return valueDiff / countDiff;
}

function getCounterDelta(key, value, count) {
  const previous = state.previousCounters.get(key);
  state.previousCounters.set(key, { value, count });
  if (!previous) return { value: 0, count: 0 };
  return {
    value: Math.max(0, value - previous.value),
    count: Math.max(0, count - previous.count),
  };
}

function getStatsCounterDelta(key, value) {
  const previous = state.previousCounters.get(key);
  state.previousCounters.set(key, { value });
  if (!previous) return 0;
  return Math.max(0, value - previous.value);
}

function addQualityLimitationDurations(target, durations) {
  if (!durations || typeof durations !== "object") return;
  for (const [key, value] of Object.entries(durations)) {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) target[key] = (target[key] || 0) + numeric;
  }
}

function formatQualityLimitationDurations(durations) {
  const parts = Object.entries(durations)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key}:${Number(value).toFixed(1)}s`);
  return parts.length ? `qualityLimitationDurations=${parts.join(",")}` : "";
}

function updateTrackStats() {
  const mic = state.rawMicTrack?.getSettings?.() || {};
  const system = state.systemTrack?.getSettings?.() || {};
  const micInputName = dom.inputDeviceSelect.selectedOptions[0]?.textContent || "-";
  const systemInputName = state.systemCaptureKind === "program"
    ? getSelectedProgramAudioLabel()
    : dom.systemInputDeviceSelect.selectedOptions[0]?.textContent || "-";
  const outputName = dom.outputDeviceSelect.selectedOptions[0]?.textContent || "-";
  setCompactStat(dom.statSampleRate, state.systemSharing
    ? `마이크 ${formatSampleRate(mic.sampleRate)} / 컴퓨터 ${formatSampleRate(system.sampleRate)}`
    : formatSampleRate(mic.sampleRate));
  setCompactStat(dom.statChannels, state.systemSharing
    ? `마이크 ${mic.channelCount || "-"}ch / 컴퓨터 ${system.channelCount || "-"}ch`
    : mic.channelCount ? `${mic.channelCount}ch` : "-");
  setCompactStat(dom.statProcessing, getProcessingText(mic));
  const inputText = state.systemSharing
    ? `마이크 ${micInputName} / 컴퓨터 ${systemInputName} / 출력 ${outputName}`
    : `마이크 ${micInputName} / 출력 ${outputName}`;
  setCompactStat(dom.statInput, inputText);
  state.screenStats.capture = getScreenCaptureStatsText();
  updateScreenStatsLabel();
  updateSetupStatus();
  updateSecurityStatus();
}

function setCompactStat(element, text) {
  if (!element) return;
  const value = String(text || "-");
  element.textContent = value;
  element.title = value;
}

function formatSampleRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number >= 1000) return `${Math.round(number / 1000)}kHz`;
  return `${number}Hz`;
}

function getSelectedProgramAudioLabel() {
  const names = getSelectedProgramAudioPids().map((pid) => {
    const item = state.programAudioSources.find((source) => Number(source.pid) === pid);
    return item?.name || `PID ${pid}`;
  });
  if (!names.length) return "선택한 프로그램";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}개`;
}

function updateSetupStatus() {
  dom.statSetup.textContent = getSetupStatusText();
}

function updateSecurityStatus() {
  if (window.isSecureContext) {
    dom.statSecurity.textContent = state.config.secure ? "HTTPS" : "로컬 허용";
    return;
  }
  dom.statSecurity.textContent = "HTTPS 필요";
}

function getSetupStatusText() {
  if (!window.isSecureContext && !isLocalHost(location.hostname)) return "보안 확인";
  const issue = getWindowsAudioRoutingIssue() || getMacAudioRoutingIssue();
  if (issue) return issue;
  if (isWindowsLoopbackEchoReductionActive()) return "헤드셋 보정";
  return "좋음";
}

function assertSafeMacAudioRouting(wantsSystem = state.systemSharing || dom.systemAudioToggle.checked) {
  const issue = getWindowsAudioRoutingIssue(wantsSystem) || getMacAudioRoutingIssue(wantsSystem);
  if (!issue) return;
  throw new Error(getAudioRoutingMessage(issue));
}

function getWindowsAudioRoutingIssue(wantsSystem = state.systemSharing || dom.systemAudioToggle.checked) {
  if (!wantsSystem || !desktop.isDesktop || desktop.platform !== "win32") return "";
  if (isProgramSystemAudioMode()) return "";
  if (state.outputSink.failed) {
    return state.outputSink.lastError === "unsupported" ? "출력 미지원" : "출력 실패";
  }
  const outputOption = dom.outputDeviceSelect.selectedOptions[0];
  if (dom.loopbackEchoReductionToggle.checked && !isWindowsSystemShareSafeOutputOption(outputOption)) return "";
  if (!isWindowsSystemShareSafeOutputOption(outputOption)) return "출력 분리";
  return "";
}

function getMacAudioRoutingIssue(wantsSystem = state.systemSharing || dom.systemAudioToggle.checked) {
  if (wantsSystem && state.outputSink.failed) {
    return state.outputSink.lastError === "unsupported" ? "출력 미지원" : "출력 실패";
  }
  if (!desktop.isDesktop || desktop.platform !== "darwin") return "";

  const micOption = dom.inputDeviceSelect.selectedOptions[0];
  const outputOption = dom.outputDeviceSelect.selectedOptions[0];
  const systemOption = dom.systemInputDeviceSelect.selectedOptions[0];
  const needsEchoSafeOutput = wantsSystem;

  if (!micOption?.value || isVirtualAudioDeviceLabel(micOption.textContent)) return "마이크 확인";
  if (needsEchoSafeOutput && (!outputOption?.value || isVirtualAudioDeviceLabel(outputOption.textContent))) return "출력 확인";

  if (!wantsSystem) return "";
  if (!systemOption?.value) return "컴퓨터 입력 없음";
  if (systemOption.value === micOption.value) return "입력 중복";
  if (!isVirtualAudioDeviceLabel(systemOption.textContent)) return "컴퓨터 입력 확인";

  return "";
}

function getAudioRoutingMessage(issue) {
  if (issue === "출력 분리") return getWindowsSystemShareOutputMessage();
  return getMacAudioRoutingMessage(issue);
}

function getMacAudioRoutingMessage(issue) {
  if (issue === "마이크 확인") return "macOS에서는 입력 장치를 실제 마이크로 선택해야 에코가 줄어듭니다.";
  if (issue === "출력 확인") return "macOS에서는 출력 장치를 실제 스피커/헤드폰으로 명시 선택해야 에코를 막을 수 있습니다.";
  if (issue === "출력 미지원") return "이 환경에서는 앱 안에서 출력 장치를 바꿀 수 없습니다. 운영체제 출력 장치를 먼저 확인해 주세요.";
  if (issue === "출력 실패") return "선택한 출력 장치를 적용하지 못했습니다. 다른 출력 장치를 선택해 주세요.";
  if (issue === "에코 누수") return "출력 소리가 마이크로 다시 들어오고 있습니다. 헤드폰을 쓰거나 출력/입력 장치를 바꿔 주세요.";
  if (issue === "컴퓨터 입력 없음") return "컴퓨터 사운드를 공유하려면 BlackHole 또는 Loopback 같은 컴퓨터 입력 장치를 선택해 주세요.";
  if (issue === "입력 중복") return "마이크 입력과 컴퓨터 입력은 서로 다른 장치여야 합니다.";
  if (issue === "컴퓨터 입력 확인") return "컴퓨터 입력은 BlackHole 또는 Loopback 같은 가상 입력 장치여야 합니다.";
  return "오디오 장치 설정을 확인해 주세요.";
}

function getProcessingText(settings) {
  const echo = formatSetting(settings.echoCancellation, dom.echoCancellationToggle.checked);
  const noise = formatSetting(settings.noiseSuppression, shouldUseNativeNoiseSuppression());
  const gain = formatSetting(settings.autoGainControl, dom.autoGainToggle.checked);
  return `에코 ${echo} / 잡음 ${noise} / 자동 ${gain} / 힌트 ${getProcessingHintText()} / 보조 ${getLocalProcessingText()}`;
}

function getProcessingHintText() {
  const parts = [];
  if (dom.echoCancellationToggle.checked) parts.push("AEC");
  if (shouldUseNativeNoiseSuppression()) parts.push("NS강");
  else if (dom.noiseSuppressionToggle.checked && getNoiseGateStrength() > 0) parts.push(`NS보조${Math.round(getNoiseGateStrength() * 100)}%`);
  if (dom.autoGainToggle.checked) parts.push("AGC");
  return parts.length ? `Chromium ${parts.join("+")}` : "꺼짐";
}

function getLocalProcessingText() {
  const planned = getPlannedLocalProcessingParts();
  if (!state.micProcess) {
    if (state.rawMicTrack?.readyState === "live" && planned.length) return `네이티브 ${planned.join("+")}`;
    return planned.length ? `예정 ${planned.join("+")}` : "꺼짐";
  }
  const parts = [];
  if (dom.echoCancellationToggle.checked) parts.push("AEC후");
  if (state.micProcess.gateNode) parts.push(`게이트${Math.round(getNoiseGateStrength() * 100)}%`);
  if (state.micProcess.compressor) parts.push("압축");
  if (state.micProcess.bleedSuppressorNode) parts.push(getBleedSuppressorText());
  if (Math.abs(getMicGain() - 1) >= 0.001) parts.push("증폭");
  return parts.length ? parts.join("+") : "필터";
}

function getBleedSuppressorText() {
  return "";
}

function getPlannedLocalProcessingParts() {
  const parts = [];
  if (dom.echoCancellationToggle.checked) parts.push("AEC");
  if (dom.noiseSuppressionToggle.checked && getNoiseGateStrength() > 0) parts.push(`게이트${Math.round(getNoiseGateStrength() * 100)}%`);
  if (dom.autoGainToggle.checked) parts.push("AGC");
  if (Math.abs(getMicGain() - 1) >= 0.001) parts.push("증폭");
  return parts;
}

function formatSetting(actual, requested) {
  if (typeof actual === "boolean") return actual ? "켜짐" : "꺼짐";
  return requested ? "요청" : "꺼짐";
}

function applyMicGainLabel() {
  dom.micGainValue.textContent = `${Math.round(getMicGain() * 100)}%`;
  if (state.micProcess?.gainNode) state.micProcess.gainNode.gain.value = getMicGain();
}

function getMicGain() {
  return Number(dom.micGainInput.value || 100) / 100;
}

function applyNoiseGateLabel() {
  const strength = getNoiseGateStrength();
  if (strength <= 0) {
    dom.noiseGateValue.textContent = "꺼짐";
  } else if (strength < 0.4) {
    dom.noiseGateValue.textContent = "부드럽게";
  } else if (strength < 0.75) {
    dom.noiseGateValue.textContent = "보통";
  } else {
    dom.noiseGateValue.textContent = "강하게";
  }
  updateTrackStats();
}

function getNoiseGateStrength() {
  return Math.max(0, Math.min(1, Number(dom.noiseGateInput.value || 0) / 100));
}

function shouldUseNativeNoiseSuppression() {
  return dom.noiseSuppressionToggle.checked && getNoiseGateStrength() >= 0.75;
}

function getNoiseGateSettings() {
  const strength = getNoiseGateStrength();
  return {
    noiseFloor: 0.005,
    minNoiseFloor: 0.002,
    maxNoiseFloor: 0.022,
    noiseAdaptRatio: 1.45 + strength * 0.3,
    minThreshold: 0.0035 + strength * 0.002,
    thresholdScale: 1.55 + strength * 1.55,
    openScale: 1.25 + strength * 0.2,
    closedGain: Math.max(0.04, 0.55 - strength * 0.52),
    holdGain: Math.max(0.22, 0.76 - strength * 0.54),
    attack: 0.22 + strength * 0.23,
    release: 0.22 - strength * 0.1,
  };
}

function applyRemoteVolumes() {
  if (dom.remoteMicVolumeValue && dom.remoteMicVolumeInput) {
    dom.remoteMicVolumeValue.textContent = `${dom.remoteMicVolumeInput.value}%`;
  }
  if (dom.remoteSystemVolumeValue && dom.remoteSystemVolumeInput) {
    dom.remoteSystemVolumeValue.textContent = `${dom.remoteSystemVolumeInput.value}%`;
  }
  for (const peer of state.peers.values()) {
    applyPlaybackVolume(peer.remote.mic);
    applyPlaybackVolume(peer.remote.system);
  }
}

function applyPlaybackVolume(playback) {
  if (!playback) return;
  playback.audio.muted = false;

  const raw = getPlaybackVolumePercent(playback);
  const gain = Math.max(0, Math.min(2, raw / 100));
  playback.volumeGain = gain;

  const pipeline = ensurePlaybackPipeline(playback);
  if (!pipeline) {
    if (playback.audio.srcObject !== playback.sourceStream) {
      playback.audio.srcObject = playback.sourceStream;
    }
    playback.audio.volume = gain;
    playback.audio.play().catch(() => {});
    updatePlaybackOutputLevel(playback);
    updateSystemEchoFilterPlaybackGain(playback);
    return;
  }

  if (playback.audio.srcObject !== playback.sourceStream) {
    playback.audio.srcObject = playback.sourceStream;
  }
  playback.pipeline.gainNode.gain.value = gain;
  playback.audio.volume = 0;
  playback.pipeline.context.resume()
    .catch(() => {})
    .finally(() => playback.audio.play().catch(() => {}));

  updatePlaybackOutputLevel(playback);
  updateSystemEchoFilterPlaybackGain(playback);
}

function getPlaybackVolumePercent(playback) {
  if (playback?.peerId) return getPeerVolume(playback.peerId, playback.role);
  const fallback = playback?.role === "system" ? dom.remoteSystemVolumeInput : dom.remoteMicVolumeInput;
  return Number(fallback?.value || 100);
}

function updatePlaybackOutputLevel(playback) {
  if (!playback) return;
  const muted = playback.audio?.muted || (playback.audio?.volume === 0 && !playback.pipeline);
  playback.outputLevel = muted ? 0 : (playback.level || 0) * (playback.volumeGain ?? 1);
}

function shouldMutePlaybackForEchoGuard() {
  return false;
}

// ===== 채널 · 방 · 멤버 렌더링 =====
function currentChannel() {
  return state.channels.find((c) => c.id === state.currentChannelId) || null;
}

function isChannelOwner(channel) {
  if (!channel) return false;
  if (state.auth.user?.isAdmin) return true;
  const uid = state.auth.user?.id;
  return channel.ownerId === uid || (channel.managerIds || []).includes(uid);
}

function isChannelCreator(channel) {
  if (!channel) return false;
  return Boolean(state.auth.user?.isAdmin) || channel.ownerId === state.auth.user?.id;
}

function reconcileCurrentChannel(preferId) {
  if (preferId && state.channels.some((c) => c.id === preferId)) {
    state.currentChannelId = preferId;
    return;
  }
  if (!state.channels.length) {
    state.currentChannelId = "";
    return;
  }
  if (!state.channels.some((c) => c.id === state.currentChannelId)) {
    state.currentChannelId = state.channels[0].id;
  }
}

function channelInitials(name) {
  const trimmed = String(name || "채").trim();
  return trimmed.slice(0, 2) || "채";
}

function renderChannels() {
  renderChannelRail();
  renderChannelHeader();
  renderRooms();
  renderMemberList();
}

function renderChannelRail() {
  if (!dom.channelRail) return;
  dom.channelRail.innerHTML = "";
  for (const channel of state.channels) {
    const btn = document.createElement("button");
    btn.className = "channel-icon" + (channel.id === state.currentChannelId ? " active" : "");
    btn.dataset.channelId = channel.id;
    btn.title = `${channel.name} (우클릭: 채널 설정)`;
    if (channel.icon) {
      btn.classList.add("has-icon");
      btn.style.backgroundImage = `url("${channel.icon}")`;
    } else {
      btn.textContent = channelInitials(channel.name);
    }
    dom.channelRail.append(btn);
  }
  const add = document.createElement("button");
  add.className = "channel-icon channel-add";
  add.dataset.channelAdd = "1";
  add.title = "채널 만들기 / 코드로 참가";
  add.textContent = "+";
  dom.channelRail.append(add);
}

function renderChannelHeader() {
  const channel = currentChannel();
  if (dom.channelName) dom.channelName.textContent = channel ? channel.name : "채널 없음";
  if (dom.channelMenuButton) dom.channelMenuButton.hidden = !channel;
  if (dom.channelEmpty) dom.channelEmpty.hidden = Boolean(channel);
}

function renderRooms() {
  if (!dom.roomList) return;
  dom.roomList.innerHTML = "";
  const channel = currentChannel();
  if (!channel) return;
  const owner = isChannelOwner(channel);

  for (const room of channel.rooms) {
    const meta = ROOM_TYPE_META[room.type] || ROOM_TYPE_META.voice;
    const item = document.createElement("div");
    item.className = "room-item";
    if (state.currentRoom?.id === room.id) item.classList.add("active");
    if (state.activeChat?.roomId === room.id) item.classList.add("active");
    if (state.memo?.roomId === room.id) item.classList.add("active");

    const head = document.createElement("button");
    head.className = "room-item-head";
    head.dataset.roomId = room.id;
    head.dataset.roomType = room.type;
    const icon = document.createElement("span");
    icon.className = "room-icon";
    icon.textContent = meta.icon;
    const name = document.createElement("span");
    name.className = "room-name";
    name.textContent = room.name;
    head.append(icon, name);

    const occupants = room.type === "voice" ? (state.presence[room.id] || []) : [];
    if (occupants.length) {
      const count = document.createElement("span");
      count.className = "room-count";
      count.textContent = String(occupants.length);
      head.append(count);
    }
    const unread = room.type === "chat" ? (state.chatUnread[room.id] || 0) : 0;
    if (unread > 0 && state.activeChat?.roomId !== room.id) {
      const badge = document.createElement("span");
      badge.className = "room-unread";
      badge.textContent = unread > 99 ? "99+" : String(unread);
      head.append(badge);
    }
    if (owner) {
      const del = document.createElement("button");
      del.className = "room-del";
      del.dataset.roomDelete = room.id;
      del.dataset.channelId = channel.id;
      del.title = "방 삭제";
      del.textContent = "×";
      head.append(del);
    }
    item.append(head);

    if (occupants.length) {
      const occList = document.createElement("div");
      occList.className = "room-occupants";
      for (const occ of occupants) {
        const row = document.createElement("div");
        row.className = "room-occupant";
        const dot = document.createElement("span");
        dot.className = "occupant-dot";
        row.append(dot, document.createTextNode(occ.name));
        occList.append(row);
      }
      item.append(occList);
    }
    dom.roomList.append(item);
  }

  if (owner) {
    const add = document.createElement("button");
    add.className = "room-add-button";
    add.dataset.roomAdd = "1";
    add.textContent = "+ 방 추가";
    dom.roomList.append(add);
  }
}

function renderMemberList() {
  if (!dom.memberList) return;
  const channel = currentChannel();
  if (!channel) {
    dom.memberList.hidden = true;
    dom.memberList.innerHTML = "";
    return;
  }
  dom.memberList.hidden = false;
  dom.memberList.innerHTML = "";
  const online = new Set(state.online || []);
  const members = (channel.members || []).slice().sort((a, b) => {
    const ao = online.has(a.id) ? 0 : 1;
    const bo = online.has(b.id) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""));
  });
  const onlineCount = members.filter((m) => online.has(m.id)).length;

  const head = document.createElement("div");
  head.className = "member-head";
  head.textContent = `멤버 · ${onlineCount}/${members.length} 접속`;
  dom.memberList.append(head);

  const owner = isChannelOwner(channel);
  const creator = isChannelCreator(channel);
  const myId = state.auth.user?.id;
  for (const member of members) {
    const isOnline = online.has(member.id);
    const row = document.createElement("div");
    row.className = "member-row" + (isOnline ? "" : " offline");

    const avatar = document.createElement("span");
    avatar.className = "account-avatar small";
    setAvatar(avatar, member);
    const dot = document.createElement("span");
    dot.className = "member-dot" + (isOnline ? " online" : "");
    avatar.append(dot);

    const info = document.createElement("div");
    info.className = "member-info";
    const name = document.createElement("b");
    name.textContent = member.displayName || `유저#${member.code}`;
    if (member.isCreator) {
      name.append(" ", makeBadge("창설자"));
    } else if (member.isManager) {
      name.append(" ", makeBadge("대표"));
    }
    const code = document.createElement("em");
    code.textContent = `#${member.code}`;
    info.append(name, code);

    row.append(avatar, info);

    const actions = document.createElement("div");
    actions.className = "member-actions";
    // 창설자(또는 관리자)만 공동대표 지정/해제
    if (creator && !member.isCreator) {
      const mgr = document.createElement("button");
      mgr.className = "member-action-btn";
      mgr.dataset.managerUserId = member.id;
      mgr.dataset.managerValue = member.isManager ? "0" : "1";
      mgr.textContent = member.isManager ? "대표 해제" : "대표 지정";
      actions.append(mgr);
    }
    if (owner && !member.isCreator && member.id !== myId) {
      const kick = document.createElement("button");
      kick.className = "member-action-btn kick";
      kick.dataset.kickUserId = member.id;
      kick.title = "채널에서 내보내기";
      kick.textContent = "내보내기";
      actions.append(kick);
    }
    if (actions.childElementCount) row.append(actions);
    dom.memberList.append(row);
  }
}

function makeBadge(text) {
  const badge = document.createElement("span");
  badge.className = "owner-badge";
  badge.textContent = text;
  return badge;
}

// ===== 채널 이벤트 · 모달 =====
function bindChannelEvents() {
  bindCropEvents();
  dom.channelIconInput?.addEventListener("change", () => {
    const file = dom.channelIconInput.files?.[0];
    const channel = currentChannel();
    if (!file || !channel) return;
    openCropModal(file, (dataUrl) => {
      sendSocket({ type: "channel:set-icon", channelId: channel.id, icon: dataUrl });
      setChannelMenuMessage("아이콘을 저장했습니다.", true);
    });
    dom.channelIconInput.value = "";
  });
  dom.channelRail?.addEventListener("click", (event) => {
    const add = event.target?.closest?.("[data-channel-add]");
    if (add) { openChannelModal(); return; }
    const icon = event.target?.closest?.("[data-channel-id]");
    if (icon) selectChannel(icon.dataset.channelId);
  });
  // 우클릭으로 채널 설정 열기(#6)
  dom.channelRail?.addEventListener("contextmenu", (event) => {
    const icon = event.target?.closest?.("[data-channel-id]");
    if (!icon) return;
    event.preventDefault();
    selectChannel(icon.dataset.channelId);
    openChannelMenu();
  });

  dom.roomList?.addEventListener("click", (event) => {
    const del = event.target?.closest?.("[data-room-delete]");
    if (del) {
      event.stopPropagation();
      if (window.confirm("이 방을 삭제할까요? 저장된 내용도 사라집니다.")) {
        sendSocket({ type: "channel:remove-room", channelId: del.dataset.channelId, roomId: del.dataset.roomDelete });
      }
      return;
    }
    const add = event.target?.closest?.("[data-room-add]");
    if (add) { openRoomModal(); return; }
    const head = event.target?.closest?.(".room-item-head");
    if (head) openRoom(head.dataset.roomId, head.dataset.roomType);
  });

  // 방 우클릭 → 이름 변경(대표자만)
  dom.roomList?.addEventListener("contextmenu", (event) => {
    const head = event.target?.closest?.(".room-item-head");
    if (!head) return;
    const channel = currentChannel();
    if (!channel || !isChannelOwner(channel)) return;
    event.preventDefault();
    openRoomRenameModal(head.dataset.roomId);
  });

  // 방 이름 변경 모달
  dom.roomRenameClose?.addEventListener("click", closeRoomRenameModal);
  dom.roomRenameModal?.addEventListener("click", (e) => { if (e.target === dom.roomRenameModal) closeRoomRenameModal(); });
  dom.roomRenameConfirm?.addEventListener("click", confirmRoomRename);
  dom.roomRenameInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmRoomRename(); } });

  dom.memberList?.addEventListener("click", (event) => {
    const channel = currentChannel();
    if (!channel) return;
    const mgr = event.target?.closest?.("[data-manager-user-id]");
    if (mgr) {
      sendSocket({ type: "channel:set-manager", channelId: channel.id, userId: mgr.dataset.managerUserId, value: mgr.dataset.managerValue === "1" });
      return;
    }
    const kick = event.target?.closest?.("[data-kick-user-id]");
    if (!kick) return;
    if (window.confirm("이 멤버를 채널에서 내보낼까요?")) {
      sendSocket({ type: "channel:kick", channelId: channel.id, userId: kick.dataset.kickUserId });
    }
  });

  dom.channelMenuButton?.addEventListener("click", openChannelMenu);

  // 채널 만들기/참가 모달
  dom.channelModalClose?.addEventListener("click", closeChannelModal);
  dom.channelModal?.addEventListener("click", (e) => { if (e.target === dom.channelModal) closeChannelModal(); });
  dom.channelTabCreate?.addEventListener("click", () => setChannelModalTab("create"));
  dom.channelTabJoin?.addEventListener("click", () => setChannelModalTab("join"));
  dom.channelCreateForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = dom.channelCreateName.value.trim();
    if (!name) { setChannelModalMessage("채널 이름을 입력해 주세요."); return; }
    setChannelModalMessage("만드는 중...", true);
    sendSocket({ type: "channel:create", name });
  });
  dom.channelJoinForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = dom.channelJoinCode.value.trim().toUpperCase();
    if (!code) { setChannelModalMessage("초대 코드를 입력해 주세요."); return; }
    setChannelModalMessage("참가 중...", true);
    sendSocket({ type: "channel:join", code });
  });

  // 방 추가 모달
  dom.roomModalClose?.addEventListener("click", closeRoomModal);
  dom.roomModal?.addEventListener("click", (e) => { if (e.target === dom.roomModal) closeRoomModal(); });
  dom.roomModalConfirm?.addEventListener("click", () => {
    const channel = currentChannel();
    if (!channel) return;
    const name = dom.roomModalName.value.trim();
    const type = document.querySelector('input[name="roomType"]:checked')?.value || "voice";
    if (!name) { setRoomModalMessage("방 이름을 입력해 주세요."); return; }
    setRoomModalMessage("추가 중...", true);
    sendSocket({ type: "channel:add-room", channelId: channel.id, name, roomType: type });
    closeRoomModal();
  });

  // 채널 관리 모달
  dom.channelMenuClose?.addEventListener("click", closeChannelMenu);
  dom.channelMenuModal?.addEventListener("click", (e) => { if (e.target === dom.channelMenuModal) closeChannelMenu(); });
  dom.copyInviteButton?.addEventListener("click", () => {
    const code = dom.channelInviteCode.textContent || "";
    navigator.clipboard?.writeText(code).then(
      () => setChannelMenuMessage("초대 코드를 복사했습니다.", true),
      () => setChannelMenuMessage("복사에 실패했습니다."),
    );
  });
  dom.channelRenameButton?.addEventListener("click", () => {
    const channel = currentChannel();
    if (!channel) return;
    const name = dom.channelRenameInput.value.trim();
    if (!name) { setChannelMenuMessage("이름을 입력해 주세요."); return; }
    sendSocket({ type: "channel:rename", channelId: channel.id, name });
    setChannelMenuMessage("저장했습니다.", true);
  });
  dom.channelLeaveButton?.addEventListener("click", () => {
    const channel = currentChannel();
    if (!channel) return;
    if (window.confirm(`'${channel.name}' 채널에서 나갈까요?`)) {
      sendSocket({ type: "channel:leave", channelId: channel.id });
      closeChannelMenu();
    }
  });
  dom.channelDeleteButton?.addEventListener("click", () => {
    const channel = currentChannel();
    if (!channel) return;
    if (window.confirm(`'${channel.name}' 채널을 삭제할까요? 되돌릴 수 없습니다.`)) {
      sendSocket({ type: "channel:delete", channelId: channel.id });
      closeChannelMenu();
    }
  });
}

function selectChannel(channelId) {
  if (!channelId || channelId === state.currentChannelId) return;
  // 다른 채널의 방을 보고 있었다면 닫는다(방 목록이 새 채널로 바뀌므로).
  if (state.activeChat && state.activeChat.channelId !== channelId) closeChatView();
  if (state.memo && state.memo.channelId !== channelId) closeMemoView();
  state.currentChannelId = channelId;
  renderChannels();
}

function openRoom(roomId, roomType) {
  if (roomType === "voice") {
    closeChatView();
    closeMemoView();
    joinRoom(roomId);
  } else if (roomType === "chat") {
    closeMemoView();
    openChatRoom(roomId);
  } else if (roomType === "memo") {
    closeChatView();
    openMemoRoom(roomId);
  } else {
    closeChatView();
    closeMemoView();
    const meta = ROOM_TYPE_META[roomType] || {};
    setMessage(`${meta.label || "이 방"}은 다음 단계에서 열립니다. (준비 중)`);
  }
}

// ===== 채팅방 =====
const CHAT_UPLOAD_MAX = 50 * 1024 * 1024; // 50MB
const CHAT_GROUP_GAP = 5 * 60 * 1000; // 5분 이내 같은 사람 메시지는 묶어서 표시
const CHAT_TYPING_TTL = 5000;
const CHAT_MAX_FILES = 10;

function findRoomInChannels(roomId) {
  for (const channel of state.channels) {
    const room = (channel.rooms || []).find((r) => r.id === roomId);
    if (room) return { channel, room };
  }
  return null;
}

function openChatRoom(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found) return;
  if (state.activeChat?.roomId === roomId) {
    document.body.classList.add("chat-open");
    dom.chatInput?.focus();
    return;
  }
  state.activeChat = { roomId, channelId: found.channel.id, name: found.room.name };
  state.chatMessages = [];
  state.chatPendingFiles = [];
  clearChatTypers();
  delete state.chatUnread[roomId];
  document.body.classList.add("chat-open");
  if (dom.chatRoomName) dom.chatRoomName.textContent = found.room.name;
  if (dom.chatSubtitle) dom.chatSubtitle.textContent = found.channel.name;
  if (dom.chatMessages) dom.chatMessages.innerHTML = '<p class="chat-loading">불러오는 중…</p>';
  renderChatAttachments();
  setChatHint("");
  if (dom.chatInput) { dom.chatInput.value = ""; autoResizeChatInput(); }
  sendSocket({ type: "chat:open", roomId });
  renderRooms();
  dom.chatInput?.focus();
}

function closeChatView() {
  if (!state.activeChat) return;
  sendSocket({ type: "chat:close" });
  state.activeChat = null;
  state.chatPendingFiles = [];
  clearChatTypers();
  document.body.classList.remove("chat-open");
  renderRooms();
}

// 채널 목록 갱신 후, 보고 있던 채팅방이 사라졌거나 이름이 바뀌었는지 확인한다.
function verifyActiveChat() {
  if (!state.activeChat) return;
  const found = findRoomInChannels(state.activeChat.roomId);
  if (!found || found.room.type !== "chat") { closeChatView(); return; }
  state.activeChat.name = found.room.name;
  state.activeChat.channelId = found.channel.id;
  if (dom.chatRoomName) dom.chatRoomName.textContent = found.room.name;
  if (dom.chatSubtitle) dom.chatSubtitle.textContent = found.channel.name;
  renderChatMessages(); // 멤버 정보가 새로 도착했을 수 있어 아바타 갱신
}

function handleIncomingChat(msg) {
  if (!msg || !msg.roomId) return;
  if (state.activeChat?.roomId === msg.roomId) {
    const nearBottom = isChatNearBottom();
    state.chatMessages.push(msg);
    if (state.chatMessages.length > 1000) state.chatMessages.shift();
    removeChatTyper(msg.userId);
    renderChatMessages();
    if (nearBottom || msg.userId === state.auth.user?.id) scrollChatToBottom();
  } else {
    state.chatUnread[msg.roomId] = (state.chatUnread[msg.roomId] || 0) + 1;
    renderRooms();
  }
}

function resolveChatUser(msg) {
  const channel = state.channels.find((c) => c.id === state.activeChat?.channelId);
  const member = channel?.members?.find((m) => m.id === msg.userId);
  return member || { displayName: msg.name, avatar: "" };
}

function renderChatMessages() {
  const container = dom.chatMessages;
  if (!container) return;
  container.innerHTML = "";
  if (!state.chatMessages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "아직 메시지가 없습니다. 첫 메시지를 남겨보세요.";
    container.append(empty);
    return;
  }
  let prev = null;
  let currentBody = null;
  for (const msg of state.chatMessages) {
    const grouped = prev && prev.userId === msg.userId && (msg.at - prev.at) < CHAT_GROUP_GAP;
    if (!grouped) {
      const group = document.createElement("div");
      group.className = "chat-group";
      const avatar = document.createElement("span");
      avatar.className = "chat-avatar account-avatar small";
      setAvatar(avatar, resolveChatUser(msg));
      currentBody = document.createElement("div");
      currentBody.className = "chat-group-body";
      const head = document.createElement("div");
      head.className = "chat-msg-head";
      const name = document.createElement("b");
      name.className = "chat-msg-name";
      name.textContent = msg.name || "이름없음";
      const time = document.createElement("span");
      time.className = "chat-msg-time";
      time.textContent = formatChatTime(msg.at);
      head.append(name, time);
      currentBody.append(head);
      group.append(avatar, currentBody);
      container.append(group);
    }
    currentBody.append(renderChatMessageBody(msg));
    prev = msg;
  }
}

function renderChatMessageBody(msg) {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg";
  if (msg.text) {
    const text = document.createElement("div");
    text.className = "chat-msg-text";
    text.textContent = msg.text; // textContent 사용 → XSS 안전, CSS pre-wrap로 줄바꿈 유지
    wrap.append(text);
  }
  if (Array.isArray(msg.files) && msg.files.length) {
    const files = document.createElement("div");
    files.className = "chat-files";
    for (const file of msg.files) files.append(renderChatFile(file));
    wrap.append(files);
  }
  return wrap;
}

function renderChatFile(file) {
  const url = String(file.url || "");
  const isImage = file.kind === "image" || /^image\//.test(file.mime || "");
  if (isImage) {
    const link = document.createElement("a");
    link.className = "chat-image-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    const img = document.createElement("img");
    img.className = "chat-image";
    img.loading = "lazy";
    img.alt = file.name || "이미지";
    img.src = url;
    link.append(img);
    return link;
  }
  const a = document.createElement("a");
  a.className = "chat-file";
  a.href = url;
  a.download = file.name || "file";
  a.target = "_blank";
  a.rel = "noopener";
  const icon = document.createElement("span");
  icon.className = "chat-file-icon";
  icon.textContent = "📄";
  const info = document.createElement("span");
  info.className = "chat-file-info";
  const name = document.createElement("b");
  name.textContent = file.name || "파일";
  const size = document.createElement("em");
  size.textContent = formatBytes(file.size || 0);
  info.append(name, size);
  a.append(icon, info);
  return a;
}

function formatChatTime(at) {
  if (!at) return "";
  const d = new Date(at);
  const now = new Date();
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return `오늘 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `어제 ${time}`;
  return `${d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })} ${time}`;
}

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 || value >= 10 ? 0 : 1)} ${units[i]}`;
}

function isChatNearBottom() {
  const el = dom.chatScroll;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function scrollChatToBottom() {
  const el = dom.chatScroll;
  if (el) el.scrollTop = el.scrollHeight;
}

// ── 입력 중 표시 ──
function handleChatTyping(message) {
  if (!state.activeChat || message.roomId !== state.activeChat.roomId) return;
  if (message.userId === state.auth.user?.id) return;
  const existing = state.chatTypers.get(message.userId);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    state.chatTypers.delete(message.userId);
    renderChatTyping();
  }, CHAT_TYPING_TTL);
  state.chatTypers.set(message.userId, { name: message.name, timer });
  renderChatTyping();
}

function removeChatTyper(userId) {
  const entry = state.chatTypers.get(userId);
  if (entry?.timer) clearTimeout(entry.timer);
  if (state.chatTypers.delete(userId)) renderChatTyping();
}

function clearChatTypers() {
  for (const entry of state.chatTypers.values()) if (entry.timer) clearTimeout(entry.timer);
  state.chatTypers.clear();
  renderChatTyping();
}

function renderChatTyping() {
  if (!dom.chatTyping) return;
  const names = [...state.chatTypers.values()].map((e) => e.name).filter(Boolean);
  if (!names.length) {
    dom.chatTyping.textContent = "";
    dom.chatTyping.classList.remove("active");
    return;
  }
  let text;
  if (names.length === 1) text = `${names[0]}님이 입력 중…`;
  else if (names.length === 2) text = `${names[0]}, ${names[1]}님이 입력 중…`;
  else text = `${names.length}명이 입력 중…`;
  dom.chatTyping.textContent = text;
  dom.chatTyping.classList.add("active");
}

// ── 전송 ──
function sendChatMessage() {
  if (!state.activeChat) return;
  if (state.chatPendingFiles.some((f) => f.uploading)) {
    setChatHint("파일 업로드가 끝난 뒤 보낼 수 있습니다.");
    return;
  }
  const text = (dom.chatInput?.value || "").replace(/\s+$/, "");
  const files = state.chatPendingFiles
    .filter((f) => f.url)
    .map((f) => ({ url: f.url, name: f.name, size: f.size, mime: f.mime, kind: f.kind }));
  if (!text && !files.length) return;
  sendSocket({ type: "chat:send", roomId: state.activeChat.roomId, text, files });
  if (dom.chatInput) { dom.chatInput.value = ""; autoResizeChatInput(); }
  state.chatPendingFiles = [];
  renderChatAttachments();
  setChatHint("");
  state.chatTypingSentAt = 0;
  dom.chatInput?.focus();
}

function onChatInput() {
  autoResizeChatInput();
  const now = Date.now();
  if (state.activeChat && now - state.chatTypingSentAt > 2500) {
    state.chatTypingSentAt = now;
    sendSocket({ type: "chat:typing", roomId: state.activeChat.roomId });
  }
}

function autoResizeChatInput() {
  const el = dom.chatInput;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

function setChatHint(text) {
  if (dom.chatComposerHint) dom.chatComposerHint.textContent = text || "";
}

// ── 파일 첨부/업로드 ──
async function handleChatFiles(fileList) {
  if (!state.activeChat) return;
  for (const file of [...fileList]) {
    if (state.chatPendingFiles.length >= CHAT_MAX_FILES) {
      setChatHint(`한 번에 최대 ${CHAT_MAX_FILES}개까지 첨부할 수 있습니다.`);
      break;
    }
    if (file.size > CHAT_UPLOAD_MAX) {
      setChatHint(`${file.name}: 50MB를 넘어 첨부할 수 없습니다.`);
      continue;
    }
    const entry = {
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      kind: (file.type || "").startsWith("image/") ? "image" : "file",
      uploading: true,
      progress: 0,
      url: "",
    };
    state.chatPendingFiles.push(entry);
    renderChatAttachments();
    setChatHint("");
    try {
      const result = await uploadChatFile(file, (p) => { entry.progress = p; renderChatAttachments(); });
      entry.url = result.url;
      entry.size = Number.isFinite(result.size) ? result.size : entry.size;
      entry.mime = result.mime || entry.mime;
      entry.uploading = false;
      renderChatAttachments();
    } catch (error) {
      state.chatPendingFiles = state.chatPendingFiles.filter((f) => f !== entry);
      renderChatAttachments();
      setChatHint(error.message || "업로드에 실패했습니다.");
    }
  }
}

function uploadChatFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const token = state.auth.token;
    if (!token) { reject(new Error("로그인이 필요합니다.")); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${serverUrl}/upload?token=${encodeURIComponent(token)}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data);
      else reject(new Error(data.error || `업로드 실패 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("업로드 중 네트워크 오류가 발생했습니다."));
    xhr.send(file);
  });
}

function renderChatAttachments() {
  const box = dom.chatAttachments;
  if (!box) return;
  box.innerHTML = "";
  if (!state.chatPendingFiles.length) { box.hidden = true; return; }
  box.hidden = false;
  for (const f of state.chatPendingFiles) {
    const chip = document.createElement("div");
    chip.className = "chat-attach-chip" + (f.uploading ? " uploading" : "");
    const label = document.createElement("span");
    label.className = "chat-attach-name";
    label.textContent = f.uploading
      ? `${f.name} · ${Math.round((f.progress || 0) * 100)}%`
      : `${f.name} · ${formatBytes(f.size)}`;
    chip.append(label);
    if (!f.uploading) {
      const remove = document.createElement("button");
      remove.className = "chat-attach-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        state.chatPendingFiles = state.chatPendingFiles.filter((x) => x !== f);
        renderChatAttachments();
      });
      chip.append(remove);
    }
    box.append(chip);
  }
}

function bindChatEvents() {
  dom.chatSendButton?.addEventListener("click", sendChatMessage);
  dom.chatInput?.addEventListener("input", onChatInput);
  dom.chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  dom.chatInput?.addEventListener("paste", (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) {
      event.preventDefault();
      handleChatFiles(files);
    }
  });
  dom.chatAttachButton?.addEventListener("click", () => dom.chatFileInput?.click());
  dom.chatFileInput?.addEventListener("change", () => {
    if (dom.chatFileInput.files?.length) handleChatFiles(dom.chatFileInput.files);
    dom.chatFileInput.value = "";
  });
  bindChatDragDrop();
}

function bindChatDragDrop() {
  const panel = dom.chatPanel;
  const overlay = dom.chatDropOverlay;
  if (!panel) return;
  let depth = 0;
  const dragHasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  panel.addEventListener("dragenter", (event) => {
    if (!state.activeChat || !dragHasFiles(event)) return;
    event.preventDefault();
    depth++;
    if (overlay) overlay.hidden = false;
  });
  panel.addEventListener("dragover", (event) => {
    if (state.activeChat && dragHasFiles(event)) event.preventDefault();
  });
  panel.addEventListener("dragleave", (event) => {
    if (!dragHasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && overlay) overlay.hidden = true;
  });
  panel.addEventListener("drop", (event) => {
    if (!state.activeChat) return;
    event.preventDefault();
    depth = 0;
    if (overlay) overlay.hidden = true;
    if (event.dataTransfer?.files?.length) handleChatFiles(event.dataTransfer.files);
  });
}

// ===== 공동 메모장 =====
const MEMO_SAVE_DEBOUNCE = 700;

function openMemoRoom(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found) return;
  if (state.memo?.roomId === roomId) {
    document.body.classList.add("memo-open");
    dom.memoEditor?.focus();
    return;
  }
  clearMemoSaveTimer();
  state.memo = {
    roomId,
    channelId: found.channel.id,
    name: found.room.name,
    rev: 0,
    remotePending: null,
    saveTimer: 0,
    view: state.memo?.view || "split",
    lastSentText: "",
  };
  document.body.classList.add("memo-open");
  if (dom.memoRoomName) dom.memoRoomName.textContent = found.room.name;
  if (dom.memoEditor) { dom.memoEditor.value = ""; dom.memoEditor.disabled = true; }
  if (dom.memoPreview) dom.memoPreview.innerHTML = "";
  hideMemoRemoteNotice();
  applyMemoView(state.memo.view);
  setMemoStatus("불러오는 중…", "muted");
  sendSocket({ type: "memo:open", roomId });
  renderRooms();
}

function closeMemoView() {
  if (!state.memo) return;
  flushMemoSave(); // 닫기 전에 마지막 편집을 저장
  sendSocket({ type: "memo:close" });
  clearMemoSaveTimer();
  state.memo = null;
  document.body.classList.remove("memo-open");
  renderRooms();
}

// 채널 목록 갱신 후, 보고 있던 메모방이 사라졌거나 이름이 바뀌었는지 확인.
function verifyActiveMemo() {
  if (!state.memo) return;
  const found = findRoomInChannels(state.memo.roomId);
  if (!found || found.room.type !== "memo") { closeMemoView(); return; }
  state.memo.name = found.room.name;
  state.memo.channelId = found.channel.id;
  if (dom.memoRoomName) dom.memoRoomName.textContent = found.room.name;
}

function handleMemoState(message) {
  if (state.memo?.roomId !== message.roomId) return;
  state.memo.rev = message.rev || 0;
  state.memo.lastSentText = message.text || "";
  if (dom.memoEditor) { dom.memoEditor.disabled = false; dom.memoEditor.value = message.text || ""; }
  renderMemoPreview();
  if (message.updatedAt) {
    setMemoStatus(`마지막 편집 ${message.updatedByName || "?"} · ${formatChatTime(message.updatedAt)}`, "muted");
  } else {
    setMemoStatus("빈 메모 — 함께 편집됩니다", "muted");
  }
}

function handleMemoChanged(message) {
  if (state.memo?.roomId !== message.roomId) return;
  if (message.rev <= state.memo.rev) return; // 이미 반영된(또는 내 저장으로 앞선) 변경은 무시
  const editing = document.activeElement === dom.memoEditor;
  if (editing) {
    // 편집 중이면 덮어쓰지 않고 알림만 — 사용자가 직접 불러오기
    state.memo.remotePending = { text: message.text, rev: message.rev, name: message.updatedByName || "" };
    showMemoRemoteNotice(message.updatedByName || "다른 사용자");
  } else {
    applyRemoteMemo(message.text, message.rev, message.updatedByName, message.updatedAt);
  }
}

function applyRemoteMemo(text, rev, name, at) {
  if (!state.memo) return;
  state.memo.rev = rev;
  state.memo.lastSentText = text;
  state.memo.remotePending = null;
  if (dom.memoEditor) dom.memoEditor.value = text;
  renderMemoPreview();
  hideMemoRemoteNotice();
  setMemoStatus(`${name || "다른 사용자"}님이 편집함 · ${formatChatTime(at || Date.now())}`, "muted");
}

function applyMemoRemotePending() {
  const pending = state.memo?.remotePending;
  if (!pending) { hideMemoRemoteNotice(); return; }
  applyRemoteMemo(pending.text, pending.rev, pending.name, Date.now());
}

function showMemoRemoteNotice(name) {
  if (!dom.memoRemoteNotice) return;
  if (dom.memoRemoteText) dom.memoRemoteText.textContent = `${name}님이 편집했습니다. 불러오면 현재 편집 내용이 대체됩니다.`;
  dom.memoRemoteNotice.hidden = false;
}
function hideMemoRemoteNotice() {
  if (dom.memoRemoteNotice) dom.memoRemoteNotice.hidden = true;
}

function onMemoInput() {
  if (!state.memo) return;
  renderMemoPreview();
  setMemoStatus("편집 중…", "muted");
  clearMemoSaveTimer();
  state.memo.saveTimer = window.setTimeout(sendMemoUpdate, MEMO_SAVE_DEBOUNCE);
}

function sendMemoUpdate() {
  if (!state.memo) return;
  clearMemoSaveTimer();
  const text = dom.memoEditor?.value ?? "";
  if (text === state.memo.lastSentText) return;
  state.memo.lastSentText = text;
  sendSocket({ type: "memo:update", roomId: state.memo.roomId, text });
  setMemoStatus("저장 중…", "muted");
}

function flushMemoSave() {
  if (!state.memo || !dom.memoEditor) return;
  if (dom.memoEditor.value !== state.memo.lastSentText) sendMemoUpdate();
}

function clearMemoSaveTimer() {
  if (state.memo?.saveTimer) {
    window.clearTimeout(state.memo.saveTimer);
    state.memo.saveTimer = 0;
  }
}

function renderMemoPreview() {
  if (dom.memoPreview) dom.memoPreview.innerHTML = renderMarkdown(dom.memoEditor?.value || "");
}

function setMemoStatus(text, tone) {
  if (!dom.memoStatus) return;
  dom.memoStatus.textContent = text || "";
  dom.memoStatus.className = "memo-status" + (tone ? ` ${tone}` : "");
}

function applyMemoView(view) {
  const v = ["split", "edit", "preview"].includes(view) ? view : "split";
  if (state.memo) state.memo.view = v;
  if (dom.memoBody) dom.memoBody.className = `memo-body view-${v}`;
  dom.memoViewSplit?.classList.toggle("active", v === "split");
  dom.memoViewEdit?.classList.toggle("active", v === "edit");
  dom.memoViewPreview?.classList.toggle("active", v === "preview");
  if (v !== "edit") renderMemoPreview();
}

function bindMemoEvents() {
  dom.memoEditor?.addEventListener("input", onMemoInput);
  dom.memoEditor?.addEventListener("blur", flushMemoSave);
  dom.memoApplyRemote?.addEventListener("click", applyMemoRemotePending);
  dom.memoViewSplit?.addEventListener("click", () => applyMemoView("split"));
  dom.memoViewEdit?.addEventListener("click", () => applyMemoView("edit"));
  dom.memoViewPreview?.addEventListener("click", () => applyMemoView("preview"));
  dom.memoEditor?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = dom.memoEditor;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
    el.selectionStart = el.selectionEnd = start + 2;
    onMemoInput();
  });
}

// ── 안전한 마크다운 렌더러(외부 의존성 없음, HTML 이스케이프 후 변환) ──
function escapeHtmlText(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(src) {
  // 1) 코드펜스(```)를 먼저 빼내 보호
  const codeBlocks = [];
  let text = String(src || "").replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(code.replace(/^\n/, "").replace(/\n$/, ""));
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  // 2) 전체 HTML 이스케이프(이후 삽입되는 태그는 우리가 만든 안전한 것뿐)
  text = escapeHtmlText(text);

  const lines = text.split("\n");
  const html = [];
  let listType = null;
  let inQuote = false;
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (inQuote) { html.push("</blockquote>"); inQuote = false; } };

  for (const line of lines) {
    const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (codeMatch) {
      closeList(); closeQuote();
      html.push(`<pre><code>${escapeHtmlText(codeBlocks[Number(codeMatch[1])])}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { closeList(); closeQuote(); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeList(); closeQuote(); html.push("<hr />"); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(); closeQuote();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const quote = line.match(/^&gt;\s?(.*)$/); // '>' 는 이미 이스케이프됨
    if (quote) {
      closeList();
      if (!inQuote) { html.push("<blockquote>"); inQuote = true; }
      html.push(`<p>${inlineMarkdown(quote[1])}</p>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      closeQuote();
      if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
      html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      closeQuote();
      if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
      html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
      continue;
    }
    closeList(); closeQuote();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList(); closeQuote();
  return html.join("\n");
}

function inlineMarkdown(str) {
  const links = [];
  let out = str;
  // 명시적 링크 [text](http…)를 먼저 자리표시자로 보호
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    return `\u0001L${links.length - 1}\u0001`;
  });
  // 맨 URL 자동 링크
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (m, url) => {
    links.push(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    return `\u0001L${links.length - 1}\u0001`;
  });
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\s][^*]*?)\*/g, "<em>$1</em>");
  out = out.replace(/(^|[^a-zA-Z0-9])_([^_\s][^_]*?)_(?=[^a-zA-Z0-9]|$)/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\u0001L(\d+)\u0001/g, (m, i) => links[Number(i)]);
  return out;
}

function openChannelModal() {
  if (!dom.channelModal) return;
  setChannelModalTab("create");
  setChannelModalMessage("");
  dom.channelCreateName.value = "";
  dom.channelJoinCode.value = "";
  dom.channelModal.hidden = false;
  dom.channelCreateName.focus();
}
function closeChannelModal() { if (dom.channelModal) dom.channelModal.hidden = true; }
function setChannelModalTab(tab) {
  const create = tab !== "join";
  dom.channelTabCreate?.classList.toggle("active", create);
  dom.channelTabJoin?.classList.toggle("active", !create);
  if (dom.channelCreateForm) dom.channelCreateForm.hidden = !create;
  if (dom.channelJoinForm) dom.channelJoinForm.hidden = create;
  setChannelModalMessage("");
}
function setChannelModalMessage(text, ok = false) {
  if (!dom.channelModalMessage) return;
  dom.channelModalMessage.textContent = text || "";
  dom.channelModalMessage.classList.toggle("ok", Boolean(ok));
}

function openRoomModal() {
  if (!dom.roomModal) return;
  dom.roomModalName.value = "";
  setRoomModalMessage("");
  const voice = document.querySelector('input[name="roomType"][value="voice"]');
  if (voice) voice.checked = true;
  dom.roomModal.hidden = false;
  dom.roomModalName.focus();
}
function closeRoomModal() { if (dom.roomModal) dom.roomModal.hidden = true; }
function setRoomModalMessage(text, ok = false) {
  if (!dom.roomModalMessage) return;
  dom.roomModalMessage.textContent = text || "";
  dom.roomModalMessage.classList.toggle("ok", Boolean(ok));
}

// 방 이름 변경 모달(우클릭에서 호출)
let roomRenameTargetId = "";
function openRoomRenameModal(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found || !dom.roomRenameModal) return;
  roomRenameTargetId = roomId;
  dom.roomRenameInput.value = found.room.name || "";
  if (dom.roomRenameMessage) dom.roomRenameMessage.textContent = "";
  // 통화방이면 최대 인원 필드를 보여준다.
  const isVoice = found.room.type === "voice";
  if (dom.roomLimitField) dom.roomLimitField.hidden = !isVoice;
  if (dom.roomLimitInput) dom.roomLimitInput.value = String(found.room.limit || 8);
  dom.roomRenameModal.hidden = false;
  dom.roomRenameInput.focus();
  dom.roomRenameInput.select();
}
function closeRoomRenameModal() {
  if (dom.roomRenameModal) dom.roomRenameModal.hidden = true;
  roomRenameTargetId = "";
}
function confirmRoomRename() {
  const found = findRoomInChannels(roomRenameTargetId);
  if (!found) { closeRoomRenameModal(); return; }
  const name = (dom.roomRenameInput.value || "").trim();
  if (!name) { if (dom.roomRenameMessage) dom.roomRenameMessage.textContent = "이름을 입력해 주세요."; return; }
  if (name !== found.room.name) {
    sendSocket({ type: "channel:rename-room", channelId: found.channel.id, roomId: roomRenameTargetId, name });
  }
  if (found.room.type === "voice") {
    const limit = Math.max(1, Math.min(99, Math.floor(Number(dom.roomLimitInput.value) || 8)));
    if (limit !== (found.room.limit || 8)) {
      sendSocket({ type: "channel:set-room-limit", channelId: found.channel.id, roomId: roomRenameTargetId, limit });
    }
  }
  closeRoomRenameModal();
}

function openChannelMenu() {
  const channel = currentChannel();
  if (!channel || !dom.channelMenuModal) return;
  const owner = isChannelOwner(channel); // 대표자(공동대표 포함)
  const creator = isChannelCreator(channel); // 창설자만
  dom.channelInviteCode.textContent = channel.inviteCode || "------";
  dom.channelRenameInput.value = channel.name || "";
  if (dom.channelRenameInput) dom.channelRenameInput.disabled = !owner;
  if (dom.channelRenameButton) dom.channelRenameButton.hidden = !owner;
  if (dom.channelDeleteButton) {
    dom.channelDeleteButton.hidden = !creator; // 삭제는 창설자만
    // 다른 멤버가 남아 있으면 삭제 불가(창설자 혼자일 때만)
    const soloMember = (channel.members || []).length <= 1;
    dom.channelDeleteButton.disabled = !soloMember;
    dom.channelDeleteButton.title = soloMember ? "" : "다른 멤버가 있어 삭제할 수 없습니다. 먼저 모두 내보내세요.";
  }
  // 채널 아이콘: 대표자만 변경 가능
  if (dom.channelIconRow) dom.channelIconRow.hidden = !owner;
  setAvatar(dom.channelIconPreview, { avatar: channel.icon, displayName: channel.name });
  setChannelMenuMessage("");
  dom.channelMenuModal.hidden = false;
}
function closeChannelMenu() { if (dom.channelMenuModal) dom.channelMenuModal.hidden = true; }
function setChannelMenuMessage(text, ok = false) {
  if (!dom.channelMenuMessage) return;
  dom.channelMenuMessage.textContent = text || "";
  dom.channelMenuMessage.classList.toggle("ok", Boolean(ok));
}

function renderCurrentRoom() {
  if (!state.currentRoom) {
    dom.currentRoomName.textContent = "통화 없음";
    dom.currentRoomMeta.textContent = "방에 들어가면 마이크가 켜집니다.";
    return;
  }
  dom.currentRoomName.textContent = state.currentRoom.name;
  dom.currentRoomMeta.textContent = `${state.currentRoom.count}/${state.currentRoom.limit}명`;
  if (dom.roomLimitLiveSelect) dom.roomLimitLiveSelect.value = String(state.currentRoom.limit);
}

function renderParticipants() {
  dom.participantList.innerHTML = "";
  if (!state.currentRoom) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "참가자가 없습니다.";
    dom.participantList.append(empty);
    return;
  }
  appendParticipant({
    id: "local",
    name: getUserName(),
    status: getLocalStateText(),
    self: true,
  });
  for (const peer of state.peers.values()) {
    appendParticipant({
      id: peer.id,
      name: peer.name,
      status: peer.remoteStatus?.mic?.muted ? `${peer.state} · 마이크 꺼짐` : peer.state,
      peer,
    });
  }
  updateParticipantMeters();
}

function appendParticipant({ id, name, status, self = false, peer = null }) {
  const card = document.createElement("div");
  card.className = "participant-card";
  card.dataset.participantId = String(id);
  const title = document.createElement("strong");
  title.textContent = name;
  const label = document.createElement("span");
  label.textContent = status;
  const header = document.createElement("div");
  header.className = "participant-head";
  header.append(title, label);

  const meters = document.createElement("div");
  meters.className = "participant-meters";
  meters.append(
    makeParticipantMeter("마이크", self ? "self-mic" : "peer-mic"),
    makeParticipantMeter("컴퓨터", self ? "self-system" : "peer-system"),
  );

  if (peer) card.dataset.peerId = peer.id;
  if (peer) {
    const volumes = document.createElement("div");
    volumes.className = "participant-volumes";
    volumes.append(
      makeParticipantVolumeControl(peer, "mic", "마이크"),
      makeParticipantVolumeControl(peer, "system", "컴퓨터"),
    );
    card.append(header, meters, volumes);
    if (peer.remote.screen?.track?.readyState === "live") {
      const screenButton = document.createElement("button");
      screenButton.className = "participant-screen-button";
      screenButton.type = "button";
      screenButton.dataset.screenPeerId = peer.id;
      screenButton.textContent = state.selectedScreenPeerId === peer.id ? "보고 있음" : "화면 보기";
      card.append(screenButton);
    }
  } else {
    if (state.screenSharing) {
      const badge = document.createElement("span");
      badge.className = "participant-screen-button";
      badge.textContent = "화면 공유 중";
      header.append(badge);
    }
    card.append(header, meters);
  }
  dom.participantList.append(card);
}

function makeParticipantMeter(labelText, key) {
  const row = document.createElement("div");
  row.className = "participant-meter";
  row.dataset.meterKey = key;
  const label = document.createElement("span");
  label.textContent = labelText;
  const meter = document.createElement("div");
  meter.className = "meter mini";
  const bar = document.createElement("span");
  meter.append(bar);
  row.append(label, meter);
  return row;
}

function makeParticipantVolumeControl(peer, role, labelText) {
  const row = document.createElement("label");
  row.className = "participant-volume";
  const label = document.createElement("span");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "200";
  input.step = "5";
  input.value = String(getPeerVolume(peer.id, role));
  input.dataset.peerId = peer.id;
  input.dataset.peerVolumeRole = role;
  const value = document.createElement("b");
  value.textContent = `${input.value}%`;
  row.append(label, input, value);
  return row;
}

function updateParticipantMeters() {
  const setLevel = (selector, level) => {
    const item = dom.participantList?.querySelector(selector);
    const bar = item?.querySelector(".meter span");
    bar?.style?.setProperty("--level", `${Math.min(100, Math.round((level || 0) * 420))}%`);
  };

  setLevel('[data-participant-id="local"] [data-meter-key="self-mic"]', state.liveEchoGuard.sendMicLevel || 0);
  setLevel('[data-participant-id="local"] [data-meter-key="self-system"]', state.liveEchoGuard.systemLevel || 0);

  let remoteMicLevel = 0;
  for (const peer of state.peers.values()) {
    const mic = peer.remote.mic?.level || 0;
    const system = peer.remote.system?.level || 0;
    remoteMicLevel = Math.max(remoteMicLevel, mic);
    setLevel(`[data-peer-id="${cssEscape(peer.id)}"] [data-meter-key="peer-mic"]`, mic);
    setLevel(`[data-peer-id="${cssEscape(peer.id)}"] [data-meter-key="peer-system"]`, system);
  }
  dom.remoteMeter?.style?.setProperty("--level", `${Math.min(100, Math.round(remoteMicLevel * 420))}%`);
}

async function enterScreenFullscreen() {
  if (!dom.screenStage || dom.screenStage.hidden) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await dom.screenStage.requestFullscreen();
    }
  } catch {
    setMessage("전체화면을 열 수 없습니다.");
  }
}

async function closeScreenViewer() {
  if (document.fullscreenElement === dom.screenStage) {
    await document.exitFullscreen().catch(() => {});
  }
  state.selectedScreenPeerId = "";
  renderScreenStage();
  // 참가자 카드의 "보고 있음" 라벨이 남지 않도록 함께 갱신한다.
  renderParticipants();
}

function toggleScreenFitMode() {
  state.screenFitMode = state.screenFitMode === "cover" ? "contain" : "cover";
  localStorage.setItem("voiceChatScreenFitMode", state.screenFitMode);
  applyScreenFitMode();
  revealScreenControls();
}

function applyScreenFitMode() {
  if (!dom.screenStage) return;
  dom.screenStage.dataset.fit = state.screenFitMode;
  if (dom.screenFitButton) {
    dom.screenFitButton.textContent = state.screenFitMode === "cover" ? "맞춤" : "채우기";
    dom.screenFitButton.title = state.screenFitMode === "cover"
      ? "잘림 없이 맞춤으로 보기"
      : "일부 잘릴 수 있지만 화면을 꽉 채우기";
  }
}

function revealScreenControls() {
  if (!dom.screenStage || dom.screenStage.hidden) return;
  dom.screenStage.classList.remove("screen-controls-hidden");
  if (state.screenControlsHideTimer) window.clearTimeout(state.screenControlsHideTimer);
  state.screenControlsHideTimer = window.setTimeout(() => {
    if (!dom.screenStage || dom.screenStage.hidden) return;
    dom.screenStage.classList.add("screen-controls-hidden");
  }, 2200);
}

function updateScreenFullscreenButton() {
  if (!dom.screenFullscreenButton) return;
  dom.screenFullscreenButton.textContent = document.fullscreenElement === dom.screenStage ? "나가기" : "전체화면";
}

function renderScreenStage() {
  const shares = getActiveScreenShares();
  const selected = shares.find((item) => item.id === state.selectedScreenPeerId) || null;
  if (!selected) {
    // 보던 공유가 사라져도 다른 공유로 자동 전환하지 않는다 — 잘못된 "보고 있음" 표시의 원인.
    // 내 미리보기("local")는 공유 재시작 중 잠깐 사라질 수 있으니 선택을 유지한다.
    if (state.selectedScreenPeerId && state.selectedScreenPeerId !== "local") {
      state.selectedScreenPeerId = "";
      renderParticipants();
    }
    // 공유가 끝났는데 전체화면이 유지되면 검은 화면만 남는다.
    if (document.fullscreenElement === dom.screenStage) {
      document.exitFullscreen().catch(() => {});
    }
    dom.screenStage.hidden = true;
    dom.screenStage.classList.remove("screen-controls-hidden");
    dom.screenViewer.srcObject = null;
    dom.screenShareList.innerHTML = "";
    if (state.screenControlsHideTimer) window.clearTimeout(state.screenControlsHideTimer);
    state.screenControlsHideTimer = 0;
    return;
  }

  dom.screenStage.hidden = false;
  applyScreenFitMode();
  updateScreenFullscreenButton();
  dom.screenViewerTitle.textContent = `${selected.name} 화면 공유`;
  if (dom.screenViewer.srcObject !== selected.stream) {
    dom.screenViewer.srcObject = selected.stream;
    dom.screenViewer.play?.().catch(() => {});
  }
  revealScreenControls();

  dom.screenShareList.innerHTML = "";
  for (const share of shares) {
    const button = document.createElement("button");
    button.className = "screen-share-pill";
    button.type = "button";
    button.dataset.screenPeerId = share.id;
    button.textContent = share.id === state.selectedScreenPeerId ? `${share.name} 보는 중` : share.name;
    dom.screenShareList.append(button);
  }
}

function getActiveScreenShares() {
  const shares = [];
  if (state.screenPreviewEnabled && state.screenSharing && state.screenTrack?.readyState === "live" && state.screenStream) {
    shares.push({ id: "local", name: getUserName(), stream: state.screenStream });
  }
  for (const peer of state.peers.values()) {
    const playback = peer.remote.screen;
    if (playback?.track?.readyState !== "live") continue;
    shares.push({ id: peer.id, name: peer.name, stream: playback.sourceStream });
  }
  return shares;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function updateControls() {
  const inRoom = Boolean(state.currentRoom);
  document.body.classList.toggle("in-call", inRoom);
  const canShareSystem = isDirectSystemAudioSupported() || isVirtualSystemAudioSupported();
  const canSendScreen = isScreenShareSendSupported();
  dom.leaveButton.disabled = !inRoom;
  dom.muteButton.disabled = !inRoom || !state.rawMicTrack;
  dom.repairAudioButton.disabled = !inRoom || !state.rawMicTrack || state.applyingSettings;
  dom.muteButton.textContent = state.muted ? "마이크 켜기" : "마이크 끄기";
  dom.systemAudioAction.hidden = !canShareSystem;
  dom.systemAudioToggle.disabled = !canShareSystem || state.applyingSettings;
  dom.systemAudioToggle.checked = state.systemSharing || (!inRoom && dom.systemAudioToggle.checked);
  if (!canShareSystem) dom.systemAudioToggle.checked = false;
  dom.screenShareButton.hidden = !canSendScreen;
  dom.screenSharePanel.hidden = !canSendScreen;
  dom.screenShareButton.disabled = !canSendScreen || !inRoom || state.applyingSettings;
  if (dom.openScreenTestButton) dom.openScreenTestButton.disabled = !canSendScreen || typeof desktop.openScreenTestWindow !== "function";
  dom.screenShareButton.textContent = state.screenSharing ? "화면 공유 끄기" : "화면 공유";
  dom.systemInputField.hidden = !isVirtualSystemAudioSupported();
  dom.systemInputDeviceSelect.disabled = !isVirtualSystemAudioSupported() || state.applyingSettings;
  if (dom.refreshProgramAudioButton) dom.refreshProgramAudioButton.disabled = state.applyingSettings;
  updateProgramAudioControls();
  updateSetupStatus();
}

function updateSystemAudioAvailability() {
  dom.systemInputField.hidden = !isVirtualSystemAudioSupported();
  updateProgramAudioControls();
  if (isDirectSystemAudioSupported() || isVirtualSystemAudioSupported()) return;
  dom.systemAudioToggle.checked = false;
  dom.systemAudioToggle.disabled = true;
  dom.systemAudioToggle.title = "이 환경에서는 컴퓨터 사운드 공유를 지원하지 않습니다.";
}

function updateProgramAudioControls() {
  const supported = isProgramSystemAudioSupported();
  if (dom.programAudioPanel) dom.programAudioPanel.hidden = !(desktop.isDesktop && desktop.platform === "win32");
  if (dom.systemCaptureProgramRadio) dom.systemCaptureProgramRadio.disabled = !supported || state.applyingSettings;
  if (dom.systemCaptureFullRadio) dom.systemCaptureFullRadio.disabled = state.applyingSettings;
  if (dom.programAudioList) {
    dom.programAudioList.toggleAttribute("hidden", state.systemCaptureMode !== "program");
  }
  if (dom.programAudioSearchInput) dom.programAudioSearchInput.hidden = state.systemCaptureMode !== "program";
  if (dom.refreshProgramAudioButton) {
    dom.refreshProgramAudioButton.hidden = state.systemCaptureMode !== "program";
    dom.refreshProgramAudioButton.disabled = !supported || state.applyingSettings;
  }
  if (state.systemCaptureMode === "program" && !supported) {
    state.systemCaptureMode = "full";
    localStorage.setItem("voiceChatSystemCaptureMode", "full");
    restoreSystemCaptureModeSetting();
  }
}

function isProgramSystemAudioSupported() {
  return desktop.isDesktop &&
    desktop.platform === "win32" &&
    typeof desktop.listProgramAudioSources === "function" &&
    typeof desktop.startProgramAudioCapture === "function";
}

function isProgramSystemAudioMode() {
  return isProgramSystemAudioSupported() && state.systemCaptureMode === "program";
}

function readStoredProgramAudioPids() {
  try {
    const values = JSON.parse(localStorage.getItem("voiceChatProgramAudioPids") || "[]");
    if (!Array.isArray(values)) return [];
    return values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function readStoredPeerVolumes() {
  try {
    const parsed = JSON.parse(localStorage.getItem("voiceChatPeerVolumes") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePeerVolumes() {
  localStorage.setItem("voiceChatPeerVolumes", JSON.stringify(state.peerVolumes));
}

function getPeerVolume(peerId, role) {
  const value = Number(state.peerVolumes?.[peerId]?.[role]);
  if (Number.isFinite(value)) return Math.max(0, Math.min(200, value));
  return 100;
}

function setPeerVolume(peerId, role, value) {
  if (!peerId || (role !== "mic" && role !== "system")) return;
  const percent = Math.max(0, Math.min(200, Number(value) || 0));
  state.peerVolumes[peerId] = {
    mic: getPeerVolume(peerId, "mic"),
    system: getPeerVolume(peerId, "system"),
    ...(state.peerVolumes[peerId] || {}),
    [role]: percent,
  };
  savePeerVolumes();
}

function updatePeerVolumeFromInput(input) {
  const peerId = input.dataset.peerId;
  const role = input.dataset.peerVolumeRole;
  setPeerVolume(peerId, role, input.value);
  const value = input.parentElement?.querySelector("b");
  if (value) value.textContent = `${getPeerVolume(peerId, role)}%`;
  const peer = state.peers.get(peerId);
  if (!peer) return;
  applyPlaybackVolume(peer.remote[role]);
}

function saveProgramAudioSelection() {
  localStorage.setItem("voiceChatProgramAudioPids", JSON.stringify(getSelectedProgramAudioPids()));
}

function getSelectedProgramAudioPids() {
  return [...state.selectedProgramAudioPids].filter((pid) => Number.isInteger(pid) && pid > 0);
}

function syncProgramAudioSelectionWithSources() {
  if (!state.programAudioSourcesLoaded) return;
  const available = new Set(getVisibleProgramAudioSources().map((item) => Number(item.pid)));
  let changed = false;
  for (const pid of [...state.selectedProgramAudioPids]) {
    if (available.has(pid)) continue;
    state.selectedProgramAudioPids.delete(pid);
    changed = true;
  }
  if (changed) saveProgramAudioSelection();
}

function getVisibleProgramAudioSources() {
  return state.programAudioSources.filter(shouldShowProgramAudioSource);
}

function getSelectedProgramAudioCapturePids() {
  if (!state.programAudioSourcesLoaded) return [];
  syncProgramAudioSelectionWithSources();
  const selected = getSelectedProgramAudioPids();
  const capturePids = new Set();
  for (const pid of selected) {
    capturePids.add(pid);
    const source = state.programAudioSources.find((item) => Number(item.pid) === pid);
    for (const relatedPid of getProgramAudioSourcePids(source)) capturePids.add(relatedPid);
    for (const relatedSource of getRelatedProgramAudioSources(source)) {
      for (const relatedPid of getProgramAudioSourcePids(relatedSource)) capturePids.add(relatedPid);
    }
  }
  return [...capturePids].filter((pid) => Number.isInteger(pid) && pid > 0);
}

function getProgramAudioSourcePids(source) {
  const values = Array.isArray(source?.pids) ? source.pids : [source?.pid];
  return values.map((value) => Number(value)).filter((pid) => Number.isInteger(pid) && pid > 0);
}

function getRelatedProgramAudioSources(source) {
  if (!source) return [];
  const appId = String(source.appId || "").trim().toLowerCase();
  const packageFamily = String(source.packageFamily || "").trim().toLowerCase();
  if (appId || packageFamily) {
    return state.programAudioSources.filter((item) => {
      const itemAppId = String(item.appId || "").trim().toLowerCase();
      const itemPackageFamily = String(item.packageFamily || "").trim().toLowerCase();
      return (appId && itemAppId === appId) || (packageFamily && itemPackageFamily === packageFamily);
    });
  }
  const key = normalizeProgramAudioName(source.name);
  if (!key) return [];
  return state.programAudioSources.filter((item) => normalizeProgramAudioName(item.name) === key);
}

function normalizeProgramAudioName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.(exe|app)$/i, "")
    .replace(/\b(helper|renderer|service|update|broker|webview|crashpad|agent|daemon|host)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function refreshProgramAudioSources({ silent = false } = {}) {
  if (!isProgramSystemAudioSupported()) {
    renderProgramAudioSources();
    return;
  }

  try {
    if (!silent && dom.programAudioStatus) dom.programAudioStatus.textContent = "프로그램 목록을 새로고침 중입니다.";
    const items = await desktop.listProgramAudioSources();
    state.programAudioSources = Array.isArray(items) ? items : [];
    state.programAudioSourcesLoaded = true;
    renderProgramAudioSources();
  } catch (error) {
    state.programAudioSources = [];
    state.programAudioSourcesLoaded = false;
    const message = error.message || "프로그램별 오디오 목록을 불러오지 못했습니다.";
    recordClientError("program-audio-list-failed", message);
    renderProgramAudioSources(`프로그램별 오디오 목록을 불러오지 못했습니다: ${message}`);
  }
}

function renderProgramAudioSources(error = "") {
  if (!dom.programAudioList || !dom.programAudioStatus) return;
  updateProgramAudioControls();
  dom.programAudioList.innerHTML = "";

  if (!isProgramSystemAudioSupported()) {
    dom.programAudioStatus.textContent = desktop.platform === "win32"
      ? "프로그램별 캡처 helper가 없습니다."
      : "";
    if (dom.programAudioSelectedList) dom.programAudioSelectedList.hidden = true;
    return;
  }

  if (error) {
    dom.programAudioStatus.textContent = error;
    if (dom.programAudioSelectedList) dom.programAudioSelectedList.hidden = true;
    return;
  }

  syncProgramAudioSelectionWithSources();
  const selected = state.programAudioSourcesLoaded ? getSelectedProgramAudioPids() : [];
  dom.programAudioStatus.textContent = state.systemCaptureMode === "program"
    ? `${selected.length}개 프로그램 선택됨`
    : "전체 컴퓨터 소리 공유";
  renderSelectedProgramAudioSummary(selected);

  const query = (dom.programAudioSearchInput?.value || "").trim().toLowerCase();
  const sources = getVisibleProgramAudioSources().filter((item) => {
    if (!query) return true;
    return `${item.name || ""} ${item.title || ""} ${item.path || ""} ${item.appId || ""} ${item.packageFamily || ""} ${item.pid || ""}`.toLowerCase().includes(query);
  });

  if (!sources.length) {
    const empty = document.createElement("div");
    empty.className = "program-audio-empty";
    empty.textContent = query ? "검색 결과가 없습니다." : "표시할 프로그램이 없습니다.";
    dom.programAudioList.append(empty);
    return;
  }

  for (const item of sources) {
    const pid = Number(item.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const label = document.createElement("label");
    label.className = "program-audio-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.programAudioPid = String(pid);
    checkbox.checked = state.selectedProgramAudioPids.has(pid);
    const text = document.createElement("span");
    text.textContent = getProgramAudioSourceText(item, pid);
    label.append(checkbox, text);
    dom.programAudioList.append(label);
  }
}

function renderSelectedProgramAudioSummary(selectedPids) {
  if (!dom.programAudioSelectedList) return;
  dom.programAudioSelectedList.innerHTML = "";
  dom.programAudioSelectedList.hidden = state.systemCaptureMode !== "program";
  if (state.systemCaptureMode !== "program") return;

  const selectedSources = selectedPids
    .map((pid) => state.programAudioSources.find((item) => Number(item.pid) === pid))
    .filter(Boolean);

  if (!selectedSources.length) {
    const chip = document.createElement("span");
    chip.className = "program-audio-chip";
    chip.textContent = "선택 없음";
    dom.programAudioSelectedList.append(chip);
    return;
  }

  for (const item of selectedSources) {
    const chip = document.createElement("span");
    chip.className = "program-audio-chip";
    chip.textContent = item.name || `PID ${item.pid}`;
    chip.title = getProgramAudioSourceText(item, Number(item.pid));
    dom.programAudioSelectedList.append(chip);
  }
}

function getProgramAudioSourceText(item, pid) {
  const name = item.name || `PID ${pid}`;
  const title = item.title && item.title !== name ? ` · ${item.title}` : "";
  const stateText = item.state === "active" ? "재생 중" : item.state === "ready" ? "열림" : "대기";
  return `${name}${title} · PID ${pid} · ${stateText}`;
}

function shouldShowProgramAudioSource(item) {
  if (!item || !Number.isInteger(Number(item.pid))) return false;
  if (isOwnProgramAudioSource(item)) return false;
  if (isNoisyProgramAudioName(item.name)) return false;
  return Boolean(item.name || item.title || item.path || item.appId || item.packageFamily);
}

function isOwnProgramAudioSource(item) {
  const text = `${item.name || ""} ${item.path || ""}`.toLowerCase();
  return text.includes("accord") || text.includes("accordprocessloopback") || text.includes("voice chat") || text.includes("voicechatprocessloopback");
}

function isNoisyProgramAudioName(name) {
  const text = String(name || "").toLowerCase();
  return text.includes("update") ||
    text.includes("service") ||
    text.includes("helper") ||
    text.includes("crash") ||
    text.includes("agent") ||
    text.includes("daemon") ||
    text.includes("host");
}

function isDirectSystemAudioSupported() {
  return desktop.isDesktop && desktop.platform !== "darwin";
}

function isVirtualSystemAudioSupported() {
  return desktop.isDesktop && desktop.platform === "darwin";
}

function isScreenShareSendSupported() {
  return desktop.isDesktop && !isMobileWeb() && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function isMobileWeb() {
  if (desktop.isDesktop) return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "");
}

function selectSafeInputDevice() {
  if (!desktop.isDesktop || desktop.platform !== "darwin") return;

  const selected = dom.inputDeviceSelect.selectedOptions[0];
  if (!selected) return;

  const selectedIsDefault = selected.value === "";
  const selectedIsVirtual = isVirtualAudioDeviceLabel(selected.textContent);
  if (!selectedIsDefault && !selectedIsVirtual) return;

  const safeOption = findSafeInputOption();

  if (safeOption) {
    dom.inputDeviceSelect.value = safeOption.value;
    localStorage.setItem("voiceChatInputDeviceId", safeOption.value);
    setMessage("컴퓨터 소리가 섞일 수 있는 입력 대신 실제 마이크 입력으로 바꿨습니다.");
    return;
  }

  setMessage("현재 입력 장치가 컴퓨터 소리를 포함할 수 있습니다. 실제 마이크 입력을 선택해 주세요.");
}

function selectDefaultSystemInputDevice() {
  if (!isVirtualSystemAudioSupported()) return null;

  const selected = dom.systemInputDeviceSelect.selectedOptions[0];
  if (selected?.value && isVirtualAudioDeviceLabel(selected.textContent)) return selected;

  const saved = localStorage.getItem("voiceChatSystemInputDeviceId") || "";
  const savedOption = [...dom.systemInputDeviceSelect.options].find((option) => {
    return option.value === saved && isVirtualAudioDeviceLabel(option.textContent);
  });
  const option = savedOption || findVirtualInputOption();
  if (!option) return null;

  dom.systemInputDeviceSelect.value = option.value;
  localStorage.setItem("voiceChatSystemInputDeviceId", option.value);
  return option;
}

function findSafeInputOption() {
  const options = [...dom.inputDeviceSelect.options].filter((option) => {
    return option.value && !isVirtualAudioDeviceLabel(option.textContent);
  });
  if (!options.length) return null;

  return options.find((option) => isLikelyMicrophoneLabel(option.textContent)) || options[0];
}

function findVirtualInputOption() {
  return [...dom.systemInputDeviceSelect.options].find((option) => {
    return option.value && isVirtualAudioDeviceLabel(option.textContent);
  }) || null;
}

async function selectSafeOutputDeviceForSystemShare() {
  if (isProgramSystemAudioMode()) return true;
  if (isWindowsSystemAudioShareActive()) return selectSeparatedWindowsOutputForSystemShare();
  if (!isVirtualSystemAudioSupported()) return true;

  const selected = dom.outputDeviceSelect.selectedOptions[0];
  if (selected?.value && !isVirtualAudioDeviceLabel(selected.textContent)) return true;

  const safeOption = findSafeOutputOption();
  if (safeOption) {
    dom.outputDeviceSelect.value = safeOption.value;
    localStorage.setItem("voiceChatOutputDeviceId", safeOption.value);
    const applied = await applyOutputDevice();
    setMessage(applied
      ? "에코를 막기 위해 앱 출력 장치를 실제 스피커/헤드폰으로 바꿨습니다."
      : "출력 장치를 자동 선택했지만 적용하지 못했습니다. 운영체제 출력 장치를 확인해 주세요.");
    return applied;
  }

  setMessage("컴퓨터 사운드 공유 중에는 앱 출력이 BlackHole/Loopback으로 들어가면 에코가 납니다. 실제 출력 장치를 선택해 주세요.");
  return false;
}

async function selectSeparatedWindowsOutputForSystemShare() {
  const selected = dom.outputDeviceSelect.selectedOptions[0];
  if (isWindowsSystemShareSafeOutputOption(selected)) return true;
  if (selected?.value && dom.loopbackEchoReductionToggle.checked) {
    const applied = await applyOutputDevice();
    setMessage(applied
      ? "헤드셋 출력은 유지하고 컴퓨터 사운드 공유에 헤드셋 반향 보정을 적용합니다."
      : "출력 장치를 적용하지 못했습니다. 운영체제 출력 장치와 헤드셋 반향 보정을 확인해 주세요.");
    return applied;
  }

  const safeOption = findWindowsSeparatedOutputOption();
  if (!safeOption) {
    if (dom.loopbackEchoReductionToggle.checked) {
      const applied = await applyOutputDevice();
      setMessage(applied
        ? "별도 출력 장치를 찾지 못해 기본 출력에 헤드셋 반향 보정을 적용합니다."
        : "출력 장치를 적용하지 못했습니다. 운영체제 출력 장치와 헤드셋 반향 보정을 확인해 주세요.");
      return applied;
    }
    setMessage(getWindowsSystemShareOutputMessage());
    return false;
  }

  dom.outputDeviceSelect.value = safeOption.value;
  localStorage.setItem("voiceChatOutputDeviceId", safeOption.value);
  const applied = await applyOutputDevice();
  setMessage(applied
    ? "헤드셋 재캡처를 막기 위해 통화 출력을 별도 출력 장치로 바꿨습니다."
    : "출력 장치를 자동 선택했지만 적용하지 못했습니다. 운영체제 출력 장치를 확인해 주세요.");
  return applied;
}

async function selectSafeOutputDeviceForEchoGuard() {
  if (!desktop.isDesktop || desktop.platform !== "darwin") return;
  if (!state.systemSharing && !dom.systemAudioToggle.checked) return;

  const selected = dom.outputDeviceSelect.selectedOptions[0];
  if (selected?.value && !isVirtualAudioDeviceLabel(selected.textContent)) return;

  const safeOption = findSafeOutputOption();
  if (!safeOption) return;

  dom.outputDeviceSelect.value = safeOption.value;
  localStorage.setItem("voiceChatOutputDeviceId", safeOption.value);
  const applied = await applyOutputDevice();
  setMessage(applied
    ? "에코를 줄이기 위해 앱 출력 장치를 실제 출력 장치로 바꿨습니다."
    : "출력 장치를 자동 선택했지만 적용하지 못했습니다. 운영체제 출력 장치를 확인해 주세요.");
}

function findSafeOutputOption() {
  const options = [...dom.outputDeviceSelect.options].filter((option) => {
    return option.value && !isVirtualAudioDeviceLabel(option.textContent);
  });
  if (!options.length) return null;
  return options.find((option) => isLikelyOutputLabel(option.textContent)) || options[0];
}

function findWindowsSeparatedOutputOption() {
  const options = [...dom.outputDeviceSelect.options].filter((option) => {
    return option.value && !isVirtualAudioDeviceLabel(option.textContent);
  });
  if (!options.length) return null;
  return options.find((option) => isLikelySpeakerOutputLabel(option.textContent)) ||
    options.find((option) => !isLikelyHeadsetLoopbackOutputLabel(option.textContent)) ||
    null;
}

function isWindowsSystemAudioShareActive() {
  return desktop.isDesktop &&
    desktop.platform === "win32" &&
    (state.systemSharing || dom.systemAudioToggle.checked);
}

function isWindowsSystemShareSafeOutputOption(option) {
  if (!isWindowsSystemAudioShareActive()) return true;
  if (!option?.value) return false;
  if (isVirtualAudioDeviceLabel(option.textContent)) return false;
  return !isLikelyHeadsetLoopbackOutputLabel(option.textContent);
}

function shouldUseWindowsLoopbackEchoReducer() {
  if (!desktop.isDesktop || desktop.platform !== "win32") return false;
  if (isProgramSystemAudioMode()) return false;
  if (!dom.loopbackEchoReductionToggle.checked) return false;
  const selected = dom.outputDeviceSelect.selectedOptions[0];
  return !isWindowsSystemShareSafeOutputOption(selected);
}

function isWindowsLoopbackEchoReductionActive() {
  return Boolean(state.systemEchoFilter);
}

function isLikelyHeadsetLoopbackOutputLabel(label) {
  return /headset|headphones?|hands.?free|ag audio|bluetooth|airpods|buds|earbuds|헤드셋|헤드폰|이어폰|이어버드/i.test(String(label || ""));
}

function isLikelySpeakerOutputLabel(label) {
  const text = String(label || "");
  if (isLikelyHeadsetLoopbackOutputLabel(text)) return false;
  return /speaker|speakers|realtek|display|monitor|hdmi|nvidia|amd|intel|내장|internal|스피커|모니터/i.test(text);
}

function getWindowsSystemShareOutputMessage() {
  return "Windows 헤드셋 출력은 통화 소리가 컴퓨터 사운드 공유에 다시 들어갈 수 있습니다. 헤드셋 반향 보정을 켜거나 스피커/모니터 같은 별도 출력 장치를 선택해 주세요.";
}

function isVirtualAudioDeviceLabel(label) {
  return /blackhole|soundflower|loopback|aggregate|multi-output|vb-audio|cable|virtual|audio hijack|rogue amoeba|obs|zoom audio|ishowu|background music/i.test(String(label || ""));
}

function isLikelyMicrophoneLabel(label) {
  return /mic|microphone|마이크|내장|internal|airpods|headset|usb|input/i.test(String(label || ""));
}

function isLikelyOutputLabel(label) {
  return /speaker|headphone|headset|airpods|내장|internal|display|usb|output|스피커|헤드폰/i.test(String(label || ""));
}

function warnIfVirtualInputBleeds() {
  if (!desktop.isDesktop || desktop.platform !== "darwin" || state.systemSharing) return;
  const selected = dom.inputDeviceSelect.selectedOptions[0]?.textContent || "";
  if (dom.inputDeviceSelect.value === "" || isVirtualAudioDeviceLabel(selected)) {
    setMessage("선택한 입력 장치에 컴퓨터 소리가 섞일 수 있습니다. 마이크만 쓸 때는 실제 마이크 입력을 선택해 주세요.");
  }
}

function resetStatsView() {
  dom.statSend.textContent = "0 kbps";
  dom.statReceive.textContent = "0 kbps";
  dom.statRtt.textContent = "-";
  dom.statJitter.textContent = "-";
  dom.statLoss.textContent = "-";
  dom.statCodec.textContent = "-";
  dom.statBuffer.textContent = "-";
  dom.statConcealment.textContent = "-";
  dom.statAudioLevel.textContent = "-";
  dom.statSampleRate.textContent = "-";
  dom.statChannels.textContent = "-";
  dom.statProcessing.textContent = "-";
  dom.statInput.textContent = "-";
  dom.statSetup.textContent = "-";
  dom.statSecurity.textContent = "-";
  dom.statScreenShare.textContent = "-";
  dom.statConnection.textContent = "-";
  updateLastErrorLabel();
  dom.statHealth.textContent = "-";
  if (dom.qualitySummary) dom.qualitySummary.textContent = "대기";
}

function sendSignal(target, data) {
  addClientLog("info", "signal-send", `${getSignalPayloadKind(data)} target=${target}`);
  sendSocket({ type: "signal", target, data });
}

function sendSocket(data) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(data));
}

async function copyDiagnostics() {
  const text = buildDiagnosticsText();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      copyTextWithFallback(text);
    }
    setMessage("진단 정보를 복사했습니다.");
  } catch (error) {
    copyTextWithFallback(text);
    setMessage("진단 정보를 복사했습니다.");
  }
}

async function copyClientLogs() {
  const text = getClientLogText();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyTextWithFallback(text);
  } catch {
    copyTextWithFallback(text);
  }
  setMessage("진단 로그를 복사했습니다.");
}

function clearClientLogs() {
  state.clientLogs = [];
  renderClientLogs();
  setMessage("진단 로그를 지웠습니다.");
}

function addClientLog(level, event, detail = "") {
  const entry = {
    at: new Date().toISOString(),
    session: state.callSessionId || "",
    level,
    event: String(event || "").slice(0, 80),
    detail: getLogDetail(detail, 3000),
  };
  state.clientLogs.push(entry);
  if (state.clientLogs.length > 500) state.clientLogs.splice(0, state.clientLogs.length - 500);
  renderClientLogs();
}

function renderClientLogs() {
  if (!dom.clientLogOutput) return;
  dom.clientLogOutput.textContent = getClientLogText() || "로그 없음";
}

function getClientLogText() {
  return state.clientLogs
    .map((entry) => `[${entry.at}] ${entry.level.toUpperCase()}${entry.session ? ` sid=${entry.session}` : ""} ${entry.event}${entry.detail ? ` ${entry.detail}` : ""}`)
    .join("\n");
}

function copyTextWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function buildDiagnosticsText() {
  const lines = [
    `Accord ${state.config.version || ""}`,
    `time=${new Date().toISOString()}`,
    `session=${state.callSessionId || "-"}`,
    getClientEnvironmentSummary(),
    `socket=${getSocketStateText()}`,
    `security=${dom.statSecurity?.textContent || "-"}`,
    `connection=${dom.statConnection?.textContent || "-"}`,
    `ice=${getIceServerSummary()}`,
    `quality=${dom.statHealth?.textContent || "-"}`,
    `screen=${dom.statScreenShare?.textContent || "-"}`,
    `screenSetup=${[
      `captureMode=${state.screenCaptureMode}`,
      `captureMethod=${state.screenCaptureMethod || "-"}`,
      `electron=${desktop.electronVersion || state.screenDesktopDiagnostics?.electronVersion || "-"}`,
      `resolution=${state.screenResolution}`,
      `fps=${state.screenFps}`,
      getScreenPreviewDebugText(),
      getScreenProbeDebugText(),
      getScreenCaptureSourceText(),
      getScreenCaptureSizeComparisonText(),
      `requested=${formatCompactJson(state.screenCaptureRequested)}`,
      state.screenStats.bottleneck || "bottleneck=pending",
    ].join(" ")}`,
    `screenDesktop=${getScreenDesktopDiagnosticsText()}`,
    `input=${dom.statInput?.textContent || "-"}`,
    `setup=${dom.statSetup?.textContent || "-"}`,
    getCallDebugSummary(),
    `recentErrors=${state.recentErrors.map((item) => item.text).join(" | ") || "-"}`,
    `logCount=${state.clientLogs.length}`,
  ];

  for (const peer of state.peers.values()) {
    lines.push(makePeerDebugDetail(peer, "peer"));
  }
  return lines.join("\n");
}

function getLogDetail(detail, limit = 1000) {
  let text = "";
  if (detail instanceof Error) {
    text = detail.stack || detail.message || String(detail);
  } else if (typeof detail === "object" && detail !== null) {
    try {
      text = JSON.stringify(detail);
    } catch {
      text = String(detail);
    }
  } else {
    text = String(detail || "");
  }
  return text.replace(/\s+/g, " ").slice(0, limit);
}

function getErrorDetail(error) {
  return getLogDetail(error instanceof Error ? error : error?.stack || error?.message || error, 3000);
}

function getSocketStateText() {
  const stateText = ["connecting", "open", "closing", "closed"][state.socket?.readyState ?? 3] || "unknown";
  return `${stateText} ${serverUrl}`;
}

function getClientEnvironmentSummary() {
  return [
    `desktop=${desktop.isDesktop ? desktop.platform || "unknown" : "web"}`,
    `secure=${window.isSecureContext ? "1" : "0"}`,
    `protocol=${location.protocol}`,
    `host=${location.host}`,
    `devicePixelRatio=${window.devicePixelRatio || 1}`,
    `ua=${navigator.userAgent || ""}`,
  ].join(" ");
}

function getIceServerSummary() {
  const servers = state.config.iceServers || [];
  const counts = { stun: 0, turn: 0, turns: 0, other: 0 };
  const urls = [];
  let turnUsername = false;
  let turnCredential = false;

  for (const server of servers) {
    const serverUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
    for (const rawUrl of serverUrls) {
      const url = String(rawUrl || "");
      if (!url) continue;
      const lower = url.toLowerCase();
      if (lower.startsWith("stun:")) counts.stun += 1;
      else if (lower.startsWith("turns:")) counts.turns += 1;
      else if (lower.startsWith("turn:")) counts.turn += 1;
      else counts.other += 1;
      urls.push(url.replace(/([?&]credential=)[^&]+/i, "$1hidden"));
    }
    if (server.username) turnUsername = true;
    if (server.credential) turnCredential = true;
  }

  return [
    `servers=${servers.length}`,
    `stun=${counts.stun}`,
    `turn=${counts.turn}`,
    `turns=${counts.turns}`,
    `other=${counts.other}`,
    `username=${turnUsername ? "set" : "empty"}`,
    `credential=${turnCredential ? "set" : "empty"}`,
    `urls=${urls.join(",") || "none"}`,
  ].join(" ");
}

function hasTurnServer() {
  if (state.config.turnConfigured) return true;
  return (state.config.iceServers || []).some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => String(url || "").toLowerCase().startsWith("turn:") || String(url || "").toLowerCase().startsWith("turns:"));
  });
}

function recordClientError(event, detail = "") {
  const text = `${event}: ${getLogDetail(detail, 600)}`;
  state.lastErrorAt = Date.now();
  state.recentErrors.unshift({ at: state.lastErrorAt, text });
  state.recentErrors = state.recentErrors.slice(0, 6);
  updateLastErrorLabel();
  addClientLog("error", event, detail);
  console.warn(text);
  logClientEvent(event, detail, { local: false });
}

function updateLastErrorLabel() {
  const latest = state.recentErrors[0]?.text || "-";
  setCompactStat(dom.statLastError, latest);
}

function makePeerDebugDetail(peer, prefix = "") {
  if (!peer) return prefix;
  const senders = ["mic", "system", "screen"].map((role) => {
    const sender = peer.senders?.[role];
    const track = sender?.track;
    return `${role}:${track ? `${track.kind}/${track.readyState}/${track.enabled ? "on" : "off"}` : "none"}`;
  }).join(",");
  const remote = ["mic", "system", "screen"].map((role) => {
    const track = peer.remote?.[role]?.track;
    return `${role}:${track ? track.readyState : "none"}`;
  }).join(",");
  return [
    prefix,
    `peer=${peer.name || peer.id}`,
    `pc=${peer.pc.connectionState}`,
    `ice=${peer.pc.iceConnectionState}`,
    `sig=${peer.pc.signalingState}`,
    getCandidateCountText(peer),
    `senders=${senders}`,
    `remote=${remote}`,
  ].filter(Boolean).join(" ");
}

function getTrackDebugText(track) {
  if (!track) return "none";
  const settings = track.getSettings?.() || {};
  return [
    track.kind,
    track.readyState,
    track.enabled ? "on" : "off",
    settings.width && settings.height ? `${settings.width}x${settings.height}` : "",
    settings.frameRate ? `${settings.frameRate}fps` : "",
    settings.displaySurface ? `surface=${settings.displaySurface}` : "",
  ].filter(Boolean).join("/");
}

function getCallDebugSummary() {
  return [
    `room=${state.currentRoom?.id || "none"}`,
    `peers=${state.peers.size}`,
    `mic=${state.micTrack?.readyState || "none"}`,
    `system=${state.systemTrack?.readyState || "none"}`,
    `screen=${state.screenTrack?.readyState || "none"}`,
    `secure=${window.isSecureContext ? "1" : "0"}`,
    `turn=${hasTurnServer() ? "1" : "0"}`,
  ].join(" ");
}

async function setDesktopScreenShareActive(active) {
  if (!desktop.isDesktop || typeof desktop.setScreenShareActive !== "function") return;
  await desktop.setScreenShareActive(Boolean(active)).catch((error) => {
    logClientEvent("screen-power-save-error", error.message || String(error));
  });
}

function logClientEvent(event, detail = "", { local = true } = {}) {
  if (local) addClientLog("info", event, detail);
  const payload = {
    type: "client-log",
    session: state.callSessionId || "",
    event: String(event || "").slice(0, 80),
    detail: getLogDetail(detail, 500),
  };
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(payload));
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("서버 응답을 받지 못했습니다.");
  return response.json();
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function setStatus(text, tone) {
  dom.statusText.textContent = text;
  dom.statusBadge.dataset.tone = tone === "good" || tone === "bad" ? tone : "";
}

function setMessage(text) {
  dom.message.textContent = text || "";
  showToast(text);
}

function showToast(text) {
  const value = String(text || "").trim();
  if (!value) return;
  const stack = document.querySelector("#toastStack");
  if (!stack) return;
  const last = stack.lastElementChild;
  if (last && last.textContent === value) last.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = value;
  stack.append(toast);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  window.setTimeout(() => {
    toast.classList.add("toast-hide");
    window.setTimeout(() => toast.remove(), 300);
  }, 3800);
}

function getLocalStateText() {
  if (!state.rawMicTrack) return "꺼짐";
  if (state.muted) return "마이크 꺼짐";
  if (isMicSendProtected()) return "에코 보호";
  return state.systemSharing ? "마이크+컴퓨터" : "마이크";
}

function getUserName() {
  return dom.nameInput.value.trim().slice(0, 24) || "Guest";
}

function makeDefaultName() {
  return `User${Math.floor(1000 + Math.random() * 9000)}`;
}

function makeSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function getSignalPayloadKind(data) {
  if (data?.description?.type) return data.description.type;
  if (data?.candidate) return `candidate:${data.candidate.type || ""}:${data.candidate.protocol || ""}`.replace(/:+$/, "");
  if (data?.trackInfo) return `trackInfo:${data.trackInfo.role || ""}`;
  if (data?.mediaStatus) return "mediaStatus";
  if (data?.repairRequest) return `repair:${data.repairRequest.role || ""}:${data.repairRequest.reason || ""}`.replace(/:+$/, "");
  return "unknown";
}

function describeMediaError(error) {
  if (!error) return "오디오 장치를 열지 못했습니다.";
  if (error.name === "NotAllowedError") return "마이크 권한이 거부되었습니다.";
  if (error.name === "NotFoundError") return "사용 가능한 입력 장치를 찾지 못했습니다.";
  if (error.name === "NotReadableError") return "다른 프로그램이 오디오 장치를 사용 중일 수 있습니다.";
  if (error.name === "OverconstrainedError") return "선택한 오디오 장치가 현재 설정을 지원하지 않습니다.";
  return error.message || "오디오 장치를 열지 못했습니다.";
}
