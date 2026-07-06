const isDesktop = Boolean(window.voiceDesktop?.isDesktop);

const state = {
  serverUrl: "",
  config: { publicUrl: "", iceServers: [], maxRoomLimit: 8 },
  socket: null,
  clientId: "",
  rooms: [],
  currentRoom: null,
  localStream: null,
  micStream: null,
  micProcessedStream: null,
  micTrack: null,
  systemStream: null,
  systemTrack: null,
  audioContext: null,
  micGainNode: null,
  micFilterNode: null,
  micCompressorNode: null,
  peers: new Map(),
  localMeterStop: null,
  remoteMeterStop: null,
  muted: false,
  systemSharing: false,
  statsTimer: 0,
  previousStats: new Map(),
  isApplyingAudioSettings: false,
};

const dom = {
  serverInput: document.querySelector("#serverInput"),
  nameInput: document.querySelector("#nameInput"),
  connectButton: document.querySelector("#connectButton"),
  createRoomForm: document.querySelector("#createRoomForm"),
  roomNameInput: document.querySelector("#roomNameInput"),
  roomLimitInput: document.querySelector("#roomLimitInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  refreshRoomsButton: document.querySelector("#refreshRoomsButton"),
  roomList: document.querySelector("#roomList"),
  currentRoomName: document.querySelector("#currentRoomName"),
  currentRoomMeta: document.querySelector("#currentRoomMeta"),
  inputDeviceSelect: document.querySelector("#inputDeviceSelect"),
  outputDeviceSelect: document.querySelector("#outputDeviceSelect"),
  micGainInput: document.querySelector("#micGainInput"),
  micGainValue: document.querySelector("#micGainValue"),
  refreshDevicesButton: document.querySelector("#refreshDevicesButton"),
  noiseSuppressionToggle: document.querySelector("#noiseSuppressionToggle"),
  echoCancellationToggle: document.querySelector("#echoCancellationToggle"),
  autoGainToggle: document.querySelector("#autoGainToggle"),
  systemAudioToggle: document.querySelector("#systemAudioToggle"),
  lowLatencyToggle: document.querySelector("#lowLatencyToggle"),
  highQualityToggle: document.querySelector("#highQualityToggle"),
  remoteMicVolumeInput: document.querySelector("#remoteMicVolumeInput"),
  remoteMicVolumeValue: document.querySelector("#remoteMicVolumeValue"),
  remoteSystemVolumeInput: document.querySelector("#remoteSystemVolumeInput"),
  remoteSystemVolumeValue: document.querySelector("#remoteSystemVolumeValue"),
  muteButton: document.querySelector("#muteButton"),
  leaveButton: document.querySelector("#leaveButton"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  localState: document.querySelector("#localState"),
  remoteState: document.querySelector("#remoteState"),
  localMeter: document.querySelector("#localMeter span"),
  remoteMeter: document.querySelector("#remoteMeter span"),
  participantList: document.querySelector("#participantList"),
  message: document.querySelector("#message"),
  localAudio: document.querySelector("#localAudio"),
  remoteAudios: document.querySelector("#remoteAudios"),
  statSend: document.querySelector("#statSend"),
  statReceive: document.querySelector("#statReceive"),
  statRtt: document.querySelector("#statRtt"),
  statJitter: document.querySelector("#statJitter"),
  statLoss: document.querySelector("#statLoss"),
  statCodec: document.querySelector("#statCodec"),
  statSampleRate: document.querySelector("#statSampleRate"),
  statChannels: document.querySelector("#statChannels"),
};

init();

async function init() {
  state.serverUrl = getSavedServerUrl();
  dom.serverInput.value = state.serverUrl;
  dom.nameInput.value = localStorage.getItem("voiceChatName") || makeDefaultName();
  dom.roomNameInput.value = "통화방";

  bindEvents();
  updateSystemAudioAvailability();
  applyMicGain();
  applyRemoteVolumes();
  updateCallControls();
  renderRooms();
  renderParticipants();
  await refreshDevices();

  if (!isDesktop && !window.isSecureContext) {
    setStatus("HTTPS 필요", "bad");
    setMessage("브라우저에서는 HTTPS 주소로 접속해야 마이크를 사용할 수 있습니다.");
  } else {
    setStatus("대기", "idle");
  }
}

function bindEvents() {
  dom.connectButton.addEventListener("click", () => connectToServer());
  dom.refreshRoomsButton.addEventListener("click", () => sendSocket({ type: "list-rooms" }));
  dom.refreshDevicesButton.addEventListener("click", () => refreshDevices());

  dom.nameInput.addEventListener("change", () => {
    localStorage.setItem("voiceChatName", getUserName());
    sendSocket({ type: "set-name", userName: getUserName() });
  });

  dom.serverInput.addEventListener("change", () => {
    state.serverUrl = normalizeServerUrl(dom.serverInput.value);
    dom.serverInput.value = state.serverUrl;
    localStorage.setItem("voiceChatServerUrl", state.serverUrl);
  });

  dom.createRoomForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createRoom();
  });

  dom.leaveButton.addEventListener("click", () => leaveRoom("방에서 나갔습니다."));
  dom.muteButton.addEventListener("click", toggleMute);
  dom.systemAudioToggle.addEventListener("change", handleSystemAudioToggle);
  dom.inputDeviceSelect.addEventListener("change", () => applyAudioSettings({ restartMic: true }));
  dom.outputDeviceSelect.addEventListener("change", applyOutputDevice);
  dom.micGainInput.addEventListener("input", applyMicGain);
  dom.remoteMicVolumeInput.addEventListener("input", applyRemoteVolumes);
  dom.remoteSystemVolumeInput.addEventListener("input", applyRemoteVolumes);

  for (const toggle of [
    dom.noiseSuppressionToggle,
    dom.echoCancellationToggle,
    dom.autoGainToggle,
    dom.lowLatencyToggle,
    dom.highQualityToggle,
  ]) {
    toggle.addEventListener("change", () => {
      applyAudioSettings({
        restartMic: true,
        renegotiate: toggle === dom.lowLatencyToggle || toggle === dom.highQualityToggle,
      });
    });
  }
}

async function connectToServer() {
  const serverUrl = normalizeServerUrl(dom.serverInput.value);
  if (!serverUrl) {
    setMessage("서버 주소를 입력해 주세요.");
    return;
  }

  stopSocket();
  resetRoomState();

  state.serverUrl = serverUrl;
  dom.serverInput.value = serverUrl;
  localStorage.setItem("voiceChatServerUrl", serverUrl);

  setBusy(true);
  setStatus("연결 중", "idle");
  setMessage("");

  try {
    const configResponse = await fetch(`${serverUrl}/config`, { cache: "no-store" });
    state.config = await configResponse.json();
    dom.roomLimitInput.max = String(state.config.maxRoomLimit || 8);
    await openSocket(serverUrl);
    sendSocket({ type: "set-name", userName: getUserName() });
    setStatus("서버 연결", "good");
    setMessage("서버에 연결되었습니다.");
  } catch (error) {
    setStatus("연결 실패", "bad");
    setMessage(error.message || "서버에 연결하지 못했습니다.");
    stopSocket();
  } finally {
    setBusy(false);
  }
}

function openSocket(serverUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/signal";
    url.search = "";

    state.socket = new WebSocket(url.toString());
    const failTimer = window.setTimeout(() => {
      reject(new Error("시그널링 서버에 연결하지 못했습니다."));
    }, 6000);

    state.socket.addEventListener("open", () => {
      window.clearTimeout(failTimer);
      resolve();
    });

    state.socket.addEventListener("message", (event) => {
      handleSocketMessage(JSON.parse(event.data)).catch((error) => {
        setStatus("오류", "bad");
        setMessage(error.message || "연결 처리 중 오류가 발생했습니다.");
      });
    });

    state.socket.addEventListener("close", (event) => {
      if (event.currentTarget.shouldIgnoreClose) return;
      setStatus("서버 끊김", "bad");
      setMessage("서버와 연결이 끊겼습니다.");
      resetRoomState();
      updateCallControls();
    });

    state.socket.addEventListener("error", () => {
      reject(new Error("서버 주소 또는 인증서 허용 상태를 확인해 주세요."));
    });
  });
}

async function handleSocketMessage(message) {
  if (message.type === "hello") {
    state.clientId = message.id;
    state.rooms = message.rooms || [];
    renderRooms();
    return;
  }

  if (message.type === "rooms") {
    state.rooms = message.rooms || [];
    renderRooms();
    updateCurrentRoomFromList();
    return;
  }

  if (message.type === "joined") {
    state.clientId = message.id || state.clientId;
    state.currentRoom = message.room;
    setStatus("통화 중", "good");
    setMessage(`${message.room.name}에 들어왔습니다.`);
    updateCallControls();
    renderCurrentRoom();
    renderParticipants();
    startStatsTimer();

    for (const peer of message.peers || []) {
      await createOfferForPeer(peer);
    }
    return;
  }

  if (message.type === "peer-joined") {
    state.currentRoom = message.room || state.currentRoom;
    ensurePeer(message.peer.id, message.peer.name);
    renderCurrentRoom();
    renderParticipants();
    setMessage(`${message.peer.name}님이 들어왔습니다.`);
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
    state.rooms = message.rooms || state.rooms;
    resetRoomState();
    renderRooms();
    return;
  }

  if (message.type === "signal") {
    await handleSignal(message.from, message.data);
    return;
  }

  if (message.type === "error") {
    setStatus("오류", "bad");
    setMessage(message.message || "서버 오류가 발생했습니다.");
    if (!state.currentRoom) stopLocalMedia();
  }
}

async function createRoom() {
  if (!await ensureServerConnected()) return;

  const name = dom.roomNameInput.value.trim() || "통화방";
  const limit = Number(dom.roomLimitInput.value || 2);
  if (!await prepareForRoom()) return;

  sendSocket({
    type: "create-room",
    name,
    limit,
    userName: getUserName(),
  });
}

async function joinRoom(roomId) {
  if (!await ensureServerConnected()) return;
  if (!await prepareForRoom()) return;

  sendSocket({
    type: "join-room",
    roomId,
    userName: getUserName(),
  });
}

async function ensureServerConnected() {
  if (state.socket?.readyState === WebSocket.OPEN) return true;
  await connectToServer();
  return state.socket?.readyState === WebSocket.OPEN;
}

async function prepareForRoom() {
  leaveRoom("", false);

  try {
    await openLocalMedia();
    return true;
  } catch (error) {
    setStatus("마이크 실패", "bad");
    setMessage(`방에 들어가지 못했습니다. ${describeMediaError(error)}`);
    stopLocalMedia();
    return false;
  }
}

async function openLocalMedia() {
  stopLocalMedia();

  const micTrack = await openMicTrack();
  if (!micTrack) {
    throw new Error("사용 가능한 마이크 트랙이 없습니다.");
  }
  state.micTrack = micTrack;

  if (dom.systemAudioToggle.checked && isSystemAudioSupported()) {
    try {
      const systemTrack = await openSystemAudioTrack();
      if (systemTrack) {
        state.systemTrack = systemTrack;
        state.systemSharing = true;
      }
    } catch (error) {
      dom.systemAudioToggle.checked = false;
      setMessage(error.message || "컴퓨터 사운드 공유 없이 마이크만 사용합니다.");
    }
  }

  rebuildLocalStream();
  dom.localAudio.srcObject = state.localStream;
  dom.localState.textContent = getLocalStateText();
  startLocalMeter();
  updateTrackStats();
  await refreshDevices();
}

async function openMicTrack() {
  const deviceId = dom.inputDeviceSelect.value;
  const constraints = {
    channelCount: { ideal: dom.highQualityToggle.checked ? 2 : 1 },
    sampleRate: { ideal: 48000 },
    latency: { ideal: dom.lowLatencyToggle.checked ? 0.01 : 0.04 },
    echoCancellation: dom.echoCancellationToggle.checked,
    noiseSuppression: dom.noiseSuppressionToggle.checked,
    autoGainControl: dom.autoGainToggle.checked,
  };

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  state.micStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: constraints,
  });

  const [track] = state.micStream.getAudioTracks();
  if (track) {
    track.contentHint = "speech";
  }
  return track ? createBoostedMicTrack() : null;
}

function createBoostedMicTrack() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return state.micStream.getAudioTracks()[0] || null;
  }

  try {
    state.audioContext = new AudioContext({
      latencyHint: dom.lowLatencyToggle.checked ? "interactive" : "balanced",
      sampleRate: 48000,
    });
  } catch {
    state.audioContext = new AudioContext({
      latencyHint: dom.lowLatencyToggle.checked ? "interactive" : "balanced",
    });
  }

  const destination = state.audioContext.createMediaStreamDestination();

  const source = state.audioContext.createMediaStreamSource(state.micStream);
  const gain = state.audioContext.createGain();
  let inputNode = source;

  if (dom.noiseSuppressionToggle.checked) {
    const highpass = state.audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;

    const compressor = state.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -42;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.16;

    inputNode.connect(highpass);
    highpass.connect(compressor);
    inputNode = compressor;
    state.micFilterNode = highpass;
    state.micCompressorNode = compressor;
  }

  inputNode.connect(gain);
  gain.connect(destination);

  state.micGainNode = gain;
  state.micProcessedStream = destination.stream;
  applyMicGain();
  state.audioContext.resume().catch(() => {});

  const [track] = destination.stream.getAudioTracks();
  if (track) {
    track.contentHint = "speech";
  }
  return track || null;
}

function rebuildLocalStream() {
  const tracks = [];
  if (state.micTrack) tracks.push(state.micTrack);
  if (state.systemTrack) tracks.push(state.systemTrack);
  state.localStream = new MediaStream(tracks);
}

async function openSystemAudioTrack() {
  if (!isSystemAudioSupported()) {
    throw new Error("macOS는 이 방식의 컴퓨터 사운드 공유를 지원하지 않습니다. BlackHole 같은 가상 오디오 장치를 입력 장치로 선택해 주세요.");
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("현재 환경에서는 컴퓨터 사운드 공유를 지원하지 않습니다.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("컴퓨터 사운드 트랙을 가져오지 못했습니다.");
  }

  track.contentHint = "music";
  track.addEventListener("ended", () => {
    if (!state.systemSharing) return;
    handleSystemAudioEnded();
  });
  state.systemStream = stream;
  return track;
}

function createPeer(peerId, peerName) {
  const pc = new RTCPeerConnection({
    iceServers: state.config.iceServers || [],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });

  const peer = {
    id: peerId,
    name: peerName || "Guest",
    pc,
    stream: new MediaStream(),
    micSender: null,
    systemSender: null,
    remoteAudioCount: 0,
    remoteMic: null,
    remoteSystem: null,
    pendingCandidates: [],
    state: "연결 중",
  };

  if (state.micTrack) {
    peer.micSender = pc.addTrack(state.micTrack, new MediaStream([state.micTrack]));
    tuneSender(peer.micSender, "mic");
  }

  if (state.systemTrack) {
    peer.systemSender = pc.addTrack(state.systemTrack, new MediaStream([state.systemTrack]));
    tuneSender(peer.systemSender, "system");
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, { candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    for (const receiver of pc.getReceivers()) {
      if (receiver.track?.kind === "audio" && "jitterBufferTarget" in receiver) {
        try {
          receiver.jitterBufferTarget = dom.lowLatencyToggle.checked ? 0.01 : 0.03;
        } catch {
          // Some runtimes expose the property but do not allow changing it.
        }
      }
    }

    const track = event.track;
    if (track?.kind === "audio" && !peer.stream.getTracks().some((item) => item.id === track.id)) {
      peer.stream.addTrack(track);
      const trackRole = peer.remoteAudioCount === 0 ? "mic" : "system";
      peer.remoteAudioCount += 1;
      setupRemoteAudio(peer, track, trackRole);
    }
    peer.state = "연결됨";
    dom.remoteState.textContent = "연결됨";
    startRemoteMeter();
    renderParticipants();
  };

  pc.onconnectionstatechange = () => {
    const current = pc.connectionState;
    if (current === "connected") {
      peer.state = "연결됨";
      setStatus("통화 중", "good");
    } else if (current === "failed") {
      peer.state = "실패";
      setStatus("연결 실패", "bad");
    } else if (current === "disconnected") {
      peer.state = "끊김";
    } else {
      peer.state = "연결 중";
    }
    renderParticipants();
  };

  state.peers.set(peerId, peer);
  renderParticipants();
  return peer;
}

function setupRemoteAudio(peer, track, role) {
  const key = role === "system" ? "remoteSystem" : "remoteMic";
  const previous = peer[key];
  if (previous) {
    cleanupRemotePlayback(previous);
  }

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.dataset.peerId = peer.id;
  audio.dataset.role = role;

  const sourceStream = new MediaStream([track]);
  audio.srcObject = sourceStream;
  peer[key] = {
    audio,
    role,
    track,
    sourceStream,
    usingBoost: false,
    boost: null,
  };

  track.addEventListener("ended", () => {
    cleanupRemotePlayback(peer[key]);
    peer[key] = null;
    if (role === "mic") {
      dom.remoteState.textContent = "대기";
      dom.remoteMeter.style.setProperty("--level", "0%");
    }
  });

  dom.remoteAudios.append(audio);
  applyRemotePlaybackVolume(peer[key]);
  applySinkToAudio(audio);
  audio.play().catch(() => {});
}

function createBoostedRemotePlayback(track) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;

  try {
    const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const gainNode = context.createGain();
    const destination = context.createMediaStreamDestination();

    source.connect(gainNode);
    gainNode.connect(destination);
    context.resume().catch(() => {});

    return {
      context,
      source,
      gainNode,
      stream: destination.stream,
    };
  } catch {
    return null;
  }
}

function cleanupRemotePlayback(playback) {
  playback?.audio?.remove();
  playback?.boost?.source?.disconnect?.();
  playback?.boost?.gainNode?.disconnect?.();
  playback?.boost?.context?.close?.().catch(() => {});
}

function ensurePeer(peerId, peerName) {
  if (state.peers.has(peerId)) {
    const peer = state.peers.get(peerId);
    peer.name = peerName || peer.name;
    return peer;
  }
  return createPeer(peerId, peerName);
}

async function createOfferForPeer(peerInfo) {
  const peer = ensurePeer(peerInfo.id, peerInfo.name);
  const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
  offer.sdp = tuneOpus(offer.sdp);
  await peer.pc.setLocalDescription(offer);
  sendSignal(peer.id, { description: peer.pc.localDescription });
}

async function handleSignal(peerId, data) {
  if (!data || !peerId) return;
  const peer = ensurePeer(peerId);

  if (data.description) {
    const description = new RTCSessionDescription(data.description);
    await peer.pc.setRemoteDescription(description);
    await flushPendingCandidates(peer);

    if (description.type === "offer") {
      const answer = await peer.pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp);
      await peer.pc.setLocalDescription(answer);
      sendSignal(peer.id, { description: peer.pc.localDescription });
    }
  }

  if (data.candidate) {
    const candidate = new RTCIceCandidate(data.candidate);
    if (peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      peer.pendingCandidates.push(candidate);
    }
  }
}

async function flushPendingCandidates(peer) {
  const candidates = peer.pendingCandidates.splice(0);
  for (const candidate of candidates) {
    await peer.pc.addIceCandidate(candidate).catch(() => {});
  }
}

function tuneSender(sender, role = "mic") {
  if (!sender.setParameters) return;

  const params = sender.getParameters();
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  const highQuality = dom.highQualityToggle.checked;
  params.encodings[0].maxBitrate = role === "system"
    ? highQuality ? 1024000 : 320000
    : highQuality ? 320000 : 128000;
  params.encodings[0].priority = "high";
  sender.setParameters(params).catch(() => {});
}

function tuneOpus(sdp) {
  const opusPayload = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)?.[1];
  if (!opusPayload) return sdp;

  const bitrate = dom.highQualityToggle.checked ? 510000 : 160000;
  const ptime = dom.lowLatencyToggle.checked ? 10 : 20;
  const maxptime = dom.lowLatencyToggle.checked ? 20 : 60;
  const stereo = dom.highQualityToggle.checked ? 1 : 0;
  const opusParams = [
    `minptime=${ptime}`,
    "useinbandfec=1",
    `stereo=${stereo}`,
    `sprop-stereo=${stereo}`,
    `maxaveragebitrate=${bitrate}`,
    "usedtx=0",
  ].join(";");

  const fmtpLine = new RegExp(`a=fmtp:${opusPayload} .+\\r\\n`);
  if (fmtpLine.test(sdp)) {
    sdp = sdp.replace(fmtpLine, (line) => `${line.trim()};${opusParams}\r\n`);
  } else {
    sdp = sdp.replace(
      new RegExp(`(a=rtpmap:${opusPayload} opus/48000/2\\r\\n)`, "i"),
      `$1a=fmtp:${opusPayload} ${opusParams}\r\n`,
    );
  }

  sdp = sdp.replace(/a=ptime:\d+\r\n/g, "");
  sdp = sdp.replace(/a=maxptime:\d+\r\n/g, "");
  sdp = sdp.replace(
    new RegExp(`(a=fmtp:${opusPayload} .+\\r\\n)`),
    `$1a=ptime:${ptime}\r\na=maxptime:${maxptime}\r\n`,
  );

  return sdp;
}

async function handleSystemAudioToggle() {
  if (!dom.systemAudioToggle.checked) {
    if (!state.currentRoom) {
      setMessage("");
      return;
    }
    await stopSystemAudio();
    setMessage("컴퓨터 사운드 공유를 껐습니다.");
    updateCallControls();
    renderParticipants();
    updateTrackStats();
    return;
  }

  if (!isSystemAudioSupported()) {
    dom.systemAudioToggle.checked = false;
    setMessage("macOS에서는 BlackHole 같은 가상 오디오 장치를 입력 장치로 선택해야 컴퓨터 소리를 보낼 수 있습니다.");
    return;
  }

  if (!state.currentRoom) {
    setMessage("방에 들어가면 컴퓨터 사운드 공유가 같이 켜집니다.");
    return;
  }

  await startSystemAudioShare();
}

async function startSystemAudioShare() {
  if (state.systemSharing) return;

  dom.systemAudioToggle.disabled = true;

  try {
    const track = await openSystemAudioTrack();
    if (!track || track.readyState === "ended") {
      throw new Error("컴퓨터 사운드 트랙이 바로 종료되었습니다.");
    }

    state.systemTrack = track;
    state.systemSharing = true;
    rebuildLocalStream();
    dom.localAudio.srcObject = state.localStream;
    await replaceSystemTrackForPeers(track);
    await renegotiatePeers();
    startLocalMeter();
    setMessage("컴퓨터 사운드 공유를 켰습니다.");
  } catch (error) {
    dom.systemAudioToggle.checked = false;
    await stopSystemAudio({ replaceSenders: true, updateMessage: false });
    setMessage(error.message || "컴퓨터 사운드를 공유하지 못했습니다.");
  } finally {
    updateCallControls();
    renderParticipants();
    updateTrackStats();
  }
}

async function handleSystemAudioEnded() {
  dom.systemAudioToggle.checked = false;
  await stopSystemAudio();
  updateCallControls();
  renderParticipants();
  updateTrackStats();
  setMessage("컴퓨터 사운드 공유가 종료되었습니다.");
}

async function replaceSystemTrackForPeers(track = state.systemTrack) {
  for (const peer of state.peers.values()) {
    if (!peer.systemSender && track) {
      peer.systemSender = peer.pc.addTrack(track, new MediaStream([track]));
    } else if (peer.systemSender) {
      await peer.systemSender.replaceTrack(track);
    }
    if (peer.systemSender) tuneSender(peer.systemSender, "system");
  }
}

async function removeSystemTrackFromPeers() {
  for (const peer of state.peers.values()) {
    if (!peer.systemSender) continue;
    peer.pc.removeTrack(peer.systemSender);
    peer.systemSender = null;
  }
}

async function renegotiatePeers() {
  for (const peer of state.peers.values()) {
    const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
    offer.sdp = tuneOpus(offer.sdp);
    await peer.pc.setLocalDescription(offer);
    sendSignal(peer.id, { description: peer.pc.localDescription });
  }
}

async function applyAudioSettings({ restartMic = false, renegotiate = false } = {}) {
  if (state.isApplyingAudioSettings) return;
  if (!state.currentRoom) {
    applyMicGain();
    return;
  }

  state.isApplyingAudioSettings = true;
  try {
    if (restartMic) {
      await replaceMicTrack();
    }

    for (const peer of state.peers.values()) {
      if (peer.micSender) tuneSender(peer.micSender, "mic");
      if (peer.systemSender) tuneSender(peer.systemSender, "system");
    }

    if (renegotiate) {
      await renegotiatePeers();
    }

    updateTrackStats();
    setMessage("오디오 설정을 적용했습니다.");
  } catch (error) {
    setMessage(error.message || "오디오 설정을 적용하지 못했습니다.");
  } finally {
    state.isApplyingAudioSettings = false;
    updateCallControls();
  }
}

async function replaceMicTrack() {
  stopMicOnly();
  const nextTrack = await openMicTrack();
  if (!nextTrack) {
    throw new Error("선택한 입력 장치를 열지 못했습니다.");
  }

  state.micTrack = nextTrack;
  state.micTrack.enabled = !state.muted;
  rebuildLocalStream();
  dom.localAudio.srcObject = state.localStream;

  for (const peer of state.peers.values()) {
    if (!peer.micSender) {
      peer.micSender = peer.pc.addTrack(state.micTrack, new MediaStream([state.micTrack]));
    } else {
      await peer.micSender.replaceTrack(state.micTrack);
    }
    tuneSender(peer.micSender, "mic");
  }

  applyMicGain();
  startLocalMeter();
  dom.localState.textContent = getLocalStateText();
}

function toggleMute() {
  state.muted = !state.muted;
  for (const track of state.micStream?.getAudioTracks() || []) {
    track.enabled = !state.muted;
  }
  if (state.micTrack) {
    state.micTrack.enabled = !state.muted;
  }
  applyMicGain();
  dom.muteButton.textContent = state.muted ? "마이크 켜기" : "마이크 끄기";
  dom.localState.textContent = state.muted ? "마이크 꺼짐" : getLocalStateText();
}

function leaveRoom(message = "방에서 나갔습니다.", notifyServer = true) {
  if (notifyServer && state.currentRoom) {
    sendSocket({ type: "leave-room" });
  }
  resetRoomState();
  setMessage(message);
}

function resetRoomState() {
  for (const peerId of Array.from(state.peers.keys())) {
    removePeer(peerId);
  }
  stopLocalMedia();
  stopStatsTimer();
  state.currentRoom = null;
  state.muted = false;
  dom.remoteState.textContent = "대기";
  dom.remoteMeter.style.setProperty("--level", "0%");
  resetStatsView();
  renderCurrentRoom();
  renderParticipants();
  updateCallControls();
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  peer.pc.close();
  cleanupRemotePlayback(peer.remoteMic);
  cleanupRemotePlayback(peer.remoteSystem);
  state.peers.delete(peerId);
  if (state.peers.size === 0) {
    dom.remoteState.textContent = "대기";
    dom.remoteMeter.style.setProperty("--level", "0%");
  }
}

function stopLocalMedia() {
  stopMeters();

  stopMicOnly();
  stopSystemAudio({ replaceSenders: false, updateMessage: false, refreshLocal: false });

  state.localStream = null;
  state.systemSharing = false;
  state.muted = false;
  dom.localAudio.srcObject = null;
  dom.localState.textContent = "꺼짐";
  dom.localMeter.style.setProperty("--level", "0%");
}

async function stopSystemAudio({
  replaceSenders = true,
  updateMessage = true,
  refreshLocal = true,
} = {}) {
  for (const track of state.systemStream?.getTracks() || []) {
    track.stop();
  }
  state.systemStream = null;
  state.systemTrack = null;
  state.systemSharing = false;
  if (refreshLocal) {
    rebuildLocalStream();
    dom.localAudio.srcObject = state.localStream;
  }
  if (replaceSenders) {
    await removeSystemTrackFromPeers();
    await renegotiatePeers();
  }
  if (refreshLocal) startLocalMeter();
  dom.localState.textContent = getLocalStateText();
  if (updateMessage) setMessage("컴퓨터 사운드 공유를 껐습니다.");
}

function stopMicOnly() {
  const stoppedTracks = new Set();
  for (const stream of [state.micStream, state.micProcessedStream]) {
    for (const track of stream?.getTracks() || []) {
      if (stoppedTracks.has(track)) continue;
      stoppedTracks.add(track);
      track.stop();
    }
  }
  if (state.micTrack && !stoppedTracks.has(state.micTrack)) {
    state.micTrack.stop();
  }

  state.audioContext?.close().catch(() => {});
  state.audioContext = null;
  state.micGainNode = null;
  state.micFilterNode = null;
  state.micCompressorNode = null;
  state.micStream = null;
  state.micProcessedStream = null;
  state.micTrack = null;
}

function stopSocket() {
  if (state.socket) {
    state.socket.shouldIgnoreClose = true;
    state.socket.close();
    state.socket = null;
  }
}

function sendSignal(target, data) {
  sendSocket({ type: "signal", target, data });
}

function sendSocket(data) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(data));
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    renderDeviceOptions(
      dom.inputDeviceSelect,
      devices.filter((device) => device.kind === "audioinput"),
      "기본 입력",
    );
    renderDeviceOptions(
      dom.outputDeviceSelect,
      devices.filter((device) => device.kind === "audiooutput"),
      "기본 출력",
    );
    await applyOutputDevice();
  } catch {
    setMessage("오디오 장치 목록을 불러오지 못했습니다.");
  }
}

function renderDeviceOptions(select, devices, fallbackLabel) {
  const previousValue = select.value;
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

  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

async function applyOutputDevice() {
  const deviceId = dom.outputDeviceSelect.value;
  const audios = [dom.localAudio, ...Array.from(dom.remoteAudios.querySelectorAll("audio"))];

  for (const audio of audios) {
    await applySinkToAudio(audio, deviceId);
  }
}

async function applySinkToAudio(audio, deviceId = dom.outputDeviceSelect.value) {
  if (!audio.setSinkId) return;
  try {
    await audio.setSinkId(deviceId || "");
  } catch {
    setMessage("선택한 출력 장치를 적용하지 못했습니다.");
  }
}

function startMeter(stream, element) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !stream) return null;

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;

  source.connect(analyser);
  context.resume().catch(() => {});

  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / samples.length);
    const level = Math.min(100, Math.round(rms * 420));
    element.style.setProperty("--level", `${level}%`);
    frame = requestAnimationFrame(tick);
  };

  tick();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    context.close().catch(() => {});
  };
}

function startLocalMeter() {
  state.localMeterStop?.();
  state.localMeterStop = startMeter(state.localStream, dom.localMeter);
}

function startRemoteMeter() {
  const firstPeer = state.peers.values().next().value;
  const meterStream = firstPeer?.remoteMic?.sourceStream || firstPeer?.stream;
  if (!meterStream) return;
  state.remoteMeterStop?.();
  state.remoteMeterStop = startMeter(meterStream, dom.remoteMeter);
}

function stopMeters() {
  state.localMeterStop?.();
  state.remoteMeterStop?.();
  state.localMeterStop = null;
  state.remoteMeterStop = null;
}

function startStatsTimer() {
  stopStatsTimer();
  state.statsTimer = window.setInterval(updateStats, 1000);
  updateStats().catch(() => {});
}

function stopStatsTimer() {
  if (state.statsTimer) {
    window.clearInterval(state.statsTimer);
    state.statsTimer = 0;
  }
  state.previousStats.clear();
}

async function updateStats() {
  let sendBps = 0;
  let receiveBps = 0;
  let rttTotal = 0;
  let rttCount = 0;
  let jitterTotal = 0;
  let jitterCount = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let codec = "";

  for (const peer of state.peers.values()) {
    const stats = await peer.pc.getStats();
    const now = Date.now();

    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "audio") {
        sendBps += getBitrate(`${peer.id}:${report.id}`, report.bytesSent, now);
      }

      if (report.type === "inbound-rtp" && report.kind === "audio") {
        receiveBps += getBitrate(`${peer.id}:${report.id}`, report.bytesReceived, now);
        packetsLost += report.packetsLost || 0;
        packetsReceived += report.packetsReceived || 0;
        if (typeof report.jitter === "number") {
          jitterTotal += report.jitter;
          jitterCount += 1;
        }
        const codecReport = stats.get(report.codecId);
        if (codecReport?.mimeType) codec = codecReport.mimeType.replace("audio/", "");
      }

      if (report.type === "candidate-pair" && report.state === "succeeded") {
        if (typeof report.currentRoundTripTime === "number") {
          rttTotal += report.currentRoundTripTime;
          rttCount += 1;
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
  const lossRate = totalPackets ? (packetsLost / totalPackets) * 100 : 0;
  dom.statLoss.textContent = totalPackets ? `${lossRate.toFixed(1)}%` : "-";
  dom.statCodec.textContent = codec || "-";
}

function getBitrate(key, bytes, now) {
  const previous = state.previousStats.get(key);
  state.previousStats.set(key, { bytes, now });
  if (!previous) return 0;

  const byteDiff = bytes - previous.bytes;
  const timeDiff = now - previous.now;
  return timeDiff > 0 ? (byteDiff * 8 * 1000) / timeDiff : 0;
}

function updateTrackStats() {
  const [rawMicTrack] = state.micStream?.getAudioTracks() || [];
  const micSettings = rawMicTrack?.getSettings?.() || state.micTrack?.getSettings?.() || {};
  const systemSettings = state.systemTrack?.getSettings?.() || {};

  dom.statSampleRate.textContent = formatAudioSetting(
    micSettings.sampleRate,
    systemSettings.sampleRate,
    "Hz",
  );
  dom.statChannels.textContent = formatAudioSetting(
    micSettings.channelCount,
    systemSettings.channelCount,
    "ch",
  );
}

function formatAudioSetting(micValue, systemValue, unit) {
  if (!micValue && !systemValue) return "-";
  const micText = micValue ? `마이크 ${micValue} ${unit}` : "마이크 -";
  if (!state.systemSharing) return micValue ? `${micValue} ${unit}` : "-";
  const systemText = systemValue ? `컴퓨터 ${systemValue} ${unit}` : "컴퓨터 -";
  return `${micText} / ${systemText}`;
}

function applyMicGain() {
  const gain = Number(dom.micGainInput.value || 1);
  dom.micGainValue.textContent = `${gain.toFixed(2).replace(/\.00$/, ".0")}x`;
  if (state.micGainNode) {
    state.micGainNode.gain.value = state.muted ? 0 : gain;
  }
}

function applyRemoteVolumes() {
  const micGain = Number(dom.remoteMicVolumeInput.value || 100);
  const systemGain = Number(dom.remoteSystemVolumeInput.value || 100);

  dom.remoteMicVolumeValue.textContent = `${micGain}%`;
  dom.remoteSystemVolumeValue.textContent = `${systemGain}%`;

  for (const peer of state.peers.values()) {
    applyRemotePlaybackVolume(peer.remoteMic);
    applyRemotePlaybackVolume(peer.remoteSystem);
  }
}

function applyRemotePlaybackVolume(playback) {
  if (!playback) return;

  const rawValue = playback.role === "system"
    ? Number(dom.remoteSystemVolumeInput.value || 100)
    : Number(dom.remoteMicVolumeInput.value || 100);
  const gain = Math.max(0, Math.min(2, rawValue / 100));

  if (gain <= 1) {
    if (playback.usingBoost) {
      playback.audio.srcObject = playback.sourceStream;
      playback.boost?.source?.disconnect?.();
      playback.boost?.gainNode?.disconnect?.();
      playback.boost?.context?.close?.().catch(() => {});
      playback.boost = null;
      playback.usingBoost = false;
      playback.audio.play().catch(() => {});
    }
    playback.audio.volume = Math.min(1, gain);
    return;
  }

  if (!playback.boost) {
    playback.boost = createBoostedRemotePlayback(playback.track);
  }

  if (playback.boost) {
    playback.boost.gainNode.gain.value = gain;
    playback.boost.context.resume().catch(() => {});
    if (!playback.usingBoost) {
      playback.audio.srcObject = playback.boost.stream;
      playback.audio.volume = 1;
      playback.usingBoost = true;
      playback.audio.play().catch(() => {});
    }
  } else {
    playback.audio.volume = 1;
  }
}

function resetStatsView() {
  dom.statSend.textContent = "0 kbps";
  dom.statReceive.textContent = "0 kbps";
  dom.statRtt.textContent = "-";
  dom.statJitter.textContent = "-";
  dom.statLoss.textContent = "-";
  dom.statCodec.textContent = "-";
  dom.statSampleRate.textContent = "-";
  dom.statChannels.textContent = "-";
}

function renderRooms() {
  dom.roomList.innerHTML = "";

  if (!state.rooms.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "열린 방이 없습니다.";
    dom.roomList.append(empty);
    return;
  }

  for (const room of state.rooms) {
    const card = document.createElement("article");
    card.className = "room-card";

    const main = document.createElement("div");
    main.className = "room-main";

    const text = document.createElement("div");
    const name = document.createElement("p");
    name.className = "room-name";
    name.textContent = room.name;
    const meta = document.createElement("p");
    meta.className = "room-meta";
    meta.textContent = `${room.count}/${room.limit}명`;
    const people = document.createElement("p");
    people.className = "room-people";
    people.textContent = room.participants?.length ? room.participants.join(", ") : "대기 중";
    text.append(name, meta, people);

    const joinButton = document.createElement("button");
    joinButton.className = "secondary";
    joinButton.type = "button";
    joinButton.textContent = room.count >= room.limit ? "가득 참" : "입장";
    joinButton.disabled = room.count >= room.limit || Boolean(state.currentRoom);
    joinButton.addEventListener("click", () => joinRoom(room.id));

    main.append(text, joinButton);
    card.append(main);
    dom.roomList.append(card);
  }
}

function renderCurrentRoom() {
  if (!state.currentRoom) {
    dom.currentRoomName.textContent = "통화 없음";
    dom.currentRoomMeta.textContent = "서버에 연결한 뒤 방에 들어가세요.";
    return;
  }

  dom.currentRoomName.textContent = state.currentRoom.name;
  dom.currentRoomMeta.textContent = `${state.currentRoom.count}/${state.currentRoom.limit}명`;
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

  appendParticipant(getUserName(), getLocalStateText());
  for (const peer of state.peers.values()) {
    appendParticipant(peer.name, peer.state);
  }
}

function appendParticipant(name, status) {
  const card = document.createElement("div");
  card.className = "participant-card";
  const label = document.createElement("strong");
  label.textContent = name;
  const stateLabel = document.createElement("span");
  stateLabel.textContent = status;
  card.append(label, stateLabel);
  dom.participantList.append(card);
}

function updateCurrentRoomFromList() {
  if (!state.currentRoom) return;
  const latest = state.rooms.find((room) => room.id === state.currentRoom.id);
  if (latest) {
    state.currentRoom = latest;
    renderCurrentRoom();
  }
}

function updateCallControls() {
  const connected = state.socket?.readyState === WebSocket.OPEN;
  const inRoom = Boolean(state.currentRoom);
  const systemAudioSupported = isSystemAudioSupported();

  dom.createRoomButton.disabled = !connected || inRoom;
  dom.leaveButton.disabled = !inRoom;
  dom.muteButton.disabled = !inRoom || !state.micStream;
  dom.muteButton.textContent = state.muted ? "마이크 켜기" : "마이크 끄기";
  dom.serverInput.disabled = inRoom;
  dom.connectButton.disabled = inRoom;
  dom.systemAudioToggle.disabled = !systemAudioSupported;
}

function setBusy(isBusy) {
  dom.connectButton.disabled = isBusy;
  dom.createRoomButton.disabled = isBusy || Boolean(state.currentRoom);
}

function setStatus(text, tone) {
  dom.statusText.textContent = text;
  dom.statusBadge.dataset.tone = tone === "good" || tone === "bad" ? tone : "";
}

function setMessage(text) {
  dom.message.textContent = text;
}

function getLocalStateText() {
  if (!state.localStream) return "꺼짐";
  if (state.muted) return "마이크 꺼짐";
  return state.systemSharing ? "마이크+사운드" : "마이크";
}

function getUserName() {
  return dom.nameInput.value.trim().slice(0, 24) || "Guest";
}

function getSavedServerUrl() {
  const saved = localStorage.getItem("voiceChatServerUrl");
  if (saved) return normalizeServerUrl(saved);
  if (location.protocol === "file:") return "https://localhost:25565";
  return location.origin;
}

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function makeDefaultName() {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `User${suffix}`;
}

function updateSystemAudioAvailability() {
  if (isSystemAudioSupported()) return;
  dom.systemAudioToggle.checked = false;
  dom.systemAudioToggle.disabled = true;
  dom.systemAudioToggle.title = "macOS에서는 BlackHole 같은 가상 오디오 장치를 입력으로 선택해야 합니다.";
}

function isSystemAudioSupported() {
  return !(isDesktop && window.voiceDesktop?.platform === "darwin");
}

function describeMediaError(error) {
  if (!error) return "오디오 장치를 열지 못했습니다.";
  if (error.name === "NotAllowedError") {
    return "마이크 권한이 거부되었습니다.";
  }
  if (error.name === "NotFoundError") {
    return "사용 가능한 입력 장치를 찾지 못했습니다.";
  }
  if (error.name === "NotReadableError") {
    return "다른 프로그램이 오디오 장치를 사용 중일 수 있습니다.";
  }
  if (error.name === "OverconstrainedError") {
    return "선택한 오디오 장치가 현재 설정을 지원하지 않습니다.";
  }
  return error.message || "오디오 장치를 열지 못했습니다.";
}
