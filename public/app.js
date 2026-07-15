const desktop = window.voiceDesktop || { isDesktop: false, platform: "" };
const serverUrl = location.origin;

// 클라이언트(앱) 버전. 서버 버전(server.js VERSION, n.n.n)과 헷갈리지 않도록 **그냥 정수**(1, 2, 3 …)로 올린다.
// package.json 의 version 은 electron-builder 가 semver 를 요구해 "N.0.0" 형태로 두고, 그 major 가 이 값과 같아야 한다.
// (scripts/check-v2.js 가 둘이 어긋나지 않는지 검사한다)
const CLIENT_VERSION = "3";

function getClientVersion() {
  // 표시는 항상 단일 정수 CLIENT_VERSION 을 쓴다(package.json 의 semver appVersion 대신).
  return CLIENT_VERSION;
}

// 프로필 배경 그라데이션 템플릿. 키는 서버에 저장되고, 실제 CSS는 여기서 매핑한다.
// init() 이 setBanner/renderGradientSwatches 를 부르는 시점보다 먼저 초기화돼야 하므로 파일 최상단에 둔다(TDZ 방지).
const BANNER_GRADIENTS = [
  { key: "aurora", label: "오로라", css: "linear-gradient(135deg, #5b3fd1, #2f6fed 55%, #21c1c9)" },
  { key: "sunset", label: "노을", css: "linear-gradient(135deg, #ff7a59, #ff3d77 55%, #a83279)" },
  { key: "ocean", label: "바다", css: "linear-gradient(135deg, #0f3d6e, #1f7bce 60%, #23c6b6)" },
  { key: "forest", label: "숲", css: "linear-gradient(135deg, #1d5c3f, #3a8f4d 55%, #9fce4f)" },
  { key: "grape", label: "포도", css: "linear-gradient(135deg, #3a1c71, #6d28d9 55%, #d76d9e)" },
  { key: "ember", label: "잔불", css: "linear-gradient(135deg, #7a1e0f, #c8471f 55%, #f2b134)" },
  { key: "mono", label: "모노", css: "linear-gradient(135deg, #2b2f3a, #3f4657 60%, #5a6377)" },
  { key: "rosegold", label: "로즈골드", css: "linear-gradient(135deg, #b76e79, #e3a5a0 55%, #f6d5c0)" },
];
const BANNER_GRADIENT_MAP = Object.fromEntries(BANNER_GRADIENTS.map((g) => [g.key, g.css]));

const ROOM_TYPE_META = {
  voice: { icon: "🔊", label: "통화방" },
  chat: { icon: "#", label: "채팅방" },
  memo: { icon: "📝", label: "메모장" },
  draw: { icon: "🎨", label: "그림판" },
  log: { icon: "📜", label: "전역 로그" },
};

const state = {
  config: { iceServers: [], maxRoomLimit: 8, version: "0.2.42", secure: false, protocol: "https" },
  settingsTab: "audio",
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
  roomsMeta: {}, // roomId -> { startedAt } (통화 시작 시각)
  callRuntimeTimer: 0,
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
  // 전역 로그
  activeLog: null, // { roomId, channelId, name, entries: [] }
  // 다이렉트 메시지
  dm: {
    open: false, // DM 모드(메인 영역을 DM 패널로 전환)
    threads: [], // [{ id, userId, partner, lastAt, lastText, lastFrom }]
    activeUserId: "", // 현재 열려 있는 대화 상대
    partner: null, // 활성 상대 유저 정보
    messages: [],
    unread: {}, // userId -> 안 읽은 수
  },
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
  roomReadOnlyField: document.querySelector("#roomReadOnlyField"),
  roomReadOnlyInput: document.querySelector("#roomReadOnlyInput"),
  roomPermsButton: document.querySelector("#roomPermsButton"),
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
  chatInputPreview: document.querySelector("#chatInputPreview"),
  chatEmojiButton: document.querySelector("#chatEmojiButton"),
  chatSendButton: document.querySelector("#chatSendButton"),
  chatComposerHint: document.querySelector("#chatComposerHint"),
  chatDropOverlay: document.querySelector("#chatDropOverlay"),
  memoPanel: document.querySelector("#memoPanel"),
  memoRoomName: document.querySelector("#memoRoomName"),
  memoStatus: document.querySelector("#memoStatus"),
  memoBody: document.querySelector("#memoBody"),
  memoEditor: document.querySelector("#memoEditor"),
  memoPreview: document.querySelector("#memoPreview"),
  memoCursors: document.querySelector("#memoCursors"),
  memoGutter: document.querySelector("#memoGutter"),
  memoViewSplit: document.querySelector("#memoViewSplit"),
  memoViewEdit: document.querySelector("#memoViewEdit"),
  memoViewPreview: document.querySelector("#memoViewPreview"),
  memoFontSelect: document.querySelector("#memoFontSelect"),
  memoFontManageButton: document.querySelector("#memoFontManageButton"),
  memoColorPick: document.querySelector("#memoColorPick"),
  drawPanel: document.querySelector("#drawPanel"),
  drawRoomName: document.querySelector("#drawRoomName"),
  drawStatus: document.querySelector("#drawStatus"),
  drawToolPen: document.querySelector("#drawToolPen"),
  drawToolEraser: document.querySelector("#drawToolEraser"),
  drawToolFill: document.querySelector("#drawToolFill"),
  drawToolMove: document.querySelector("#drawToolMove"),
  drawColor: document.querySelector("#drawColor"),
  drawSize: document.querySelector("#drawSize"),
  drawSizeVal: document.querySelector("#drawSizeVal"),
  drawZoomIn: document.querySelector("#drawZoomIn"),
  drawZoomOut: document.querySelector("#drawZoomOut"),
  drawZoomReset: document.querySelector("#drawZoomReset"),
  drawUndo: document.querySelector("#drawUndo"),
  drawClear: document.querySelector("#drawClear"),
  drawResize: document.querySelector("#drawResize"),
  drawResizePop: document.querySelector("#drawResizePop"),
  drawResizeW: document.querySelector("#drawResizeW"),
  drawResizeH: document.querySelector("#drawResizeH"),
  drawResizeApply: document.querySelector("#drawResizeApply"),
  drawSaveCanvas: document.querySelector("#drawSaveCanvas"),
  drawSaveLayer: document.querySelector("#drawSaveLayer"),
  drawCopyCanvas: document.querySelector("#drawCopyCanvas"),
  drawMoreBtn: document.querySelector("#drawMoreBtn"),
  drawMoreMenu: document.querySelector("#drawMoreMenu"),
  drawCanvasScroll: document.querySelector("#drawCanvasScroll"),
  drawCanvasStage: document.querySelector("#drawCanvasStage"),
  drawCanvas: document.querySelector("#drawCanvas"),
  drawOverlay: document.querySelector("#drawOverlay"),
  drawLayerAdd: document.querySelector("#drawLayerAdd"),
  drawLayerList: document.querySelector("#drawLayerList"),
  logPanel: document.querySelector("#logPanel"),
  logRoomName: document.querySelector("#logRoomName"),
  logSubtitle: document.querySelector("#logSubtitle"),
  logScroll: document.querySelector("#logScroll"),
  logList: document.querySelector("#logList"),
  logSearchToggle: document.querySelector("#logSearchToggle"),
  logFilters: document.querySelector("#logFilters"),
  logSearchInput: document.querySelector("#logSearchInput"),
  logSearchClear: document.querySelector("#logSearchClear"),
  logFilterUser: document.querySelector("#logFilterUser"),
  logFilterRoom: document.querySelector("#logFilterRoom"),
  logFilterDate: document.querySelector("#logFilterDate"),
  logFilterReset: document.querySelector("#logFilterReset"),
  logFilterCount: document.querySelector("#logFilterCount"),
  dmPanel: document.querySelector("#dmPanel"),
  dmNewButton: document.querySelector("#dmNewButton"),
  dmNewRow: document.querySelector("#dmNewRow"),
  dmCodeInput: document.querySelector("#dmCodeInput"),
  dmFindButton: document.querySelector("#dmFindButton"),
  dmFindMsg: document.querySelector("#dmFindMsg"),
  dmThreadList: document.querySelector("#dmThreadList"),
  dmConvHead: document.querySelector("#dmConvHead"),
  dmConvAvatar: document.querySelector("#dmConvAvatar"),
  dmConvName: document.querySelector("#dmConvName"),
  dmConvCode: document.querySelector("#dmConvCode"),
  dmScroll: document.querySelector("#dmScroll"),
  dmMessages: document.querySelector("#dmMessages"),
  dmEmpty: document.querySelector("#dmEmpty"),
  dmComposer: document.querySelector("#dmComposer"),
  dmInput: document.querySelector("#dmInput"),
  dmSendButton: document.querySelector("#dmSendButton"),
  channelMenuModal: document.querySelector("#channelMenuModal"),
  channelMenuClose: document.querySelector("#channelMenuClose"),
  channelInviteCode: document.querySelector("#channelInviteCode"),
  copyInviteButton: document.querySelector("#copyInviteButton"),
  channelRenameInput: document.querySelector("#channelRenameInput"),
  channelRenameButton: document.querySelector("#channelRenameButton"),
  channelRolesButton: document.querySelector("#channelRolesButton"),
  channelLeaveButton: document.querySelector("#channelLeaveButton"),
  channelDeleteButton: document.querySelector("#channelDeleteButton"),
  channelMenuMessage: document.querySelector("#channelMenuMessage"),
  channelIconRow: document.querySelector("#channelIconRow"),
  channelIconPreview: document.querySelector("#channelIconPreview"),
  channelIconInput: document.querySelector("#channelIconInput"),
  cropModal: document.querySelector("#cropModal"),
  cropCanvas: document.querySelector("#cropCanvas"),
  cropTitle: document.querySelector("#cropTitle"),
  cropHint: document.querySelector("#cropHint"),
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
  settingsTabs: document.querySelector("#settingsTabs"),
  focusBar: document.querySelector("#focusBar"),
  focusBarTitle: document.querySelector("#focusBarTitle"),
  focusExitButton: document.querySelector("#focusExitButton"),
  focusLauncherButton: document.querySelector("#focusLauncherButton"),
  chatFocusButton: document.querySelector("#chatFocusButton"),
  memoFocusButton: document.querySelector("#memoFocusButton"),
  drawFocusButton: document.querySelector("#drawFocusButton"),
  profileModal: document.querySelector("#profileModal"),
  profileCloseButton: document.querySelector("#profileCloseButton"),
  openProfileButton: document.querySelector("#openProfileButton"),
  profileEditBanner: document.querySelector("#profileEditBanner"),
  profileEditAvatar: document.querySelector("#profileEditAvatar"),
  profileEditName: document.querySelector("#profileEditName"),
  profileEditCode: document.querySelector("#profileEditCode"),
  profileBannerInput: document.querySelector("#profileBannerInput"),
  profileBannerClear: document.querySelector("#profileBannerClear"),
  profileGradientRow: document.querySelector("#profileGradientRow"),
  accountAvatarClear: document.querySelector("#accountAvatarClear"),
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
  // 커스텀 파일 선택 버튼: 선택한 파일 이름을 옆에 표시(다른 change 핸들러보다 먼저 바인딩).
  document.querySelectorAll(".file-input").forEach((input) => {
    input.addEventListener("change", () => {
      const nameEl = input.closest(".file-picker")?.querySelector(".file-name");
      if (nameEl) nameEl.textContent = input.files?.[0]?.name || "선택된 파일 없음";
    });
  });
  dom.launcherButton.addEventListener("click", () => desktop.backToLauncher?.());
  dom.settingsButton?.addEventListener("click", () => toggleSettingsModal(true));
  dom.settingsCloseButton?.addEventListener("click", () => toggleSettingsModal(false));
  dom.settingsModal?.addEventListener("click", (event) => {
    if (event.target === dom.settingsModal) toggleSettingsModal(false);
  });
  dom.settingsTabs?.addEventListener("click", (event) => {
    const tab = event.target?.closest?.("[data-settings-tab]");
    if (tab) setSettingsTab(tab.dataset.settingsTab);
  });
  dom.chatFocusButton?.addEventListener("click", toggleFocusMode);
  dom.memoFocusButton?.addEventListener("click", toggleFocusMode);
  dom.drawFocusButton?.addEventListener("click", toggleFocusMode);
  dom.focusExitButton?.addEventListener("click", exitFocusMode);
  dom.focusLauncherButton?.addEventListener("click", () => desktop.backToLauncher?.());
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
  bindDrawEvents();
  bindDmEvents();
  bindLogEvents();

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
    const mod = event.target?.closest?.("[data-mod-action]");
    if (mod) {
      handleCallModeration(mod.dataset.modAction, mod.dataset.modPeerId);
      return;
    }
    const profile = event.target?.closest?.("[data-profile-user]");
    if (profile) {
      openProfileCard(profile.dataset.profileUser, profile, { id: profile.dataset.profileUser, displayName: profile.textContent, code: "----" });
      return;
    }
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
  dom.versionLabel.textContent = `Accord 서버 ${state.config.version || "-"} · 클라 ${getClientVersion()}`;
  dom.versionLabel.title = `서버 버전 ${state.config.version || "-"} / 클라이언트 버전 ${getClientVersion()}`;
  updateSecurityStatus();
  await openSocket();
  attemptAuthResume();
  logClientEvent("client-env", getClientEnvironmentSummary());
  logClientEvent("ice-server-config", getIceServerSummary());
  if (!hasTurnServer()) logClientEvent("turn-missing", "No TURN server configured; symmetric NAT or VM networks may fail.");
  setStatus("서버 연결", "good");
  updateControls();
}

let socketEverConnected = false;
let reconnectTimer = 0;
let reconnectAttempts = 0;

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
      socketEverConnected = true;
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
      resetRoomState();
      updateControls();
      // 한 번이라도 연결됐던 경우엔 자동 재연결(유휴 끊김 대비). 최초 연결 실패는 init에서 처리.
      if (socketEverConnected) {
        scheduleReconnect();
      } else {
        setStatus("서버 끊김", "bad");
        setMessage("서버와 연결이 끊겼습니다.");
      }
    });

    state.socket.addEventListener("error", () => {
      logClientEvent("socket-error", "websocket error");
      recordClientError("socket-error", `WebSocket 실패: ${url.toString()}`);
      reject(new Error("서버 연결을 확인해 주세요."));
    });
  });
}

// 유휴 상태 등으로 연결이 끊기면 지수 백오프로 다시 연결하고 인증을 복원한다.
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempts - 1, 4));
  setStatus("재연결 중", "");
  setMessage(`서버와 연결이 끊겨 다시 연결하는 중입니다… (${reconnectAttempts}회)`);
  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = 0;
    try {
      await openSocket();
      reconnectAttempts = 0;
      attemptAuthResume();
      logClientEvent("client-env", getClientEnvironmentSummary());
      setStatus("서버 연결", "good");
      setMessage("서버에 다시 연결되었습니다.");
    } catch {
      scheduleReconnect();
    }
  }, delay);
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

  dom.profileChipButton?.addEventListener("click", () => toggleProfileModal(true));
  dom.openProfileButton?.addEventListener("click", () => {
    toggleSettingsModal(false);
    toggleProfileModal(true);
  });
  dom.profileCloseButton?.addEventListener("click", () => toggleProfileModal(false));
  dom.profileModal?.addEventListener("click", (event) => {
    if (event.target === dom.profileModal) toggleProfileModal(false);
  });
  dom.saveProfileButton?.addEventListener("click", saveProfile);
  dom.changePasswordButton?.addEventListener("click", changePassword);
  dom.logoutButton?.addEventListener("click", logout);
  dom.accountAvatarInput?.addEventListener("change", () => {
    const file = dom.accountAvatarInput.files?.[0];
    if (!file) return;
    openCropModal(file, (dataUrl) => {
      applyProfilePatch({ avatar: dataUrl }, "프로필 이미지를 적용하는 중...");
    });
    dom.accountAvatarInput.value = "";
  });
  dom.accountAvatarClear?.addEventListener("click", () => {
    if (!state.auth.user?.avatar) {
      setAccountMessage("제거할 프로필 이미지가 없습니다.");
      return;
    }
    applyProfilePatch({ avatar: "" }, "프로필 이미지를 제거하는 중...");
  });
  dom.profileBannerInput?.addEventListener("change", () => {
    const file = dom.profileBannerInput.files?.[0];
    if (!file) return;
    openCropModal(
      file,
      (dataUrl) => {
        applyProfilePatch({ banner: dataUrl }, "배경 이미지를 적용하는 중...");
      },
      { w: BANNER_CROP.w, h: BANNER_CROP.h, title: "배경 이미지 자르기", hint: "드래그로 위치, 슬라이더로 확대해서 가로로 긴 영역을 맞추세요." },
    );
    dom.profileBannerInput.value = "";
  });
  dom.profileBannerClear?.addEventListener("click", () => {
    if (!state.auth.user?.banner) {
      setAccountMessage("제거할 배경 이미지가 없습니다.");
      return;
    }
    applyProfilePatch({ banner: "" }, "배경 이미지를 제거하는 중...");
  });
  renderGradientSwatches();
  dom.profileGradientRow?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.("button[data-gradient]");
    if (!btn) return;
    const key = btn.dataset.gradient || "";
    // 그라데이션을 고르면 배경 이미지를 지워 그라데이션이 보이도록 한다.
    applyProfilePatch(
      { bannerGradient: key, banner: "" },
      key ? "배경 그라데이션을 적용하는 중..." : "기본 배경으로 되돌리는 중...",
    );
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
    applyAuthedUser(message.user);
    setAccountMessage("프로필이 적용되었습니다.", true);
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
  // 프로필 창 미리보기(ID 카드)
  if (dom.profileEditName) dom.profileEditName.textContent = user.displayName || "-";
  if (dom.profileEditCode) dom.profileEditCode.textContent = `#${user.code || "----"}`;
  setAvatar(dom.profileEditAvatar, user);
  setBanner(dom.profileEditBanner, user);
  updateGradientSelection(user.banner ? "" : (user.bannerGradient || ""));
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
  setAccountMessage("저장 중...", true);
  sendSocket(payload);
}

// 이미지·배경·그라데이션 등 개별 항목만 즉시 서버에 반영(프로필 저장 버튼 없이 바로 적용).
function applyProfilePatch(patch, pendingMessage) {
  if (!state.auth.authed) return;
  setAccountMessage(pendingMessage || "적용 중...", true);
  sendSocket({ type: "update-profile", ...patch });
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
  toggleProfileModal(false);
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

// 프로필 배경(배너). 이미지 → 선택한 그라데이션 → 코드 기반 기본 그라데이션 순으로 채운다.
function setBanner(el, user) {
  if (!el) return;
  const banner = user?.banner || "";
  const gradientCss = BANNER_GRADIENT_MAP[user?.bannerGradient || ""];
  if (banner) {
    el.style.backgroundImage = `url("${banner}")`;
    el.classList.remove("empty");
  } else if (gradientCss) {
    el.style.backgroundImage = gradientCss;
    el.classList.remove("empty");
  } else {
    el.style.backgroundImage = "";
    el.classList.add("empty");
  }
  el.style.setProperty("--banner-hue", String(bannerHue(user)));
}

function bannerHue(user) {
  const seed = String(user?.code || user?.id || user?.displayName || "0");
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum = (sum * 31 + seed.charCodeAt(i)) % 360;
  return sum;
}

// 프로필 창의 그라데이션 선택 버튼들을 만든다("기본" + 템플릿들).
function renderGradientSwatches() {
  const row = dom.profileGradientRow;
  if (!row || row.childElementCount) return;
  const makeSwatch = (key, css, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gradient-swatch";
    btn.dataset.gradient = key;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.style.backgroundImage = css;
    row.append(btn);
  };
  // "기본"은 유저 코드 기반 기본 그라데이션(setBanner의 .empty와 동일 계열)
  makeSwatch("", "linear-gradient(135deg, hsl(230 45% 32%), hsl(270 50% 22%))", "기본");
  for (const g of BANNER_GRADIENTS) makeSwatch(g.key, g.css, g.label);
}

// 현재 선택된 그라데이션 버튼에 active 표시.
function updateGradientSelection(activeKey) {
  const row = dom.profileGradientRow;
  if (!row) return;
  for (const btn of row.querySelectorAll("button[data-gradient]")) {
    btn.classList.toggle("active", (btn.dataset.gradient || "") === (activeKey || ""));
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
const cropState = { img: null, scale: 1, fitScale: 1, offX: 0, offY: 0, dragging: false, lastX: 0, lastY: 0, onDone: null, w: 256, h: 256, wide: false };
const CROP_SIZE = 256;
const BANNER_CROP = { w: 960, h: 320 }; // 프로필 배경(3:1)

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
    const sx = cropState.w / rect.width;
    const sy = cropState.h / rect.height;
    cropState.offX += (e.clientX - cropState.lastX) * sx;
    cropState.offY += (e.clientY - cropState.lastY) * sy;
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
    cropState.offX = cropState.w / 2 - (cropState.w / 2 - cropState.offX) * k;
    cropState.offY = cropState.h / 2 - (cropState.h / 2 - cropState.offY) * k;
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

// opts: { w, h, title, hint } — 기본은 정사각 아바타, 배경은 BANNER_CROP 사용.
function openCropModal(file, onDone, opts = {}) {
  if (!file || !dom.cropModal) return;
  const w = Math.max(1, Number(opts.w) || CROP_SIZE);
  const h = Math.max(1, Number(opts.h) || CROP_SIZE);
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      cropState.img = img;
      cropState.w = w;
      cropState.h = h;
      cropState.wide = w !== h;
      // 영역을 꽉 채우는(cover) 배율을 기본값으로 잡는다.
      cropState.fitScale = Math.max(w / img.width, h / img.height);
      cropState.scale = cropState.fitScale;
      cropState.offX = (w - img.width * cropState.scale) / 2;
      cropState.offY = (h - img.height * cropState.scale) / 2;
      cropState.onDone = onDone;
      if (dom.cropCanvas) {
        dom.cropCanvas.width = w;
        dom.cropCanvas.height = h;
        dom.cropCanvas.classList.toggle("wide", cropState.wide);
      }
      if (dom.cropTitle) dom.cropTitle.textContent = opts.title || "이미지 자르기";
      if (dom.cropHint) dom.cropHint.textContent = opts.hint || "드래그로 위치, 슬라이더로 확대해서 정사각형 영역을 맞추세요.";
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
  cropState.offX = Math.min(0, Math.max(cropState.w - w, cropState.offX));
  cropState.offY = Math.min(0, Math.max(cropState.h - h, cropState.offY));
}

function renderCrop() {
  const ctx = dom.cropCanvas?.getContext("2d");
  if (!ctx || !cropState.img) return;
  ctx.clearRect(0, 0, cropState.w, cropState.h);
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
    // 미리보기 대상이 사라졌으면(역할 삭제 등) 미리보기 종료.
    if (rolePreview.active) {
      const ch = currentChannel();
      const stillExists = ch && (rolePreview.kind === "role"
        ? (ch.roles || []).some((r) => r.id === rolePreview.id)
        : (ch.members || []).some((m) => m.id === rolePreview.id));
      if (!stillExists) { rolePreview.active = false; rolePreview.kind = ""; rolePreview.id = ""; }
    }
    renderChannels();
    registerAllCustomFonts();    // 업로드된 공유 글꼴을 브라우저에 등록
    syncMemoFontUi();            // 메모장 글꼴 선택/관리 버튼을 최신 채널 글꼴로 갱신
    renderPermsModal(); // 권한 모달이 열려 있으면 최신 데이터로 갱신
    refreshEmojiPickerIfOpen(); // 이모지 목록이 바뀌었으면 피커 갱신
    updateChatInputPreview();   // 이모지 변경 시 입력 미리보기도 갱신
    verifyActiveChat();
    verifyActiveMemo();
    verifyActiveDraw();
    verifyActiveLog();
    enforceCurrentRoomMediaPerms(); // 통화 중 권한 회수 시 소리/화면 공유 강제 종료
    updateControls();               // 발언·공유 버튼 상태를 최신 권한으로 갱신
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

  if (message.type === "chat:deleted") {
    if (state.activeChat?.roomId === message.roomId) {
      state.chatMessages = state.chatMessages.filter((m) => m.id !== message.msgId);
      if (chatEditingId === message.msgId) chatEditingId = "";
      renderChatMessages();
    }
    return;
  }

  if (message.type === "chat:edited") {
    if (state.activeChat?.roomId === message.roomId) {
      const m = state.chatMessages.find((x) => x.id === message.msgId);
      if (m) { m.text = message.text; m.editedAt = message.editedAt; }
      if (chatEditingId === message.msgId) chatEditingId = "";
      renderChatMessages();
    }
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

  if (message.type === "memo:op") {
    handleMemoOp(message);
    return;
  }

  if (message.type === "memo:font") {
    handleMemoFont(message);
    return;
  }

  if (message.type === "memo:cursor") {
    handleMemoCursor(message);
    return;
  }

  if (message.type === "memo:cursor-leave") {
    handleMemoCursorLeave(message);
    return;
  }

  if (message.type === "memo-error") {
    if (state.memo) setMemoStatus(message.message || "메모 오류", "bad");
    return;
  }

  if (message.type && message.type.startsWith("draw:")) {
    handleDrawSocketMessage(message);
    return;
  }

  if (message.type === "draw-error") {
    if (state.draw) setDrawStatus(message.message || "그림판 오류", "bad");
    return;
  }

  if (message.type === "log:history") {
    handleLogHistory(message);
    return;
  }

  if (message.type === "log:entry") {
    handleLogEntry(message);
    return;
  }

  if (message.type === "log-error") {
    if (state.activeLog && dom.logSubtitle) dom.logSubtitle.textContent = message.message || "로그 오류";
    return;
  }

  if (message.type === "dm:threads") { handleDmThreads(message); return; }
  if (message.type === "dm:history") { handleDmHistory(message); return; }
  if (message.type === "dm:message") { handleIncomingDm(message); return; }
  if (message.type === "dm:deleted") { handleDmDeleted(message); return; }
  if (message.type === "dm:user") { handleDmUser(message); return; }
  if (message.type === "dm-error") { handleDmError(message); return; }

  if (message.type === "presence") {
    state.presence = message.rooms || {};
    state.roomsMeta = message.roomsMeta || {};
    state.online = message.online || [];
    renderRooms();
    renderMemberList();
    renderParticipants();
    return;
  }

  if (message.type === "force-muted") {
    if (!state.muted) { toggleMute(); } // 내 마이크를 끈다(이미 꺼져 있으면 유지)
    setMessage(`${message.byName || "대표자"}님이 회원님의 마이크를 껐습니다.`);
    return;
  }

  if (message.type === "kicked-from-room") {
    // 서버가 이어서 leave-room 처리('left')를 보내 방에서 빠진다. 여기선 안내만.
    setMessage(`${message.byName || "대표자"}님이 ${message.roomName || "통화방"}에서 내보냈습니다.`);
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
    const peer = ensurePeer(message.peer.id, message.peer.name, message.peer.userId);
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

function createPeer(peerId, peerName, userId) {
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
    userId: userId || "",
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

function ensurePeer(peerId, peerName, userId) {
  if (state.peers.has(peerId)) {
    const peer = state.peers.get(peerId);
    peer.name = peerName || peer.name;
    if (userId) peer.userId = userId;
    return peer;
  }
  return createPeer(peerId, peerName, userId);
}

async function createOfferForPeer(peerInfo, options = {}) {
  const peer = ensurePeer(peerInfo.id, peerInfo.name, peerInfo.userId);
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
  if (open) {
    setSettingsTab(state.settingsTab || "audio");
    refreshDevices().catch(() => {});
    renderClientLogs();
  }
}

function setSettingsTab(tab) {
  const name = String(tab || "audio");
  state.settingsTab = name;
  for (const btn of document.querySelectorAll("[data-settings-tab]")) {
    btn.classList.toggle("active", btn.dataset.settingsTab === name);
  }
  for (const pane of document.querySelectorAll("[data-settings-pane]")) {
    pane.classList.toggle("active", pane.dataset.settingsPane === name);
  }
  if (name === "log") renderClientLogs();
}

function toggleProfileModal(open) {
  if (!dom.profileModal) return;
  dom.profileModal.hidden = !open;
  if (open) {
    // 저장된 프로필 기준으로 미리보기(카드·그라데이션 선택)를 최신화한다.
    if (state.auth.user) applyAuthedUser(state.auth.user);
    setAccountMessage("");
  }
}

// ===== 집중모드 =====
// 채팅 · 메모장 · 그림판을 화면 가득 채우고, 상단/사이드 UI를 모두 숨긴다.
// 상단에는 "서버 변경"과 "집중모드 나가기"만 남는다.
function focusablePanel() {
  const body = document.body.classList;
  if (body.contains("chat-open")) return { kind: "chat", name: state.activeChat?.name || "채팅방", icon: "#" };
  if (body.contains("memo-open")) return { kind: "memo", name: state.memo?.name || "메모장", icon: "📝" };
  if (body.contains("draw-open")) return { kind: "draw", name: state.draw?.name || "그림판", icon: "🎨" };
  return null;
}

function enterFocusMode() {
  const panel = focusablePanel();
  if (!panel) {
    setMessage("집중모드는 채팅방 · 메모장 · 그림판에서 사용할 수 있습니다.");
    return;
  }
  closeProfileCard();
  document.body.classList.add("focus-mode");
  const channel = currentChannel();
  if (dom.focusBarTitle) {
    dom.focusBarTitle.textContent = `${panel.icon} ${panel.name}${channel ? ` · ${channel.name}` : ""}`;
  }
  if (dom.focusLauncherButton) dom.focusLauncherButton.hidden = !desktop.isDesktop;
  // 레이아웃이 바뀌었으니 캔버스 등 크기에 의존하는 UI를 다시 맞춘다.
  window.dispatchEvent(new Event("resize"));
}

function exitFocusMode() {
  if (!document.body.classList.contains("focus-mode")) return;
  document.body.classList.remove("focus-mode");
  window.dispatchEvent(new Event("resize"));
}

function toggleFocusMode() {
  if (document.body.classList.contains("focus-mode")) exitFocusMode();
  else enterFocusMode();
}

function handleGlobalHotkeys(event) {
  if (event.key === "Escape" && document.body.classList.contains("focus-mode")
    && dom.settingsModal?.hidden !== false && dom.profileModal?.hidden !== false) {
    exitFocusMode();
    return;
  }
  if (event.key === "Escape" && dom.profileModal && !dom.profileModal.hidden) {
    toggleProfileModal(false);
    return;
  }
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
  // 듣기 권한이 없으면(스피커 차단) 원격 오디오를 음소거한다.
  const blocked = Boolean(state.listenBlocked);
  playback.audio.muted = blocked;

  const raw = getPlaybackVolumePercent(playback);
  const gain = Math.max(0, Math.min(2, raw / 100));
  playback.volumeGain = gain;
  const effGain = blocked ? 0 : gain;

  const pipeline = ensurePlaybackPipeline(playback);
  if (!pipeline) {
    if (playback.audio.srcObject !== playback.sourceStream) {
      playback.audio.srcObject = playback.sourceStream;
    }
    playback.audio.volume = effGain;
    playback.audio.play().catch(() => {});
    updatePlaybackOutputLevel(playback);
    updateSystemEchoFilterPlaybackGain(playback);
    return;
  }

  if (playback.audio.srcObject !== playback.sourceStream) {
    playback.audio.srcObject = playback.sourceStream;
  }
  playback.pipeline.gainNode.gain.value = effGain;
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

// 역할 능력 해석(레거시 manageEmoji=추가·삭제 겸용 폴백). 서버 data-store 와 동일 규칙.
const roleCap = (r, cap) => {
  if (cap === "addEmoji") return Boolean(r.addEmoji ?? r.manageEmoji);
  if (cap === "removeEmoji") return Boolean(r.removeEmoji ?? r.manageEmoji);
  return Boolean(r[cap]);
};
function memberHasCap(channel, cap) {
  if (!channel) return false;
  if (isChannelOwner(channel)) return true;
  const uid = state.auth.user?.id;
  if (channel.userPerms?.[uid]?.[cap]) return true; // 유저 개별 허용
  return (channel.roles || []).some((r) => roleCap(r, cap) && (r.memberIds || []).includes(uid));
}
// 이모지 추가(업로드) 권한.
function canAddEmoji(channel) { return memberHasCap(channel, "addEmoji"); }
// 이모지 삭제 권한.
function canRemoveEmoji(channel) { return memberHasCap(channel, "removeEmoji"); }
// 이모지 사용 권한: 제한 안 걸렸으면 전원 허용.
function canUseEmojiCh(channel) {
  if (!channel) return false;
  if (!channel.emojiUseRestricted) return true;
  return memberHasCap(channel, "useEmoji");
}
// 파일 첨부 권한: 제한 안 걸렸으면 전원 허용.
function canAttachCh(channel) {
  if (!channel) return false;
  if (!channel.attachRestricted) return true;
  return memberHasCap(channel, "attachFile");
}
// 하위호환: 이모지 관리(추가 또는 삭제) 가능 여부.
function canManageEmoji(channel) { return canAddEmoji(channel) || canRemoveEmoji(channel); }
// 방 이름 변경 권한(대표·개별허용·역할).
function canRenameRoom(channel) { return memberHasCap(channel, "renameRoom"); }
// 공유 글꼴 업로드·삭제 권한(대표·개별허용·역할).
function canManageFont(channel) { return memberHasCap(channel, "manageFont"); }

// ===== 권한 시스템(클라이언트 해석) =====
// 서버 data-store 의 resolveRoomPerms 와 동일한 규칙을 클라이언트에서도 계산한다
// (방 숨김·입력 비활성화·미리보기용). 실제 강제는 서버가 담당한다.
const rolePreview = { active: false, kind: "", id: "" }; // 미리보기: kind 'role'|'user', id

function defaultRoomPerm(type, perm) {
  if (perm === "access") return type !== "log";
  return true;
}

// 명시적 역할집합/유저로 방 권한을 계산. 반환 { access, use }.
function resolveRoomPermsWith(room, roleIds, userId) {
  const perms = room.perms || {};
  const one = (perm) => {
    if (userId) {
      const uo = perms.users && perms.users[userId];
      if (uo && uo[perm] !== undefined) return Boolean(uo[perm]);
    }
    let allow = false, deny = false;
    for (const rid of roleIds || []) {
      const ro = perms.roles && perms.roles[rid];
      if (ro && ro[perm] !== undefined) { if (ro[perm]) allow = true; else deny = true; }
    }
    if (allow) return true;
    if (deny) return false;
    return defaultRoomPerm(room.type, perm);
  };
  return {
    access: one("access"),
    use: one("use"),
    voice: one("voice"),
    sound: one("sound"),
    screen: one("screen"),
  };
}

function rolesOfUser(channel, userId) {
  return (channel.roles || []).filter((r) => (r.memberIds || []).includes(userId)).map((r) => r.id);
}

function isChannelOwnerId(channel, userId) {
  if (!channel || !userId) return false;
  return channel.ownerId === userId || (channel.managerIds || []).includes(userId);
}

// 특정 유저의 방 권한(대표/관리자는 전권).
function roomPermsForUser(channel, room, userId, isAdmin) {
  if (isAdmin || isChannelOwnerId(channel, userId)) return { access: true, use: true, owner: true };
  return { ...resolveRoomPermsWith(room, rolesOfUser(channel, userId), userId), owner: false };
}

// 지금 화면에 적용할 "관점"의 방 권한. 미리보기가 켜져 있으면 그 관점으로 계산한다.
function viewRoomPerms(channel, room) {
  if (rolePreview.active && channel) {
    if (rolePreview.kind === "user") {
      return roomPermsForUser(channel, room, rolePreview.id, false);
    }
    // 역할 미리보기: 그 역할 하나만 가진 일반 멤버 관점.
    return { ...resolveRoomPermsWith(room, [rolePreview.id], null), owner: false };
  }
  if (isChannelOwner(channel)) return { access: true, use: true, owner: true };
  return { ...resolveRoomPermsWith(room, rolesOfUser(channel, state.auth.user?.id), state.auth.user?.id), owner: false };
}

// 방이 현재 관점에서 보이는지(접근 권한).
function canSeeRoom(channel, room) {
  return viewRoomPerms(channel, room).access;
}

// 읽기 전용 방이면 대표자만 쓸 수 있다. 그 외에는 권한 시스템의 사용(use) 권한을 따른다.
function canWriteRoom(channel, room) {
  if (room?.readOnly && !isChannelOwner(channel)) return false;
  return viewRoomPerms(channel, room).use;
}

// 현재 통화 중인 방이 속한 채널·방 객체를 채널 목록에서 찾는다.
function currentCallRoomContext() {
  const cur = state.currentRoom;
  if (!cur) return null;
  for (const channel of state.channels) {
    const room = (channel.rooms || []).find((r) => r.id === cur.id);
    if (room) return { channel, room };
  }
  return null;
}

// 현재 통화방에서 "나"의 실제 권한(미리보기와 무관). 발언/소리공유/화면공유 판정용.
function currentRoomPerms() {
  const ctx = currentCallRoomContext();
  if (!ctx) return null;
  if (isChannelOwner(ctx.channel)) {
    return { access: true, use: true, voice: true, sound: true, screen: true, owner: true };
  }
  const p = resolveRoomPermsWith(ctx.room, rolesOfUser(ctx.channel, state.auth.user?.id), state.auth.user?.id);
  return { ...p, owner: false };
}

// 듣기 금지(스피커 권한 없음) 시 원격 오디오를 음소거한다.
function applyListenBlock(blocked) {
  const next = Boolean(blocked);
  if (state.listenBlocked === next) return;
  state.listenBlocked = next;
  applyRemoteVolumes();
}

// 통화 중 권한이 회수되면 이미 켜져 있던 소리/화면 공유를 강제로 끈다.
function enforceCurrentRoomMediaPerms() {
  const rp = currentRoomPerms();
  if (!rp || rp.owner) return;
  if (rp.sound === false && state.systemSharing) {
    dom.systemAudioToggle.checked = false;
    stopSystemAudio().catch(() => {});
  }
  if (rp.screen === false && state.screenSharing) {
    stopScreenShare().catch(() => {});
  }
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
  // 최상단 DM(홈) 버튼
  const home = document.createElement("button");
  home.className = "channel-icon channel-home" + (state.dm.open ? " active" : "");
  home.dataset.dmHome = "1";
  home.title = "다이렉트 메시지";
  home.innerHTML = `<svg class="dm-home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>`;
  const unreadTotal = dmUnreadTotal();
  if (unreadTotal > 0) {
    const badge = document.createElement("span");
    badge.className = "channel-unread";
    badge.textContent = unreadTotal > 99 ? "99+" : String(unreadTotal);
    home.append(badge);
  }
  dom.channelRail.append(home);
  const divider = document.createElement("div");
  divider.className = "channel-rail-divider";
  dom.channelRail.append(divider);
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
  // 미리보기 중에는 대표 전용 버튼(방 추가/삭제)도 숨겨 실제 유저 화면처럼 보여준다.
  const owner = isChannelOwner(channel) && !rolePreview.active;

  // 미리보기 배너(대표가 특정 역할/유저 관점을 확인 중)
  if (rolePreview.active) dom.roomList.append(buildPreviewBanner(channel));

  for (const room of channel.rooms) {
    // 접근 권한이 없는 방은 목록에서 숨긴다(미리보기 중이면 그 관점 기준).
    if (!canSeeRoom(channel, room)) continue;
    const meta = ROOM_TYPE_META[room.type] || ROOM_TYPE_META.voice;
    const item = document.createElement("div");
    item.className = "room-item";
    if (state.currentRoom?.id === room.id) item.classList.add("active");
    if (state.activeChat?.roomId === room.id) item.classList.add("active");
    if (state.memo?.roomId === room.id) item.classList.add("active");
    if (state.draw?.roomId === room.id) item.classList.add("active");
    if (state.activeLog?.roomId === room.id) item.classList.add("active");

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
    row.dataset.profileUser = member.id;

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

// ===== 프로필 카드(ID 카드) 팝오버 =====
// 멤버 목록 · 통화 참가자 · 채팅 · DM 어디서든 유저를 누르면 뜨는 작은 카드.
const profileCard = { el: null, userId: "", cache: new Map(), cleanup: null };

function rememberUserProfile(user) {
  if (!user?.id) return;
  const prev = profileCard.cache.get(user.id) || {};
  profileCard.cache.set(user.id, { ...prev, ...user });
}

// 유저 정보는 여러 곳(현재 채널 → 다른 채널 → DM → 캐시)에 흩어져 있어 순서대로 찾는다.
function lookupUserProfile(userId, fallback = null) {
  if (!userId) return fallback;
  if (state.auth.user?.id === userId) return state.auth.user;
  const here = currentChannel()?.members?.find((m) => m.id === userId);
  if (here) return here;
  for (const ch of state.channels) {
    const m = (ch.members || []).find((x) => x.id === userId);
    if (m) return m;
  }
  const thread = state.dm.threads.find((t) => t.userId === userId);
  if (thread?.partner) return thread.partner;
  if (state.dm.partner?.id === userId) return state.dm.partner;
  return profileCard.cache.get(userId) || fallback;
}

function openProfileCard(userId, anchor, fallback = null) {
  const user = lookupUserProfile(userId, fallback);
  if (!user || !anchor) return;
  const sameTarget = profileCard.el && profileCard.userId === user.id;
  closeProfileCard();
  if (sameTarget) return; // 같은 대상을 다시 누르면 토글로 닫힌다.
  rememberUserProfile(user);

  const pop = document.createElement("div");
  pop.className = "profile-popover";
  pop.id = "profileCardPop";

  const card = document.createElement("div");
  card.className = "profile-card";
  const banner = document.createElement("div");
  banner.className = "profile-card-banner";
  setBanner(banner, user);
  const main = document.createElement("div");
  main.className = "profile-card-main";
  const avatar = document.createElement("span");
  avatar.className = "account-avatar large profile-card-avatar";
  setAvatar(avatar, user);
  const idBox = document.createElement("div");
  idBox.className = "profile-card-id";
  const name = document.createElement("b");
  name.textContent = user.displayName || `유저#${user.code || "----"}`;
  const code = document.createElement("em");
  code.textContent = `#${user.code || "----"}`;
  idBox.append(name, code);
  main.append(avatar, idBox);
  card.append(banner, main);

  const badges = buildProfileCardBadges(user);
  if (badges) card.append(badges);

  const actions = document.createElement("div");
  actions.className = "profile-card-actions";
  const isSelf = state.auth.user?.id === user.id;
  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "secondary";
  if (isSelf) {
    primary.textContent = "프로필 편집";
    primary.addEventListener("click", () => {
      closeProfileCard();
      toggleProfileModal(true);
    });
  } else {
    primary.textContent = "DM 보내기";
    primary.addEventListener("click", () => {
      closeProfileCard();
      openDmMode();
      openDmConversation(user.id);
    });
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary";
  copy.textContent = "코드 복사";
  copy.addEventListener("click", () => {
    copyTextWithFallback(`#${user.code || "----"}`);
    copy.textContent = "복사됨";
    window.setTimeout(() => { copy.textContent = "코드 복사"; }, 1200);
  });
  actions.append(primary, copy);
  card.append(actions);

  pop.append(card);
  document.body.append(pop);
  positionProfileCard(pop, anchor);
  profileCard.el = pop;
  profileCard.userId = user.id;

  const onDocPointerDown = (event) => {
    if (!pop.contains(event.target)) closeProfileCard();
  };
  const onKey = (event) => { if (event.key === "Escape") closeProfileCard(); };
  const onDismiss = () => closeProfileCard();
  // 카드를 연 클릭이 그대로 바깥 클릭으로 잡히지 않도록 다음 틱에 등록한다.
  window.setTimeout(() => document.addEventListener("pointerdown", onDocPointerDown), 0);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onDismiss);
  window.addEventListener("scroll", onDismiss, true);
  profileCard.cleanup = () => {
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onDismiss);
    window.removeEventListener("scroll", onDismiss, true);
  };
}

function closeProfileCard() {
  profileCard.cleanup?.();
  profileCard.cleanup = null;
  profileCard.el?.remove();
  profileCard.el = null;
  profileCard.userId = "";
}

function buildProfileCardBadges(user) {
  const wrap = document.createElement("div");
  wrap.className = "profile-card-badges";
  const channel = currentChannel();
  const member = channel?.members?.find((m) => m.id === user.id);
  if (user.isAdmin) wrap.append(makeBadge("관리자"));
  if (member?.isCreator) wrap.append(makeBadge("창설자"));
  else if (member?.isManager) wrap.append(makeBadge("대표"));
  const online = (state.online || []).includes(user.id);
  const dot = document.createElement("span");
  dot.className = "profile-card-presence" + (online ? " online" : "");
  dot.textContent = online ? "접속 중" : "오프라인";
  wrap.append(dot);
  return wrap;
}

function positionProfileCard(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const gap = 10;
  const margin = 8;
  let left;
  if (window.innerWidth - rect.right >= width + gap) left = rect.right + gap;
  else if (rect.left >= width + gap) left = rect.left - width - gap;
  else left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));
  let top = rect.top;
  if (top + height > window.innerHeight - margin) top = window.innerHeight - height - margin;
  if (top < margin) top = margin;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

// ===== 권한 미리보기 · 역할/권한 관리 모달 =====
function escapeHtml(str) { return escapeHtmlText(str); }

function previewTargetName(channel) {
  if (!channel) return "";
  if (rolePreview.kind === "role") {
    const role = (channel.roles || []).find((r) => r.id === rolePreview.id);
    return role ? role.name : "(삭제된 역할)";
  }
  const m = (channel.members || []).find((u) => u.id === rolePreview.id);
  return m ? (m.displayName || `유저#${m.code}`) : "(알 수 없는 유저)";
}

function buildPreviewBanner(channel) {
  const bar = document.createElement("div");
  bar.className = "preview-banner";
  const label = document.createElement("span");
  const kindText = rolePreview.kind === "role" ? "역할" : "유저";
  label.innerHTML = `👁 미리보기 · <b>${escapeHtml(previewTargetName(channel))}</b> ${kindText} 관점`;
  const stop = document.createElement("button");
  stop.className = "preview-stop";
  stop.textContent = "미리보기 종료";
  stop.dataset.previewStop = "1";
  bar.append(label, stop);
  return bar;
}

function startRolePreview(kind, id) {
  rolePreview.active = true;
  rolePreview.kind = kind;
  rolePreview.id = id;
  closePermsModal();
  renderRooms();
}

function stopRolePreview() {
  rolePreview.active = false;
  rolePreview.kind = "";
  rolePreview.id = "";
  renderRooms();
}

let permsModalEl = null;
const permsState = { tab: "roles", roomId: "", selectedRoleId: "" };

function permsChannel() {
  return currentChannel();
}

function openPermsModal(focusRoomId) {
  const channel = permsChannel();
  if (!channel || !isChannelOwner(channel)) return;
  if (focusRoomId) { permsState.tab = "rooms"; permsState.roomId = focusRoomId; }
  if (!permsState.roomId || !channel.rooms.some((r) => r.id === permsState.roomId)) {
    permsState.roomId = channel.rooms[0]?.id || "";
  }
  ensurePermsModal();
  permsModalEl.hidden = false;
  renderPermsModal();
}
function closePermsModal() { if (permsModalEl) permsModalEl.hidden = true; }

function ensurePermsModal() {
  if (permsModalEl) return;
  permsModalEl = document.createElement("div");
  permsModalEl.className = "modal-backdrop";
  permsModalEl.id = "permsModal";
  permsModalEl.hidden = true;
  permsModalEl.innerHTML = `
    <div class="modal perms-modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2>역할 · 권한 관리</h2>
        <button class="ghost small" data-perms-close="1">닫기</button>
      </header>
      <div class="perms-tabs">
        <button class="perms-tab" data-perms-tab="roles">역할</button>
        <button class="perms-tab" data-perms-tab="members">멤버</button>
        <button class="perms-tab" data-perms-tab="rooms">방별 권한</button>
        <button class="perms-tab" data-perms-tab="preview">미리보기</button>
      </div>
      <div class="modal-body perms-body"></div>
    </div>`;
  document.body.append(permsModalEl);
  permsModalEl.addEventListener("click", onPermsModalClick);
  permsModalEl.addEventListener("change", onPermsModalChange);
  // 새 역할 이름에서 Enter 로 바로 생성.
  permsModalEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target?.closest?.("[data-role-new]")) return;
    e.preventDefault();
    createRoleFromInput();
  });
}

function createRoleFromInput() {
  const channel = permsChannel();
  if (!channel) return;
  const input = permsModalEl.querySelector("[data-role-new]");
  const name = (input?.value || "").trim();
  sendSocket({ type: "channel:create-role", channelId: channel.id, name: name || "새 역할" });
  if (input) input.value = "";
}

function renderPermsModal() {
  if (!permsModalEl || permsModalEl.hidden) return;
  const channel = permsChannel();
  if (!channel) { closePermsModal(); return; }
  permsModalEl.querySelectorAll(".perms-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.permsTab === permsState.tab);
  });
  const body = permsModalEl.querySelector(".perms-body");
  body.innerHTML = "";
  if (permsState.tab === "roles") body.append(buildRolesPane(channel));
  else if (permsState.tab === "members") body.append(buildMembersPane(channel));
  else if (permsState.tab === "rooms") body.append(buildRoomPermsPane(channel));
  else body.append(buildPreviewPane(channel));
}

// 권한 항목 설명(역할 탭·멤버 탭 공용).
const CAP_META = {
  addEmoji: { icon: "➕", name: "커스텀 이모지 추가", short: "이모지 추가", desc: "채널에 새 이모지를 업로드할 수 있어요." },
  removeEmoji: { icon: "🗑", name: "커스텀 이모지 삭제", short: "이모지 삭제", desc: "채널에 등록된 이모지를 지울 수 있어요." },
  useEmoji: { icon: "😀", name: "커스텀 이모지 사용", short: "이모지 사용", desc: "채팅에 커스텀 이모지를 넣을 수 있어요.", gate: "emojiUseRestricted" },
  attachFile: { icon: "📎", name: "파일·이미지 첨부", short: "파일 첨부", desc: "채팅에 파일·이미지를 올릴 수 있어요.", gate: "attachRestricted" },
  renameRoom: { icon: "✏️", name: "방 이름 변경", short: "방 이름", desc: "채널의 방 이름을 바꿀 수 있어요." },
  manageFont: { icon: "🅰", name: "공유 글꼴 관리", short: "글꼴 관리", desc: "메모장 공유 글꼴을 올리고 지울 수 있어요." },
};
const CAP_KEYS = ["addEmoji", "removeEmoji", "useEmoji", "attachFile", "renameRoom", "manageFont"];

// 스위치형 권한 카드(제목 + 설명 + 오른쪽 토글). data 속성은 호출부에서 지정한다.
function buildPermCard({ title, desc, checked, badge, dim, dataset }) {
  const card = document.createElement("label");
  card.className = "perm-card" + (dim ? " dim" : "");
  const textBox = document.createElement("div");
  textBox.className = "perm-card-text";
  const t = document.createElement("b");
  t.textContent = title;
  textBox.append(t);
  if (badge) {
    const bd = document.createElement("span");
    bd.className = "perm-badge";
    bd.textContent = badge;
    t.append(bd);
  }
  if (desc) textBox.append(el("span", "", desc));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "perm-switch";
  input.checked = !!checked;
  for (const [k, v] of Object.entries(dataset || {})) input.dataset[k] = v;
  card.append(textBox, input);
  return card;
}

// --- 역할 관리 탭: 왼쪽 역할 목록 + 오른쪽 상세(디스코드식 마스터·디테일) ---
function buildRolesPane(channel) {
  const wrap = document.createElement("div");
  wrap.className = "perms-pane";
  const roles = channel.roles || [];

  const selId = permsState.selectedRoleId && roles.some((r) => r.id === permsState.selectedRoleId)
    ? permsState.selectedRoleId : (roles[0]?.id || "");

  const grid = document.createElement("div");
  grid.className = "rolemgr";

  // 왼쪽: 역할 목록 + 만들기
  const side = document.createElement("aside");
  side.className = "rolemgr-side";
  const sideHead = document.createElement("div");
  sideHead.className = "rolemgr-side-head";
  sideHead.innerHTML = `<span>역할</span><span class="role-count">${roles.length}</span>`;
  side.append(sideHead);

  const list = document.createElement("div");
  list.className = "rolemgr-list";
  for (const role of roles) {
    const btn = document.createElement("button");
    btn.className = "rolemgr-item" + (role.id === selId ? " active" : "");
    btn.dataset.roleSelect = role.id;
    btn.innerHTML = `<span class="role-dot" style="background:${role.color || "#5865f2"}"></span>
      <span class="role-name">${escapeHtml(role.name)}</span>
      <span class="role-count">${(role.memberIds || []).length}</span>`;
    list.append(btn);
  }
  if (!roles.length) list.append(el("p", "rolemgr-empty", "아직 역할이 없어요."));
  side.append(list);

  const add = document.createElement("div");
  add.className = "rolemgr-add";
  add.innerHTML = `<input class="perms-input" data-role-new placeholder="새 역할 이름" maxlength="24" />
    <button class="primary small" data-role-create="1" title="역할 만들기">＋</button>`;
  side.append(add);
  grid.append(side);

  // 오른쪽: 선택한 역할 상세
  const detail = document.createElement("section");
  detail.className = "rolemgr-detail";
  const role = roles.find((r) => r.id === selId);
  if (role) detail.append(buildRoleDetail(channel, role));
  else {
    const empty = document.createElement("div");
    empty.className = "rolemgr-detail-empty";
    empty.innerHTML = `<span class="rme-icon">🏷️</span>
      <b>역할로 여러 명을 한 번에 관리해요</b>
      <p>왼쪽 아래에서 역할을 만들면 이름·색·권한·멤버를 여기서 편집할 수 있어요.<br />
      개인 한 명에게만 권한을 주려면 위쪽 <b>멤버</b> 탭을 쓰세요.</p>`;
    detail.append(empty);
  }
  grid.append(detail);
  wrap.append(grid);
  return wrap;
}

function buildRoleDetail(channel, role) {
  const box = document.createElement("div");
  box.className = "rd";

  // 헤더: 색상 · 이름 · 삭제
  const head = document.createElement("div");
  head.className = "rd-head";
  head.innerHTML = `
    <label class="rd-color" title="역할 색상">
      <input type="color" data-role-color="${role.id}" value="${role.color || "#5865f2"}" /></label>
    <input class="perms-input rd-name" data-role-name="${role.id}" value="${escapeHtml(role.name)}" maxlength="24" placeholder="역할 이름" />
    <button class="rd-delete" data-role-delete="${role.id}" title="역할 삭제">삭제</button>`;
  box.append(head);

  // 권한 카드
  const sec = document.createElement("div");
  sec.className = "rd-section";
  sec.append(el("p", "rd-sec-title", "권한"));
  for (const cap of CAP_KEYS) {
    const meta = CAP_META[cap];
    const gateOff = meta.gate && !channel[meta.gate];
    sec.append(buildPermCard({
      title: `${meta.icon} ${meta.name}`,
      desc: gateOff ? "지금은 채널 제한이 꺼져 있어 모든 멤버가 할 수 있어요." : meta.desc,
      checked: roleCap(role, cap),
      badge: gateOff ? "제한 꺼짐" : "",
      dim: gateOff,
      dataset: { roleCap: cap, roleId: role.id },
    }));
  }
  box.append(sec);

  // 멤버 배정
  const members = channel.members || [];
  const msec = document.createElement("div");
  msec.className = "rd-section";
  const mt = el("p", "rd-sec-title", "멤버");
  mt.append(el("span", "role-count", String((role.memberIds || []).length)));
  msec.append(mt);
  const mlist = document.createElement("div");
  mlist.className = "rd-members";
  for (const m of members) {
    const has = (role.memberIds || []).includes(m.id);
    const row = document.createElement("label");
    row.className = "rd-member" + (has ? " on" : "");
    row.innerHTML = `<span class="rd-member-name">${escapeHtml(m.displayName || ("유저#" + m.code))} <em>#${escapeHtml(m.code)}</em></span>
      <input class="perm-switch" type="checkbox" data-role-member="${role.id}" data-user-id="${m.id}" ${has ? "checked" : ""} />`;
    mlist.append(row);
  }
  if (!members.length) mlist.append(el("p", "modal-hint", "채널 멤버가 없어요."));
  msec.append(mlist);
  box.append(msec);
  return box;
}

// --- 멤버 탭: 채널 기본 제한 + 멤버 한 명에게만 주는 개별 권한 ---
function buildMembersPane(channel) {
  const wrap = document.createElement("div");
  wrap.className = "perms-pane";

  const gateBox = document.createElement("div");
  gateBox.className = "perms-channel-box";
  gateBox.append(el("p", "rd-sec-title", "채널 기본 제한"));
  gateBox.append(el("p", "modal-hint", "끄면 모든 멤버가 자유롭게 사용할 수 있어요. 켜면 아래에서 권한을 받은 사람과 대표만 가능해요."));
  gateBox.append(buildPermCard({
    title: "😀 커스텀 이모지 사용 제한",
    desc: channel.emojiUseRestricted ? "권한을 받은 사람만 커스텀 이모지를 쓸 수 있어요." : "지금은 모두가 커스텀 이모지를 쓸 수 있어요.",
    checked: !!channel.emojiUseRestricted,
    dataset: { channelPerm: "emojiUseRestricted" },
  }));
  gateBox.append(buildPermCard({
    title: "📎 파일·이미지 첨부 제한",
    desc: channel.attachRestricted ? "권한을 받은 사람만 파일을 올릴 수 있어요." : "지금은 모두가 파일을 올릴 수 있어요.",
    checked: !!channel.attachRestricted,
    dataset: { channelPerm: "attachRestricted" },
  }));
  wrap.append(gateBox);

  const title = el("p", "rd-sec-title", "멤버별 개별 권한");
  wrap.append(title);
  wrap.append(el("p", "modal-hint", "역할과 별개로 이 사람에게만 권한을 열어줍니다. 초록색 ‘역할’ 표시는 이미 역할로 허용된 권한이에요."));

  const list = document.createElement("div");
  list.className = "mp-list";
  for (const m of channel.members || []) {
    const isOwner = isChannelOwnerId(channel, m.id);
    const up = channel.userPerms?.[m.id] || {};
    const myRoles = (channel.roles || []).filter((r) => (r.memberIds || []).includes(m.id));

    const row = document.createElement("div");
    row.className = "mp-row";
    const who = document.createElement("div");
    who.className = "mp-who";
    who.innerHTML = `<span class="mp-name">${escapeHtml(m.displayName || ("유저#" + m.code))} <em>#${escapeHtml(m.code)}</em></span>`;
    const chips = document.createElement("div");
    chips.className = "mp-roles";
    if (isOwner) chips.append(el("span", "mp-chip owner", "대표"));
    for (const r of myRoles) {
      const c = el("span", "mp-chip", r.name);
      c.style.setProperty("--chip", r.color || "#5865f2");
      chips.append(c);
    }
    if (!isOwner && !myRoles.length) chips.append(el("span", "mp-chip none", "역할 없음"));
    who.append(chips);
    row.append(who);

    const caps = document.createElement("div");
    caps.className = "mp-caps";
    for (const cap of CAP_KEYS) {
      const meta = CAP_META[cap];
      const viaRole = myRoles.some((r) => roleCap(r, cap));
      const mine = !!up[cap];
      const gateOff = meta.gate && !channel[meta.gate];
      const b = document.createElement("button");
      b.className = "mp-pill" + (isOwner ? " owner" : mine ? " on" : viaRole ? " via" : "") + (gateOff ? " gate-off" : "");
      b.dataset.userPermPill = cap;
      b.dataset.userId = m.id;
      b.dataset.value = mine ? "0" : "1";
      b.disabled = isOwner;
      b.textContent = `${meta.icon} ${meta.short}`;
      b.title = isOwner ? "대표는 항상 모든 권한을 가집니다."
        : gateOff ? `채널 제한이 꺼져 있어 지금은 모두 가능합니다. (${meta.name})`
        : viaRole && !mine ? `역할로 이미 허용됨 — 클릭하면 이 멤버에게 개별 허용도 추가합니다. (${meta.name})`
        : mine ? `개별 허용됨 — 클릭하면 해제합니다. (${meta.name})`
        : `클릭하면 이 멤버에게만 허용합니다. (${meta.name})`;
      if (viaRole && !mine && !isOwner) b.append(el("span", "mp-pill-tag", "역할"));
      caps.append(b);
    }
    row.append(caps);
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}

// --- 방별 권한 탭 ---
const PERM_LABELS = {
  access: "접근",
  use: { chat: "채팅", draw: "그리기", memo: "편집", voice: "발언", log: "보기" },
};
function useLabelFor(roomType) {
  return PERM_LABELS.use[roomType] || "사용";
}
// 권한 표 헤더 라벨.
function permHeaderLabel(roomType, key) {
  if (key === "access") return "접근";
  if (key === "use") return useLabelFor(roomType);
  if (key === "voice") return "마이크·스피커";
  if (key === "sound") return "소리 공유";
  if (key === "screen") return "화면 공유";
  return key;
}
// 이 방 타입에서 편집할 권한 키 목록.
function permKeysForRoom(roomType) {
  if (roomType === "voice") return ["access", "voice", "sound", "screen"]; // 통화방 세부 권한
  if (roomType === "log") return ["access"]; // 로그는 접근만
  return ["access", "use"];
}

function buildRoomPermsPane(channel) {
  const wrap = document.createElement("div");
  wrap.className = "perms-pane";

  const sel = document.createElement("div");
  sel.className = "perms-room-select";
  const label = document.createElement("span");
  label.textContent = "방 선택";
  const dropdown = document.createElement("select");
  dropdown.dataset.roomSelect = "1";
  for (const r of channel.rooms) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${(ROOM_TYPE_META[r.type] || {}).icon || ""} ${r.name}`;
    if (r.id === permsState.roomId) opt.selected = true;
    dropdown.append(opt);
  }
  sel.append(label, dropdown);
  wrap.append(sel);

  const room = channel.rooms.find((r) => r.id === permsState.roomId);
  if (!room) { wrap.append(el("p", "modal-hint", "방을 선택하세요.")); return wrap; }

  const keys = permKeysForRoom(room.type);
  const hint = document.createElement("p");
  hint.className = "modal-hint";
  hint.textContent = room.type === "log"
    ? "로그방은 기본적으로 관리자·대표만 볼 수 있습니다. 아래에서 역할/유저에게 접근을 허용하세요."
    : (room.type === "voice"
      ? "통화방은 접근 외에 마이크·스피커(듣기), 소리 공유, 화면 공유 권한을 따로 설정할 수 있습니다. 역할 칸은 허용 → 거부 → 기본, 특정 유저 칸은 허용 ↔ 거부로 바뀌고 오른쪽 × 로 유저를 제거합니다."
      : "역할 칸은 허용 → 거부 → 기본(상속) 순으로 바뀝니다. 특정 유저 칸은 허용 ↔ 거부로 토글하고, 오른쪽 × 로 유저를 표에서 제거합니다.");
  wrap.append(hint);

  // 헤더
  const table = document.createElement("div");
  table.className = "perms-table";
  // 컬럼: 대상 + 권한들 + 삭제(정렬용 마지막 칸)
  table.style.setProperty("--perm-cols", `1.6fr ${keys.map(() => "1fr").join(" ")} 40px`);
  const header = document.createElement("div");
  header.className = "perms-trow perms-thead";
  header.append(el("div", "perms-tcell name", "대상"));
  for (const k of keys) {
    header.append(el("div", "perms-tcell", permHeaderLabel(room.type, k)));
  }
  header.append(el("div", "perms-tcell perms-del-cell", ""));
  table.append(header);

  // 역할 행
  for (const role of channel.roles || []) {
    table.append(buildPermRow(room, "role", role.id,
      `<span class="role-dot" style="background:${role.color || "#5865f2"}"></span>${escapeHtml(role.name)}`, keys));
  }
  // 유저별(오버라이드가 있는 유저 + 추가 버튼)
  const userOverrides = Object.keys((room.perms && room.perms.users) || {});
  for (const uid of userOverrides) {
    const m = (channel.members || []).find((u) => u.id === uid);
    const nm = m ? escapeHtml(m.displayName || ("유저#" + m.code)) : "(비멤버)";
    table.append(buildPermRow(room, "user", uid, `<span class="perms-user-ic">@</span>${nm}`, keys, true));
  }
  wrap.append(table);

  // 특정 유저 추가 드롭다운
  const addUser = document.createElement("div");
  addUser.className = "perms-room-select";
  addUser.append(el("span", "", "특정 유저 추가"));
  const udd = document.createElement("select");
  udd.dataset.permAddUser = "1";
  udd.append(new Option("멤버 선택…", ""));
  for (const m of channel.members || []) {
    if (userOverrides.includes(m.id)) continue;
    udd.append(new Option(`${m.displayName || ("유저#" + m.code)} #${m.code}`, m.id));
  }
  addUser.append(udd);
  wrap.append(addUser);
  return wrap;
}

// 권한 행. 역할은 3단계(허용/거부/기본), 유저는 2단계(허용↔거부) + 삭제 버튼.
// perm 값: true(허용)/false(거부)/undefined(상속=기본)
function buildPermRow(room, kind, targetId, labelHtml, keys, isUser) {
  const row = document.createElement("div");
  row.className = "perms-trow";
  const nameCell = document.createElement("div");
  nameCell.className = "perms-tcell name";
  nameCell.innerHTML = labelHtml;
  row.append(nameCell);
  const bucket = kind === "user" ? "users" : "roles";
  const entry = (room.perms && room.perms[bucket] && room.perms[bucket][targetId]) || {};
  for (const k of keys) {
    const cell = document.createElement("div");
    cell.className = "perms-tcell";
    const cur = entry[k]; // true/false/undefined
    const btn = document.createElement("button");
    btn.dataset.permSet = "1";
    btn.dataset.kind = kind;
    btn.dataset.targetId = targetId;
    btn.dataset.perm = k;
    btn.dataset.roomId = room.id;
    if (isUser) {
      // 유저: 허용 ↔ 거부 (상속 없음). 명시하지 않은 값은 기본(허용)으로 표시.
      const deny = cur === false;
      btn.className = "perm-tri " + (deny ? "deny" : "allow");
      btn.textContent = deny ? "✕ 거부" : "✓ 허용";
    } else {
      const stateName = cur === true ? "allow" : cur === false ? "deny" : "inherit";
      btn.className = "perm-tri " + stateName;
      btn.textContent = stateName === "allow" ? "✓ 허용" : stateName === "deny" ? "✕ 거부" : "– 기본";
    }
    cell.append(btn);
    row.append(cell);
  }
  // 삭제 열 — 유저 행에만 버튼, 나머지는 정렬용 빈 칸.
  const delCell = document.createElement("div");
  delCell.className = "perms-tcell perms-del-cell";
  if (isUser) {
    const del = document.createElement("button");
    del.className = "perms-user-del";
    del.dataset.permUserDel = targetId;
    del.dataset.roomId = room.id;
    del.title = "이 유저 권한 제거";
    del.textContent = "×";
    delCell.append(del);
  }
  row.append(delCell);
  return row;
}

// --- 미리보기 탭 ---
function buildPreviewPane(channel) {
  const wrap = document.createElement("div");
  wrap.className = "perms-pane";
  wrap.append(el("p", "modal-hint", "역할이나 멤버를 고르면 그 관점에서 보이는 방·기능을 미리 확인합니다. 실제 화면에도 적용해 볼 수 있어요."));

  const picker = document.createElement("div");
  picker.className = "perms-preview-picks";
  // 역할 목록
  const roleCol = document.createElement("div");
  roleCol.className = "perms-preview-col";
  roleCol.append(el("p", "perms-subtitle", "역할"));
  for (const role of channel.roles || []) {
    const b = document.createElement("button");
    b.className = "perms-pick";
    b.dataset.previewPick = "role";
    b.dataset.id = role.id;
    b.innerHTML = `<span class="role-dot" style="background:${role.color || "#5865f2"}"></span>${escapeHtml(role.name)}`;
    roleCol.append(b);
  }
  if (!(channel.roles || []).length) roleCol.append(el("p", "modal-hint", "역할 없음"));
  // 멤버 목록
  const userCol = document.createElement("div");
  userCol.className = "perms-preview-col";
  userCol.append(el("p", "perms-subtitle", "멤버"));
  for (const m of channel.members || []) {
    const b = document.createElement("button");
    b.className = "perms-pick";
    b.dataset.previewPick = "user";
    b.dataset.id = m.id;
    b.textContent = m.displayName || ("유저#" + m.code);
    userCol.append(b);
  }
  picker.append(roleCol, userCol);
  wrap.append(picker);

  // 결과 미리보기(선택된 대상이 있으면)
  const target = permsState.previewTarget;
  if (target) {
    const res = document.createElement("div");
    res.className = "perms-preview-result";
    const isUserOwner = target.kind === "user" && isChannelOwnerId(channel, target.id);
    res.append(el("p", "perms-subtitle",
      `결과 · ${escapeHtml(previewNameOf(channel, target))}${isUserOwner ? " (대표 → 전권)" : ""}`));
    for (const room of channel.rooms) {
      const p = target.kind === "user"
        ? roomPermsForUser(channel, room, target.id, false)
        : { ...resolveRoomPermsWith(room, [target.id], null), owner: false };
      const line = document.createElement("div");
      line.className = "perms-preview-line" + (p.access ? "" : " no-access");
      const ic = (ROOM_TYPE_META[room.type] || {}).icon || "";
      let caps = p.access ? "접근 O" : "접근 X (숨김)";
      if (p.access && (room.type === "chat" || room.type === "draw" || room.type === "memo")) {
        caps += ` · ${useLabelFor(room.type)} ${p.use ? "O" : "X"}`;
      }
      line.innerHTML = `<span>${ic} ${escapeHtml(room.name)}</span><span class="perms-caps">${caps}</span>`;
      res.append(line);
    }
    const apply = document.createElement("button");
    apply.className = "primary";
    apply.dataset.previewApply = "1";
    apply.textContent = "이 관점으로 실제 화면 미리보기";
    res.append(apply);
    wrap.append(res);
  }
  return wrap;
}

function previewNameOf(channel, target) {
  if (target.kind === "role") {
    const r = (channel.roles || []).find((x) => x.id === target.id);
    return r ? r.name + " 역할" : "역할";
  }
  const m = (channel.members || []).find((x) => x.id === target.id);
  return m ? (m.displayName || ("유저#" + m.code)) : "유저";
}

// 작은 엘리먼트 헬퍼
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function onPermsModalClick(event) {
  const channel = permsChannel();
  if (!channel) return;
  const t = event.target;
  if (t === permsModalEl || t.closest?.("[data-perms-close]")) { closePermsModal(); return; }
  const tab = t.closest?.("[data-perms-tab]");
  if (tab) { permsState.tab = tab.dataset.permsTab; renderPermsModal(); return; }
  const cid = channel.id;

  // 역할 추가
  if (t.closest?.("[data-role-create]")) { createRoleFromInput(); return; }
  // 멤버 탭: 개별 권한 알약 토글
  const pill = t.closest?.("[data-user-perm-pill]");
  if (pill) {
    sendSocket({ type: "channel:set-user-perm", channelId: cid, userId: pill.dataset.userId,
      cap: pill.dataset.userPermPill, value: pill.dataset.value === "1" });
    return;
  }
  const roleSel = t.closest?.("[data-role-select]");
  if (roleSel) { permsState.selectedRoleId = roleSel.dataset.roleSelect; renderPermsModal(); return; }
  const roleDel = t.closest?.("[data-role-delete]");
  if (roleDel) {
    if (window.confirm("이 역할을 삭제할까요? 관련 권한 설정도 함께 지워집니다.")) {
      sendSocket({ type: "channel:delete-role", channelId: cid, roleId: roleDel.dataset.roleDelete });
    }
    return;
  }
  // 권한 토글: 역할은 기본→허용→거부→기본, 유저는 허용↔거부.
  const tri = t.closest?.("[data-perm-set]");
  if (tri) {
    let next;
    if (tri.dataset.kind === "user") {
      next = tri.classList.contains("deny") ? true : false; // 허용 ↔ 거부
    } else {
      const cur = tri.classList.contains("allow") ? true : tri.classList.contains("deny") ? false : undefined;
      next = cur === undefined ? true : cur === true ? false : null; // null=상속으로
    }
    sendSocket({ type: "channel:set-room-perm", channelId: cid, roomId: tri.dataset.roomId,
      kind: tri.dataset.kind, targetId: tri.dataset.targetId, perm: tri.dataset.perm, value: next });
    return;
  }
  // 유저 권한 행 삭제(오버라이드 통째로 제거)
  const permUserDel = t.closest?.("[data-perm-user-del]");
  if (permUserDel) {
    sendSocket({ type: "channel:clear-room-perm", channelId: cid, roomId: permUserDel.dataset.roomId,
      kind: "user", targetId: permUserDel.dataset.permUserDel });
    return;
  }
  // 미리보기 대상 선택
  const pick = t.closest?.("[data-preview-pick]");
  if (pick) { permsState.previewTarget = { kind: pick.dataset.previewPick, id: pick.dataset.id }; renderPermsModal(); return; }
  const applyPrev = t.closest?.("[data-preview-apply]");
  if (applyPrev && permsState.previewTarget) {
    startRolePreview(permsState.previewTarget.kind, permsState.previewTarget.id);
    return;
  }
}

// 역할 이름/색 변경, 방 선택, 유저 추가 (change 이벤트)
function onPermsModalChange(event) {
  const channel = permsChannel();
  if (!channel) return;
  const cid = channel.id;
  const t = event.target;
  const rn = t.closest?.("[data-role-name]");
  if (rn) { sendSocket({ type: "channel:update-role", channelId: cid, roleId: rn.dataset.roleName, name: rn.value }); return; }
  const rc = t.closest?.("[data-role-color]");
  if (rc) { sendSocket({ type: "channel:update-role", channelId: cid, roleId: rc.dataset.roleColor, color: rc.value }); return; }
  const cap = t.closest?.("[data-role-cap]");
  if (cap) { sendSocket({ type: "channel:update-role", channelId: cid, roleId: cap.dataset.roleId, [cap.dataset.roleCap]: cap.checked }); return; }
  const chPerm = t.closest?.("[data-channel-perm]");
  if (chPerm) { sendSocket({ type: "channel:set-perms", channelId: cid, [chPerm.dataset.channelPerm]: chPerm.checked }); return; }
  const rs = t.closest?.("[data-room-select]");
  if (rs) { permsState.roomId = rs.value; renderPermsModal(); return; }
  const memberChk = t.closest?.("[data-role-member]");
  if (memberChk) {
    sendSocket({ type: "channel:set-role-member", channelId: cid, roleId: memberChk.dataset.roleMember,
      userId: memberChk.dataset.userId, value: memberChk.checked });
    return;
  }
  const au = t.closest?.("[data-perm-add-user]");
  if (au && au.value) {
    // 접근 권한을 기본으로 명시(오버라이드 행 생성). 상속과 동일 효과지만 행이 나타난다.
    sendSocket({ type: "channel:set-room-perm", channelId: cid, roomId: permsState.roomId,
      kind: "user", targetId: au.value, perm: "access", value: true });
  }
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
    const home = event.target?.closest?.("[data-dm-home]");
    if (home) { openDmMode(); return; }
    const add = event.target?.closest?.("[data-channel-add]");
    if (add) { closeDmMode(); openChannelModal(); return; }
    const icon = event.target?.closest?.("[data-channel-id]");
    if (icon) { closeDmMode(); selectChannel(icon.dataset.channelId); }
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
    const previewStop = event.target?.closest?.("[data-preview-stop]");
    if (previewStop) { stopRolePreview(); return; }
    const add = event.target?.closest?.("[data-room-add]");
    if (add) { openRoomModal(); return; }
    const head = event.target?.closest?.(".room-item-head");
    if (head) openRoom(head.dataset.roomId, head.dataset.roomType);
  });

  // 방 우클릭 → 이름 변경(대표자 또는 방 이름 변경 권한 보유자)
  dom.roomList?.addEventListener("contextmenu", (event) => {
    const head = event.target?.closest?.(".room-item-head");
    if (!head) return;
    const channel = currentChannel();
    if (!channel || (!isChannelOwner(channel) && !canRenameRoom(channel))) return;
    event.preventDefault();
    openRoomRenameModal(head.dataset.roomId);
  });

  // 방 이름 변경 모달
  dom.roomRenameClose?.addEventListener("click", closeRoomRenameModal);
  dom.roomRenameModal?.addEventListener("click", (e) => { if (e.target === dom.roomRenameModal) closeRoomRenameModal(); });
  dom.roomRenameConfirm?.addEventListener("click", confirmRoomRename);
  dom.roomPermsButton?.addEventListener("click", () => {
    const id = roomRenameTargetId;
    closeRoomRenameModal();
    openPermsModal(id);
  });
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
    if (kick) {
      if (window.confirm("이 멤버를 채널에서 내보낼까요?")) {
        sendSocket({ type: "channel:kick", channelId: channel.id, userId: kick.dataset.kickUserId });
      }
      return;
    }
    // 관리 버튼이 아닌 곳을 누르면 프로필 카드를 띄운다.
    const row = event.target?.closest?.("[data-profile-user]");
    if (row) openProfileCard(row.dataset.profileUser, row);
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
  dom.channelRolesButton?.addEventListener("click", () => {
    const channel = currentChannel();
    if (!channel || !isChannelOwner(channel)) return;
    closeChannelMenu();
    openPermsModal();
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
  if (state.draw && state.draw.channelId !== channelId) closeDrawView();
  if (state.activeLog && state.activeLog.channelId !== channelId) closeLogView();
  state.currentChannelId = channelId;
  renderChannels();
}

function openRoom(roomId, roomType) {
  if (roomType === "voice") {
    closeChatView();
    closeMemoView();
    closeDrawView();
    closeLogView();
    joinRoom(roomId);
  } else if (roomType === "chat") {
    closeMemoView();
    closeDrawView();
    closeLogView();
    openChatRoom(roomId);
  } else if (roomType === "memo") {
    closeChatView();
    closeDrawView();
    closeLogView();
    openMemoRoom(roomId);
  } else if (roomType === "draw") {
    closeChatView();
    closeMemoView();
    closeLogView();
    openDrawRoom(roomId);
  } else if (roomType === "log") {
    closeChatView();
    closeMemoView();
    closeDrawView();
    openLogRoom(roomId);
  } else {
    closeChatView();
    closeMemoView();
    closeDrawView();
    closeLogView();
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
  clearChatInputPreview();
  closeEmojiPicker();
  applyChatReadOnly(found);
  sendSocket({ type: "chat:open", roomId });
  renderRooms();
  dom.chatInput?.focus();
}

// 읽기 전용 방에서는 대표자가 아닌 사람의 입력창을 잠근다.
function applyChatReadOnly(found) {
  const writable = canWriteRoom(found.channel, found.room);
  if (state.activeChat) state.activeChat.writable = writable;
  if (dom.chatInput) {
    dom.chatInput.disabled = !writable;
    dom.chatInput.placeholder = writable ? "메시지를 입력하세요" : "읽기 전용 방입니다 (대표자만 작성)";
  }
  const canAttach = writable && canAttachCh(found.channel);
  if (dom.chatSendButton) dom.chatSendButton.disabled = !writable;
  if (dom.chatAttachButton) {
    dom.chatAttachButton.disabled = !canAttach;
    dom.chatAttachButton.title = canAttach ? "파일 첨부" : "파일 첨부 권한이 없어요";
  }
  if (dom.chatEmojiButton) dom.chatEmojiButton.disabled = !writable;
  if (!writable) closeEmojiPicker();
}

function closeChatView() {
  if (!state.activeChat) return;
  sendSocket({ type: "chat:close" });
  state.activeChat = null;
  state.chatPendingFiles = [];
  clearChatTypers();
  closeEmojiPicker();
  clearChatInputPreview();
  document.body.classList.remove("chat-open");
  exitFocusMode();
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
  applyChatReadOnly(found); // 읽기 전용 설정이 바뀌었을 수 있어 재적용
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
      avatar.className = "chat-avatar account-avatar small profile-link";
      avatar.dataset.profileUser = msg.userId || "";
      setAvatar(avatar, resolveChatUser(msg));
      currentBody = document.createElement("div");
      currentBody.className = "chat-group-body";
      const head = document.createElement("div");
      head.className = "chat-msg-head";
      const name = document.createElement("b");
      name.className = "chat-msg-name profile-link";
      name.dataset.profileUser = msg.userId || "";
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
  // 편집 중이면 텍스트 대신 인라인 편집기를 보여준다.
  if (chatEditingId === msg.id) {
    wrap.append(buildChatEditor(msg));
    return wrap;
  }
  if (msg.text) {
    const text = document.createElement("div");
    text.className = "chat-msg-text markdown-inline";
    // 이모지만 보낸 메시지는 크게(점보) 표시한다.
    if (chatEmojiOnly(msg.text)) text.classList.add("jumbo");
    // 사용자가 입력한 텍스트를 이스케이프한 뒤 일부 마크다운(코드블록/인라인코드/굵게 등)만 허용
    text.innerHTML = renderChatText(msg.text);
    if (msg.editedAt) {
      const edited = document.createElement("span");
      edited.className = "chat-msg-edited";
      edited.textContent = " (수정됨)";
      edited.title = "수정됨: " + formatChatTime(msg.editedAt);
      text.append(edited);
    }
    wrap.append(text);
  }
  if (Array.isArray(msg.files) && msg.files.length) {
    const files = document.createElement("div");
    files.className = "chat-files";
    for (const file of msg.files) files.append(renderChatFile(file));
    wrap.append(files);
  }
  // 모든 메시지에 ⋯ 메뉴(복사)를 붙인다. 삭제 권한이 있으면 즉시삭제(🗑)도 추가.
  const canDelete = canDeleteChatMessage(msg);
  const actions = document.createElement("div");
  actions.className = "chat-msg-actions";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "chat-act more";
  more.textContent = "⋯";
  more.title = "더보기";
  more.addEventListener("click", (e) => { e.stopPropagation(); openChatMsgMenu(msg, more); });
  actions.append(more);
  if (canDelete) {
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "chat-act trash";
    trash.textContent = "🗑";
    trash.title = "바로 삭제 (Shift)";
    trash.addEventListener("click", (e) => { e.stopPropagation(); deleteChatMessage(msg.id, true); });
    actions.append(trash);
  }
  wrap.append(actions);
  // 우클릭도 ⋯ 메뉴와 동일하게 동작(이미지 위 우클릭은 이미지 메뉴가 stopPropagation 으로 가로챈다).
  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openChatMsgMenu(msg, null, { x: e.clientX, y: e.clientY });
  });
  return wrap;
}

function canDeleteChatMessage(msg) {
  const myId = state.auth.user?.id;
  if (msg.userId === myId) return true; // 본인 메시지
  const channel = state.channels.find((c) => c.id === state.activeChat?.channelId);
  return isChannelOwner(channel); // 대표자(또는 관리자)는 전체 삭제
}

function deleteChatMessage(msgId, immediate) {
  if (!state.activeChat) return;
  if (!immediate && !window.confirm("이 메시지를 삭제할까요?")) return;
  sendSocket({ type: "chat:delete", roomId: state.activeChat.roomId, msgId });
}

// ── 자기 메시지 수정(인라인 편집) ──
let chatEditingId = "";

function startEditChatMessage(msgId) {
  chatEditingId = msgId;
  renderChatMessages();
  const ta = document.querySelector(`.chat-edit-box[data-edit-id="${CSS.escape(msgId)}"] textarea`);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); autoResizeEl(ta); }
}

function cancelEditChatMessage() {
  if (!chatEditingId) return;
  chatEditingId = "";
  renderChatMessages();
}

function saveEditChatMessage(msgId, text) {
  const trimmed = String(text || "").replace(/\s+$/, "");
  const msg = state.chatMessages.find((m) => m.id === msgId);
  if (!trimmed) { setChatHint("빈 메시지로 수정할 수 없습니다. (지우려면 삭제를 쓰세요)"); return; }
  if (msg && trimmed === msg.text) { cancelEditChatMessage(); return; } // 변경 없음
  sendSocket({ type: "chat:edit", roomId: state.activeChat.roomId, msgId, text: trimmed });
  chatEditingId = "";
  renderChatMessages();
}

function buildChatEditor(msg) {
  const box = document.createElement("div");
  box.className = "chat-edit-box";
  box.dataset.editId = msg.id;
  const ta = document.createElement("textarea");
  ta.className = "chat-edit-input";
  ta.value = msg.text || "";
  ta.rows = 1;
  ta.addEventListener("input", () => autoResizeEl(ta));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEditChatMessage(msg.id, ta.value); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEditChatMessage(); }
  });
  const actions = document.createElement("div");
  actions.className = "chat-edit-actions";
  const hint = document.createElement("span");
  hint.className = "chat-edit-hint";
  hint.textContent = "Enter 저장 · Esc 취소";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "ghost small"; cancel.textContent = "취소";
  cancel.addEventListener("click", cancelEditChatMessage);
  const save = document.createElement("button");
  save.type = "button"; save.className = "primary small"; save.textContent = "저장";
  save.addEventListener("click", () => saveEditChatMessage(msg.id, ta.value));
  actions.append(hint, cancel, save);
  box.append(ta, actions);
  return box;
}

function autoResizeEl(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function openChatMsgMenu(msg, anchor, pos) {
  const items = [];
  if (msg.text) {
    items.push({ label: "복사", action: () => copyTextToClipboard(msg.text) });
  }
  if (msg.text && msg.userId === state.auth.user?.id && state.activeChat?.writable) {
    items.push({ label: "수정", action: () => startEditChatMessage(msg.id) });
  }
  if (canDeleteChatMessage(msg)) {
    items.push({ label: "삭제", danger: true, action: () => deleteChatMessage(msg.id, false) });
  }
  if (!items.length) return;
  let at = pos;
  if (!at && anchor) { const r = anchor.getBoundingClientRect(); at = { x: r.left, y: r.bottom + 4 }; }
  openChatContextMenu(items, at || { x: 0, y: 0 });
}

// 공용 컨텍스트 메뉴(메시지 ⋯ / 이미지 우클릭·⋯ 공용)
// 이전에는 close 리스너를 { once:true } 로 걸어, 메뉴가 열린 상태에서 다시 우클릭하면
// 남아있던 contextmenu 리스너가 "새로 연" 메뉴를 곧바로 닫아 첫 1회만 보이는 버그가 있었다.
// → 열 때 등록한 리스너를 close 시 반드시 정리(chatCtxCleanup)하도록 바꿔 재우클릭도 정상 동작.
let chatCtxCleanup = null;
function openChatContextMenu(items, pos) {
  closeChatContextMenu();
  const menu = document.createElement("div");
  menu.className = "chat-msg-menu";
  menu.id = "chatContextMenu";
  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-msg-menu-item" + (it.danger ? " danger" : "");
    btn.textContent = it.label;
    btn.addEventListener("click", (e) => { e.stopPropagation(); closeChatContextMenu(); it.action(); });
    menu.append(btn);
  }
  document.body.append(menu);
  // 화면 밖으로 나가지 않게 위치 보정
  const mw = menu.offsetWidth || 150;
  const mh = menu.offsetHeight || 80;
  const left = Math.max(8, Math.min(pos.x, window.innerWidth - mw - 8));
  const top = Math.max(8, Math.min(pos.y, window.innerHeight - mh - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const close = () => closeChatContextMenu();
  setTimeout(() => {
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    chatCtxCleanup = () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, 0);
}

function closeChatContextMenu() {
  if (chatCtxCleanup) { chatCtxCleanup(); chatCtxCleanup = null; }
  document.getElementById("chatContextMenu")?.remove();
}

async function copyTextToClipboard(text) {
  // 일렉트론 앱은 비보안(http) 컨텍스트라 navigator.clipboard 가 없거나 거부됨 → execCommand 폴백.
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyTextWithFallback(text);
    setChatHint("복사했습니다.");
    setTimeout(() => setChatHint(""), 1500);
  } catch {
    try {
      copyTextWithFallback(text);
      setChatHint("복사했습니다.");
      setTimeout(() => setChatHint(""), 1500);
    } catch {
      setChatHint("복사에 실패했습니다.");
    }
  }
}

// 이미지 저장: blob으로 받아 다운로드(같은 서버 origin이라 CORS 문제 없음)
async function saveChatImage(src, name) {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name || src.split("/").pop() || "image";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
  } catch {
    setChatHint("이미지를 저장하지 못했습니다.");
    setTimeout(() => setChatHint(""), 1500);
  }
}

// 이미지 복사: 클립보드는 PNG만 안정적으로 지원 → 필요시 캔버스로 PNG 변환
async function copyChatImage(src) {
  try {
    const res = await fetch(src);
    let blob = await res.blob();
    if (blob.type !== "image/png") blob = await imageBlobToPng(blob);
    // 일렉트론 앱: 비보안 컨텍스트라 navigator.clipboard가 막히므로 네이티브 브리지 사용
    if (window.voiceDesktop?.copyImage) {
      const dataUrl = await blobToDataUrl(blob);
      const r = await window.voiceDesktop.copyImage(dataUrl);
      if (!r?.ok) throw new Error(r?.error || "copy failed");
    } else {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    }
    setChatHint("이미지를 복사했습니다.");
    setTimeout(() => setChatHint(""), 1500);
  } catch {
    setChatHint("이미지 복사에 실패했습니다.");
    setTimeout(() => setChatHint(""), 1500);
  }
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

// 이미지 컨텍스트 메뉴(⋯ 버튼·우클릭 공용): 저장 / 복사 / 크게 보기 / 새 탭
function openChatImageMenu(url, file, pos) {
  openChatContextMenu([
    { label: "이미지 저장", action: () => saveChatImage(url, file.name) },
    { label: "이미지 복사", action: () => copyChatImage(url) },
    { label: "크게 보기", action: () => openImageViewer({ src: url, title: file.name || "이미지" }) },
    { label: "새 탭에서 열기", action: () => window.open(url, "_blank", "noopener") },
  ], pos);
}

function imageBlobToPng(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((out) => out ? resolve(out) : reject(new Error("convert failed")), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load failed")); };
    img.src = url;
  });
}

// ===== 이미지 크게 보기 + 크롭 (첨부 미리보기 확대·크롭, 커스텀 이모지 업로드 공용) =====
let imageViewerEl = null;
function onImageViewerKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeImageViewer(); } }
function closeImageViewer() {
  if (imageViewerEl) {
    if (imageViewerEl._cleanup) imageViewerEl._cleanup();
    imageViewerEl.remove();
    imageViewerEl = null;
  }
  document.removeEventListener("keydown", onImageViewerKey, true);
}

// opts: { src, title, crop(bool), aspect(number|null), maxOut(px), applyLabel,
//         outputType, quality, onApply(blob) }
function openImageViewer(opts) {
  closeImageViewer();
  const o = opts || {};
  const backdrop = document.createElement("div");
  backdrop.className = "img-viewer-backdrop";
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeImageViewer(); });

  const panel = document.createElement("div");
  panel.className = "img-viewer" + (o.crop ? " cropping" : "");
  backdrop.append(panel);

  const head = document.createElement("div");
  head.className = "img-viewer-head";
  const titleEl = document.createElement("span");
  titleEl.className = "img-viewer-title";
  titleEl.textContent = o.title || (o.crop ? "이미지 자르기" : "이미지 보기");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "img-viewer-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "닫기";
  closeBtn.addEventListener("click", closeImageViewer);
  head.append(titleEl, closeBtn);
  panel.append(head);

  const stage = document.createElement("div");
  stage.className = "img-viewer-stage";
  const img = document.createElement("img");
  img.className = "img-viewer-img";
  img.alt = o.title || "이미지";
  img.draggable = false;
  stage.append(img);
  let cropBox = null;
  if (o.crop) {
    cropBox = document.createElement("div");
    cropBox.className = "img-crop-box";
    for (const pos of ["nw", "ne", "sw", "se"]) {
      const h = document.createElement("span");
      h.className = "img-crop-handle " + pos;
      h.dataset.handle = pos;
      cropBox.append(h);
    }
    stage.append(cropBox);
  }
  panel.append(stage);

  const foot = document.createElement("div");
  foot.className = "img-viewer-foot";
  if (o.crop) {
    const hint = document.createElement("span");
    hint.className = "img-viewer-hint";
    hint.textContent = o.aspect ? "영역을 끌어 조절하세요 (정사각형)." : "모서리를 끌어 자를 영역을 조절하세요.";
    const spacer = document.createElement("span");
    spacer.style.flex = "1";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost small";
    cancel.textContent = "취소";
    cancel.addEventListener("click", closeImageViewer);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "primary small";
    apply.textContent = o.applyLabel || "적용";
    apply.addEventListener("click", () => doCropApply());
    foot.append(hint, spacer, cancel, apply);
  } else {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ghost small";
    open.textContent = "새 탭에서 열기";
    open.addEventListener("click", () => window.open(o.src, "_blank", "noopener"));
    foot.append(open);
  }
  panel.append(foot);

  document.body.append(backdrop);
  imageViewerEl = backdrop;
  document.addEventListener("keydown", onImageViewerKey, true);

  // 크롭 상태: crop 은 stage 좌표(표시 픽셀) 기준. layout 은 contain 렌더된 이미지 박스.
  const crop = { x: 0, y: 0, w: 0, h: 0 };
  let layout = { left: 0, top: 0, w: 0, h: 0, scale: 1 };

  function computeLayout() {
    const sw = stage.clientWidth || 1, sh = stage.clientHeight || 1;
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const scale = Math.min(sw / nw, sh / nh);
    const w = nw * scale, h = nh * scale;
    return { left: (sw - w) / 2, top: (sh - h) / 2, w, h, scale };
  }
  function clampCrop() {
    crop.w = Math.max(24, Math.min(crop.w, layout.w));
    crop.h = Math.max(24, Math.min(crop.h, layout.h));
    crop.x = Math.max(layout.left, Math.min(crop.x, layout.left + layout.w - crop.w));
    crop.y = Math.max(layout.top, Math.min(crop.y, layout.top + layout.h - crop.h));
  }
  function drawCrop() {
    clampCrop();
    cropBox.style.left = crop.x + "px";
    cropBox.style.top = crop.y + "px";
    cropBox.style.width = crop.w + "px";
    cropBox.style.height = crop.h + "px";
  }
  function initCrop() {
    let cw, ch;
    if (o.aspect) {
      if (layout.w / layout.h > o.aspect) { ch = layout.h * 0.9; cw = ch * o.aspect; }
      else { cw = layout.w * 0.9; ch = cw / o.aspect; }
    } else { cw = layout.w * 0.9; ch = layout.h * 0.9; }
    crop.w = cw; crop.h = ch;
    crop.x = layout.left + (layout.w - cw) / 2;
    crop.y = layout.top + (layout.h - ch) / 2;
    drawCrop();
  }
  function resizeCrop(handle, start, dx, dy) {
    let x = start.x, y = start.y, w = start.w, h = start.h;
    const right = start.x + start.w, bottom = start.y + start.h;
    if (handle.includes("e")) w = start.w + dx;
    if (handle.includes("s")) h = start.h + dy;
    if (handle.includes("w")) { x = start.x + dx; w = start.w - dx; }
    if (handle.includes("n")) { y = start.y + dy; h = start.h - dy; }
    if (o.aspect) {
      h = w / o.aspect;
      if (handle.includes("n")) y = bottom - h;
    }
    if (w >= 24 && h >= 24) { crop.x = x; crop.y = y; crop.w = w; crop.h = h; drawCrop(); }
  }
  function doCropApply() {
    const sc = layout.scale || 1;
    const sx = (crop.x - layout.left) / sc;
    const sy = (crop.y - layout.top) / sc;
    const sw = crop.w / sc, sh = crop.h / sc;
    let outW = sw, outH = sh;
    const maxOut = o.maxOut || 0;
    if (maxOut && Math.max(outW, outH) > maxOut) {
      const r = maxOut / Math.max(outW, outH);
      outW *= r; outH *= r;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(outW));
    canvas.height = Math.max(1, Math.round(outH));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const type = o.outputType || "image/png";
    canvas.toBlob((blob) => {
      if (blob && o.onApply) o.onApply(blob);
      closeImageViewer();
    }, type, o.quality || 0.92);
  }

  if (o.crop) {
    cropBox.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const handle = e.target?.dataset?.handle || "";
      const startX = e.clientX, startY = e.clientY;
      const start = { ...crop };
      const move = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (handle) resizeCrop(handle, start, dx, dy);
        else { crop.x = start.x + dx; crop.y = start.y + dy; drawCrop(); }
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  img.onload = () => {
    layout = computeLayout();
    if (o.crop) initCrop();
  };
  img.src = o.src;

  // 창 크기 변화 시 레이아웃/크롭 재계산.
  const ro = new ResizeObserver(() => {
    const prev = layout;
    layout = computeLayout();
    if (o.crop && prev.w) {
      const r = layout.w / prev.w;
      crop.x = layout.left + (crop.x - prev.left) * r;
      crop.y = layout.top + (crop.y - prev.top) * r;
      crop.w *= r; crop.h *= r;
      drawCrop();
    }
  });
  ro.observe(stage);
  backdrop._cleanup = () => ro.disconnect();
}

// ── 경량 코드 구문 강조(외부 의존성 없음, 디스코드/원다크식) ──
// 원본 코드를 토큰 스캔해 각 토큰을 escape 후 <span class="hl-*">로 감싼다(XSS 안전: 태그는 우리가 넣는 span 뿐).
const HL_CFG = (() => {
  const kw = (s) => new Set(s.split(/\s+/));
  const cLike = { line: ["//"], block: ["/*", "*/"], hash: false };
  const hashLine = { line: ["#"], block: null, hash: true };
  const K = {
    js: "await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield null true false undefined of get set as from",
    py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self match case",
    c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class public private protected virtual namespace template new delete using this string vector auto override final",
    cs: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await yield get set",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record",
    go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota string int bool error make len append",
    rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    php: "abstract and array as break case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include instanceof insteadof interface isset list match namespace new or print private protected public readonly require return static switch throw trait try unset use var while yield true false null self this",
    ruby: "def end if elsif else unless while until for in do begin rescue ensure raise return yield class module self nil true false and or not then case when break next redo retry super attr_accessor require puts",
    sql: "select from where insert update delete into values create table drop alter join left right inner outer on group by order having limit distinct as and or not null primary key foreign references default index union all set",
  };
  const map = {
    javascript: { ...cLike, keywords: kw(K.js) }, js: null,
    typescript: { ...cLike, keywords: kw(K.js + " interface type enum namespace declare implements readonly public private protected abstract keyof infer never unknown any") }, ts: null,
    jsx: null, tsx: null, json: { ...cLike, keywords: kw("true false null") },
    python: { ...hashLine, keywords: kw(K.py) }, py: null,
    c: { ...cLike, keywords: kw(K.c) }, "c++": { ...cLike, keywords: kw(K.c) }, cpp: null, h: null, hpp: null,
    "c#": { ...cLike, keywords: kw(K.cs) }, cs: null, csharp: null,
    java: { ...cLike, keywords: kw(K.java) }, kotlin: { ...cLike, keywords: kw(K.java + " fun val when object companion data sealed suspend") }, kt: null,
    swift: { ...cLike, keywords: kw("func let var if else guard switch case for while return class struct enum protocol extension import true false nil self init deinit weak lazy") },
    go: { ...cLike, keywords: kw(K.go) }, golang: null,
    rust: { ...cLike, keywords: kw(K.rust) }, rs: null,
    php: { line: ["//", "#"], block: ["/*", "*/"], keywords: kw(K.php) },
    ruby: { ...hashLine, keywords: kw(K.ruby) }, rb: null,
    bash: { ...hashLine, keywords: kw("if then else elif fi for while do done case esac in function return echo export local read exit cd source") }, sh: null, shell: null, zsh: null,
    sql: { line: ["--"], block: ["/*", "*/"], keywords: kw(K.sql), ci: true },
    yaml: { ...hashLine, keywords: kw("true false null yes no") }, yml: null, toml: { ...hashLine, keywords: kw("true false") },
    css: { line: [], block: ["/*", "*/"], keywords: kw("") },
    html: { line: [], block: ["<!--", "-->"], keywords: kw("") }, xml: null,
  };
  // 별칭(null) 해소
  const alias = { js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", py: "python", cpp: "c++", h: "c", hpp: "c++", cs: "c#", csharp: "c#", kt: "kotlin", golang: "go", rs: "rust", rb: "ruby", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", xml: "html" };
  for (const [k, v] of Object.entries(alias)) map[k] = map[v];
  return map;
})();
const HL_DEFAULT = { line: ["//", "#"], block: ["/*", "*/"], hash: true, keywords: new Set() };

function highlightCode(code, lang) {
  const cfg = HL_CFG[(lang || "").toLowerCase()] || HL_DEFAULT;
  const src = String(code || "");
  const n = src.length;
  let i = 0;
  let out = "";
  const wrap = (cls, text) => `<span class="hl-${cls}">${escapeHtmlText(text)}</span>`;
  const idStart = (c) => /[A-Za-z_$]/.test(c);
  const idPart = (c) => /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    const c = src[i];
    // 줄 주석
    const lc = cfg.line.find((tok) => src.startsWith(tok, i));
    if (lc) { let j = src.indexOf("\n", i); if (j < 0) j = n; out += wrap("comment", src.slice(i, j)); i = j; continue; }
    // 블록 주석
    if (cfg.block && src.startsWith(cfg.block[0], i)) {
      let j = src.indexOf(cfg.block[1], i + cfg.block[0].length);
      j = j < 0 ? n : j + cfg.block[1].length;
      out += wrap("comment", src.slice(i, j)); i = j; continue;
    }
    // 문자열
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === "\n" && c !== "`") break;
        j++;
      }
      out += wrap("string", src.slice(i, j)); i = j; continue;
    }
    // 숫자
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i; while (j < n && /[0-9a-fA-FxXbBoO._]/.test(src[j])) j++;
      out += wrap("number", src.slice(i, j)); i = j; continue;
    }
    // 식별자/키워드
    if (idStart(c)) {
      let j = i; while (j < n && idPart(src[j])) j++;
      const word = src.slice(i, j);
      const key = cfg.ci ? word.toLowerCase() : word;
      if (cfg.keywords.has(key)) out += wrap("keyword", word);
      else {
        // 뒤에 '(' 가 오면 함수 호출로 취급
        let k = j; while (k < n && (src[k] === " " || src[k] === "\t")) k++;
        out += src[k] === "(" ? wrap("fn", word) : escapeHtmlText(word);
      }
      i = j; continue;
    }
    out += escapeHtmlText(c); i++;
  }
  return out;
}

// 채팅 메시지 텍스트: 이스케이프 후 코드블록/헤딩/인용/리스트/인라인 서식만 허용(XSS 안전).
// 언어 태그(```cs 등)와 # 헤딩, > 인용, - / 1. 리스트, --- 구분선, :이모지: 를 지원한다.
function renderChatText(src, emojiMap) {
  const map = emojiMap || activeChatEmojiMap();
  const str = String(src || "");
  // 1) 코드펜스(``` 또는 ```lang)를 먼저 분리해 블록으로 보호한다.
  const fence = /```([a-zA-Z0-9+#._-]*)\n([\s\S]*?)```|```([\s\S]*?)```/g;
  const segments = []; // { code:bool, lang, value }
  let last = 0;
  let m;
  while ((m = fence.exec(str))) {
    if (m.index > last) segments.push({ code: false, value: str.slice(last, m.index) });
    if (m[2] !== undefined) segments.push({ code: true, lang: (m[1] || "").toLowerCase(), value: m[2].replace(/\n$/, "") });
    else segments.push({ code: true, lang: "", value: (m[3] || "").replace(/^\n/, "").replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < str.length) segments.push({ code: false, value: str.slice(last) });
  if (!segments.length) return "";

  const out = [];
  for (const seg of segments) {
    if (seg.code) {
      const langTag = seg.lang ? `<span class="chat-code-lang">${escapeHtmlText(seg.lang)}</span>` : "";
      out.push(`<pre class="chat-code"${seg.lang ? ` data-lang="${escapeHtmlText(seg.lang)}"` : ""}>${langTag}<code>${highlightCode(seg.value, seg.lang)}</code></pre>`);
      continue;
    }
    out.push(renderChatBlocks(seg.value.replace(/^\n+/, "").replace(/\n+$/, ""), map));
  }
  return out.join("");
}

// 코드펜스 사이의 일반 텍스트를 블록(헤딩/인용/리스트/문단) 단위로 렌더한다.
function renderChatBlocks(text, map) {
  if (!text) return "";
  const lines = text.split("\n");
  const html = [];
  let list = null;      // "ul" | "ol" | null
  let para = [];        // 연속된 일반 줄(문단) 버퍼
  const flushList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  const flushPara = () => {
    if (para.length) { html.push(`<p>${para.map((l) => inlineChat(l, map)).join("<br>")}</p>`); para = []; }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const hr = /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const lv = heading[1].length;
      html.push(`<h${lv} class="chat-h">${inlineChat(heading[2], map)}</h${lv}>`);
    } else if (hr) {
      flushPara(); flushList(); html.push('<hr class="chat-hr" />');
    } else if (quote) {
      flushPara(); flushList();
      html.push(`<blockquote class="chat-quote">${inlineChat(quote[1], map)}</blockquote>`);
    } else if (ul) {
      flushPara();
      if (list !== "ul") { flushList(); html.push('<ul class="chat-list">'); list = "ul"; }
      html.push(`<li>${inlineChat(ul[1], map)}</li>`);
    } else if (ol) {
      flushPara();
      if (list !== "ol") { flushList(); html.push('<ol class="chat-list">'); list = "ol"; }
      html.push(`<li>${inlineChat(ol[1], map)}</li>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return html.join("");
}

// 채팅용 인라인 서식(굵게/기울임/취소선/인라인코드/링크/커스텀 이모지).
// inlineMarkdown 은 이미 이스케이프된 문자열을 받도록 설계돼 있어 먼저 escape 한다(XSS 안전).
function inlineChat(str, map) {
  let out = inlineMarkdown(escapeHtmlText(str));
  out = replaceCustomEmoji(out, map);
  return out;
}

// :name: 토큰을 커스텀 이모지 이미지로 치환(코드/링크 자리표시자는 건드리지 않음).
function replaceCustomEmoji(html, map) {
  if (!map) return html;
  return html.replace(/:([a-zA-Z0-9_+-]{1,32}):/g, (whole, name) => {
    const url = map[name];
    if (!url) return whole;
    return `<img class="chat-emoji" src="${escapeHtmlText(url)}" alt=":${escapeHtmlText(name)}:" title=":${escapeHtmlText(name)}:" draggable="false" />`;
  });
}

// 이모지만 있는 메시지인지(디스코드식 "점보 이모지" 판정). 텍스트가 섞이면 false.
// 커스텀 이모지(:name:)와 유니코드 이모지를 모두 세고, 너무 많으면(27개 초과) 크게 키우지 않는다.
const UNICODE_EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|︎|‍|⃣|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator})*/gu;
function chatEmojiOnly(src, emojiMap) {
  const str = String(src || "");
  if (!str.trim() || str.includes("```")) return false;
  const map = emojiMap || activeChatEmojiMap();
  let count = 0;
  let rest = str.replace(/:([a-zA-Z0-9_+-]{1,32}):/g, (whole, name) => {
    if (!map[name]) return whole;
    count += 1;
    return "";
  });
  rest = rest.replace(UNICODE_EMOJI_RE, () => { count += 1; return ""; });
  if (!count || count > 27) return false;
  return rest.trim() === "";
}

// 현재 보고 있는 채팅방이 속한 채널의 커스텀 이모지 맵 { name: url }.
function activeChatEmojiMap() {
  const ch = state.channels.find((c) => c.id === state.activeChat?.channelId);
  return emojiMapOf(ch);
}
function emojiMapOf(channel) {
  const map = {};
  for (const e of (channel?.emojis || [])) if (e && e.name && e.url) map[e.name] = e.url;
  return map;
}

function renderChatFile(file) {
  const url = String(file.url || "");
  const isImage = file.kind === "image" || /^image\//.test(file.mime || "");
  if (isImage) {
    const box = document.createElement("div");
    box.className = "chat-image-wrap";
    const img = document.createElement("img");
    img.className = "chat-image";
    img.loading = "lazy";
    img.alt = file.name || "이미지";
    img.src = url;
    // 클릭 → 라이트박스로 크게 보기
    img.addEventListener("click", (e) => { e.preventDefault(); openImageViewer({ src: url, title: file.name || "이미지" }); });
    box.append(img);
    // ⋯ 버튼(우클릭이 막힌 환경/터치에서도 저장·복사 가능)
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chat-image-more";
    more.textContent = "⋯";
    more.title = "더보기";
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      openChatImageMenu(url, file, { x: r.right - 4, y: r.bottom + 4 });
    });
    box.append(more);
    // 우클릭 → ⋯ 와 동일한 이미지 메뉴(메시지 우클릭보다 우선하도록 stopPropagation)
    box.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChatImageMenu(url, file, { x: e.clientX, y: e.clientY });
    });
    return box;
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
  clearChatInputPreview();
  for (const f of state.chatPendingFiles) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
  state.chatPendingFiles = [];
  renderChatAttachments();
  setChatHint("");
  state.chatTypingSentAt = 0;
  dom.chatInput?.focus();
}

function onChatInput() {
  autoResizeChatInput();
  updateChatInputPreview();
  const now = Date.now();
  if (state.activeChat && now - state.chatTypingSentAt > 2500) {
    state.chatTypingSentAt = now;
    sendSocket({ type: "chat:typing", roomId: state.activeChat.roomId });
  }
}

// 입력창 아래에 마크다운/이모지가 어떻게 보일지 실시간 미리보기.
// 서식 문법이나 커스텀 이모지가 들어있을 때만 표시(평범한 한 줄은 방해되지 않게 숨김).
const CHAT_MD_HINT = /(\*\*|__|~~|`|^#{1,6}\s|^>\s|^\s*[-*+]\s|^\s*\d+\.\s|\[[^\]]+\]\(https?:|:[a-zA-Z0-9_+-]{1,32}:)/m;
function updateChatInputPreview() {
  const box = dom.chatInputPreview;
  if (!box) return;
  const raw = dom.chatInput?.value || "";
  const map = activeChatEmojiMap();
  const hasEmoji = /:([a-zA-Z0-9_+-]{1,32}):/.test(raw) && Object.keys(map).length > 0;
  if (!raw.trim() || (!CHAT_MD_HINT.test(raw) && !hasEmoji)) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.innerHTML = renderChatText(raw, map);
  box.classList.toggle("jumbo", chatEmojiOnly(raw, map));
  box.hidden = false;
}

function clearChatInputPreview() {
  if (dom.chatInputPreview) { dom.chatInputPreview.hidden = true; dom.chatInputPreview.innerHTML = ""; }
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
  const ch = activeChatChannel();
  if (!canAttachCh(ch)) { setChatHint("파일을 첨부할 권한이 없어요."); return; }
  for (const file of [...fileList]) {
    if (state.chatPendingFiles.length >= CHAT_MAX_FILES) {
      setChatHint(`한 번에 최대 ${CHAT_MAX_FILES}개까지 첨부할 수 있습니다.`);
      break;
    }
    if (file.size > CHAT_UPLOAD_MAX) {
      setChatHint(`${file.name}: 50MB를 넘어 첨부할 수 없습니다.`);
      continue;
    }
    const isImage = (file.type || "").startsWith("image/");
    const entry = {
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      kind: isImage ? "image" : "file",
      uploading: true,
      progress: 0,
      url: "",
      // 업로드 완료 전에도 로컬 미리보기를 보여주기 위한 objectURL
      previewUrl: isImage ? URL.createObjectURL(file) : "",
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
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
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
    // 이미지는 썸네일 미리보기를 함께 표시
    if (f.kind === "image" && (f.previewUrl || f.url)) {
      chip.classList.add("has-thumb");
      const thumb = document.createElement("img");
      thumb.className = "chat-attach-thumb";
      thumb.src = f.previewUrl || f.url;
      thumb.alt = f.name || "이미지";
      thumb.title = "클릭하면 크게 보고 자를 수 있어요";
      // 클릭 → 크게 보기 + 크롭. 크롭 시 대기 파일을 잘린 이미지로 교체.
      thumb.addEventListener("click", () => openAttachmentCropper(f));
      chip.append(thumb);
    }
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
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        state.chatPendingFiles = state.chatPendingFiles.filter((x) => x !== f);
        renderChatAttachments();
      });
      chip.append(remove);
    }
    box.append(chip);
  }
}

// 첨부 미리보기 이미지 → 크게 보기 + 크롭. 업로드 중이면 크롭 없이 크게 보기만.
function openAttachmentCropper(entry) {
  const src = entry.previewUrl || entry.url;
  if (!src) return;
  if (entry.uploading) {
    openImageViewer({ src, title: entry.name || "이미지" });
    return;
  }
  const png = (entry.mime || "").includes("png");
  openImageViewer({
    src,
    title: entry.name || "이미지",
    crop: true,
    maxOut: 2560, // 너무 큰 원본은 적당히 축소
    applyLabel: "자르기 적용",
    outputType: png ? "image/png" : "image/jpeg",
    quality: 0.92,
    onApply: (blob) => applyCroppedAttachment(entry, blob),
  });
}

// 크롭 결과 blob 으로 대기 파일을 교체하고 다시 업로드한다.
async function applyCroppedAttachment(entry, blob) {
  if (!state.chatPendingFiles.includes(entry)) return;
  const base = (entry.name || "image").replace(/\.[^./\\]+$/, "");
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const file = new File([blob], `${base}.${ext}`, { type: blob.type });
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  entry.previewUrl = URL.createObjectURL(blob);
  entry.name = file.name;
  entry.mime = blob.type;
  entry.size = blob.size;
  entry.uploading = true;
  entry.progress = 0;
  entry.url = "";
  renderChatAttachments();
  try {
    const result = await uploadChatFile(file, (p) => { entry.progress = p; renderChatAttachments(); });
    entry.url = result.url;
    entry.size = Number.isFinite(result.size) ? result.size : entry.size;
    entry.mime = result.mime || entry.mime;
    entry.uploading = false;
    renderChatAttachments();
  } catch (error) {
    entry.uploading = false;
    renderChatAttachments();
    setChatHint(error.message || "자른 이미지 업로드에 실패했습니다.");
  }
}

// ===== 커스텀 이모지 피커 =====
const UNICODE_EMOJIS = [
  "😀", "😂", "🙂", "😍", "😎", "🤔", "😭", "😡", "👍", "👎",
  "🙏", "👏", "🔥", "🎉", "💯", "❤️", "💜", "✅", "❌", "⭐",
  "😅", "😉", "😊", "🥰", "😴", "🤯", "🥳", "😱", "💀", "👀",
  "🚀", "☕", "🍺", "🍕", "🎮", "🎧", "💡", "📌", "⚡", "✨",
];

let emojiPickerEl = null;

function activeChatChannel() {
  return state.channels.find((c) => c.id === state.activeChat?.channelId) || null;
}

function closeEmojiPicker() {
  if (emojiPickerEl) { emojiPickerEl.remove(); emojiPickerEl = null; }
  document.removeEventListener("click", onEmojiPickerOutside, true);
}
function onEmojiPickerOutside(e) {
  if (!emojiPickerEl) return;
  if (emojiPickerEl.contains(e.target)) return;
  if (dom.chatEmojiButton && (e.target === dom.chatEmojiButton || dom.chatEmojiButton.contains(e.target))) return;
  closeEmojiPicker();
}
function toggleEmojiPicker() {
  if (emojiPickerEl) { closeEmojiPicker(); return; }
  if (!state.activeChat) return;
  const composer = dom.chatEmojiButton?.closest(".chat-composer");
  if (!composer) return;
  emojiPickerEl = buildEmojiPicker();
  composer.append(emojiPickerEl);
  setTimeout(() => document.addEventListener("click", onEmojiPickerOutside, true), 0);
}
function refreshEmojiPickerIfOpen() {
  if (!emojiPickerEl) return;
  const composer = dom.chatEmojiButton?.closest(".chat-composer");
  if (!composer) { closeEmojiPicker(); return; }
  const next = buildEmojiPicker();
  emojiPickerEl.replaceWith(next);
  emojiPickerEl = next;
}

function buildEmojiPicker() {
  const channel = activeChatChannel();
  const list = channel?.emojis || [];
  const canAdd = canAddEmoji(channel);
  const canRemove = canRemoveEmoji(channel);
  const canUse = canUseEmojiCh(channel);
  const panel = document.createElement("div");
  panel.className = "emoji-picker";
  panel.id = "emojiPicker";

  const head = document.createElement("div");
  head.className = "emoji-picker-head";
  head.append(el("span", "", "이모지"));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "emoji-picker-close";
  close.textContent = "✕";
  close.addEventListener("click", closeEmojiPicker);
  head.append(close);
  panel.append(head);

  const body = document.createElement("div");
  body.className = "emoji-picker-body";

  body.append(el("p", "emoji-section-title", "커스텀 이모지"));
  if (list.length) {
    const grid = document.createElement("div");
    grid.className = "emoji-grid";
    for (const e of list) {
      const cell = document.createElement("div");
      cell.className = "emoji-cell";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emoji-btn";
      b.title = `:${e.name}:`;
      const im = document.createElement("img");
      im.src = e.url;
      im.alt = `:${e.name}:`;
      im.className = "emoji-btn-img";
      im.loading = "lazy";
      b.append(im);
      if (canUse) b.addEventListener("click", () => insertAtChatCursor(`:${e.name}: `));
      else { b.disabled = true; b.title = "커스텀 이모지 사용 권한이 없어요"; }
      cell.append(b);
      if (canRemove) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "emoji-del";
        del.textContent = "×";
        del.title = "삭제";
        del.addEventListener("click", (ev) => { ev.stopPropagation(); deleteEmoji(channel.id, e); });
        cell.append(del);
      }
      grid.append(cell);
    }
    body.append(grid);
    if (!canUse) body.append(el("p", "emoji-empty", "이 채널은 커스텀 이모지 사용이 역할로 제한돼 있어요."));
  } else {
    body.append(el("p", "emoji-empty", canAdd ? "아직 없어요. 아래 버튼으로 추가하세요." : "아직 커스텀 이모지가 없습니다."));
  }

  body.append(el("p", "emoji-section-title", "기본 이모지"));
  const ugrid = document.createElement("div");
  ugrid.className = "emoji-grid unicode";
  for (const ch of UNICODE_EMOJIS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-btn uni";
    b.textContent = ch;
    b.addEventListener("click", () => insertAtChatCursor(ch));
    ugrid.append(b);
  }
  body.append(ugrid);
  panel.append(body);

  if (canAdd) {
    const foot = document.createElement("div");
    foot.className = "emoji-picker-foot";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary small";
    add.textContent = "＋ 커스텀 이모지 추가";
    add.addEventListener("click", startAddEmoji);
    foot.append(add);
    panel.append(foot);
  }
  return panel;
}

// 입력창 커서 위치에 텍스트 삽입.
function insertAtChatCursor(text) {
  const elx = dom.chatInput;
  if (!elx) return;
  if (elx.disabled) return;
  const start = elx.selectionStart ?? elx.value.length;
  const end = elx.selectionEnd ?? elx.value.length;
  elx.value = elx.value.slice(0, start) + text + elx.value.slice(end);
  const caret = start + text.length;
  elx.selectionStart = elx.selectionEnd = caret;
  elx.focus();
  autoResizeChatInput();
  updateChatInputPreview();
}

// 커스텀 이모지 추가: 이미지 선택 → 정사각 크롭(자동 128px 축소) → 이름 지정 → 업로드.
function startAddEmoji() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) beginEmojiCrop(file);
  });
  input.click();
}
function beginEmojiCrop(file) {
  const src = URL.createObjectURL(file);
  openImageViewer({
    src,
    title: "이모지 자르기 (정사각형)",
    crop: true,
    aspect: 1,
    maxOut: 128, // 큰 이미지는 자동으로 128px 이하로 축소
    applyLabel: "다음",
    outputType: "image/png",
    onApply: (blob) => { URL.revokeObjectURL(src); promptEmojiNameAndUpload(blob, file.name); },
  });
}
function promptEmojiNameAndUpload(blob, originalName) {
  const suggested = (originalName || "emoji").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
  // window.prompt 는 일렉트론에서 지원되지 않아(null 반환) 크롭 후 멈춰버린다 → 인앱 모달로 이름을 받는다.
  openEmojiNameModal(suggested, (name) => uploadEmojiBlob(blob, name));
}

const sanitizeEmojiName = (raw) =>
  String(raw || "").trim().replace(/^:+|:+$/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);

let emojiNameModalEl = null;
function closeEmojiNameModal() {
  if (emojiNameModalEl) { emojiNameModalEl.remove(); emojiNameModalEl = null; }
  document.removeEventListener("keydown", onEmojiNameModalKey, true);
}
function onEmojiNameModalKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeEmojiNameModal(); } }
function openEmojiNameModal(suggested, onConfirm) {
  closeEmojiNameModal();
  const backdrop = document.createElement("div");
  backdrop.className = "img-viewer-backdrop emoji-name-backdrop";
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeEmojiNameModal(); });
  const panel = document.createElement("div");
  panel.className = "emoji-name-modal";
  panel.innerHTML = `
    <h3>이모지 이름</h3>
    <p class="modal-hint">영문·숫자·밑줄 2~32자. 채팅에서 <b>:이름:</b> 으로 넣어요.</p>
    <div class="emoji-name-row"><span>:</span><input type="text" class="emoji-name-input" maxlength="32" placeholder="이름" /><span>:</span></div>
    <p class="emoji-name-err" hidden></p>
    <div class="emoji-name-actions">
      <button type="button" class="ghost small" data-act="cancel">취소</button>
      <button type="button" class="primary small" data-act="ok">추가</button>
    </div>`;
  backdrop.append(panel);
  const input = panel.querySelector(".emoji-name-input");
  const err = panel.querySelector(".emoji-name-err");
  input.value = suggested || "";
  input.addEventListener("input", () => { input.value = sanitizeEmojiName(input.value); if (err.hidden === false) err.hidden = true; });
  const submit = () => {
    const name = sanitizeEmojiName(input.value);
    if (name.length < 2) { err.textContent = "이름은 영문·숫자·밑줄 2자 이상이어야 해요."; err.hidden = false; input.focus(); return; }
    closeEmojiNameModal();
    onConfirm(name);
  };
  panel.querySelector('[data-act="ok"]').addEventListener("click", submit);
  panel.querySelector('[data-act="cancel"]').addEventListener("click", closeEmojiNameModal);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  document.body.append(backdrop);
  emojiNameModalEl = backdrop;
  document.addEventListener("keydown", onEmojiNameModalKey, true);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
async function uploadEmojiBlob(blob, name) {
  const channel = activeChatChannel();
  if (!channel) return;
  const file = new File([blob], `${name}.png`, { type: "image/png" });
  setChatHint("이모지 업로드 중…");
  try {
    const result = await uploadChatFile(file);
    sendSocket({ type: "channel:add-emoji", channelId: channel.id, name, url: result.url });
    setChatHint("");
  } catch (error) {
    setChatHint(error.message || "이모지 업로드에 실패했습니다.");
  }
}
function deleteEmoji(channelId, emoji) {
  if (!window.confirm(`이모지 :${emoji.name}: 를 삭제할까요?`)) return;
  sendSocket({ type: "channel:remove-emoji", channelId, emojiId: emoji.id });
}

function bindChatEvents() {
  dom.chatSendButton?.addEventListener("click", sendChatMessage);
  dom.chatEmojiButton?.addEventListener("click", (e) => { e.stopPropagation(); toggleEmojiPicker(); });
  dom.chatMessages?.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-profile-user]");
    if (!target) return;
    const msgEl = target.closest(".chat-group");
    const name = msgEl?.querySelector(".chat-msg-name")?.textContent || "";
    openProfileCard(target.dataset.profileUser, target, { id: target.dataset.profileUser, displayName: name, code: "----" });
  });
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
  // Shift를 누르면 메시지 hover 시 즉시삭제(🗑) 아이콘이 뜨도록 body 클래스 토글(디스코드식)
  document.addEventListener("keydown", (e) => { if (e.key === "Shift") document.body.classList.add("chat-shift"); });
  document.addEventListener("keyup", (e) => { if (e.key === "Shift") document.body.classList.remove("chat-shift"); });
  window.addEventListener("blur", () => document.body.classList.remove("chat-shift"));
  bindChatDragDrop();
}

function bindDmEvents() {
  dom.dmNewButton?.addEventListener("click", () => {
    if (!dom.dmNewRow) return;
    dom.dmNewRow.hidden = !dom.dmNewRow.hidden;
    setDmFindMsg("");
    if (!dom.dmNewRow.hidden) dom.dmCodeInput?.focus();
  });
  dom.dmFindButton?.addEventListener("click", dmFindByCode);
  dom.dmCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); dmFindByCode(); }
  });
  dom.dmThreadList?.addEventListener("click", (event) => {
    const item = event.target?.closest?.("[data-dm-user]");
    if (item) openDmConversation(item.dataset.dmUser);
  });
  dom.dmMessages?.addEventListener("click", (event) => {
    const del = event.target?.closest?.("[data-dm-delete]");
    if (del) {
      if (!confirm("이 메시지를 삭제할까요?")) return;
      sendSocket({ type: "dm:delete", userId: state.dm.activeUserId, msgId: del.dataset.dmDelete });
      return;
    }
    const profile = event.target?.closest?.("[data-profile-user]");
    if (profile) openProfileCard(profile.dataset.profileUser, profile);
  });
  // DM 대화 헤더(아바타 · 이름)를 누르면 상대 프로필 카드가 뜬다.
  dom.dmConvHead?.addEventListener("click", () => {
    const partner = state.dm.partner;
    if (partner?.id) openProfileCard(partner.id, dom.dmConvHead, partner);
  });
  dom.dmSendButton?.addEventListener("click", sendDmText);
  dom.dmInput?.addEventListener("input", autoResizeDmInput);
  dom.dmInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendDmText();
    }
  });
}

function dmFindByCode() {
  const raw = (dom.dmCodeInput?.value || "").trim().replace(/^#/, "");
  if (!raw) { setDmFindMsg("코드를 입력하세요."); return; }
  setDmFindMsg("찾는 중…");
  sendSocket({ type: "dm:find", code: raw });
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

// ===== 공동 메모장 (OT 실시간 협업 + 커서 공유) =====
const MEMO_CURSOR_COLORS = ["#f0b232", "#23a559", "#eb459e", "#00a8fc", "#f23f43", "#e67e22", "#1abc9c", "#a855f7"];
const MEMO_CURSOR_THROTTLE = 120;
const MEMO_FONT_MIN = 10;
const MEMO_FONT_MAX = 32;
const MEMO_FONT_DEFAULT = 13;
let memoFontSize = clampMemoFont(Number(localStorage.getItem("accordMemoFontSize")) || MEMO_FONT_DEFAULT);

// 메모방 글꼴(글자 크기와 달리 모든 참가자에게 공유되는 문서 속성).
// key만 서버로 주고받고, 실제 폰트 스택은 각 클라이언트가 매핑한다(안전 + 플랫폼별 대체).
const MEMO_FONTS = {
  default: { label: "기본", stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
  sans: { label: "고딕", stack: '"Pretendard", "Apple SD Gothic Neo", "맑은 고딕", "Malgun Gothic", sans-serif' },
  serif: { label: "명조", stack: '"Nanum Myeongjo", "Apple Myungjo", "바탕", Batang, serif' },
  round: { label: "둥근고딕", stack: '"Nanum Gothic", "Apple SD Gothic Neo", "맑은 고딕", sans-serif' },
  hand: { label: "손글씨", stack: '"Nanum Pen Script", "Gaegu", "Apple SD Gothic Neo", cursive' },
};
const MEMO_FONT_DEFAULT_KEY = "default";
function memoFontStack(key) {
  // 업로드 글꼴(custom:<id>) 은 등록된 FontFace 패밀리 + 기본 대체 스택을 쓴다.
  if (typeof key === "string" && key.startsWith("custom:")) {
    return `"af-${key.slice(7)}", ${MEMO_FONTS[MEMO_FONT_DEFAULT_KEY].stack}`;
  }
  return (MEMO_FONTS[key] || MEMO_FONTS[MEMO_FONT_DEFAULT_KEY]).stack;
}

// 현재 메모방이 속한 채널의 업로드 글꼴 목록.
function memoChannelFonts() {
  const chId = state.memo?.channelId;
  const ch = state.channels.find((c) => c.id === chId);
  return Array.isArray(ch?.fonts) ? ch.fonts : [];
}
function memoFontExists(key) {
  if (MEMO_FONTS[key]) return true;
  if (typeof key === "string" && key.startsWith("custom:")) {
    return memoChannelFonts().some((f) => `custom:${f.id}` === key);
  }
  return false;
}

// 업로드 글꼴을 브라우저에 등록(FontFace). 이미 등록한 것은 건너뛴다.
const registeredFontIds = new Set();
function registerCustomFonts(channel) {
  if (!channel || !Array.isArray(channel.fonts) || typeof FontFace === "undefined" || !document.fonts) return;
  for (const font of channel.fonts) {
    if (!font?.id || registeredFontIds.has(font.id)) continue;
    registeredFontIds.add(font.id);
    try {
      const face = new FontFace(`af-${font.id}`, `url("${serverUrl}${font.url}")`);
      face.load().then((loaded) => {
        document.fonts.add(loaded);
        // 지금 이 글꼴을 쓰는 메모가 열려 있으면 로드 완료 후 다시 렌더.
        if (state.memo && state.memo.font === `custom:${font.id}`) applyMemoFont(state.memo.font);
      }).catch(() => {});
    } catch { /* 잘못된 폰트 URL 무시 */ }
  }
}
function registerAllCustomFonts() {
  for (const ch of state.channels || []) registerCustomFonts(ch);
}

// 글꼴 <select> 옵션을 채운다(내장 글꼴 + 현재 채널 업로드 글꼴). 채널 글꼴이 바뀌면 다시 호출된다.
function populateMemoFonts() {
  const sel = dom.memoFontSelect;
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = "";
  for (const [key, f] of Object.entries(MEMO_FONTS)) {
    sel.append(new Option(f.label, key));
  }
  const fonts = memoChannelFonts();
  if (fonts.length) {
    const grp = document.createElement("optgroup");
    grp.label = "업로드 글꼴";
    for (const font of fonts) grp.append(new Option(font.name, `custom:${font.id}`));
    sel.append(grp);
  }
  if (keep && memoFontExists(keep)) sel.value = keep;
}

function clampMemoFont(px) {
  return Math.min(MEMO_FONT_MAX, Math.max(MEMO_FONT_MIN, Math.round(px)));
}

// 편집기·거터·미리보기의 글꼴을 바꾼다(공유 속성이므로 로컬 저장은 하지 않음).
function applyMemoFont(key) {
  const stack = memoFontStack(key);
  if (dom.memoEditor) dom.memoEditor.style.fontFamily = stack;
  if (dom.memoGutter) dom.memoGutter.style.fontFamily = stack;
  if (dom.memoPreview) dom.memoPreview.style.fontFamily = stack;
  if (dom.memoFontSelect && dom.memoFontSelect.value !== key) {
    dom.memoFontSelect.value = memoFontExists(key) ? key : MEMO_FONT_DEFAULT_KEY;
  }
  renderMemoCursors(); // 글꼴에 따라 줄바꿈·캐럿 좌표가 달라지므로 다시 그린다
}

// 편집기에서 선택한 텍스트(없으면 자리표시자)를 색 마크업 {색:#hex}…{/색} 으로 감싼다.
// 마크업은 문서 텍스트에 그대로 들어가 OT 로 동기화되고, 미리보기에서 색으로 렌더된다.
function applyMemoColor(color) {
  const m = state.memo;
  const el = dom.memoEditor;
  if (!m || !m.writable || !el) return;
  const hex = /^#[0-9a-fA-F]{3,8}$/.test(String(color || "")) ? color : "#f0b232";
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = el.value.slice(start, end) || "색 글자";
  const open = `{색:${hex}}`;
  const close = "{/색}";
  el.value = el.value.slice(0, start) + open + selected + close + el.value.slice(end);
  el.selectionStart = start + open.length;
  el.selectionEnd = start + open.length + selected.length; // 감싼 내용을 선택 상태로 둔다
  el.focus();
  onMemoInput();
}

// 편집기·미리보기 글자 크기를 함께 조절한다(Ctrl/Cmd+휠).
function applyMemoFontSize(px) {
  memoFontSize = clampMemoFont(px);
  localStorage.setItem("accordMemoFontSize", String(memoFontSize));
  if (dom.memoEditor) dom.memoEditor.style.fontSize = `${memoFontSize}px`;
  if (dom.memoPreview) dom.memoPreview.style.fontSize = `${memoFontSize}px`;
  if (dom.memoGutter) dom.memoGutter.style.fontSize = `${memoFontSize}px`;
  renderMemoCursors(); // 캐럿 좌표·줄번호가 글자 크기에 의존하므로 다시 그린다
}

function openMemoRoom(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found) return;
  if (state.memo?.roomId === roomId) {
    document.body.classList.add("memo-open");
    dom.memoEditor?.focus();
    return;
  }
  state.memo = {
    roomId,
    channelId: found.channel.id,
    name: found.room.name,
    view: state.memo?.view || "split",
    doc: "",
    font: MEMO_FONT_DEFAULT_KEY, // 공유 글꼴(memo:state 로 갱신됨)
    serverRev: 0,
    inflight: null, // 서버에 보내고 ack 대기 중인 op
    buffer: [], // inflight 이후 로컬 편집 op들
    cursors: new Map(), // clientId -> { userId, name, pos, sel, color }
    cursorSentAt: 0,
    lastCursor: "",
    writable: canWriteRoom(found.channel, found.room),
  };
  document.body.classList.add("memo-open");
  if (dom.memoRoomName) dom.memoRoomName.textContent = found.room.name;
  if (dom.memoEditor) { dom.memoEditor.value = ""; dom.memoEditor.disabled = true; }
  if (dom.memoPreview) dom.memoPreview.innerHTML = "";
  applyMemoFontSize(memoFontSize); // 저장된 글자 크기 반영
  populateMemoFonts();
  applyMemoFont(state.memo.font);
  updateMemoFontManageButton();
  updateMemoToolsEnabled();
  clearMemoCursors();
  applyMemoView(state.memo.view);
  setMemoStatus("불러오는 중…", "muted");
  sendSocket({ type: "memo:open", roomId });
  renderRooms();
}

function closeMemoView() {
  if (!state.memo) return;
  sendSocket({ type: "memo:close" });
  state.memo = null;
  clearMemoCursors();
  closeFontManager();
  document.body.classList.remove("memo-open");
  exitFocusMode();
  renderRooms();
}

// 채널 목록 갱신 후, 보고 있던 메모방이 사라졌거나 이름이 바뀌었는지 확인.
function verifyActiveMemo() {
  if (!state.memo) return;
  const found = findRoomInChannels(state.memo.roomId);
  if (!found || found.room.type !== "memo") { closeMemoView(); return; }
  state.memo.name = found.room.name;
  state.memo.channelId = found.channel.id;
  state.memo.writable = canWriteRoom(found.channel, found.room);
  if (dom.memoRoomName) dom.memoRoomName.textContent = found.room.name;
  if (dom.memoEditor) dom.memoEditor.disabled = !state.memo.writable;
}

function handleMemoState(message) {
  const m = state.memo;
  if (!m || m.roomId !== message.roomId) return;
  m.doc = message.text || "";
  m.serverRev = message.rev || 0;
  m.inflight = null;
  m.buffer = [];
  m.font = MEMO_FONTS[message.font] ? message.font : MEMO_FONT_DEFAULT_KEY;
  if (dom.memoEditor) { dom.memoEditor.disabled = !m.writable; dom.memoEditor.value = m.doc; }
  applyMemoFont(m.font);
  updateMemoToolsEnabled();
  renderMemoPreview();
  m.cursors.clear();
  for (const cur of message.cursors || []) setMemoCursor(cur);
  renderMemoCursors();
  if (!m.writable) setMemoStatus("읽기 전용 — 대표자만 편집", "muted");
  else setMemoStatus(m.doc ? "실시간 편집 중" : "빈 메모 — 함께 편집됩니다", "muted");
}

// 다른 참가자가 글꼴을 바꾸면 반영한다.
function handleMemoFont(message) {
  const m = state.memo;
  if (!m || m.roomId !== message.roomId) return;
  m.font = MEMO_FONTS[message.font] ? message.font : MEMO_FONT_DEFAULT_KEY;
  applyMemoFont(m.font);
}

// 글꼴/색 도구는 편집 권한이 있을 때만 활성화(읽기 전용이면 잠금).
function updateMemoToolsEnabled() {
  const on = Boolean(state.memo?.writable);
  if (dom.memoFontSelect) dom.memoFontSelect.disabled = !on;
  document.querySelectorAll("#memoPanel [data-memo-color], #memoColorPick").forEach((el) => { el.disabled = !on; });
  const tools = document.querySelector(".memo-tools");
  if (tools) tools.classList.toggle("disabled", !on);
}

// ===== 메모장 공유 글꼴 관리 =====
// 채널 데이터가 갱신될 때마다 글꼴 선택/관리버튼/열려있는 관리창을 최신 채널 글꼴로 맞춘다.
function syncMemoFontUi() {
  if (!state.memo) return;
  populateMemoFonts();
  applyMemoFont(state.memo.font);
  updateMemoFontManageButton();
  if (fontManagerEl) renderFontManagerList();
}
function memoChannel() {
  return state.channels.find((c) => c.id === state.memo?.channelId) || null;
}
function updateMemoFontManageButton() {
  const btn = dom.memoFontManageButton;
  if (!btn) return;
  const ch = memoChannel();
  btn.hidden = !(ch && canManageFont(ch));
}

let fontManagerEl = null;
function closeFontManager() {
  if (fontManagerEl) { fontManagerEl.remove(); fontManagerEl = null; }
  document.removeEventListener("keydown", onFontManagerKey, true);
}
function onFontManagerKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeFontManager(); } }
function openFontManager() {
  const ch = memoChannel();
  if (!ch || !canManageFont(ch)) return;
  closeFontManager();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop font-manager-backdrop";
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeFontManager(); });
  const panel = document.createElement("div");
  panel.className = "modal font-manager";
  panel.innerHTML = `
    <header class="modal-head">
      <h2>공유 글꼴 관리</h2>
      <button class="ghost small" data-font-close="1" type="button">닫기</button>
    </header>
    <div class="modal-body">
      <p class="modal-hint">올린 글꼴은 이 채널의 모든 메모장에서 함께 쓸 수 있어요. (ttf·otf·woff·woff2)</p>
      <div class="font-list" data-font-list></div>
      <div class="font-manager-foot">
        <button class="primary small" data-font-upload="1" type="button">＋ 글꼴 올리기</button>
      </div>
      <p class="font-manager-msg" data-font-msg aria-live="polite"></p>
    </div>`;
  backdrop.append(panel);
  document.body.append(backdrop);
  fontManagerEl = backdrop;
  panel.querySelector("[data-font-close]").addEventListener("click", closeFontManager);
  panel.querySelector("[data-font-upload]").addEventListener("click", startFontUpload);
  panel.querySelector("[data-font-list]").addEventListener("click", (e) => {
    const del = e.target?.closest?.("[data-font-del]");
    if (del) deleteFont(del.dataset.fontDel);
  });
  document.addEventListener("keydown", onFontManagerKey, true);
  renderFontManagerList();
}
function setFontManagerMsg(text, ok = false) {
  const el = fontManagerEl?.querySelector("[data-font-msg]");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("ok", Boolean(ok));
}
function renderFontManagerList() {
  const list = fontManagerEl?.querySelector("[data-font-list]");
  if (!list) return;
  const ch = memoChannel();
  const fonts = Array.isArray(ch?.fonts) ? ch.fonts : [];
  list.innerHTML = "";
  if (!fonts.length) {
    list.append(el("p", "font-empty", "아직 올린 글꼴이 없어요."));
    return;
  }
  for (const font of fonts) {
    const row = document.createElement("div");
    row.className = "font-row";
    const name = document.createElement("span");
    name.className = "font-row-name";
    name.textContent = font.name;
    name.style.fontFamily = `"af-${font.id}", ${MEMO_FONTS.default.stack}`;
    const sample = document.createElement("span");
    sample.className = "font-row-sample";
    sample.textContent = "가나다 AaBb 123";
    sample.style.fontFamily = `"af-${font.id}", ${MEMO_FONTS.default.stack}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "font-row-del";
    del.textContent = "삭제";
    del.dataset.fontDel = font.id;
    row.append(name, sample, del);
    list.append(row);
  }
}
function startFontUpload() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ttf,.otf,.woff,.woff2,font/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) uploadFont(file);
  });
  input.click();
}
async function uploadFont(file) {
  const ch = memoChannel();
  if (!ch) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["ttf", "otf", "woff", "woff2"].includes(ext)) {
    setFontManagerMsg("ttf·otf·woff·woff2 파일만 올릴 수 있습니다.");
    return;
  }
  const name = file.name.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim().slice(0, 40) || "글꼴";
  setFontManagerMsg("글꼴 올리는 중…", true);
  try {
    const result = await uploadChatFile(file);
    sendSocket({ type: "channel:add-font", channelId: ch.id, name, url: result.url });
    setFontManagerMsg("올렸습니다. 목록에 곧 표시됩니다.", true);
  } catch (error) {
    setFontManagerMsg(error.message || "글꼴 업로드에 실패했습니다.");
  }
}
function deleteFont(fontId) {
  const ch = memoChannel();
  if (!ch) return;
  if (!window.confirm("이 글꼴을 삭제할까요? 이 글꼴을 쓰던 메모는 기본 글꼴로 바뀝니다.")) return;
  sendSocket({ type: "channel:remove-font", channelId: ch.id, fontId });
}

// 로컬 편집 → 변경분(op)을 만들어 서버로 보낸다.
function onMemoInput() {
  const m = state.memo;
  if (!m || !dom.memoEditor) return;
  const newDoc = dom.memoEditor.value;
  const op = window.OTText.fromDiff(m.doc, newDoc);
  if (op.length) {
    m.doc = newDoc;
    // 내 편집으로 문서가 밀린 만큼 원격 커서도 함께 이동시켜 제자리에 고정한다.
    // (안 하면 내가 앞에 글자를 넣어도 상대 커서가 옛 위치에 묶여 뒤로 밀려 보임)
    for (const cur of m.cursors.values()) {
      cur.pos = window.OTText.transformCursor(cur.pos, op, "left");
      cur.sel = window.OTText.transformCursor(cur.sel, op, "left");
    }
    if (m.inflight === null) {
      m.inflight = op;
      sendSocket({ type: "memo:op", roomId: m.roomId, rev: m.serverRev, ops: op });
    } else {
      m.buffer.push(op);
    }
  }
  renderMemoPreview();
  renderMemoCursors();
  sendMemoCursor();
}

function handleMemoOp(message) {
  const m = state.memo;
  if (!m || m.roomId !== message.roomId) return;
  const OT = window.OTText;
  m.serverRev = message.rev;
  if (message.by === state.clientId) {
    // 내 op의 ack → 버퍼에 쌓인 다음 op를 보낸다.
    if (m.buffer.length) {
      m.inflight = m.buffer.shift();
      sendSocket({ type: "memo:op", roomId: m.roomId, rev: m.serverRev, ops: m.inflight });
    } else {
      m.inflight = null;
    }
    return;
  }
  // 원격 op → 내 미확정 op들을 지나 문서에 적용.
  let r = message.ops;
  if (m.inflight) {
    const ni = OT.transform(m.inflight, r, "right");
    r = OT.transform(r, m.inflight, "left");
    m.inflight = ni;
  }
  const nb = [];
  for (const b of m.buffer) {
    const b2 = OT.transform(b, r, "right");
    r = OT.transform(r, b, "left");
    nb.push(b2);
  }
  m.buffer = nb;

  const el = dom.memoEditor;
  const hadFocus = document.activeElement === el;
  const selStart = el ? el.selectionStart : 0;
  const selEnd = el ? el.selectionEnd : 0;
  const scrollTop = el ? el.scrollTop : 0;
  m.doc = OT.apply(m.doc, r);
  if (el) {
    el.value = m.doc;
    if (hadFocus) el.setSelectionRange(OT.transformCursor(selStart, r, "right"), OT.transformCursor(selEnd, r, "right"));
    el.scrollTop = scrollTop;
  }
  // 원격 커서들도 이번 op만큼 이동.
  // 작성자 본인 커서는 삽입 위치에서 함께 앞으로 밀려야 하므로 side "right"
  // (side "left"면 삽입 텍스트만 앞으로 나가고 커서가 제자리에 묶여 뒤로 밀리는 것처럼 보임).
  for (const cur of m.cursors.values()) {
    const side = cur.clientId === message.by ? "right" : "left";
    cur.pos = OT.transformCursor(cur.pos, r, side);
    cur.sel = OT.transformCursor(cur.sel, r, side);
  }
  renderMemoPreview();
  renderMemoCursors();
}

function handleMemoCursor(message) {
  const m = state.memo;
  if (!m || m.roomId !== message.roomId) return;
  setMemoCursor(message);
  renderMemoCursors();
}

function handleMemoCursorLeave(message) {
  const m = state.memo;
  if (!m || m.roomId !== message.roomId) return;
  m.cursors.delete(message.clientId);
  renderMemoCursors();
}

// 상대가 보내온 커서 위치는 상대 문서 기준이라, 아직 상대가 못 받은 내 미확정 op(inflight+buffer)만큼
// 앞으로 당겨 내 로컬 문서 좌표계로 옮긴다. 안 하면 내가 편집 중일 때 상대 커서가 옛 위치로 튄다.
function memoLocalizeCursorPos(pos) {
  const m = state.memo;
  const OT = window.OTText;
  let p = pos | 0;
  if (m.inflight) p = OT.transformCursor(p, m.inflight, "left");
  for (const b of m.buffer) p = OT.transformCursor(p, b, "left");
  return p;
}

function setMemoCursor(cur) {
  const m = state.memo;
  if (!m || !cur.clientId) return;
  const existing = m.cursors.get(cur.clientId);
  const color = existing?.color || MEMO_CURSOR_COLORS[m.cursors.size % MEMO_CURSOR_COLORS.length];
  m.cursors.set(cur.clientId, {
    clientId: cur.clientId,
    userId: cur.userId,
    name: cur.name || "익명",
    pos: memoLocalizeCursorPos(cur.pos),
    sel: memoLocalizeCursorPos(cur.sel ?? cur.pos),
    color,
  });
}

function clearMemoCursors() {
  if (state.memo) state.memo.cursors.clear();
  if (dom.memoCursors) dom.memoCursors.innerHTML = "";
}

function sendMemoCursor() {
  const m = state.memo;
  const el = dom.memoEditor;
  if (!m || !el) return;
  const now = Date.now();
  const key = `${el.selectionStart}:${el.selectionEnd}`;
  if (key === m.lastCursor) return;
  if (now - m.cursorSentAt < MEMO_CURSOR_THROTTLE) return;
  m.cursorSentAt = now;
  m.lastCursor = key;
  sendSocket({ type: "memo:cursor", roomId: m.roomId, pos: el.selectionStart, sel: el.selectionEnd });
}

function renderMemoCursors() {
  const m = state.memo;
  const layer = dom.memoCursors;
  const el = dom.memoEditor;
  if (!m || !layer || !el) return;
  renderMemoGutter(); // 줄번호도 같은 좌표계로 함께 갱신
  layer.innerHTML = "";
  if (m.view === "preview") return; // 편집기가 숨겨져 있으면 커서 표시 안함
  for (const cur of m.cursors.values()) {
    const pos = Math.max(0, Math.min(cur.pos, m.doc.length));
    const coords = getCaretCoordinates(el, pos);
    const bar = document.createElement("div");
    bar.className = "memo-remote-cursor";
    bar.style.left = `${coords.left - el.scrollLeft}px`;
    bar.style.top = `${coords.top - el.scrollTop}px`;
    bar.style.height = `${coords.height}px`;
    bar.style.background = cur.color;
    const label = document.createElement("span");
    label.className = "memo-cursor-label";
    label.textContent = cur.name;
    label.style.background = cur.color;
    bar.append(label);
    layer.append(bar);
  }
}

// textarea 내 특정 위치의 캐럿 픽셀 좌표 계산(미러 div 기법).
const MIRROR_PROPS = [
  "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
  "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent",
  "letterSpacing", "wordSpacing", "tabSize", "whiteSpace", "wordWrap",
];
let memoMirror = null;
function getCaretCoordinates(el, position) {
  if (!memoMirror) {
    memoMirror = document.createElement("div");
    memoMirror.setAttribute("aria-hidden", "true");
    document.body.appendChild(memoMirror);
  }
  const div = memoMirror;
  const computed = getComputedStyle(el);
  const s = div.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.top = "0";
  s.left = "-9999px";
  s.overflow = "hidden";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  for (const prop of MIRROR_PROPS) s[prop] = computed[prop];
  // 스크롤바가 있으면 실제 텍스트박스가 좁아지므로 clientWidth 기준 콘텐츠 폭으로 줄바꿈을 맞춘다.
  const padL0 = parseFloat(computed.paddingLeft) || 0;
  const padR0 = parseFloat(computed.paddingRight) || 0;
  s.boxSizing = "content-box";
  s.width = `${Math.max(0, el.clientWidth - padL0 - padR0)}px`;
  div.textContent = el.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = el.value.substring(position) || ".";
  div.appendChild(span);
  const coords = {
    top: span.offsetTop + parseInt(computed.borderTopWidth || "0", 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10),
    height: parseInt(computed.lineHeight || "18", 10) || 18,
  };
  div.textContent = "";
  return coords;
}

// 각 논리적 줄(\n 기준)이 시작되는 세로 픽셀 위치를 한 번의 레이아웃으로 계산한다.
// textarea의 실제 콘텐츠 너비로 미러를 맞춰 soft-wrap(줄 감김)까지 동일하게 재현 → 줄번호가 감긴 줄만큼 아래로 밀려 정렬된다.
let memoLineMirror = null;
function getMemoLineTops(el) {
  if (!memoLineMirror) {
    memoLineMirror = document.createElement("div");
    memoLineMirror.setAttribute("aria-hidden", "true");
    document.body.appendChild(memoLineMirror);
  }
  const div = memoLineMirror;
  const computed = getComputedStyle(el);
  const s = div.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.top = "0";
  s.left = "-9999px";
  s.overflow = "hidden";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  for (const prop of MIRROR_PROPS) s[prop] = computed[prop];
  // 스크롤바 유무와 무관하게 실제 텍스트박스 너비로 줄바꿈을 맞춘다.
  const padL = parseFloat(computed.paddingLeft) || 0;
  const padR = parseFloat(computed.paddingRight) || 0;
  s.boxSizing = "content-box";
  s.width = `${Math.max(0, el.clientWidth - padL - padR)}px`;
  div.textContent = "";
  const lines = el.value.split("\n");
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    // 폭 0의 inline-block(vertical-align:top) 마커를 줄 맨 앞에 두면 offsetTop이 그 줄 라인박스의 '위쪽'을 가리킨다.
    // (텍스트 span의 offsetTop은 half-leading만큼 아래라 줄번호가 살짝 내려가므로 이 방식을 쓴다.)
    // 실제 줄바꿈은 마커 뒤의 텍스트 노드가 담당하므로 감긴 줄도 첫 행 위치가 잡힌다.
    const marker = document.createElement("span");
    marker.style.display = "inline-block";
    marker.style.width = "0";
    marker.style.verticalAlign = "top";
    marker.textContent = "​"; // zero-width space — 빈 줄에서도 라인박스가 생기게
    div.appendChild(marker);
    markers.push(marker);
    if (lines[i]) div.appendChild(document.createTextNode(lines[i]));
    if (i < lines.length - 1) div.appendChild(document.createTextNode("\n"));
  }
  const borderTop = parseInt(computed.borderTopWidth || "0", 10) || 0;
  const tops = markers.map((mk) => mk.offsetTop + borderTop);
  div.textContent = "";
  return tops;
}

// 줄번호 거터를 그린다. 자릿수에 맞춰 폭·편집기 좌패딩을 조정하고, 편집기 세로 스크롤과 동기화한다.
function renderMemoGutter() {
  const m = state.memo;
  const gutter = dom.memoGutter;
  const el = dom.memoEditor;
  if (!m || !gutter || !el) return;
  if (m.view === "preview") { gutter.innerHTML = ""; return; }
  const lineCount = el.value ? el.value.split("\n").length : 1;
  const digits = String(lineCount).length;
  const gutterW = Math.ceil(digits * memoFontSize * 0.62) + 18;
  if (gutter._memoWidth !== gutterW) {
    gutter.style.width = `${gutterW}px`;
    el.style.paddingLeft = `${gutterW + 6}px`; // 텍스트가 거터를 침범하지 않도록
    gutter._memoWidth = gutterW;
  }
  const tops = getMemoLineTops(el);
  const scrollTop = el.scrollTop;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < tops.length; i++) {
    const y = tops[i] - scrollTop;
    if (y < -memoFontSize * 2 || y > el.clientHeight + memoFontSize) continue; // 화면 밖 줄은 생략
    const n = document.createElement("span");
    n.className = "memo-line-no";
    n.textContent = String(i + 1);
    n.style.top = `${y}px`;
    frag.appendChild(n);
  }
  gutter.innerHTML = "";
  gutter.appendChild(frag);
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
  renderMemoCursors();
}

function bindMemoEvents() {
  dom.memoEditor?.addEventListener("input", onMemoInput);
  dom.memoViewSplit?.addEventListener("click", () => applyMemoView("split"));
  dom.memoViewEdit?.addEventListener("click", () => applyMemoView("edit"));
  dom.memoViewPreview?.addEventListener("click", () => applyMemoView("preview"));
  // 글꼴 드롭다운 변경 시 모두에게 공유. (옵션 채우기는 openMemoRoom 에서 지연 — MEMO_FONTS TDZ 회피)
  dom.memoFontSelect?.addEventListener("change", () => {
    const m = state.memo;
    if (!m || !m.writable) return;
    const key = memoFontExists(dom.memoFontSelect.value) ? dom.memoFontSelect.value : MEMO_FONT_DEFAULT_KEY;
    m.font = key;
    applyMemoFont(key);
    sendSocket({ type: "memo:font", roomId: m.roomId, font: key });
  });
  dom.memoFontManageButton?.addEventListener("click", openFontManager);
  // 색 버튼: 선택한 텍스트를 {색:#hex}…{/색} 로 감싼다.
  dom.memoPanel?.querySelectorAll("[data-memo-color]").forEach((btn) => {
    btn.addEventListener("click", () => applyMemoColor(btn.dataset.memoColor));
  });
  dom.memoColorPick?.addEventListener("input", () => applyMemoColor(dom.memoColorPick.value));
  // 커서 이동/선택 변경을 다른 사람에게 알린다.
  const cursorEvents = ["keyup", "mouseup", "click", "select", "focus"];
  for (const ev of cursorEvents) dom.memoEditor?.addEventListener(ev, sendMemoCursor);
  dom.memoEditor?.addEventListener("scroll", renderMemoCursors);
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
  // Ctrl(⌘)+휠 로 글자 크기 조절 — 편집기/미리보기 어느 쪽 위에서든 동작.
  dom.memoBody?.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    applyMemoFontSize(memoFontSize + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  // 창/패널 크기가 바뀌면 줄바꿈 위치가 달라지므로 줄번호·커서를 다시 계산.
  window.addEventListener("resize", () => { if (state.memo) renderMemoCursors(); });
}

// ===== 공동 그림판 (draw) =====
// 방별 캔버스를 레이어 단위 offscreen 캔버스로 구성하고, 획(stroke)을 실시간 브로드캐스트한다.
// 서버는 append-only(획 추가) 모델이라 늦게 들어와도 전체 문서를 받아 리플레이하면 동일 화면이 된다.
const DRAW_MIN_POINT_DIST = 1.5; // 이 거리보다 덜 움직이면 점을 추가하지 않음(용량 절약)

function openDrawRoom(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found) return;
  if (state.draw?.roomId === roomId) {
    document.body.classList.add("draw-open");
    return;
  }
  state.draw = {
    roomId,
    channelId: found.channel.id,
    name: found.room.name,
    width: 900,
    height: 600,
    layers: [], // { id, name, visible, strokes:[], canvas, ctx }
    activeLayerId: "",
    tool: "pen",
    color: dom.drawColor?.value || "#1a1a1a",
    size: Number(dom.drawSize?.value) || 4,
    zoom: 1,
    strokeCounter: 0,
    drawing: null,
    myStrokes: [], // 내가 그린 획 스택(실행취소용) { layerId, strokeId }
    imageCache: new Map(),
    loaded: false,
    writable: canWriteRoom(found.channel, found.room),
    spaceDown: false, // 스페이스로 화면 이동(팬) 준비 상태
    panning: null, // { startX, startY, scrollLeft, scrollTop }
    transform: null, // 이동·크기 변형 세션
    cursors: new Map(), // clientId -> { name, x, y, tool, color, size, drawing, trail:[], ts }
    hoverPt: null, // 브러시 미리보기용 최근 캔버스 좌표
    cursorSeq: 0,
  };
  setDrawTool("pen");
  document.body.classList.add("draw-open");
  if (dom.drawRoomName) dom.drawRoomName.textContent = found.room.name;
  if (dom.drawResizePop) dom.drawResizePop.hidden = true;
  setDrawStatus("불러오는 중…");
  if (dom.drawLayerList) dom.drawLayerList.innerHTML = "";
  sendSocket({ type: "draw:open", roomId });
  renderRooms();
}

function closeDrawView() {
  if (!state.draw) return;
  sendSocket({ type: "draw:close" });
  state.draw = null;
  document.body.classList.remove("draw-open");
  dom.drawCanvasStage?.classList.remove("space", "panning");
  dom.drawCanvasScroll?.classList.remove("space", "panning");
  if (dom.drawResizePop) dom.drawResizePop.hidden = true;
  exitFocusMode();
  renderRooms();
}

// 채널 목록 갱신 후, 보고 있던 그림판이 사라졌거나 이름이 바뀌었는지 확인.
function verifyActiveDraw() {
  if (!state.draw) return;
  const found = findRoomInChannels(state.draw.roomId);
  if (!found || found.room.type !== "draw") { closeDrawView(); return; }
  state.draw.name = found.room.name;
  state.draw.channelId = found.channel.id;
  state.draw.writable = canWriteRoom(found.channel, found.room);
  if (dom.drawRoomName) dom.drawRoomName.textContent = found.room.name;
}

// ===== 전역 로그 =====
// 채널 단위 이벤트 타임라인(읽기 전용). 서버가 통화 입/퇴장·그림판 참여·메모 편집·채널 참여를 기록하고,
// 로그방을 보고 있으면 새 이벤트가 실시간으로 내려온다. 로그는 방이 아니라 채널에 종속된다.
const LOG_MAX_ENTRIES = 500;

function openLogRoom(roomId) {
  const found = findRoomInChannels(roomId);
  if (!found) return;
  if (state.activeLog?.roomId === roomId) {
    document.body.classList.add("log-open");
    return;
  }
  state.activeLog = {
    roomId,
    channelId: found.channel.id,
    name: found.room.name,
    entries: [],
    filter: { q: "", user: "", room: "", date: "" },
    collapsedDays: new Set(),
  };
  clearLogFilterInputs();
  document.body.classList.add("log-open");
  if (dom.logRoomName) dom.logRoomName.textContent = found.room.name;
  if (dom.logSubtitle) dom.logSubtitle.textContent = found.channel.name;
  if (dom.logList) dom.logList.innerHTML = '<li class="log-empty">불러오는 중…</li>';
  sendSocket({ type: "log:open", roomId });
  renderRooms();
}

function closeLogView() {
  if (!state.activeLog) return;
  sendSocket({ type: "log:close" });
  state.activeLog = null;
  document.body.classList.remove("log-open");
  renderRooms();
}

// 채널 목록 갱신 후, 보고 있던 로그방이 사라졌거나 이름이 바뀌었는지 확인.
function verifyActiveLog() {
  if (!state.activeLog) return;
  const found = findRoomInChannels(state.activeLog.roomId);
  if (!found || found.room.type !== "log") { closeLogView(); return; }
  state.activeLog.name = found.room.name;
  state.activeLog.channelId = found.channel.id;
  if (dom.logRoomName) dom.logRoomName.textContent = found.room.name;
  if (dom.logSubtitle) dom.logSubtitle.textContent = found.channel.name;
}

function handleLogHistory(message) {
  if (!state.activeLog || state.activeLog.roomId !== message.roomId) return;
  state.activeLog.entries = Array.isArray(message.entries) ? message.entries : [];
  updateLogFilterOptions();
  renderLogEntries();
  scrollLogToBottom();
}

function handleLogEntry(message) {
  if (!state.activeLog || state.activeLog.channelId !== message.channelId) return;
  const entry = message.entry;
  if (!entry || !entry.id) return;
  const list = state.activeLog.entries;
  if (list.some((e) => e.id === entry.id)) return; // 중복 수신 방지
  const stick = logIsNearBottom();
  list.push(entry);
  if (list.length > LOG_MAX_ENTRIES) list.splice(0, list.length - LOG_MAX_ENTRIES);
  updateLogFilterOptions();
  renderLogEntries();
  if (stick && !logHasActiveFilter()) scrollLogToBottom();
}

// 이벤트 종류별 아이콘 + 설명 문구. name/roomName 은 반드시 이스케이프해서 넣는다.
function formatLogEntry(entry) {
  const name = escapeHtmlText(entry.name || "누군가");
  const room = escapeHtmlText(entry.roomName || "");
  const by = escapeHtmlText(entry.byName || "대표자");
  switch (entry.type) {
    case "voice-join":
      return { icon: "🔊", html: `<b>${name}</b>님이 <b>${room}</b> 통화방에 입장했습니다.` };
    case "voice-leave":
      return { icon: "👋", html: `<b>${name}</b>님이 <b>${room}</b> 통화방에서 나갔습니다.` };
    case "draw-join":
      return { icon: "🎨", html: `<b>${name}</b>님이 그림판 <b>${room}</b>에 참여했습니다.` };
    case "memo-edit":
      return { icon: "📝", html: `<b>${name}</b>님이 메모장 <b>${room}</b>을 편집했습니다.` };
    case "member-join":
      return { icon: "➕", html: `<b>${name}</b>님이 채널에 참여했습니다.` };
    case "force-mute":
      return { icon: "🔇", html: `<b>${by}</b>님이 <b>${name}</b>님을 음소거했습니다.` };
    case "voice-kick":
      return { icon: "🚪", html: `<b>${by}</b>님이 <b>${name}</b>님을 <b>${room}</b>에서 내보냈습니다.` };
    default:
      return { icon: "•", html: `<b>${name}</b>님의 활동` };
  }
}

function renderLogEntries() {
  if (!dom.logList) return;
  const log = state.activeLog;
  const allEntries = log?.entries || [];
  if (!allEntries.length) {
    dom.logList.innerHTML = '<li class="log-empty">아직 기록된 활동이 없습니다.</li>';
    updateLogFilterCount(0, 0);
    return;
  }
  const filter = log.filter || (log.filter = { q: "", user: "", room: "", date: "" });
  const collapsed = log.collapsedDays || (log.collapsedDays = new Set());
  const active = logHasActiveFilter();
  const entries = active ? allEntries.filter((e) => logMatchesFilter(e, filter)) : allEntries;
  updateLogFilterCount(entries.length, allEntries.length);

  if (!entries.length) {
    dom.logList.innerHTML = '<li class="log-empty">검색 결과가 없습니다.</li>';
    return;
  }

  // 같은 날짜끼리 묶는다(날짜 헤더 하나로 접었다 폈다).
  const groups = [];
  let cur = null;
  for (const entry of entries) {
    const key = logDayKey(entry.at);
    if (!cur || cur.key !== key) {
      cur = { key, label: logDayLabel(entry.at), items: [] };
      groups.push(cur);
    }
    cur.items.push(entry);
  }

  const frag = document.createDocumentFragment();
  for (const g of groups) {
    const isCollapsed = collapsed.has(g.key);
    const dayLi = document.createElement("li");
    dayLi.className = "log-day" + (isCollapsed ? " collapsed" : "");
    dayLi.dataset.day = g.key;
    const toggle = document.createElement("button");
    toggle.className = "log-day-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    const arrow = document.createElement("span");
    arrow.className = "log-day-arrow";
    arrow.textContent = "▾";
    arrow.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "log-day-label";
    label.textContent = g.label;
    const count = document.createElement("span");
    count.className = "log-day-count";
    count.textContent = String(g.items.length);
    toggle.append(arrow, label, count);
    dayLi.append(toggle);
    frag.append(dayLi);
    if (isCollapsed) continue;
    for (const entry of g.items) {
      const { icon, html } = formatLogEntry(entry);
      const li = document.createElement("li");
      li.className = "log-entry";
      li.dataset.day = g.key;
      const ic = document.createElement("span");
      ic.className = "log-entry-icon";
      ic.textContent = icon;
      const body = document.createElement("span");
      body.className = "log-entry-body";
      body.innerHTML = html;
      const time = document.createElement("span");
      time.className = "log-entry-time";
      time.textContent = logTime(entry.at);
      li.append(ic, body, time);
      frag.append(li);
    }
  }
  dom.logList.innerHTML = "";
  dom.logList.append(frag);
}

// ── 로그 검색·필터 ─────────────────────────
// 서버는 채널의 전체 history 를 한 번에 내려주므로 검색·필터·접기는 모두 클라이언트에서 처리한다.
function logHasActiveFilter() {
  const f = state.activeLog?.filter;
  return !!(f && (f.q.trim() || f.user || f.room || f.date));
}

function logMatchesFilter(entry, f) {
  if (f.date && logDayKey(entry.at) !== f.date) return false;         // 날짜별
  if (f.user && (entry.name || "") !== f.user) return false;          // 유저별
  if (f.room && (entry.roomName || "") !== f.room) return false;      // 방별
  const q = f.q.trim().toLowerCase();                                 // 자유 검색
  if (q && !logSearchHaystack(entry).includes(q)) return false;
  return true;
}

// 이름·방·설명 문구를 한 문자열로 합쳐 검색 대상으로 삼는다(HTML 태그 제거).
function logSearchHaystack(entry) {
  const { html } = formatLogEntry(entry);
  const text = html.replace(/<[^>]*>/g, " ");
  return [entry.name, entry.roomName, entry.byName, text].filter(Boolean).join(" ").toLowerCase();
}

// 타임스탬프 → 로컬 달력 날짜 키(YYYY-MM-DD). date input 값과 동일한 형식이라 그대로 비교 가능.
function logDayKey(ts) {
  const d = new Date(Number(ts) || 0);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// 유저·방 드롭다운을 현재 history 에 등장한 값으로 채운다(선택값은 최대한 유지).
function updateLogFilterOptions() {
  const log = state.activeLog;
  if (!log) return;
  const users = new Set();
  const rooms = new Set();
  for (const e of log.entries || []) {
    if (e.name) users.add(e.name);
    if (e.roomName) rooms.add(e.roomName);
  }
  const byKo = (a, b) => a.localeCompare(b, "ko");
  fillLogSelect(dom.logFilterUser, [...users].sort(byKo), "모든 유저");
  fillLogSelect(dom.logFilterRoom, [...rooms].sort(byKo), "모든 방");
  // 선택했던 값이 사라졌으면 필터 상태도 동기화한다.
  if (log.filter) {
    if (dom.logFilterUser && log.filter.user) log.filter.user = dom.logFilterUser.value;
    if (dom.logFilterRoom && log.filter.room) log.filter.room = dom.logFilterRoom.value;
  }
}

function fillLogSelect(sel, values, allLabel) {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = allLabel;
  sel.append(opt0);
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.append(o);
  }
  sel.value = values.includes(prev) ? prev : "";
}

function updateLogFilterCount(shown, total) {
  if (!dom.logFilterCount) return;
  dom.logFilterCount.textContent = logHasActiveFilter() ? `${total}개 중 ${shown}개 표시` : "";
}

function clearLogFilterInputs() {
  if (dom.logSearchInput) dom.logSearchInput.value = "";
  if (dom.logSearchClear) dom.logSearchClear.hidden = true;
  if (dom.logFilterUser) dom.logFilterUser.value = "";
  if (dom.logFilterRoom) dom.logFilterRoom.value = "";
  if (dom.logFilterDate) dom.logFilterDate.value = "";
  if (dom.logFilterCount) dom.logFilterCount.textContent = "";
}

function setLogFilter(key, value) {
  const log = state.activeLog;
  if (!log) return;
  if (!log.filter) log.filter = { q: "", user: "", room: "", date: "" };
  log.filter[key] = value;
  renderLogEntries();
}

function toggleLogFilters(force) {
  if (!dom.logFilters) return;
  const show = typeof force === "boolean" ? force : dom.logFilters.hidden;
  dom.logFilters.hidden = !show;
  dom.logSearchToggle?.classList.toggle("active", show);
  if (show) dom.logSearchInput?.focus();
}

function resetLogFilters() {
  const log = state.activeLog;
  if (!log) return;
  log.filter = { q: "", user: "", room: "", date: "" };
  clearLogFilterInputs();
  renderLogEntries();
}

function bindLogEvents() {
  dom.logSearchToggle?.addEventListener("click", () => toggleLogFilters());
  dom.logSearchInput?.addEventListener("input", () => {
    const v = dom.logSearchInput.value;
    if (dom.logSearchClear) dom.logSearchClear.hidden = !v;
    setLogFilter("q", v);
  });
  dom.logSearchClear?.addEventListener("click", () => {
    dom.logSearchInput.value = "";
    dom.logSearchClear.hidden = true;
    setLogFilter("q", "");
    dom.logSearchInput.focus();
  });
  dom.logFilterUser?.addEventListener("change", () => setLogFilter("user", dom.logFilterUser.value));
  dom.logFilterRoom?.addEventListener("change", () => setLogFilter("room", dom.logFilterRoom.value));
  dom.logFilterDate?.addEventListener("change", () => setLogFilter("date", dom.logFilterDate.value));
  dom.logFilterReset?.addEventListener("click", resetLogFilters);
  // 날짜 헤더의 화살표 클릭 → 그날 로그 접기/펴기.
  dom.logList?.addEventListener("click", (event) => {
    const toggle = event.target?.closest?.(".log-day-toggle");
    if (!toggle) return;
    const key = toggle.closest(".log-day")?.dataset.day;
    if (!key || !state.activeLog) return;
    const set = state.activeLog.collapsedDays || (state.activeLog.collapsedDays = new Set());
    if (set.has(key)) set.delete(key);
    else set.add(key);
    renderLogEntries();
  });
}

function logTime(ts) {
  const d = new Date(Number(ts) || 0);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function logDayLabel(ts) {
  const d = new Date(Number(ts) || 0);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "오늘";
  if (sameDay(d, yesterday)) return "어제";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

function scrollLogToBottom() {
  if (dom.logScroll) dom.logScroll.scrollTop = dom.logScroll.scrollHeight;
}

function logIsNearBottom() {
  const el = dom.logScroll;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// ===== 다이렉트 메시지(DM) =====
// 채널과 별개인 1:1 대화. 유저 코드(#XXXX)로 상대를 찾고, 메인 영역을 DM 패널로 전환한다.
const DM_GROUP_GAP = 5 * 60 * 1000;

function dmUnreadTotal() {
  return Object.values(state.dm.unread).reduce((a, b) => a + (b || 0), 0);
}

function openDmMode() {
  state.dm.open = true;
  // 다른 채널 패널은 닫되 통화(WebRTC)는 유지된다.
  closeChatView();
  closeMemoView();
  closeDrawView();
  closeLogView();
  document.body.classList.add("dm-open");
  renderChannelRail();
  sendSocket({ type: "dm:list" });
  renderDmThreads();
  if (state.dm.activeUserId) openDmConversation(state.dm.activeUserId);
  else showDmEmpty();
}

function closeDmMode() {
  if (!state.dm.open) return;
  state.dm.open = false;
  document.body.classList.remove("dm-open");
  if (dom.dmNewRow) dom.dmNewRow.hidden = true;
  renderChannelRail();
}

function showDmEmpty() {
  if (dom.dmConvHead) dom.dmConvHead.hidden = true;
  if (dom.dmComposer) dom.dmComposer.hidden = true;
  if (dom.dmEmpty) dom.dmEmpty.hidden = false;
  if (dom.dmMessages) dom.dmMessages.innerHTML = "";
}

function renderDmThreads() {
  if (!dom.dmThreadList) return;
  dom.dmThreadList.innerHTML = "";
  if (!state.dm.threads.length) {
    const li = document.createElement("li");
    li.className = "dm-thread-empty";
    li.textContent = "아직 대화가 없습니다.";
    dom.dmThreadList.append(li);
    return;
  }
  for (const t of state.dm.threads) {
    const li = document.createElement("li");
    li.className = "dm-thread" + (t.userId === state.dm.activeUserId ? " active" : "");
    li.dataset.dmUser = t.userId;
    const av = document.createElement("span");
    av.className = "dm-thread-avatar";
    setAvatar(av, t.partner);
    const body = document.createElement("div");
    body.className = "dm-thread-body";
    const nameEl = document.createElement("div");
    nameEl.className = "dm-thread-name";
    nameEl.textContent = t.partner?.displayName || "유저";
    const preview = document.createElement("div");
    preview.className = "dm-thread-preview";
    preview.textContent = t.lastText || "";
    body.append(nameEl, preview);
    li.append(av, body);
    const unread = state.dm.unread[t.userId] || 0;
    if (unread > 0 && t.userId !== state.dm.activeUserId) {
      const badge = document.createElement("span");
      badge.className = "dm-thread-unread";
      badge.textContent = unread > 99 ? "99+" : String(unread);
      li.append(badge);
    }
    dom.dmThreadList.append(li);
  }
}

function openDmConversation(userId) {
  if (!userId) return;
  state.dm.activeUserId = userId;
  delete state.dm.unread[userId];
  state.dm.messages = [];
  if (dom.dmEmpty) dom.dmEmpty.hidden = true;
  if (dom.dmMessages) dom.dmMessages.innerHTML = '<p class="dm-loading">불러오는 중…</p>';
  const t = state.dm.threads.find((x) => x.userId === userId);
  if (t) setDmHeader(t.partner);
  else if (state.dm.partner?.id === userId) setDmHeader(state.dm.partner);
  if (dom.dmComposer) dom.dmComposer.hidden = false;
  sendSocket({ type: "dm:open", userId });
  renderDmThreads();
  renderChannelRail();
  dom.dmInput?.focus();
}

function setDmHeader(partner) {
  if (!partner) return;
  state.dm.partner = partner;
  rememberUserProfile(partner);
  if (dom.dmConvHead) dom.dmConvHead.hidden = false;
  if (dom.dmConvName) dom.dmConvName.textContent = partner.displayName || "유저";
  if (dom.dmConvCode) dom.dmConvCode.textContent = "#" + (partner.code || "----");
  if (dom.dmConvAvatar) setAvatar(dom.dmConvAvatar, partner);
}

function handleDmThreads(message) {
  state.dm.threads = message.threads || [];
  if (state.dm.open) renderDmThreads();
  renderChannelRail();
}

function handleDmHistory(message) {
  if (message.userId !== state.dm.activeUserId) return;
  if (message.partner) setDmHeader(message.partner);
  state.dm.messages = message.messages || [];
  renderDmMessages();
  scrollDmToBottom();
}

function handleIncomingDm(message) {
  const users = message.users || [];
  const myId = state.auth.user?.id;
  const partnerId = users.find((u) => u !== myId) || "";
  if (!partnerId) return;
  const isActive = state.dm.open && state.dm.activeUserId === partnerId;
  if (isActive) {
    state.dm.messages.push(message.message);
    renderDmMessages();
    scrollDmToBottom();
  } else if (message.message.userId !== myId) {
    state.dm.unread[partnerId] = (state.dm.unread[partnerId] || 0) + 1;
    renderChannelRail();
    if (state.dm.open) renderDmThreads();
  }
}

function handleDmDeleted(message) {
  const users = message.users || [];
  const myId = state.auth.user?.id;
  const partnerId = users.find((u) => u !== myId) || "";
  if (state.dm.open && state.dm.activeUserId === partnerId) {
    state.dm.messages = state.dm.messages.filter((m) => m.id !== message.msgId);
    renderDmMessages();
  }
}

function handleDmUser(message) {
  const u = message.user;
  if (!u) return;
  state.dm.partner = u;
  if (dom.dmNewRow) dom.dmNewRow.hidden = true;
  if (dom.dmCodeInput) dom.dmCodeInput.value = "";
  setDmFindMsg("");
  openDmConversation(u.id);
}

function handleDmError(message) {
  if (message.action === "find") { setDmFindMsg(message.message || "찾을 수 없습니다."); return; }
  setMessage(message.message || "DM 오류가 발생했습니다.");
}

function setDmFindMsg(text) {
  if (dom.dmFindMsg) dom.dmFindMsg.textContent = text || "";
}

function sendDmText() {
  const userId = state.dm.activeUserId;
  if (!userId || !dom.dmInput) return;
  const text = dom.dmInput.value.trim();
  if (!text) return;
  sendSocket({ type: "dm:send", userId, text });
  dom.dmInput.value = "";
  autoResizeDmInput();
}

function renderDmMessages() {
  if (!dom.dmMessages) return;
  dom.dmMessages.innerHTML = "";
  const myId = state.auth.user?.id;
  let prev = null;
  let currentBody = null;
  for (const msg of state.dm.messages) {
    const grouped = prev && prev.userId === msg.userId && (msg.at - prev.at) < DM_GROUP_GAP;
    // 묶이지 않은 첫 메시지마다 아바타 + 이름/시간 헤더를 가진 그룹을 새로 만든다(채팅과 동일한 형태).
    if (!grouped) {
      const group = document.createElement("div");
      group.className = "dm-group" + (msg.userId === myId ? " mine" : "");
      const avatar = document.createElement("span");
      avatar.className = "dm-avatar profile-link";
      avatar.dataset.profileUser = msg.userId || "";
      setAvatar(avatar, lookupUserProfile(msg.userId, { displayName: msg.name }));
      currentBody = document.createElement("div");
      currentBody.className = "dm-group-body";
      const head = document.createElement("div");
      head.className = "dm-msg-head";
      const nameEl = document.createElement("b");
      nameEl.className = "profile-link";
      nameEl.dataset.profileUser = msg.userId || "";
      nameEl.textContent = msg.name || "유저";
      const time = document.createElement("span");
      time.textContent = formatChatTime(msg.at);
      head.append(nameEl, time);
      currentBody.append(head);
      group.append(avatar, currentBody);
      dom.dmMessages.append(group);
    }
    currentBody.append(renderDmMessageLine(msg, myId));
    prev = msg;
  }
}

function renderDmMessageLine(msg, myId) {
  const line = document.createElement("div");
  line.className = "dm-msg-line";
  line.dataset.msgId = msg.id;
  const text = document.createElement("span");
  text.className = "dm-msg-text";
  text.textContent = msg.text || "";
  line.append(text);
  if (msg.userId === myId) {
    const del = document.createElement("button");
    del.className = "dm-msg-del";
    del.type = "button";
    del.dataset.dmDelete = msg.id;
    del.title = "삭제";
    del.textContent = "🗑";
    line.append(del);
  }
  return line;
}

function scrollDmToBottom() {
  if (dom.dmScroll) dom.dmScroll.scrollTop = dom.dmScroll.scrollHeight;
}

function autoResizeDmInput() {
  const el = dom.dmInput;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

let drawStatusTimer = null;
function setDrawStatus(text, tone) {
  const el = dom.drawStatus;
  if (!el) return;
  clearTimeout(drawStatusTimer);
  // 캔버스 위 토스트로 띄운다(툴바 버튼을 밀지 않음). 빈 문자열이면 숨긴다.
  if (!text) {
    el.classList.remove("show");
    return;
  }
  el.textContent = text;
  el.className = "draw-status show" + (tone === "bad" ? " bad" : "");
  // 읽기 전용 안내(muted)는 계속 떠 있고, 나머지 확인 메시지는 잠시 뒤 사라진다.
  if (tone !== "muted") {
    drawStatusTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
}

function nextDrawStrokeId() {
  const d = state.draw;
  return `${state.clientId || "me"}-${++d.strokeCounter}-${Date.now().toString(36)}`;
}

// ── 문서/레이어 구성 ──
function makeLayerCanvas(d) {
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  return c;
}

function buildDrawFromDoc(doc) {
  const d = state.draw;
  d.width = doc.width || 900;
  d.height = doc.height || 600;
  d.imageCache.clear();
  d.layers = (doc.layers || []).map((raw) => {
    const layer = {
      id: raw.id,
      name: raw.name || "레이어",
      visible: raw.visible !== false,
      locked: raw.locked === true,
      strokes: Array.isArray(raw.strokes) ? raw.strokes.slice() : [],
      canvas: null,
      ctx: null,
    };
    layer.canvas = makeLayerCanvas(d);
    layer.ctx = layer.canvas.getContext("2d");
    return layer;
  });
  if (!d.layers.length) {
    const layer = { id: "L1", name: "레이어 1", visible: true, locked: false, strokes: [], canvas: makeLayerCanvas(d), ctx: null };
    layer.ctx = layer.canvas.getContext("2d");
    d.layers.push(layer);
  }
  d.activeLayerId = d.layers[d.layers.length - 1].id;
  applyCanvasSize();
  for (const layer of d.layers) renderLayer(layer);
  compositeDraw();
  renderDrawLayers();
}

function findDrawLayer(layerId) {
  return state.draw?.layers.find((l) => l.id === layerId) || null;
}

function applyCanvasSize() {
  const d = state.draw;
  const canvas = dom.drawCanvas;
  if (!canvas) return;
  canvas.width = d.width;
  canvas.height = d.height;
  for (const layer of d.layers) {
    layer.canvas.width = d.width;
    layer.canvas.height = d.height;
  }
  applyZoom(); // CSS 표시 크기·오버레이 해상도 갱신
}

const DRAW_ZOOM_MIN = 0.1;
const DRAW_ZOOM_MAX = 8;

// 줌 배율을 CSS 표시 크기에 반영하고, 오버레이 해상도를 표시 픽셀에 맞춘다(라벨이 확대에도 또렷하게).
function applyZoom() {
  const d = state.draw;
  if (!d) return;
  const z = d.zoom || 1;
  const w = Math.max(1, Math.round(d.width * z));
  const h = Math.max(1, Math.round(d.height * z));
  if (dom.drawCanvas) {
    dom.drawCanvas.style.width = `${w}px`;
    dom.drawCanvas.style.height = `${h}px`;
  }
  if (dom.drawOverlay) {
    dom.drawOverlay.width = w;
    dom.drawOverlay.height = h;
    dom.drawOverlay.style.width = `${w}px`;
    dom.drawOverlay.style.height = `${h}px`;
  }
  if (dom.drawZoomReset) dom.drawZoomReset.textContent = `${Math.round(z * 100)}%`;
  renderDrawOverlay();
}

// clientX/Y(마우스)를 주면 그 지점을 기준으로 확대/축소(포토샵식). 안 주면 현재 스크롤 유지.
function setDrawZoom(z, clientX, clientY) {
  const d = state.draw;
  if (!d) return;
  const nz = Math.max(DRAW_ZOOM_MIN, Math.min(DRAW_ZOOM_MAX, z));
  const scroll = dom.drawCanvasScroll;
  const hasAnchor = scroll && dom.drawCanvas && clientX != null;
  let ax = 0, ay = 0;
  if (hasAnchor) {
    const rb = dom.drawCanvas.getBoundingClientRect();
    ax = (clientX - rb.left) / (d.zoom || 1); // 앵커의 캔버스 좌표
    ay = (clientY - rb.top) / (d.zoom || 1);
  }
  d.zoom = nz;
  applyZoom();
  if (hasAnchor) {
    const ra = dom.drawCanvas.getBoundingClientRect();
    scroll.scrollLeft += ra.left + ax * nz - clientX;
    scroll.scrollTop += ra.top + ay * nz - clientY;
  }
}

function zoomStep(dir, clientX, clientY) {
  const d = state.draw;
  if (!d) return;
  const factor = dir > 0 ? 1.2 : 1 / 1.2;
  setDrawZoom((d.zoom || 1) * factor, clientX, clientY);
}

// 한 획을 주어진 컨텍스트에 그린다(펜/지우개/이미지).
function paintStroke(ctx, stroke) {
  if (stroke.tool === "image") {
    const img = getStrokeImage(stroke);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, stroke.x, stroke.y, stroke.w, stroke.h);
    return;
  }
  const pts = stroke.points || [];
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], Math.max(0.5, stroke.size / 2), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function getStrokeImage(stroke) {
  const d = state.draw;
  let img = d.imageCache.get(stroke.id);
  if (!img) {
    img = new Image();
    img.onload = () => {
      // 이미지 로드가 끝나면 해당 획이 남아있을 때만 다시 그린다.
      if (!state.draw) return;
      const layer = state.draw.layers.find((l) => l.strokes.some((s) => s.id === stroke.id));
      if (layer) { renderLayer(layer); compositeDraw(); }
    };
    img.src = stroke.src;
    d.imageCache.set(stroke.id, img);
  }
  return img;
}

// 레이어 offscreen을 그 레이어의 모든 획으로 다시 그린다.
function renderLayer(layer) {
  const d = state.draw;
  layer.ctx.clearRect(0, 0, d.width, d.height);
  for (const stroke of layer.strokes) paintStroke(layer.ctx, stroke);
  // 진행 중인 내 획이 이 레이어면 함께 표시(재렌더로 지워지지 않게).
  if (d.drawing && d.drawing.layer === layer) paintStroke(layer.ctx, d.drawing.stroke);
}

// 표시 캔버스에 보이는 레이어들을 순서대로 합성한다.
function compositeDraw() {
  const d = state.draw;
  const ctx = dom.drawCanvas?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, d.width, d.height);
  for (const layer of d.layers) {
    if (layer.visible) ctx.drawImage(layer.canvas, 0, 0);
  }
}

// ── 로컬 그리기 ──
function drawPointFromEvent(event) {
  const canvas = dom.drawCanvas;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return [(event.clientX - rect.left) * sx, (event.clientY - rect.top) * sy];
}

function onDrawPointerDown(event) {
  const d = state.draw;
  if (!d || !d.loaded) return;
  if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
  d.hoverPt = drawPointFromEvent(event);

  // 팬(화면 이동): 스페이스 누름 또는 가운데 버튼
  if (d.spaceDown || event.button === 1) { beginPan(event); return; }

  // 이동·크기 변형 도구
  if (d.tool === "move") { beginTransform(event); return; }

  if (!d.writable) { setDrawStatus("읽기 전용 그림판 — 대표자만 그릴 수 있어요", "bad"); return; }
  const layer = findDrawLayer(d.activeLayerId);
  if (!layer) return;
  if (!layer.visible) { setDrawStatus("숨긴 레이어에는 그릴 수 없어요", "bad"); return; }
  if (layer.locked) { setDrawStatus("잠긴 레이어에는 그릴 수 없어요", "bad"); return; }
  event.preventDefault();

  // 페인트통(채우기)
  if (d.tool === "fill") { floodFillAt(d.hoverPt, layer); return; }

  try { dom.drawCanvas.setPointerCapture?.(event.pointerId); } catch { /* 캡처 실패해도 그리기는 진행 */ }
  const stroke = {
    id: nextDrawStrokeId(),
    tool: d.tool,
    color: d.color,
    size: d.size,
    points: [d.hoverPt],
  };
  d.drawing = { stroke, layer };
  renderLayer(layer);
  compositeDraw();
  sendDrawCursor(true, true);
}

function onDrawPointerMove(event) {
  const d = state.draw;
  if (!d || !d.loaded) return;
  if (d.panning) { updatePan(event); return; }
  if (d.transform && d.transform.dragging) { updateTransform(event); return; }

  const pt = drawPointFromEvent(event);
  d.hoverPt = pt;

  if (d.drawing) {
    const pts = d.drawing.stroke.points;
    const last = pts[pts.length - 1];
    const dx = pt[0] - last[0];
    const dy = pt[1] - last[1];
    if (dx * dx + dy * dy >= DRAW_MIN_POINT_DIST * DRAW_MIN_POINT_DIST) {
      pts.push(pt);
      if (pts.length > 8000) pts.length = 8000;
      // 마지막 구간만 증분 그리기(전체 재렌더 없이).
      const ctx = d.drawing.layer.ctx;
      ctx.save();
      ctx.globalCompositeOperation = d.drawing.stroke.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = d.drawing.stroke.color;
      ctx.lineWidth = d.drawing.stroke.size;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(pt[0], pt[1]);
      ctx.stroke();
      ctx.restore();
      compositeDraw();
    }
    sendDrawCursor(true, false);
  } else {
    sendDrawCursor(false, false);
  }
  renderDrawOverlay();
}

function onDrawPointerUp(event) {
  const d = state.draw;
  if (!d) return;
  if (d.panning) { endPan(event); return; }
  if (d.transform && d.transform.dragging) { endTransform(event); return; }
  if (!d.drawing) return;
  const { stroke, layer } = d.drawing;
  d.drawing = null;
  layer.strokes.push(stroke);
  d.myStrokes.push({ layerId: layer.id, strokeId: stroke.id });
  renderLayer(layer);
  compositeDraw();
  sendSocket({ type: "draw:stroke", roomId: d.roomId, layerId: layer.id, stroke });
  sendDrawCursor(false, true); // 그리기 종료를 즉시 알려 원격 라이브 트레일을 정리
  renderDrawOverlay();
}

// ── 화면 이동(팬): 스페이스 + 드래그 ──
function beginPan(event) {
  const d = state.draw;
  const scroll = dom.drawCanvasScroll;
  if (!scroll) return;
  event.preventDefault();
  d.panning = { x: event.clientX, y: event.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop };
  dom.drawCanvasStage?.classList.add("panning");
  try { dom.drawCanvas.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
}
function updatePan(event) {
  const d = state.draw;
  const scroll = dom.drawCanvasScroll;
  if (!d.panning || !scroll) return;
  scroll.scrollLeft = d.panning.sl - (event.clientX - d.panning.x);
  scroll.scrollTop = d.panning.st - (event.clientY - d.panning.y);
}
function endPan(event) {
  const d = state.draw;
  d.panning = null;
  dom.drawCanvasStage?.classList.remove("panning");
  try { dom.drawCanvas.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
}

// ── 페인트통(flood fill) ──
// 활성 레이어의 현재 픽셀을 기준으로 연결된 영역을 칠하고, 칠한 영역만 이미지 획으로 추가한다
// (기존 image 획 타입을 재사용 → 서버 변경 없이 동기화·실행취소가 그대로 동작).
function hexToRgba(hex) {
  let h = String(hex || "#000000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  if (h.length !== 8) h = "000000ff";
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
}

function floodFillAt(pt, layer) {
  const d = state.draw;
  const W = d.width, H = d.height;
  const x0 = Math.floor(pt[0]), y0 = Math.floor(pt[1]);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
  const ctx = layer.ctx;
  const img = ctx.getImageData(0, 0, W, H);
  const data = new Uint32Array(img.data.buffer);
  const idx0 = y0 * W + x0;
  const [fr, fg, fb, fa] = hexToRgba(d.color);
  const fill = ((fa << 24) | (fb << 16) | (fg << 8) | fr) >>> 0; // little-endian AABBGGRR
  const target = data[idx0];
  if (target === fill) return;
  const tol = 40;
  const tr = target & 0xff, tg = (target >> 8) & 0xff, tb = (target >> 16) & 0xff, ta = (target >>> 24) & 0xff;
  const match = (v) => {
    const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff, a = (v >>> 24) & 0xff;
    return Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol && Math.abs(a - ta) <= tol;
  };
  const seen = new Uint8Array(W * H);
  const filled = new Uint8Array(W * H);
  let minX = x0, minY = y0, maxX = x0, maxY = y0;
  const stack = [idx0];
  seen[idx0] = 1;
  while (stack.length) {
    const idx = stack.pop();
    if (!match(data[idx])) continue;
    data[idx] = fill;
    filled[idx] = 1;
    const px = idx % W, py = (idx - px) / W;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (px > 0 && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
    if (px < W - 1 && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
    if (py > 0 && !seen[idx - W]) { seen[idx - W] = 1; stack.push(idx - W); }
    if (py < H - 1 && !seen[idx + W]) { seen[idx + W] = 1; stack.push(idx + W); }
  }
  // 칠한 영역만 잘라 이미지 획으로 만든다
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = bw; out.height = bh;
  const octx = out.getContext("2d");
  const oimg = octx.createImageData(bw, bh);
  const odata = new Uint32Array(oimg.data.buffer);
  for (let y = 0; y < bh; y++) {
    const srow = (minY + y) * W + minX;
    const drow = y * bw;
    for (let x = 0; x < bw; x++) if (filled[srow + x]) odata[drow + x] = fill;
  }
  octx.putImageData(oimg, 0, 0);
  const stroke = { id: nextDrawStrokeId(), tool: "image", src: out.toDataURL("image/png"), x: minX, y: minY, w: bw, h: bh };
  layer.strokes.push(stroke);
  d.myStrokes.push({ layerId: layer.id, strokeId: stroke.id });
  renderLayer(layer);
  compositeDraw();
  sendSocket({ type: "draw:stroke", roomId: d.roomId, layerId: layer.id, stroke });
  setDrawStatus("채우기 완료", "");
}

// ── 이동·크기 변형 도구(레이어 통째로 이동/확대·축소) ──
function computeLayerBBox(layer) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of layer.strokes) {
    if (s.tool === "image") {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
    } else {
      const r = (s.size || 1) / 2;
      for (const p of (s.points || [])) {
        minX = Math.min(minX, p[0] - r); minY = Math.min(minY, p[1] - r);
        maxX = Math.max(maxX, p[0] + r); maxY = Math.max(maxY, p[1] + r);
      }
    }
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function transformHandles(box) {
  const { x, y, w, h } = box;
  return {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y],
    e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h],
    sw: [x, y + h], w: [x, y + h / 2],
  };
}
function hitTransformHandle(pt, box) {
  const tol = 10 / (state.draw.zoom || 1);
  for (const [name, [hx, hy]] of Object.entries(transformHandles(box))) {
    if (Math.abs(pt[0] - hx) <= tol && Math.abs(pt[1] - hy) <= tol) return name;
  }
  return null; // 핸들이 아니면 내부 이동
}

function beginTransform(event) {
  const d = state.draw;
  if (!d.writable) { setDrawStatus("읽기 전용 그림판 — 대표자만 그릴 수 있어요", "bad"); return; }
  const layer = findDrawLayer(d.activeLayerId);
  if (!layer) return;
  if (layer.locked) { setDrawStatus("잠긴 레이어는 변형할 수 없어요", "bad"); return; }
  if (!d.transform || d.transform.layerId !== layer.id) {
    const bbox = computeLayerBBox(layer);
    if (!bbox) { setDrawStatus("빈 레이어입니다", "bad"); return; }
    d.transform = {
      layerId: layer.id,
      orig: { ...bbox },
      box: { ...bbox },
      snapshot: layer.strokes.map((s) => JSON.parse(JSON.stringify(s))),
      dragging: false,
    };
  }
  const t = d.transform;
  const pt = drawPointFromEvent(event);
  event.preventDefault();
  try { dom.drawCanvas.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
  t.handle = hitTransformHandle(pt, t.box);
  t.startPt = pt;
  t.startBox = { ...t.box };
  t.dragging = true;
  renderDrawOverlay();
}

function updateTransform(event) {
  const d = state.draw;
  const t = d.transform;
  if (!t || !t.dragging) return;
  const pt = drawPointFromEvent(event);
  const dx = pt[0] - t.startPt[0];
  const dy = pt[1] - t.startPt[1];
  const b = { ...t.startBox };
  const h = t.handle;
  if (!h) { b.x += dx; b.y += dy; }
  else {
    if (h.includes("e")) b.w = t.startBox.w + dx;
    if (h.includes("s")) b.h = t.startBox.h + dy;
    if (h.includes("w")) { b.x = t.startBox.x + dx; b.w = t.startBox.w - dx; }
    if (h.includes("n")) { b.y = t.startBox.y + dy; b.h = t.startBox.h - dy; }
  }
  if (b.w < 4) b.w = 4;
  if (b.h < 4) b.h = 4;
  t.box = b;
  applyTransformToLayer();
  renderDrawOverlay();
}

function applyTransformToLayer() {
  const d = state.draw;
  const t = d.transform;
  const layer = findDrawLayer(t.layerId);
  if (!layer) return;
  const sx = t.box.w / t.orig.w;
  const sy = t.box.h / t.orig.h;
  const savg = (Math.abs(sx) + Math.abs(sy)) / 2;
  const mapX = (x) => t.box.x + (x - t.orig.x) * sx;
  const mapY = (y) => t.box.y + (y - t.orig.y) * sy;
  layer.strokes = t.snapshot.map((s) => {
    if (s.tool === "image") return { ...s, x: mapX(s.x), y: mapY(s.y), w: s.w * sx, h: s.h * sy };
    return { ...s, size: Math.max(0.5, (s.size || 1) * savg), points: (s.points || []).map((p) => [mapX(p[0]), mapY(p[1])]) };
  });
  renderLayer(layer);
  compositeDraw();
}

function endTransform(event) {
  const d = state.draw;
  const t = d.transform;
  if (!t) return;
  t.dragging = false;
  try { dom.drawCanvas.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
  const layer = findDrawLayer(t.layerId);
  if (!layer) { d.transform = null; return; }
  // 확정: 다음 드래그의 기준을 새 상태로 갱신하고 서버에 레이어 획을 통째로 교체 요청
  t.orig = { ...t.box };
  t.snapshot = layer.strokes.map((s) => JSON.parse(JSON.stringify(s)));
  d.myStrokes = d.myStrokes.filter((e) => e.layerId !== layer.id); // 좌표가 바뀌어 개별 undo 무효
  sendSocket({ type: "draw:layer-replace", roomId: d.roomId, layerId: layer.id, strokes: layer.strokes });
  renderDrawOverlay();
  setDrawStatus(`${Math.round(t.box.w)} × ${Math.round(t.box.h)}`, "");
}

// ── 캔버스 크기를 마우스로 직접 조절(모서리 손잡이 드래그) ──
function beginCanvasResize(event, dir) {
  const d = state.draw;
  if (!d) return;
  if (!d.writable) { setDrawStatus("읽기 전용 — 크기를 바꿀 수 없어요", "bad"); return; }
  event.preventDefault();
  event.stopPropagation();
  d.canvasResize = { dir, x: event.clientX, y: event.clientY, w0: d.width, h0: d.height };
  window.addEventListener("pointermove", onCanvasResizeMove);
  window.addEventListener("pointerup", onCanvasResizeUp, { once: true });
}
function onCanvasResizeMove(event) {
  const d = state.draw;
  if (!d || !d.canvasResize) return;
  const cr = d.canvasResize;
  const z = d.zoom || 1;
  const dx = (event.clientX - cr.x) / z;
  const dy = (event.clientY - cr.y) / z;
  if (cr.dir.includes("e")) d.width = Math.max(200, Math.min(4000, Math.round(cr.w0 + dx)));
  if (cr.dir.includes("s")) d.height = Math.max(200, Math.min(4000, Math.round(cr.h0 + dy)));
  applyCanvasSize();
  for (const layer of d.layers) renderLayer(layer);
  compositeDraw();
  setDrawStatus(`${d.width} × ${d.height}`, "");
}
function onCanvasResizeUp() {
  const d = state.draw;
  window.removeEventListener("pointermove", onCanvasResizeMove);
  if (!d || !d.canvasResize) return;
  d.canvasResize = null;
  sendSocket({ type: "draw:resize", roomId: d.roomId, width: d.width, height: d.height });
  setDrawStatus(d.writable ? "" : "읽기 전용 — 대표자만 그릴 수 있어요", d.writable ? "" : "muted");
}

// ── 실시간 커서/라이브 펜 오버레이 ──
let drawLastCursorSent = 0;
function sendDrawCursor(drawing, force) {
  const d = state.draw;
  if (!d || !d.loaded || !d.hoverPt) return;
  const now = performance.now();
  if (!force && now - drawLastCursorSent < 45) return;
  drawLastCursorSent = now;
  sendSocket({
    type: "draw:cursor",
    roomId: d.roomId,
    x: Math.round(d.hoverPt[0]),
    y: Math.round(d.hoverPt[1]),
    tool: d.tool,
    color: d.color,
    size: d.size,
    drawing: Boolean(drawing),
    active: true,
  });
}

const DRAW_TOOL_ICON = { pen: "✏️", eraser: "🧽", fill: "🪣", move: "✥" };

function overlayRoundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRemoteCursorMarker(ctx, cur, z) {
  const x = cur.x * z, y = cur.y * z;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = cur.color || "#5865f2";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  const label = `${DRAW_TOOL_ICON[cur.tool] || "✏️"} ${cur.name || "유저"}`;
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(label).width + 12;
  const lx = x + 9, ly = y + 6;
  ctx.fillStyle = "rgba(20,22,28,0.86)";
  overlayRoundRect(ctx, lx, ly, w, 18, 5);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, lx + 6, ly + 10);
  ctx.restore();
}

// 오버레이 = 표시 픽셀(캔버스*줌) 해상도. 캔버스 좌표에 z를 곱해 그린다.
function renderDrawOverlay() {
  const d = state.draw;
  const ov = dom.drawOverlay;
  if (!d || !ov) return;
  const ctx = ov.getContext("2d");
  const z = d.zoom || 1;
  ctx.clearRect(0, 0, ov.width, ov.height);

  // 1) 원격 라이브 트레일(그리는 중인 상대 펜)
  for (const cur of d.cursors.values()) {
    if (cur.drawing && cur.trail && cur.trail.length > 1 && cur.tool !== "eraser") {
      ctx.save();
      ctx.strokeStyle = cur.color || "#888";
      ctx.lineWidth = Math.max(1, (cur.size || 2) * z);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cur.trail[0][0] * z, cur.trail[0][1] * z);
      for (let i = 1; i < cur.trail.length; i++) ctx.lineTo(cur.trail[i][0] * z, cur.trail[i][1] * z);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 2) 내 브러시 크기 미리보기(펜/지우개 hover 중)
  if (d.hoverPt && !d.drawing && !d.panning && (d.tool === "pen" || d.tool === "eraser")) {
    const r = Math.max(1, (d.size / 2) * z);
    ctx.save();
    ctx.beginPath();
    ctx.arc(d.hoverPt[0] * z, d.hoverPt[1] * z, r, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = d.tool === "eraser" ? "rgba(240,80,80,0.9)" : "rgba(0,0,0,0.7)";
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.restore();
  }

  // 3) 변형 박스 + 핸들
  if (d.tool === "move" && d.transform) {
    const b = d.transform.box;
    ctx.save();
    ctx.strokeStyle = "#5865f2";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(b.x * z, b.y * z, b.w * z, b.h * z);
    ctx.setLineDash([]);
    ctx.fillStyle = "#5865f2";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    for (const [, [hx, hy]] of Object.entries(transformHandles(b))) {
      ctx.beginPath();
      ctx.rect(hx * z - 4, hy * z - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4) 원격 커서 마커(도구 모양 + 이름)
  for (const cur of d.cursors.values()) {
    if (cur.active === false) continue;
    drawRemoteCursorMarker(ctx, cur, z);
  }
}

// ── 캔버스 전체/레이어 저장·복사 ──
function drawSanitizeFileName(name) {
  return String(name || "canvas").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "canvas";
}
function compositeToCanvas() {
  const d = state.draw;
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  const ctx = c.getContext("2d");
  for (const layer of d.layers) if (layer.visible) ctx.drawImage(layer.canvas, 0, 0);
  return c;
}
function downloadCanvasPng(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
function saveCanvasPng() {
  const d = state.draw;
  if (!d) return;
  downloadCanvasPng(compositeToCanvas(), `${drawSanitizeFileName(d.name)}.png`);
  setDrawStatus("캔버스를 저장했어요", "");
}
function saveLayerPng() {
  const d = state.draw;
  if (!d) return;
  const layer = findDrawLayer(d.activeLayerId);
  if (!layer) return;
  downloadCanvasPng(layer.canvas, `${drawSanitizeFileName(d.name)}-${drawSanitizeFileName(layer.name)}.png`);
  setDrawStatus(`'${layer.name}' 레이어를 저장했어요`, "");
}
async function copyCanvasImage() {
  const d = state.draw;
  if (!d) return;
  try {
    const canvas = compositeToCanvas();
    // 일렉트론 앱: 비보안 컨텍스트라 navigator.clipboard가 막히므로 네이티브 브리지 사용
    if (window.voiceDesktop?.copyImage) {
      const r = await window.voiceDesktop.copyImage(canvas.toDataURL("image/png"));
      if (!r?.ok) throw new Error(r?.error || "copy failed");
      setDrawStatus("캔버스 이미지를 복사했어요", "");
      return;
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob || !navigator.clipboard || !window.ClipboardItem) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setDrawStatus("캔버스 이미지를 복사했어요", "");
  } catch {
    setDrawStatus("복사 실패 — 브라우저가 지원하지 않을 수 있어요", "bad");
  }
}

function undoMyLastStroke() {
  const d = state.draw;
  if (!d || !d.myStrokes.length) return;
  const entry = d.myStrokes.pop();
  const layer = findDrawLayer(entry.layerId);
  if (layer) {
    layer.strokes = layer.strokes.filter((s) => s.id !== entry.strokeId);
    renderLayer(layer);
    compositeDraw();
  }
  sendSocket({ type: "draw:undo", roomId: d.roomId, strokeId: entry.strokeId });
}

function clearActiveLayer() {
  const d = state.draw;
  if (!d) return;
  const layer = findDrawLayer(d.activeLayerId);
  if (!layer) return;
  if (!confirm(`'${layer.name}' 레이어를 지울까요?`)) return;
  layer.strokes = [];
  d.myStrokes = d.myStrokes.filter((e) => e.layerId !== layer.id);
  renderLayer(layer);
  compositeDraw();
  sendSocket({ type: "draw:clear", roomId: d.roomId, layerId: layer.id });
}

// ── 이미지 붙여넣기 ──
function handleDrawPaste(event) {
  const d = state.draw;
  if (!d || !d.loaded) return;
  if (!document.body.classList.contains("draw-open")) return;
  const items = event.clipboardData?.items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) { event.preventDefault(); insertDrawImageFile(file); return; }
    }
  }
}

function insertDrawImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const d = state.draw;
      if (!d) return;
      // 캔버스 대비 과도하게 크면 축소, 원본이 매우 크면 재인코딩으로 용량도 줄인다.
      const maxDim = 1200;
      let nw = img.naturalWidth;
      let nh = img.naturalHeight;
      const encScale = Math.min(1, maxDim / nw, maxDim / nh);
      const encW = Math.max(1, Math.round(nw * encScale));
      const encH = Math.max(1, Math.round(nh * encScale));
      let src = String(reader.result);
      if (encScale < 1) {
        const tmp = document.createElement("canvas");
        tmp.width = encW; tmp.height = encH;
        tmp.getContext("2d").drawImage(img, 0, 0, encW, encH);
        src = tmp.toDataURL("image/png");
      }
      const fitScale = Math.min(1, (d.width * 0.8) / encW, (d.height * 0.8) / encH);
      const w = Math.max(1, Math.round(encW * fitScale));
      const h = Math.max(1, Math.round(encH * fitScale));
      const x = Math.round((d.width - w) / 2);
      const y = Math.round((d.height - h) / 2);
      const layer = findDrawLayer(d.activeLayerId) || d.layers[d.layers.length - 1];
      const stroke = { id: nextDrawStrokeId(), tool: "image", src, x, y, w, h };
      layer.strokes.push(stroke);
      d.myStrokes.push({ layerId: layer.id, strokeId: stroke.id });
      renderLayer(layer);
      compositeDraw();
      sendSocket({ type: "draw:stroke", roomId: d.roomId, layerId: layer.id, stroke });
      setDrawStatus("이미지 추가됨", "");
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

// ── 레이어 UI ──
function renderDrawLayers() {
  const d = state.draw;
  const list = dom.drawLayerList;
  if (!d || !list) return;
  list.innerHTML = "";
  d.layers.forEach((layer, index) => {
    const li = document.createElement("li");
    li.className = "draw-layer-item" + (layer.id === d.activeLayerId ? " active" : "") + (layer.visible ? "" : " hidden-layer") + (layer.locked ? " locked-layer" : "");
    li.dataset.layerId = layer.id;

    const vis = document.createElement("button");
    vis.className = "draw-layer-vis";
    vis.type = "button";
    vis.textContent = layer.visible ? "👁" : "🚫";
    vis.title = layer.visible ? "숨기기" : "보이기";
    vis.addEventListener("click", (e) => { e.stopPropagation(); toggleLayerVisible(layer.id); });

    const lock = document.createElement("button");
    lock.className = "draw-layer-lock";
    lock.type = "button";
    lock.textContent = layer.locked ? "🔒" : "🔓";
    lock.title = layer.locked ? "잠금 해제" : "잠그기";
    lock.addEventListener("click", (e) => { e.stopPropagation(); toggleLayerLock(layer.id); });

    const name = document.createElement("span");
    name.className = "draw-layer-name";
    name.textContent = layer.name;
    name.title = "더블클릭(또는 ✏️)하여 이름 변경";
    name.addEventListener("dblclick", (e) => { e.stopPropagation(); startLayerRename(li, layer); });

    const rename = document.createElement("button");
    rename.className = "draw-layer-rename";
    rename.type = "button"; rename.textContent = "✏️"; rename.title = "이름 변경";
    rename.addEventListener("click", (e) => { e.stopPropagation(); selectDrawLayer(layer.id); startLayerRename(li, layer); });

    const order = document.createElement("span");
    order.className = "draw-layer-order";
    const up = document.createElement("button");
    up.type = "button"; up.textContent = "▲"; up.title = "위로";
    up.disabled = index === d.layers.length - 1;
    up.addEventListener("click", (e) => { e.stopPropagation(); moveLayer(layer.id, 1); });
    const down = document.createElement("button");
    down.type = "button"; down.textContent = "▼"; down.title = "아래로";
    down.disabled = index === 0;
    down.addEventListener("click", (e) => { e.stopPropagation(); moveLayer(layer.id, -1); });
    order.append(up, down);

    const del = document.createElement("button");
    del.className = "draw-layer-del";
    del.type = "button"; del.textContent = "🗑"; del.title = "레이어 삭제";
    del.addEventListener("click", (e) => { e.stopPropagation(); removeLayer(layer.id); });

    li.append(vis, lock, name, rename, order, del);
    // 선택은 목록을 다시 그리지 않고 active 클래스만 갱신한다(재렌더 시 더블클릭 이름변경이 씹히던 문제 방지).
    li.addEventListener("click", () => selectDrawLayer(layer.id));
    list.appendChild(li);
  });
}

// 레이어 선택(경량): DOM을 새로 만들지 않고 활성 표시만 바꾼다.
function selectDrawLayer(layerId) {
  const d = state.draw;
  if (!d) return;
  d.activeLayerId = layerId;
  d.transform = null;
  for (const li of dom.drawLayerList?.querySelectorAll(".draw-layer-item") || []) {
    li.classList.toggle("active", li.dataset.layerId === layerId);
  }
  renderDrawOverlay();
}

function startLayerRename(li, layer) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = layer.name;
  input.className = "draw-layer-name";
  input.style.minWidth = "0";
  const nameEl = li.querySelector(".draw-layer-name");
  li.replaceChild(input, nameEl);
  input.focus();
  input.select();
  const commit = () => {
    const newName = input.value.trim().slice(0, 40) || layer.name;
    layer.name = newName;
    sendSocket({ type: "draw:layer-update", roomId: state.draw.roomId, layerId: layer.id, name: newName });
    renderDrawLayers();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); renderDrawLayers(); }
  });
}

function addDrawLayer() {
  const d = state.draw;
  if (!d) return;
  const id = `L${Date.now().toString(36)}`;
  const layer = { id, name: `레이어 ${d.layers.length + 1}`, visible: true, locked: false, strokes: [], canvas: makeLayerCanvas(d), ctx: null };
  layer.ctx = layer.canvas.getContext("2d");
  d.layers.push(layer);
  d.activeLayerId = id;
  renderDrawLayers();
  compositeDraw();
  sendSocket({ type: "draw:layer-add", roomId: d.roomId, layer: { id, name: layer.name } });
}

function removeLayer(layerId) {
  const d = state.draw;
  if (!d) return;
  if (d.layers.length <= 1) { setDrawStatus("최소 한 개의 레이어가 필요합니다", "bad"); return; }
  const layer = findDrawLayer(layerId);
  if (!layer) return;
  if (!confirm(`'${layer.name}' 레이어를 삭제할까요?`)) return;
  applyLayerRemoval(layerId);
  sendSocket({ type: "draw:layer-remove", roomId: d.roomId, layerId });
}

function applyLayerRemoval(layerId) {
  const d = state.draw;
  d.layers = d.layers.filter((l) => l.id !== layerId);
  d.myStrokes = d.myStrokes.filter((e) => e.layerId !== layerId);
  if (d.activeLayerId === layerId) d.activeLayerId = d.layers[d.layers.length - 1]?.id || "";
  renderDrawLayers();
  compositeDraw();
}

function toggleLayerVisible(layerId) {
  const d = state.draw;
  const layer = findDrawLayer(layerId);
  if (!layer) return;
  layer.visible = !layer.visible;
  renderDrawLayers();
  compositeDraw();
  sendSocket({ type: "draw:layer-update", roomId: d.roomId, layerId, visible: layer.visible });
}

function toggleLayerLock(layerId) {
  const d = state.draw;
  const layer = findDrawLayer(layerId);
  if (!layer) return;
  layer.locked = !layer.locked;
  if (layer.locked && d.transform && d.transform.layerId === layerId) d.transform = null;
  renderDrawLayers();
  renderDrawOverlay();
  sendSocket({ type: "draw:layer-update", roomId: d.roomId, layerId, locked: layer.locked });
}

// dir=+1 위로(배열 뒤로, 위에 표시), -1 아래로.
function moveLayer(layerId, dir) {
  const d = state.draw;
  const i = d.layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.layers.length) return;
  const [layer] = d.layers.splice(i, 1);
  d.layers.splice(j, 0, layer);
  renderDrawLayers();
  compositeDraw();
  sendSocket({ type: "draw:layer-reorder", roomId: d.roomId, order: d.layers.map((l) => l.id) });
}

// ── 캔버스 크기 조절 ──
function closeDrawMore() {
  if (!dom.drawMoreMenu) return;
  dom.drawMoreMenu.hidden = true;
  dom.drawMoreBtn?.parentElement?.classList.remove("open");
  dom.drawMoreBtn?.setAttribute("aria-expanded", "false");
}
function toggleDrawMore() {
  if (!dom.drawMoreMenu) return;
  const willOpen = dom.drawMoreMenu.hidden;
  dom.drawMoreMenu.hidden = !willOpen;
  dom.drawMoreBtn?.parentElement?.classList.toggle("open", willOpen);
  dom.drawMoreBtn?.setAttribute("aria-expanded", willOpen ? "true" : "false");
  if (willOpen && dom.drawResizePop) dom.drawResizePop.hidden = true;
}

function toggleResizePop() {
  const d = state.draw;
  const pop = dom.drawResizePop;
  if (!d || !pop) return;
  if (pop.hidden) {
    if (dom.drawResizeW) dom.drawResizeW.value = d.width;
    if (dom.drawResizeH) dom.drawResizeH.value = d.height;
    pop.hidden = false;
    dom.drawResizeW?.focus();
  } else {
    pop.hidden = true;
  }
}

function applyResize() {
  const d = state.draw;
  if (!d) return;
  const w = Math.max(200, Math.min(4000, Math.round(Number(dom.drawResizeW?.value) || d.width)));
  const h = Math.max(200, Math.min(4000, Math.round(Number(dom.drawResizeH?.value) || d.height)));
  d.width = w; d.height = h;
  applyCanvasSize();
  for (const layer of d.layers) renderLayer(layer);
  compositeDraw();
  if (dom.drawResizePop) dom.drawResizePop.hidden = true;
  sendSocket({ type: "draw:resize", roomId: d.roomId, width: w, height: h });
}

// ── 서버 이벤트 처리 ──
function handleDrawSocketMessage(message) {
  const d = state.draw;
  if (!d || message.roomId !== d.roomId) return;
  switch (message.type) {
    case "draw:state": {
      buildDrawFromDoc(message.doc || {});
      d.cursors.clear();
      if (Array.isArray(message.cursors)) {
        for (const c of message.cursors) if (c.clientId !== state.clientId) d.cursors.set(c.clientId, { ...c, trail: [] });
      }
      d.loaded = true;
      renderDrawOverlay();
      setDrawStatus(d.writable ? "" : "읽기 전용 — 대표자만 그릴 수 있어요", d.writable ? "" : "muted");
      break;
    }
    case "draw:stroke": {
      const layer = findDrawLayer(message.layerId);
      if (!layer) return;
      layer.strokes.push(message.stroke);
      paintStroke(layer.ctx, message.stroke);
      compositeDraw();
      break;
    }
    case "draw:remove": {
      for (const layer of d.layers) {
        const before = layer.strokes.length;
        layer.strokes = layer.strokes.filter((s) => s.id !== message.strokeId);
        if (layer.strokes.length !== before) { renderLayer(layer); compositeDraw(); break; }
      }
      d.myStrokes = d.myStrokes.filter((e) => e.strokeId !== message.strokeId);
      break;
    }
    case "draw:clear": {
      if (message.layerId === "*") {
        for (const layer of d.layers) { layer.strokes = []; renderLayer(layer); }
      } else {
        const layer = findDrawLayer(message.layerId);
        if (layer) { layer.strokes = []; renderLayer(layer); }
      }
      compositeDraw();
      break;
    }
    case "draw:resize": {
      d.width = message.width || d.width;
      d.height = message.height || d.height;
      applyCanvasSize();
      for (const layer of d.layers) renderLayer(layer);
      compositeDraw();
      break;
    }
    case "draw:layer-add": {
      if (findDrawLayer(message.layer.id)) return;
      const raw = message.layer;
      const layer = { id: raw.id, name: raw.name || "레이어", visible: true, locked: false, strokes: [], canvas: makeLayerCanvas(d), ctx: null };
      layer.ctx = layer.canvas.getContext("2d");
      d.layers.push(layer);
      renderDrawLayers();
      compositeDraw();
      break;
    }
    case "draw:layer-remove": {
      applyLayerRemoval(message.layerId);
      break;
    }
    case "draw:layer-update": {
      const layer = findDrawLayer(message.layerId);
      if (!layer) return;
      if (typeof message.visible === "boolean") layer.visible = message.visible;
      if (typeof message.locked === "boolean") layer.locked = message.locked;
      if (typeof message.name === "string") layer.name = message.name;
      renderDrawLayers();
      compositeDraw();
      break;
    }
    case "draw:layer-replace": {
      const layer = findDrawLayer(message.layerId);
      if (!layer) return;
      layer.strokes = Array.isArray(message.strokes) ? message.strokes.slice() : [];
      d.myStrokes = d.myStrokes.filter((e) => e.layerId !== layer.id);
      if (d.transform && d.transform.layerId === layer.id) d.transform = null; // 남의 변형이 확정되면 내 세션 폐기
      renderLayer(layer);
      compositeDraw();
      break;
    }
    case "draw:cursor": {
      if (message.clientId === state.clientId) break;
      let cur = d.cursors.get(message.clientId);
      if (!cur) { cur = { clientId: message.clientId, trail: [] }; d.cursors.set(message.clientId, cur); }
      const wasDrawing = cur.drawing;
      cur.name = message.name;
      cur.x = message.x;
      cur.y = message.y;
      cur.tool = message.tool;
      cur.color = message.color;
      cur.size = message.size;
      cur.active = message.active !== false;
      cur.drawing = Boolean(message.drawing);
      if (cur.drawing && cur.tool !== "eraser") {
        if (!wasDrawing) cur.trail = [];
        cur.trail.push([message.x, message.y]);
        if (cur.trail.length > 600) cur.trail.shift();
      } else {
        cur.trail = [];
      }
      renderDrawOverlay();
      break;
    }
    case "draw:cursor-leave": {
      if (d.cursors.delete(message.clientId)) renderDrawOverlay();
      break;
    }
    case "draw:layer-reorder": {
      const order = message.order || [];
      const map = new Map(d.layers.map((l) => [l.id, l]));
      const reordered = [];
      for (const id of order) if (map.has(id)) { reordered.push(map.get(id)); map.delete(id); }
      for (const l of map.values()) reordered.push(l);
      if (reordered.length === d.layers.length) d.layers = reordered;
      renderDrawLayers();
      compositeDraw();
      break;
    }
    default:
      break;
  }
}

function setDrawTool(tool) {
  const d = state.draw;
  const t = ["pen", "eraser", "fill", "move"].includes(tool) ? tool : "pen";
  if (d) {
    d.tool = t;
    if (t !== "move") d.transform = null; // 이동 도구를 벗어나면 변형 세션 종료
  }
  dom.drawToolPen?.classList.toggle("active", t === "pen");
  dom.drawToolEraser?.classList.toggle("active", t === "eraser");
  dom.drawToolFill?.classList.toggle("active", t === "fill");
  dom.drawToolMove?.classList.toggle("active", t === "move");
  updateDrawCanvasCursor();
  renderDrawOverlay();
}

function updateDrawCanvasCursor() {
  const c = dom.drawCanvas;
  if (!c) return;
  c.classList.remove("tool-pen", "tool-eraser", "tool-fill", "tool-move");
  c.classList.add("tool-" + (state.draw?.tool || "pen"));
}

function bindDrawEvents() {
  const canvas = dom.drawCanvas;
  if (canvas) {
    canvas.addEventListener("pointerdown", onDrawPointerDown);
    canvas.addEventListener("pointermove", onDrawPointerMove);
    canvas.addEventListener("pointerup", onDrawPointerUp);
    canvas.addEventListener("pointercancel", onDrawPointerUp);
    canvas.addEventListener("pointerleave", (e) => {
      const d = state.draw;
      if (!d) return;
      if (d.drawing) onDrawPointerUp(e);
      if (d.hoverPt) { d.hoverPt = null; sendSocket({ type: "draw:cursor-leave", roomId: d.roomId }); renderDrawOverlay(); }
    });
  }
  dom.drawToolPen?.addEventListener("click", () => setDrawTool("pen"));
  dom.drawToolEraser?.addEventListener("click", () => setDrawTool("eraser"));
  dom.drawToolFill?.addEventListener("click", () => setDrawTool("fill"));
  dom.drawToolMove?.addEventListener("click", () => setDrawTool("move"));
  dom.drawColor?.addEventListener("input", (e) => { if (state.draw) state.draw.color = e.target.value; });
  dom.drawSize?.addEventListener("input", (e) => {
    const v = Number(e.target.value) || 1;
    if (state.draw) state.draw.size = v;
    if (dom.drawSizeVal) dom.drawSizeVal.textContent = String(v);
    renderDrawOverlay();
  });
  dom.drawZoomIn?.addEventListener("click", () => zoomStep(1));
  dom.drawZoomOut?.addEventListener("click", () => zoomStep(-1));
  dom.drawZoomReset?.addEventListener("click", () => setDrawZoom(1));
  dom.drawUndo?.addEventListener("click", undoMyLastStroke);
  dom.drawClear?.addEventListener("click", clearActiveLayer);
  dom.drawResize?.addEventListener("click", () => { closeDrawMore(); toggleResizePop(); });
  dom.drawResizeApply?.addEventListener("click", applyResize);
  dom.drawSaveCanvas?.addEventListener("click", () => { closeDrawMore(); saveCanvasPng(); });
  dom.drawSaveLayer?.addEventListener("click", () => { closeDrawMore(); saveLayerPng(); });
  dom.drawCopyCanvas?.addEventListener("click", () => { closeDrawMore(); copyCanvasImage(); });
  dom.drawMoreBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleDrawMore(); });
  document.addEventListener("click", (e) => {
    if (dom.drawMoreMenu && !dom.drawMoreMenu.hidden && !e.target.closest(".draw-more-wrap")) closeDrawMore();
  });
  dom.drawLayerAdd?.addEventListener("click", addDrawLayer);
  // 캔버스 크기를 마우스로 직접 조절하는 손잡이
  document.querySelectorAll(".draw-rz-handle").forEach((h) => {
    h.addEventListener("pointerdown", (e) => beginCanvasResize(e, h.dataset.drawRz || "se"));
  });
  // Ctrl+휠로 마우스 지점 기준 확대/축소
  dom.drawCanvasScroll?.addEventListener("wheel", (e) => {
    if (!state.draw || !document.body.classList.contains("draw-open")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
  }, { passive: false });
  document.addEventListener("paste", handleDrawPaste);
  document.addEventListener("keydown", onDrawKeyDown);
  document.addEventListener("keyup", onDrawKeyUp);
}

function drawTypingTarget(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

function onDrawKeyDown(e) {
  if (!state.draw || !document.body.classList.contains("draw-open")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoMyLastStroke(); return; }
  if (drawTypingTarget(e)) return;
  // 스페이스: 화면 이동(팬) 준비
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    if (!state.draw.spaceDown) {
      state.draw.spaceDown = true;
      dom.drawCanvasStage?.classList.add("space");
      dom.drawCanvasScroll?.classList.add("space");
    }
    return;
  }
  // 도구 단축키
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "b") setDrawTool("pen");
  else if (k === "e") setDrawTool("eraser");
  else if (k === "g") setDrawTool("fill");
  else if (k === "v") setDrawTool("move");
  else if (k === "=" || k === "+") { e.preventDefault(); zoomStep(1); }
  else if (k === "-" || k === "_") { e.preventDefault(); zoomStep(-1); }
  else if (k === "0") { e.preventDefault(); setDrawZoom(1); }
}

function onDrawKeyUp(e) {
  if (!state.draw) return;
  if (e.code === "Space" || e.key === " ") {
    state.draw.spaceDown = false;
    dom.drawCanvasStage?.classList.remove("space");
    dom.drawCanvasScroll?.classList.remove("space");
  }
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
  // 1) 코드펜스(``` 또는 ```lang)를 먼저 빼내 보호. 언어 태그가 있으면 구문 강조에 쓴다.
  const codeBlocks = [];
  let text = String(src || "").replace(
    /```([a-zA-Z0-9+#._-]*)[ \t]*\n([\s\S]*?)```|```([\s\S]*?)```/g,
    (m, lang, body, bare) => {
      if (body !== undefined) codeBlocks.push({ lang: (lang || "").toLowerCase(), code: body.replace(/\n$/, "") });
      else codeBlocks.push({ lang: "", code: (bare || "").replace(/^\n/, "").replace(/\n$/, "") });
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
      const blk = codeBlocks[Number(codeMatch[1])];
      const langTag = blk.lang ? `<span class="md-code-lang">${escapeHtmlText(blk.lang)}</span>` : "";
      html.push(`<pre class="md-code"${blk.lang ? ` data-lang="${escapeHtmlText(blk.lang)}"` : ""}>${langTag}<code>${highlightCode(blk.code, blk.lang)}</code></pre>`);
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
  // 글자 색: {색:#hex}내용{/색} → 색 span. 값은 #hex 또는 영문 색이름만 허용해 CSS 주입을 막는다.
  // 안쪽 내용은 이어지는 굵게/기울임 치환에도 계속 노출돼 서식이 함께 적용된다.
  out = out.replace(/\{색:(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})\}([\s\S]*?)\{\/색\}/g,
    (m, color, inner) => `<span style="color:${color}">${inner}</span>`);
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
  // 인원/읽기전용/방별권한은 대표자 전용. 방 이름 변경 권한만 있는 유저에겐 이름 필드만 보인다.
  const owner = isChannelOwner(found.channel);
  const isVoice = owner && found.room.type === "voice";
  const canReadOnly = owner && ["chat", "memo", "draw"].includes(found.room.type);
  if (dom.roomLimitField) dom.roomLimitField.hidden = !isVoice;
  if (dom.roomLimitInput) dom.roomLimitInput.value = String(found.room.limit || 8);
  if (dom.roomReadOnlyField) dom.roomReadOnlyField.hidden = !canReadOnly;
  if (dom.roomReadOnlyInput) dom.roomReadOnlyInput.checked = Boolean(found.room.readOnly);
  if (dom.roomPermsButton) dom.roomPermsButton.hidden = !owner;
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
  // 인원/읽기전용은 대표자만(서버도 재확인). 이름만 바꾸는 권한 유저는 여기서 건너뛴다.
  if (!isChannelOwner(found.channel)) { closeRoomRenameModal(); return; }
  if (found.room.type === "voice") {
    const limit = Math.max(1, Math.min(99, Math.floor(Number(dom.roomLimitInput.value) || 8)));
    if (limit !== (found.room.limit || 8)) {
      sendSocket({ type: "channel:set-room-limit", channelId: found.channel.id, roomId: roomRenameTargetId, limit });
    }
  } else if (["chat", "memo", "draw"].includes(found.room.type) && dom.roomReadOnlyInput) {
    const value = dom.roomReadOnlyInput.checked;
    if (value !== Boolean(found.room.readOnly)) {
      sendSocket({ type: "channel:set-room-readonly", channelId: found.channel.id, roomId: roomRenameTargetId, value });
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
  if (dom.channelRolesButton) dom.channelRolesButton.hidden = !owner; // 역할·권한은 대표만
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
    stopCallRuntimeTimer();
    return;
  }
  dom.currentRoomName.textContent = state.currentRoom.name;
  dom.currentRoomMeta.textContent = currentRoomMetaText();
  if (dom.roomLimitLiveSelect) dom.roomLimitLiveSelect.value = String(state.currentRoom.limit);
  startCallRuntimeTimer();
}

function currentRoomMetaText() {
  const r = state.currentRoom;
  if (!r) return "";
  const started = r.startedAt || state.roomsMeta?.[r.id]?.startedAt || 0;
  const runtime = started ? ` · 통화 ${formatDuration(Date.now() - started)}` : "";
  return `${r.count}/${r.limit}명${runtime}`;
}

// 통화 경과 시간을 1초마다 갱신한다(방에 있을 때만).
function startCallRuntimeTimer() {
  if (state.callRuntimeTimer) return;
  state.callRuntimeTimer = window.setInterval(() => {
    if (!state.currentRoom) { stopCallRuntimeTimer(); return; }
    dom.currentRoomMeta.textContent = currentRoomMetaText();
  }, 1000);
}

function stopCallRuntimeTimer() {
  if (state.callRuntimeTimer) { clearInterval(state.callRuntimeTimer); state.callRuntimeTimer = 0; }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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
    userId: state.auth.user?.id || "",
  });
  for (const peer of state.peers.values()) {
    appendParticipant({
      id: peer.id,
      name: peer.name,
      status: peer.remoteStatus?.mic?.muted ? `${peer.state} · 마이크 꺼짐` : peer.state,
      peer,
      userId: peer.userId || "",
    });
  }
  updateParticipantMeters();
}

function appendParticipant({ id, name, status, self = false, peer = null, userId = "" }) {
  const card = document.createElement("div");
  card.className = "participant-card";
  card.dataset.participantId = String(id);
  const title = document.createElement("strong");
  title.textContent = name;
  if (userId) {
    title.classList.add("profile-link");
    title.dataset.profileUser = userId;
    title.title = "프로필 보기";
  }
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
    // 대표자에게만 보이는 강제 음소거 / 내보내기(다른 대표자에겐 숨김).
    if (canModerateCall() && !isPeerCallOwner(peer)) {
      const mod = document.createElement("div");
      mod.className = "participant-mod";
      const muteBtn = document.createElement("button");
      muteBtn.type = "button";
      muteBtn.className = "participant-mod-btn";
      muteBtn.dataset.modAction = "force-mute";
      muteBtn.dataset.modPeerId = peer.id;
      muteBtn.textContent = "음소거";
      const kickBtn = document.createElement("button");
      kickBtn.type = "button";
      kickBtn.className = "participant-mod-btn danger";
      kickBtn.dataset.modAction = "kick";
      kickBtn.dataset.modPeerId = peer.id;
      kickBtn.textContent = "내보내기";
      mod.append(muteBtn, kickBtn);
      card.append(mod);
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

// 현재 통화가 속한 채널(권한 판단용). state.currentChannelId 가 아니라 통화방 채널을 쓴다.
function currentCallChannel() {
  const id = state.currentRoom?.channelId;
  return id ? state.channels.find((c) => c.id === id) || null : null;
}

function canModerateCall() {
  return isChannelOwner(currentCallChannel());
}

function isPeerCallOwner(peer) {
  const ch = currentCallChannel();
  if (!ch || !peer?.userId) return false;
  return ch.ownerId === peer.userId || (ch.managerIds || []).includes(peer.userId);
}

function handleCallModeration(action, peerId) {
  if (!state.currentRoom || !peerId) return;
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (action === "force-mute") {
    sendSocket({ type: "room:force-mute", roomId: state.currentRoom.id, targetId: peerId });
    setMessage(`${peer.name}님을 음소거했습니다.`);
  } else if (action === "kick") {
    if (!confirm(`${peer.name}님을 통화방에서 내보낼까요?`)) return;
    sendSocket({ type: "room:kick-user", roomId: state.currentRoom.id, targetId: peerId });
  }
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
  // 통화방 권한(발언·소리공유·화면공유). 대표/관리자는 항상 전권.
  const rp = inRoom ? currentRoomPerms() : null;
  const denyVoice = Boolean(rp) && !rp.owner && rp.voice === false;
  const denySound = Boolean(rp) && !rp.owner && rp.sound === false;
  const denyScreen = Boolean(rp) && !rp.owner && rp.screen === false;
  // 발언 금지 시 강제 음소거, 듣기 금지 시 원격 오디오 음소거.
  if (denyVoice && !state.muted) {
    state.muted = true;
    applyMicTrackEnabled();
  }
  applyListenBlock(denyVoice);
  dom.leaveButton.disabled = !inRoom;
  dom.muteButton.disabled = !inRoom || !state.rawMicTrack || denyVoice;
  dom.muteButton.title = denyVoice ? "이 통화방에서 마이크·스피커 권한이 없습니다." : "";
  dom.repairAudioButton.disabled = !inRoom || !state.rawMicTrack || state.applyingSettings;
  dom.muteButton.textContent = state.muted ? "마이크 켜기" : "마이크 끄기";
  dom.systemAudioAction.hidden = !canShareSystem || denySound;
  dom.systemAudioToggle.disabled = !canShareSystem || state.applyingSettings || denySound;
  dom.systemAudioToggle.checked = state.systemSharing || (!inRoom && dom.systemAudioToggle.checked);
  if (!canShareSystem || denySound) dom.systemAudioToggle.checked = false;
  dom.screenShareButton.hidden = !canSendScreen || denyScreen;
  dom.screenSharePanel.hidden = !canSendScreen || denyScreen;
  dom.screenShareButton.disabled = !canSendScreen || !inRoom || state.applyingSettings || denyScreen;
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
    `Accord server=${state.config.version || "-"} client=${getClientVersion()}`,
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
