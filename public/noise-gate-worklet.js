class VoiceNoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const settings = options.processorOptions || {};
    this.noiseFloor = numberOr(settings.noiseFloor, 0.005);
    this.minNoiseFloor = numberOr(settings.minNoiseFloor, 0.002);
    this.maxNoiseFloor = numberOr(settings.maxNoiseFloor, 0.022);
    this.noiseAdaptRatio = numberOr(settings.noiseAdaptRatio, 1.55);
    this.minThreshold = numberOr(settings.minThreshold, 0.004);
    this.thresholdScale = numberOr(settings.thresholdScale, 2);
    this.openScale = numberOr(settings.openScale, 1.3);
    this.closedGain = numberOr(settings.closedGain, 0.4);
    this.holdGain = numberOr(settings.holdGain, 0.6);
    this.attack = numberOr(settings.attack, 0.3);
    this.release = numberOr(settings.release, 0.18);
    this.gateGain = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    let sum = 0;
    for (let index = 0; index < input.length; index += 1) {
      sum += input[index] * input[index];
    }

    const rms = Math.sqrt(sum / input.length);
    if (rms < this.noiseFloor * this.noiseAdaptRatio) {
      this.noiseFloor = Math.min(this.maxNoiseFloor, Math.max(this.minNoiseFloor, this.noiseFloor * 0.985 + rms * 0.015));
    }

    const threshold = Math.max(this.minThreshold, this.noiseFloor * this.thresholdScale);
    const openThreshold = threshold * this.openScale;
    const target = rms < threshold ? this.closedGain : rms < openThreshold ? this.holdGain : 1;
    this.gateGain += (target - this.gateGain) * (target > this.gateGain ? this.attack : this.release);

    for (let index = 0; index < input.length; index += 1) {
      output[index] = input[index] * this.gateGain;
    }

    return true;
  }
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

registerProcessor("voice-noise-gate", VoiceNoiseGateProcessor);
