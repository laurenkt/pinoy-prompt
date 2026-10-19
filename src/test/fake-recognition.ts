// A scriptable stand-in for the Web Speech API's SpeechRecognition, so tests
// can play out what a real recogniser does: open the mic, hear sound, send
// interim and final transcripts, fail, or (like some phones) never report
// the end after stop().

export interface FakeOptions {
  /** Whether stop() and abort() lead to an end event, as the spec says they should. */
  endsOnStop?: boolean;
}

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static options: FakeOptions = {};

  lang = '';
  interimResults = false;
  maxAlternatives = 1;
  continuous = false;
  started = false;
  ended = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  onend: (() => void) | null = null;
  private pending: string[] | null = null;

  /** The recogniser most recently started. */
  static get latest(): FakeRecognition {
    return FakeRecognition.instances[FakeRecognition.instances.length - 1];
  }

  /** Install as window.SpeechRecognition; returns a function that removes it. */
  static install(options: FakeOptions = {}): () => void {
    FakeRecognition.instances = [];
    FakeRecognition.options = { endsOnStop: true, ...options };
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    return () => {
      delete w.SpeechRecognition;
    };
  }

  start(): void {
    this.started = true;
    FakeRecognition.instances.push(this);
  }

  stop(): void {
    if (!FakeRecognition.options.endsOnStop || this.ended) return;
    // Like Chrome: what was heard so far comes back as a final result, then the end.
    if (this.pending) this.results(this.pending, true);
    this.end();
  }

  abort(): void {
    if (!FakeRecognition.options.endsOnStop || this.ended) return;
    this.onerror?.({ error: 'aborted' });
    this.end();
  }

  audioStart(): void {
    this.onaudiostart?.();
  }

  soundStart(): void {
    this.onsoundstart?.();
    this.onspeechstart?.();
  }

  soundEnd(): void {
    this.onsoundend?.();
  }

  /** Send transcripts (best first) as one result. */
  results(alternatives: string[], isFinal: boolean): void {
    this.pending = isFinal ? null : alternatives;
    const result = Object.assign(alternatives.map((transcript) => ({ transcript })), { isFinal });
    this.onresult?.({ results: [result] });
  }

  error(code: string): void {
    this.onerror?.({ error: code });
  }

  end(): void {
    this.ended = true;
    this.onend?.();
  }
}
