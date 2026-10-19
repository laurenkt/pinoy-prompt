// Records one attempt from the microphone as 16 kHz mono samples, for the
// phone recogniser. Reports the input level as it goes (for the meter) and
// stops by itself shortly after the learner stops speaking.

import { SAMPLE_RATE } from './fbank';

/** Level (RMS, 0–1) above which a block counts as speech. */
const SPEECH_LEVEL = 0.02;
/** Stop this long after speech ends. */
const TRAILING_SILENCE_MS = 900;
/** Never record longer than this. */
export const MAX_RECORDING_MS = 7000;

export type RecordProblem = 'denied' | 'no-mic' | 'unsupported';

export class RecordError extends Error {
  constructor(readonly problem: RecordProblem) {
    super(problem);
  }
}

export interface RecorderEvents {
  /** Input level, 0–1, a few times a second. */
  onLevel?: (level: number) => void;
  /** Called once when speech is first detected. */
  onSpeech?: () => void;
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

/** Average blocks of samples down to 16 kHz. Speech has little above 8 kHz, so this is enough. */
export function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input;
  const ratio = fromRate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** Start recording. Asks for the microphone if it hasn't been allowed yet. */
export function record({ onLevel, onSpeech }: RecorderEvents = {}): Recording {
  let finish: () => void = () => {};
  let cancelled = false;
  // stop() can come before the microphone is open (e.g. during the permission prompt).
  let stopped = false;
  const audio = (async () => {
    if (!recordingSupported()) throw new RecordError('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      throw new RecordError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-mic');
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but works everywhere, including iOS, without a separate worklet file.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let heardSpeech = false;
    let silentMs = 0;
    let elapsedMs = 0;

    return new Promise<Take>((resolve) => {
      let done = false;
      finish = () => {
        if (done) return;
        done = true;
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const all = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) {
          all.set(c, offset);
          offset += c.length;
        }
        resolve(cancelled ? { samples: new Float32Array(0), speech: false } : { samples: resample(all, context.sampleRate), speech: heardSpeech });
      };
      if (cancelled || stopped) return finish();
      processor.onaudioprocess = (e) => {
        const block = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(block);
        let sum = 0;
        for (const v of block) sum += v * v;
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

/** Stop and discard any recording in progress, e.g. when leaving a screen. */
export function cancelRecording(): void {
  active?.cancel();
}
