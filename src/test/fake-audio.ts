// A stand-in for the shared AudioContext in screen tests, counting the chimes and ticks it plays.

/** Sounds made in code, as against clips decoded from a file: the chime, and the shorter tick. */
export const chimes = { count: 0 };
export const ticks = { count: 0 };
/** Sounds decoded from a file: word clips, and the thock. */
export const recorded = { count: 0 };

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
    const buffer = {
      made: true,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
      // A slice of a recording copied in, not a sound made in code.
      copyToChannel: () => (buffer.made = false),
    };
    return buffer;
  }
  createGain() {
    const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
    return { gain: param, connect: (to: unknown) => to };
  }
  createBufferSource() {
    const source = {
      buffer: null as { made?: boolean; duration: number } | null,
      playbackRate: { value: 1 },
      onended: null as (() => void) | null,
      connect: (to: unknown) => to,
      start: () => {
        if (source.buffer?.made) void (source.buffer.duration > 0.2 ? chimes.count++ : ticks.count++);
        else recorded.count++;
        // Ends when it would have, so nothing is left playing for the next test.
        setTimeout(() => source.onended?.(), (source.buffer?.duration ?? 0) * 1000);
      },
      stop: () => {},
    };
    return source;
  }
}
