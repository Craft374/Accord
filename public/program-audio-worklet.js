// 프로그램별 오디오 재생 워클릿.
// 단일 노드가 pid별 큐를 유지하며 합산 출력한다. PCM은 두 경로로 들어온다:
//  1) 직결 포트: 메인 프로세스 MessagePort가 오디오 스레드에 직접 전달(권장) —
//     렌더러 메인 스레드가 바빠도 밀리지 않는다.
//  2) 폴백: 노드 port를 통한 렌더러 경유 전달.
class PidQueue {
  constructor(channels) {
    this.channels = channels;
    this.queue = [];
    this.offset = 0;
    this.availableSamples = 0;
    this.primed = false;
    // 언더런이 반복되면 프리버퍼를 키워(60ms→최대 240ms) 크래클을 없앤다.
    this.prebufferSamples = Math.round(48000 * 0.06) * channels;
    this.minPrebufferSamples = this.prebufferSamples;
    this.maxPrebufferSamples = Math.round(48000 * 0.24) * channels;
    this.prebufferStepSamples = Math.round(48000 * 0.03) * channels;
    this.maxQueuedSamples = Math.round(48000 * 0.3) * channels;
    // 소비는 실시간 속도라 버스트로 쌓인 백로그는 스스로 줄지 않고 그대로
    // 지연이 된다(래칫). 초과분이 지속되면 오래된 쪽을 잘라 지연을 회복한다.
    this.backlogSlackSamples = Math.round(48000 * 0.08) * channels;
    this.trimMarginSamples = this.prebufferStepSamples;
    this.backlogBlocks = 0;
    this.backlogTrimHoldBlocks = 192; // 128프레임 블록 ≈2.67ms → 약 0.5초 지속 시 트림
    this.stableBlocks = 0;
    this.shrinkHoldBlocks = 5625; // 약 15초 동안 언더런이 없으면 프리버퍼를 한 단계 줄인다
  }

  push(chunk) {
    this.queue.push(chunk);
    this.availableSamples += chunk.length;
    while (this.availableSamples > this.maxQueuedSamples && this.queue.length > 1) {
      const dropped = this.queue.shift();
      this.availableSamples -= dropped.length - this.offset;
      this.offset = 0;
    }
  }

  beginBlock() {
    if (!this.primed) {
      if (this.availableSamples < this.prebufferSamples) return false;
      this.primed = true;
    }
    return true;
  }

  endBlock() {
    if (this.availableSamples < this.channels) {
      this.primed = false;
      this.prebufferSamples = Math.min(this.maxPrebufferSamples, this.prebufferSamples + this.prebufferStepSamples);
      this.stableBlocks = 0;
      this.backlogBlocks = 0;
      return;
    }

    this.stableBlocks += 1;
    if (this.stableBlocks >= this.shrinkHoldBlocks) {
      this.prebufferSamples = Math.max(this.minPrebufferSamples, this.prebufferSamples - this.prebufferStepSamples);
      this.stableBlocks = 0;
    }

    if (this.availableSamples > this.prebufferSamples + this.backlogSlackSamples) {
      this.backlogBlocks += 1;
      if (this.backlogBlocks >= this.backlogTrimHoldBlocks) {
        this.trimTo(this.prebufferSamples + this.trimMarginSamples);
        this.backlogBlocks = 0;
      }
    } else {
      this.backlogBlocks = 0;
    }
  }

  trimTo(targetSamples) {
    while (this.queue.length > 1) {
      const remaining = this.queue[0].length - this.offset;
      if (this.availableSamples - remaining < targetSamples) break;
      this.queue.shift();
      this.offset = 0;
      this.availableSamples -= remaining;
    }
  }

  readFrame(out) {
    while (this.queue.length) {
      const chunk = this.queue[0];
      if (this.offset + this.channels <= chunk.length) {
        out.left = chunk[this.offset] || 0;
        out.right = this.channels > 1 ? chunk[this.offset + 1] || 0 : out.left;
        this.offset += this.channels;
        this.availableSamples -= this.channels;
        return true;
      }
      this.availableSamples -= chunk.length - this.offset;
      this.queue.shift();
      this.offset = 0;
    }
    out.left = 0;
    out.right = 0;
    return false;
  }
}

class VoiceProgramAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = Math.max(1, Math.min(2, Number(options.processorOptions?.channels || 2)));
    this.queues = new Map();
    this.frame = { left: 0, right: 0 };
    this.directPort = null;

    const handleMessage = (data) => {
      if (!data) return;
      if (data.type === "port" && data.port) {
        this.directPort?.close?.();
        this.directPort = data.port;
        this.directPort.onmessage = (event) => handleMessage(event.data);
        return;
      }
      this.handlePcm(data);
    };
    this.port.onmessage = (event) => handleMessage(event.data);
  }

  handlePcm(data) {
    const pid = Number(data.pid);
    if (!Number.isFinite(pid) || !data.data) return;
    const chunk = this.toFloat32(data.data);
    if (!chunk || !chunk.length) return;
    let queue = this.queues.get(pid);
    if (!queue) {
      queue = new PidQueue(this.channels);
      this.queues.set(pid, queue);
    }
    queue.push(chunk);
  }

  toFloat32(value) {
    // 직결 포트는 Uint8Array(구조화 복제), 폴백은 ArrayBuffer(transfer)로 도착한다.
    // float32 프레임(채널 수 배수) 정렬이 깨진 꼬리는 잘라낸다.
    try {
      const frameBytes = 4 * this.channels;
      if (value instanceof ArrayBuffer) {
        const usable = value.byteLength - (value.byteLength % frameBytes);
        return usable > 0 ? new Float32Array(value, 0, usable / 4) : null;
      }
      if (ArrayBuffer.isView(value)) {
        const usable = value.byteLength - (value.byteLength % frameBytes);
        if (usable <= 0) return null;
        if (value.byteOffset % 4 === 0) {
          return new Float32Array(value.buffer, value.byteOffset, usable / 4);
        }
        const copy = new Uint8Array(usable);
        copy.set(new Uint8Array(value.buffer, value.byteOffset, usable));
        return new Float32Array(copy.buffer);
      }
    } catch {}
    return null;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || null;

    for (const queue of this.queues.values()) {
      if (!queue.beginBlock()) continue;
      for (let frame = 0; frame < left.length; frame += 1) {
        queue.readFrame(this.frame);
        if (right) {
          left[frame] += this.frame.left;
          right[frame] += this.frame.right;
        } else {
          left[frame] += (this.frame.left + this.frame.right) * 0.5;
        }
      }
      queue.endBlock();
    }

    return true;
  }
}

registerProcessor("voice-program-audio", VoiceProgramAudioProcessor);
