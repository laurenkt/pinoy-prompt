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
  onaudiostart: (() => void) | null;
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

export function recognitionSupported(): boolean {
  return !languageUnsupported && recognitionCtor() !== undefined;
}

export type ListenProblem = 'unsupported' | 'denied' | 'offline' | 'failed';

export class ListenError extends Error {
  constructor(readonly problem: ListenProblem) {
    super(problem);
  }
}

export interface Listening {
  /** Resolves with the recogniser's guesses, best first; empty if nothing was heard or it was cancelled. */
  result: Promise<string[]>;
  /** Stop listening and judge what was heard so far. */
  stop(): void;
  /** Stop listening and discard it. */
  cancel(): void;
}

/** Listen for one utterance. `onHearing` gets the live transcript as the learner speaks. */
export function listen(onHearing?: (text: string) => void): Listening {
  // Only one recogniser at a time: end the old one before starting another.
  active?.cancel();
  const Ctor = recognitionCtor();
  let recognition: Recognition | null = null;
  let cancelled = false;
  const result = new Promise<string[]>((resolve, reject) => {
    if (!Ctor) return reject(new ListenError('unsupported'));
    const r = new Ctor();
    recognition = r;
    r.lang = LANG;
    r.interimResults = true;
    r.maxAlternatives = 5;
    r.continuous = false;

    let alternatives: string[] = [];
    let failure: ListenError | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(giveUp);
      if (failure) reject(failure);
      else resolve(cancelled ? [] : alternatives);
    };
    // The listening limit starts when the microphone opens, not while the permission prompt is up.
    r.onaudiostart = () => {
      timer = setTimeout(() => r.stop(), MAX_LISTEN_MS);
    };
    const giveUp = setTimeout(() => {
      r.abort();
      settle();
    }, GIVE_UP_MS);

    r.onresult = (e) => {
      // Each result is one stretch of speech; join them, alternative by alternative.
      const results = Array.from({ length: e.results.length }, (_, i) => e.results[i]);
      const count = Math.max(...results.map((res) => res.length));
      alternatives = Array.from({ length: count }, (_, a) =>
        results.map((res) => (res[a] ?? res[0]).transcript.trim()).join(' ').trim(),
      ).filter(Boolean);
      if (alternatives[0]) onHearing?.(alternatives[0]);
    };
    r.onerror = (e) => {
      if (e.error === 'language-not-supported') {
        languageUnsupported = true;
        failure = new ListenError('unsupported');
      } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        failure = new ListenError('denied');
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
  const listening: Listening = {
    result,
    stop: () => recognition?.stop(),
    cancel: () => {
      cancelled = true;
      recognition?.abort();
    },
  };
  active = listening;
  void result.catch(() => {}).finally(() => {
    if (active === listening) active = null;
  });
  return listening;
}

let active: Listening | null = null;

/** Cancel any listening in progress, e.g. when leaving a screen. */
export function cancelListening(): void {
  active?.cancel();
}
