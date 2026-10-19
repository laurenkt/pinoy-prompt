// Speech recognition for speaking questions, using the browser's Web Speech
// API in Filipino (fil-PH).
//
// Support varies: Chrome (Android and desktop) handles Filipino by sending the
// audio to its speech service; some browsers have no recogniser at all, and
// others have one that doesn't know Filipino.
//
// We don't ask for on-device recognition (processLocally / available()):
// on-device Filipino is rare, and calling available() crashed the page in
// headless Chromium during testing.

const LANG = 'fil-PH';
/** Stop listening this long after the microphone opens, even if the recogniser hasn't. */
const MAX_LISTEN_MS = 8000;
/** Give up on a recogniser that never reports back (this includes time on the permission prompt). */
const GIVE_UP_MS = 30000;
/**
 * After the learner taps done, how long to wait for the recogniser to finish
 * before we stop waiting and judge what it heard so far. Some recognisers
 * (seen on phones) never report the end after stop().
 */
export const STOP_GRACE_MS = 1500;
/** If the recogniser shows no sign of life this long after starting, it isn't going to. */
export const NO_START_MS = 5000;

// The Web Speech API isn't in TypeScript's DOM types; this is the part we use.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent extends Event {
  results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent extends Event {
  error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onsoundend: (() => void) | null;
  onend: (() => void) | null;
}
interface RecognitionCtor {
  new (): Recognition;
}

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Set once the recogniser says it can't do Filipino, so we stop offering it. */
let languageUnsupported = false;

/**
 * iOS home-screen apps expose SpeechRecognition but it never starts
 * (https://bugs.webkit.org/show_bug.cgi?id=225298), so treat them as unsupported.
 */
function isIosHomeScreenApp(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Why speaking questions can't work here, or null if they might. */
export function recognitionBlocker(): ListenProblem | null {
  if (recognitionCtor() === undefined || languageUnsupported) return 'unsupported';
  if (isIosHomeScreenApp()) return 'home-screen';
  return null;
}

export function recognitionSupported(): boolean {
  return recognitionBlocker() === null;
}

export type ListenProblem = 'unsupported' | 'home-screen' | 'denied' | 'no-mic' | 'no-start' | 'offline' | 'failed';

export class ListenError extends Error {
  constructor(readonly problem: ListenProblem) {
    super(problem);
  }
}

/**
 * What the recogniser reports while listening, so the screen can show it:
 * waiting for the microphone, microphone open, picking up sound, or finishing
 * up after the learner tapped done.
 */
export type ListenPhase = 'starting' | 'mic-on' | 'sound' | 'finishing';

export interface ListenCallbacks {
  /** The live transcript as the learner speaks. */
  onHearing?: (text: string) => void;
  onPhase?: (phase: ListenPhase) => void;
}

export interface Listening {
  /** Resolves with the recogniser's guesses, best first; empty if nothing was heard or it was cancelled. */
  result: Promise<string[]>;
  /** Stop listening and judge what was heard so far. Always finishes within STOP_GRACE_MS. */
  stop(): void;
  /** Stop listening and discard it. */
  cancel(): void;
}

/**
 * Ask for the microphone ourselves before starting the recogniser. Some
 * recognisers fail silently without permission instead of prompting, so
 * this makes sure the learner sees the browser's prompt. The stream is
 * released straight away: the recogniser opens its own.
 */
async function askForMicrophone(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new ListenError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new ListenError('no-mic');
    // Anything else: let the recogniser try anyway.
  }
}

/** Listen for one utterance. */
export function listen({ onHearing, onPhase }: ListenCallbacks = {}): Listening {
  // Only one recogniser at a time: end the old one before starting another.
  active?.cancel();
  const Ctor = recognitionCtor();
  let cancelled = false;
  // Until the recogniser is running (e.g. while the permission prompt is up), stopping just cancels.
  let cancel = () => {
    cancelled = true;
  };
  let stop = () => cancel();

  const result = (async () => {
    if (!Ctor) throw new ListenError('unsupported');
    await askForMicrophone();
    if (cancelled) return [];
    return recognise(Ctor);
  })();

  function recognise(Ctor: RecognitionCtor): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const r = new Ctor();
      r.lang = LANG;
      r.interimResults = true;
      r.maxAlternatives = 5;
      r.continuous = false;

      let alternatives: string[] = [];
      let failure: ListenError | null = null;
      let settled = false;
      let alive = false;
      let phase: ListenPhase = 'starting';
      const timers: ReturnType<typeof setTimeout>[] = [];
      const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
      const setPhase = (next: ListenPhase) => {
        if (settled || phase === next || phase === 'finishing') return;
        phase = next;
        onPhase?.(next);
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        if (failure) reject(failure);
        else resolve(cancelled ? [] : alternatives);
      };
      // Judge what was heard so far, whether or not the recogniser ever reports the end.
      const finish = () => {
        if (settled) return;
        setPhase('finishing');
        try {
          r.stop();
        } catch {
          // Already stopped.
        }
        later(STOP_GRACE_MS, () => {
          try {
            r.abort();
          } catch {
            // Already stopped.
          }
          settle();
        });
      };
      stop = finish;
      cancel = () => {
        cancelled = true;
        try {
          r.abort();
        } catch {
          // Already stopped.
        }
        settle();
      };

      const showsLife = () => {
        alive = true;
      };
      r.onstart = showsLife;
      r.onaudiostart = () => {
        showsLife();
        setPhase('mic-on');
        // The listening limit starts when the microphone opens, not while the permission prompt is up.
        later(MAX_LISTEN_MS, finish);
      };
      r.onsoundstart = () => setPhase('sound');
      r.onspeechstart = () => setPhase('sound');
      r.onsoundend = () => {
        if (phase === 'sound') setPhase('mic-on');
      };
      later(GIVE_UP_MS, finish);
      later(NO_START_MS, () => {
        if (alive || settled) return;
        failure = new ListenError('no-start');
        try {
          r.abort();
        } catch {
          // Already stopped.
        }
        settle();
      });

      r.onresult = (e) => {
        // Each result is one stretch of speech; join them, alternative by alternative.
        const results = Array.from({ length: e.results.length }, (_, i) => e.results[i]);
        if (results.length === 0) return;
        const count = Math.max(...results.map((res) => res.length));
        alternatives = Array.from({ length: count }, (_, a) =>
          results
            .map((res) => (res[a] ?? res[0]).transcript.trim())
            .join(' ')
            .trim(),
        ).filter(Boolean);
        // A transcript means it is hearing speech, even on recognisers that skip the sound events.
        showsLife();
        setPhase('sound');
        if (alternatives[0]) onHearing?.(alternatives[0]);
      };
      r.onerror = (e) => {
        showsLife();
        if (e.error === 'language-not-supported') {
          languageUnsupported = true;
          failure = new ListenError('unsupported');
        } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          failure = new ListenError('denied');
        } else if (e.error === 'audio-capture') {
          failure = new ListenError('no-mic');
        } else if (e.error === 'network') {
          failure = new ListenError('offline');
        } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
          failure = new ListenError('failed');
        }
      };
      r.onend = settle;
      try {
        r.start();
      } catch {
        failure = new ListenError('failed');
        settle();
      }
    });
  }

  const listening: Listening = { result, stop: () => stop(), cancel: () => cancel() };
  active = listening;
  void result
    .catch(() => {})
    .finally(() => {
      if (active === listening) active = null;
    });
  return listening;
}

let active: Listening | null = null;

/** Cancel any listening in progress, e.g. when leaving a screen. */
export function cancelListening(): void {
  active?.cancel();
}
