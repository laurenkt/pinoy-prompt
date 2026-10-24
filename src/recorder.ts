// Records one attempt from the microphone as 16 kHz mono samples, for the
// phone recogniser. Reports the input level as it goes (for the meter) and
// stops by itself shortly after the learner stops speaking.
//
// The microphone and the recorder's context take a moment to start giving
// sound, so a screen about to ask for a take can warm them up first
// (warmRecorder): the audio runs, and is thrown away, until the take begins.

import { SAMPLE_RATE } from './fbank';
import { closeMicrophone, dropMicrophone, getMicrophone, microphoneInUse, microphoneStreaming, releaseMicrophone } from './microphone';

/** Level (RMS, 0–1) above which a block counts as speech. */
const SPEECH_LEVEL = 0.02;
/** Stop this long after speech ends. */
const TRAILING_SILENCE_MS = 900;
/** Never record longer than this, counted from when the microphone gave sound (it may be reopened first: SIGNAL_WAIT_MS). */
export const MAX_RECORDING_MS = 7000;
/**
 * A working microphone never gives exact silence: there's always some hiss. iOS can hand back a stream
 * that looks live but gives only zeros (after the audio session changed under it, or an interruption),
 * or a context that never starts, so no audio comes at all. If nothing above this level has come this
 * long after the microphone opened, it's opened afresh, once; if that gives nothing either, the take
 * fails as 'silent' rather than passing for a learner who said nothing.
 */
export const SIGNAL_LEVEL = 1e-6;
export const SIGNAL_WAIT_MS = 1200;
/** Exact silence for this long before the learner stops counts as a dead microphone too; any less is too soon to tell. */
const DEAD_AFTER_MS = 500;

export type RecordProblem = 'denied' | 'no-mic' | 'unsupported' | 'silent';

export class RecordError extends Error {
  constructor(readonly problem: RecordProblem) {
    super(problem);
  }
}

export interface RecorderEvents {
  /** Input level, 0–1, a few times a second. */
  onLevel?: (level: number) => void;
  /**
   * Called once the microphone is giving sound, so what's said from now on is in the take. Until then (the
   * microphone switching on, iOS handing over the audio session) anything said is lost, so screens show the
   * learner they're listening only from here.
   */
  onListening?: () => void;
  /** Called once when speech is first detected. */
  onSpeech?: () => void;
  /** The microphone gave no sound and has been opened afresh, so anything said so far wasn't heard. */
  onRestart?: () => void;
}

export interface Take {
  /** 16 kHz mono samples. */
  samples: Float32Array;
  /** Whether anything loud enough to be speech was picked up. */
  speech: boolean;
}

export interface Recording {
  /** Resolves when recording ends: on stop(), after trailing silence, or at the time limit. */
  audio: Promise<Take>;
  stop(): void;
  /** Stop and throw the audio away. */
  cancel(): void;
}

export function recordingSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
}

/**
 * Resample to 16 kHz with windowed-sinc interpolation. Going down, it first
 * filters out everything above the new Nyquist frequency, so high hiss (and
 * the top of "s") can't fold back into the band the recogniser listens to.
 */
export function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input;
  const ratio = fromRate / SAMPLE_RATE;
  // Cutoff as a fraction of the input's Nyquist frequency, a little under the lower of the two rates.
  const cutoff = Math.min(1, 1 / ratio) * 0.95;
  const half = Math.ceil(8 / cutoff);
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const t = i * ratio;
    const centre = Math.floor(t);
    let sum = 0;
    let weights = 0;
    for (let k = centre - half + 1; k <= centre + half; k++) {
      if (k < 0 || k >= input.length) continue;
      const d = t - k;
      const x = Math.PI * cutoff * d;
      const sinc = x === 0 ? 1 : Math.sin(x) / x;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
      const w = sinc * window;
      sum += input[k] * w;
      weights += w;
    }
    out[i] = weights > 0 ? sum / weights : 0;
  }
  return out;
}

/**
 * The recorder's context, kept between takes while the microphone is held, so the next take (or warmRecorder) doesn't
 * wait for one to start. Only one made while the microphone was already open is kept: iOS can change the hardware's
 * rate as the microphone opens, under a context made before. Once a tap has started it, WebKit lets it resume
 * without one, so a card that came up by itself can warm it too.
 */
let kept: AudioContext | null = null;

/** The microphone running into the kept context, its sound thrown away, until a take adopts it or it's cooled. */
interface Warm {
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  sink: ScriptProcessorNode | null;
  cooled: boolean;
}
let warm: Warm | null = null;

function unwire(w: Warm): void {
  w.source?.disconnect();
  w.sink?.disconnect();
}

/**
 * Get the microphone and the recorder's context going ahead of a take, so it starts with sound already flowing rather
 * than after they wake up. Call it from the tap that brings up a question that will ask for a take, if there is one;
 * without one it only works once a take has started the kept context. Never asks for the microphone: only an open
 * (held) one is warmed. Returns the way to cool it again, which record() makes a no-op by adopting it.
 */
export function warmRecorder(): () => void {
  if (!recordingSupported() || !microphoneStreaming() || globalThis.document?.visibilityState === 'hidden') return () => {};
  coolRecorder();
  if (!kept || kept.state === 'closed') kept = new AudioContext();
  const context = kept;
  if (context.state !== 'running') void context.resume().catch(() => {});
  const mine: Warm = { stream: null, source: null, sink: null, cooled: false };
  warm = mine;
  void getMicrophone().then(
    (stream) => {
      if (mine.cooled || warm !== mine) return releaseMicrophone(stream);
      mine.stream = stream;
      mine.source = context.createMediaStreamSource(stream);
      // Some browsers only pull audio through a node connected to an output; this one's output is silence.
      mine.sink = context.createScriptProcessor(4096, 1, 1);
      mine.source.connect(mine.sink);
      mine.sink.connect(context.destination);
    },
    () => {},
  );
  return () => {
    if (warm === mine) coolRecorder();
  };
}

/** Stop warming: the microphone is switched off again and the kept context rests. */
function coolRecorder(): void {
  const w = warm;
  warm = null;
  if (!w) return;
  w.cooled = true;
  unwire(w);
  if (w.stream) releaseMicrophone(w.stream);
  if (kept && !active) void kept.suspend().catch(() => {});
}

/** Let go of the kept context too: the screen is going, or the app went into the background. */
function closeRecorder(): void {
  coolRecorder();
  void kept?.close().catch(() => {});
  kept = null;
}

/** Start recording. Asks for the microphone if it hasn't been allowed yet. */
export function record({ onLevel, onListening, onSpeech, onRestart }: RecorderEvents = {}): Recording {
  let finish: () => void = () => {};
  let cancelled = false;
  // stop() can come before the microphone is open (e.g. during the permission prompt).
  let stopped = false;
  // A warmed microphone is taken over as it is, its tracks never switched off, so the take starts with sound.
  const adopted = warm;
  warm = null;
  if (adopted) unwire(adopted);
  // Made (and resumed) right away, while still inside the learner's tap: iOS keeps an audio
  // context created later, after the permission prompt, suspended, and then nothing records.
  const reuse = kept !== null && kept.state !== 'closed';
  const context = reuse ? kept : recordingSupported() ? new AudioContext() : null;
  if (!reuse && context && microphoneStreaming()) kept = context;
  void context?.resume().catch(() => {});
  /** Done with the context: the kept one rests for the next take, any other is closed. */
  const letGo = (c: AudioContext) => void (c === kept ? (warm ? undefined : c.suspend()) : c.close())?.catch(() => {});
  const audio = (async () => {
    if (!context) throw new RecordError('unsupported');
    const problem = (err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      return new RecordError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-mic');
    };
    let stream: MediaStream;
    try {
      // The warmed stream's hold on the microphone becomes this take's.
      stream = adopted?.stream ?? (await getMicrophone());
    } catch (err) {
      letGo(context);
      throw problem(err);
    }
    // iOS can also leave it 'interrupted' as the microphone takes over the audio session.
    if (context.state !== 'running') await context.resume().catch(() => {});
    let source = context.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but works everywhere, including iOS, without a separate worklet file.
    const processor = context.createScriptProcessor(4096, 1, 1);
    let chunks: Float32Array[] = [];
    let heardSpeech = false;
    let silentMs = 0;
    let elapsedMs = 0;
    /** Whether the microphone has given anything but exact silence (SIGNAL_LEVEL). */
    let signal = false;
    /** When the current stream was wired up, by Date.now(); a context that never starts gives no blocks to count. */
    let listeningSince = Date.now();

    return new Promise<Take>((resolve, reject) => {
      let done = false;
      let limit: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      // The time limit runs on a timer too, in case the audio never starts flowing.
      const startLimit = () => {
        clearTimeout(limit);
        limit = setTimeout(() => finish(), MAX_RECORDING_MS + 500);
      };
      const end = () => {
        done = true;
        clearTimeout(limit);
        clearTimeout(watchdog);
        processor.disconnect();
        source.disconnect();
        letGo(context);
      };
      finish = () => {
        if (done) return;
        end();
        // Stopped over a stream giving exact silence: it's dead, not a learner who said nothing.
        const dead = !signal && !cancelled;
        if (dead) dropMicrophone(stream);
        else releaseMicrophone(stream);
        if (dead && Date.now() - listeningSince >= DEAD_AFTER_MS) return reject(new RecordError('silent'));
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const all = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) {
          all.set(c, offset);
          offset += c.length;
        }
        resolve(cancelled ? { samples: new Float32Array(0), speech: false } : { samples: resample(all, context.sampleRate), speech: heardSpeech });
      };
      /** Nothing at all from the microphone yet: open it afresh once, then give up. */
      const watch = (retried: boolean) => {
        watchdog = setTimeout(async () => {
          if (done || signal) return;
          if (retried) {
            end();
            // The stream is no good, so the next take opens a new one rather than the same dead one.
            dropMicrophone(stream);
            return reject(new RecordError('silent'));
          }
          source.disconnect();
          dropMicrophone(stream);
          try {
            stream = await getMicrophone();
          } catch (err) {
            if (done) return;
            end();
            return reject(problem(err));
          }
          if (done) return releaseMicrophone(stream);
          if (context.state !== 'running') await context.resume().catch(() => {});
          if (done) return;
          // What came before was silence, so the learner gets the whole time from here.
          chunks = [];
          elapsedMs = 0;
          startLimit();
          source = context.createMediaStreamSource(stream);
          source.connect(processor);
          listeningSince = Date.now();
          onRestart?.();
          watch(true);
        }, SIGNAL_WAIT_MS);
      };
      startLimit();
      if (cancelled || stopped) return finish();
      processor.onaudioprocess = (e) => {
        const block = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(block);
        const before = signal;
        let sum = 0;
        for (const v of block) {
          sum += v * v;
          if (!signal && Math.abs(v) > SIGNAL_LEVEL) signal = true;
        }
        if (signal && !before) onListening?.();
        const level = Math.sqrt(sum / block.length);
        onLevel?.(Math.min(1, level * 8));
        const blockMs = (block.length / context.sampleRate) * 1000;
        elapsedMs += blockMs;
        if (level > SPEECH_LEVEL) {
          if (!heardSpeech) onSpeech?.();
          heardSpeech = true;
          silentMs = 0;
        } else if (heardSpeech) {
          silentMs += blockMs;
        }
        if ((heardSpeech && silentMs >= TRAILING_SILENCE_MS) || elapsedMs >= MAX_RECORDING_MS) finish();
      };
      source.connect(processor);
      // Some browsers only run the processor while it's connected to an output.
      processor.connect(context.destination);
      watch(false);
    });
  })();
  const recording: Recording = {
    audio,
    stop: () => {
      stopped = true;
      finish();
    },
    cancel: () => {
      cancelled = true;
      finish();
    },
  };
  active?.cancel();
  active = recording;
  void audio.catch(() => {}).finally(() => {
    if (active === recording) active = null;
  });
  return recording;
}

let active: Recording | null = null;

/** A take as a 16-bit mono WAV file, for sending to a speech-to-text service. */
export function toWav(samples: Float32Array, rate = SAMPLE_RATE): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([data.buffer], { type: 'audio/wav' });
}

/** Stop and discard any recording in progress, and let go of a warmed microphone, e.g. when leaving a screen. */
export function cancelRecording(): void {
  active?.cancel();
  closeRecorder();
}

if (typeof document !== 'undefined') {
  // iOS cuts the microphone off in the background, and a warmed one would keep the stream from closing (microphone.ts).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || active) return;
    const warmed = warm !== null;
    closeRecorder();
    // microphone.ts's own listener ran first and left the stream open for the warm-up's sake.
    if (warmed && !microphoneInUse()) closeMicrophone();
  });
}
