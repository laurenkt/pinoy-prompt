// A stand-in for the shared AudioContext in screen tests, counting the chimes and ticks it plays.

/** Sounds made in code, as against clips decoded from a file: the chime, and the shorter tick. */
export const chimes = { count: 0 };
export const ticks = { count: 0 };

export class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  resume = async () => {};
  suspend = async () => {};
  close = async () => {};
  decodeAudioData = async () => ({ duration: 1 });
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { made: true, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
    return { gain: param, connect: (to: unknown) => to };
  }
  createBufferSource() {
    const source = {
      buffer: null as { made?: boolean; duration: number } | null,
      playbackRate: { value: 1 },
      onended: null,
      connect: (to: unknown) => to,
      start: () => source.buffer?.made && (source.buffer.duration > 0.2 ? chimes.count++ : ticks.count++),
      stop: () => {},
    };
    return source;
  }
}
