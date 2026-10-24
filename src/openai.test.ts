// @vitest-environment happy-dom
// The OpenAI client, with stand-ins for the network, microphone and WebRTC.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSpend,
  AiError,
  callCost,
  CENTS_PER_MINUTE,
  CHECK_MODEL,
  checkMeaning,
  transcribe,
  transcriptionCost,
  TRANSCRIBE_PRICES,
  TRANSCRIBE_MODEL,
  errorText,
  forgetApiKey,
  getApiKey,
  MAX_CALL_SECONDS,
  setApiKey,
  forgetRetiredVoiceChoice,
  getSpend,
  PRICES,
  startCall,
  tokenCost,
  VOICE_MODEL,
  type CallDeps,
  type CallEvents,
} from './openai';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('the API key', () => {
  beforeEach(() => localStorage.clear());

  it('is saved trimmed, and forgotten', () => {
    expect(getApiKey()).toBeNull();
    expect(setApiKey(`  ${KEY}\n`)).toBe(true);
    expect(getApiKey()).toBe(KEY);
    forgetApiKey();
    expect(getApiKey()).toBeNull();
  });

  it("isn't saved when it doesn't look like a key", () => {
    expect(setApiKey('hello')).toBe(false);
    expect(setApiKey('sk-short')).toBe(false);
    expect(getApiKey()).toBeNull();
  });

  it('is kept apart from progress, so backups never include it', () => {
    setApiKey(KEY);
    expect(Object.keys(localStorage).filter((k) => localStorage.getItem(k) === KEY)).toEqual(['pinoy-prompt:openai-key']);
  });
});

const PROMPT = { instructions: '', greeting: 'Say hi.' };

class FakeChannel {
  readyState = 'open';
  sent: unknown[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakePeer {
  channel = new FakeChannel();
  tracks: unknown[] = [];
  remote: RTCSessionDescriptionInit | null = null;
  closed = false;
  connectionState = 'new';
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  createDataChannel(label: string) {
    expect(label).toBe('oai-events');
    return this.channel;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
  }
  close() {
    this.closed = true;
    this.channel.readyState = 'closed';
    this.channel.onclose?.();
  }
  setState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function fakeCall(response: Response) {
  const peer = new FakePeer();
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const mic = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response);
  const deps: CallDeps = {
    fetch: fetchFn as typeof fetch,
    getMicrophone: async () => mic,
    createPeer: () => peer as unknown as RTCPeerConnection,
    createSpeaker: () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLAudioElement,
  };
  const events = {
    onTranscript: vi.fn(),
    onStarted: vi.fn(),
    onUsage: vi.fn(),
    onEnded: vi.fn(),
  } satisfies CallEvents;
  return { peer, track, fetchFn, deps, events };
}

describe('the retired voice choice', () => {
  afterEach(() => localStorage.clear());

  it('is cleared, leaving the key alone', () => {
    localStorage.setItem('pinoy-prompt:talk-voice', 'marin');
    localStorage.setItem('pinoy-prompt:openai-key', KEY);
    forgetRetiredVoiceChoice();
    expect(localStorage.getItem('pinoy-prompt:talk-voice')).toBeNull();
    expect(localStorage.getItem('pinoy-prompt:openai-key')).toBe(KEY);
  });
});

describe('startCall', () => {
  afterEach(() => vi.useRealTimers());

  it('starts a GPT-Live session in the Beacon voice with the browser offer and applies the answer', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }));
    await startCall(KEY, { instructions: 'Talk Taglish.', greeting: 'Say hi.' }, f.events, f.deps);
    const [url, init] = f.fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    const body = JSON.parse(String(init!.body));
    expect(body.session.model).toBe(VOICE_MODEL);
    expect(body.session.instructions).toBe('Talk Taglish.');
    expect(body.session.input).toEqual([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Say hi.' }] }]);
    expect(body.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' });
    expect(f.peer.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(f.peer.tracks).toHaveLength(1);
    expect(body.session.audio).toEqual({ output: { voice: 'beacon' } });
  });

  it('passes on transcripts and usage, and hangs up cleanly', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    const call = await startCall(KEY, PROMPT, f.events, f.deps);
    f.peer.channel.emit({ type: 'session.started', session: {} });
    f.peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Kumusta', start_ms: 100, end_ms: 600 });
    f.peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Mabuti', start_ms: 900, end_ms: 1400 });
    f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 12.5 } });
    expect(f.events.onStarted).toHaveBeenCalledOnce();
    expect(f.events.onTranscript.mock.calls).toEqual([['ai', 'Kumusta', 100, 600], ['you', 'Mabuti', 900, 1400]]);
    expect(f.events.onUsage).toHaveBeenCalledWith(12.5);
    call.setMuted(true);
    expect(f.track.enabled).toBe(false);
    call.hangUp();
    call.hangUp();
    expect(f.peer.channel.sent).toEqual([
      { type: 'session.commentary.append', event_id: 'greeting', delegation_id: null, content: 'Say hi.' },
      { type: 'session.close' },
    ]);
    expect(f.peer.closed).toBe(true);
    expect(f.track.stopped).toBe(true);
    expect(f.events.onEnded).toHaveBeenCalledOnce();
  });

  it('hands over the microphone and the AI voice to show', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    const onAudio = vi.fn();
    await startCall(KEY, PROMPT, { ...f.events, onAudio }, f.deps);
    const voice = {} as MediaStream;
    f.peer.ontrack!({ streams: [voice], track: {} });
    expect(onAudio.mock.calls.map(([who]) => who)).toEqual(['you', 'ai']);
    expect(onAudio.mock.calls[1][1]).toBe(voice);
  });

  it('asks for the greeting once, and still starts if that fails', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, PROMPT, f.events, f.deps);
    let tries = 0;
    f.peer.channel.send = () => {
      tries++;
      throw new Error('closing');
    };
    f.peer.channel.emit({ type: 'session.started', session: {} });
    f.peer.channel.emit({ type: 'session.started', session: {} });
    expect(f.events.onStarted).toHaveBeenCalledTimes(2);
    expect(tries).toBe(1);
  });

  it('ends on its own after the time limit', async () => {
    vi.useFakeTimers();
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, PROMPT, f.events, f.deps);
    vi.advanceTimersByTime(MAX_CALL_SECONDS * 1000);
    expect(f.events.onEnded).toHaveBeenCalledOnce();
    expect(f.peer.closed).toBe(true);
  });

  it('releases the microphone when OpenAI refuses the call', async () => {
    const f = fakeCall(json(401, { error: { message: 'Incorrect API key' } }));
    await expect(startCall(KEY, PROMPT, f.events, f.deps)).rejects.toMatchObject({ kind: 'key' });
    expect(f.track.stopped).toBe(true);
    expect(f.peer.closed).toBe(true);
    expect(f.events.onEnded).not.toHaveBeenCalled();
  });

  it('gives up a call abandoned while connecting at once, leaving nothing of it running', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    let request: RequestInit | undefined;
    // OpenAI takes its time to answer, until the request is cancelled.
    f.deps.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }) as typeof fetch;
    const abort = new AbortController();
    const started = startCall(KEY, { ...PROMPT, signal: abort.signal }, f.events, f.deps);
    await vi.waitFor(() => expect(request).toBeDefined());
    abort.abort();
    expect(f.peer.closed).toBe(true);
    expect(f.track.stopped).toBe(true);
    await expect(started).rejects.toBeInstanceOf(AiError);
    expect(f.events.onEnded).not.toHaveBeenCalled();
  });

  it("doesn't start a call already abandoned", async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    const abort = new AbortController();
    abort.abort();
    await expect(startCall(KEY, { ...PROMPT, signal: abort.signal }, f.events, f.deps)).rejects.toBeInstanceOf(AiError);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it('turns refusals into errors the learner can act on', async () => {
    const refused = async (response: Response | Error) => {
      const f = fakeCall(json(201, {}));
      f.deps.fetch = (async () => {
        if (response instanceof Error) throw response;
        return response;
      }) as typeof fetch;
      return startCall(KEY, PROMPT, f.events, f.deps).then(
        () => { throw new Error('expected a failure'); },
        (e: AiError) => e,
      );
    };
    expect((await refused(json(401, { error: { message: 'Incorrect API key' } }))).kind).toBe('key');
    expect((await refused(json(429, { error: { code: 'insufficient_quota', message: 'quota' } }))).kind).toBe('quota');
    expect((await refused(json(404, { error: { code: 'model_not_found', message: 'nope' } }))).kind).toBe('access');
    expect((await refused(new TypeError('Failed to fetch'))).kind).toBe('network');
    const other = await refused(new Response('Bad gateway', { status: 502 }));
    expect(other.kind).toBe('other');
    expect(errorText(other)).toContain('Bad gateway');
    expect((await refused(json(201, { session: { id: 'live_1' } }))).message).toContain('without an answer');
  });

  it('ends with an error when the call drops without OpenAI closing it', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, PROMPT, f.events, f.deps);
    f.peer.channel.readyState = 'closed';
    f.peer.channel.onclose!();
    expect(f.events.onEnded).toHaveBeenCalledOnce();
    expect(f.events.onEnded.mock.calls[0][0]).toMatchObject({ kind: 'network' });
    expect(f.track.stopped).toBe(true);
  });

  it('gives a disconnection a few seconds to recover before ending', async () => {
    vi.useFakeTimers();
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, PROMPT, f.events, f.deps);
    f.peer.setState('disconnected');
    vi.advanceTimersByTime(3000);
    f.peer.setState('connected');
    vi.advanceTimersByTime(10_000);
    expect(f.events.onEnded).not.toHaveBeenCalled();
    f.peer.setState('disconnected');
    vi.advanceTimersByTime(5000);
    expect(f.events.onEnded).toHaveBeenCalledOnce();
  });

  it('ends quietly when OpenAI closes the session', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, PROMPT, f.events, f.deps);
    f.peer.channel.emit({ type: 'session.closed', reason: 'expired' });
    expect(f.events.onEnded).toHaveBeenCalledWith(undefined);
    f.peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'late' });
    expect(f.events.onTranscript).not.toHaveBeenCalled();
  });

  it('releases the microphone when setting up the connection fails', async () => {
    const f = fakeCall(json(201, {}));
    f.deps.createPeer = () => {
      throw new Error('no WebRTC');
    };
    await expect(startCall(KEY, PROMPT, f.events, f.deps)).rejects.toMatchObject({ kind: 'other' });
    expect(f.track.stopped).toBe(true);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it('says so when the microphone is refused', async () => {
    const f = fakeCall(json(201, {}));
    f.deps.getMicrophone = async () => {
      throw new DOMException('denied', 'NotAllowedError');
    };
    await expect(startCall(KEY, PROMPT, f.events, f.deps)).rejects.toThrow(/microphone/);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });
});

describe('checking a typed meaning', () => {
  const CARD = { tl: 'Maraming salamat', en: 'Thank you very much', answer: 'thanks a lot' };
  const verdict = (right: boolean) => json(200, { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ right }) }] }] });

  it('sends only the card and the answer, and reads back the verdict', async () => {
    const fetchFn = vi.fn(async () => verdict(true));
    expect(await checkMeaning(KEY, CARD, fetchFn as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(CHECK_MODEL);
    expect(body.store).toBe(false);
    expect(body.input).toBe('Tagalog: Maraming salamat\nMeaning: Thank you very much\nAnswer: thanks a lot');
    // Saying the Tagalog back means the same, but the answer has to be in English.
    expect(body.instructions).toMatch(/has to be in English.*repeat the Tagalog/s);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('checks Tagalog given for the English as Tagalog, and turns down the English said back', async () => {
    const fetchFn = vi.fn(async () => verdict(true));
    await checkMeaning(KEY, { ...CARD, answer: 'salamat nang marami', language: 'tl' }, fetchFn as unknown as typeof fetch);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.input).toBe('Tagalog: Maraming salamat\nMeaning: Thank you very much\nAnswer: salamat nang marami');
    expect(body.instructions).toMatch(/how to say it in Tagalog/);
    expect(body.instructions).toMatch(/has to be in Tagalog.*repeat the English/s);
  });

  it('reads a wrong verdict', async () => {
    expect(await checkMeaning(KEY, CARD, (async () => verdict(false)) as unknown as typeof fetch)).toBe(false);
  });

  it('fails on a bad key, a lost connection or no verdict', async () => {
    await expect(checkMeaning(KEY, CARD, (async () => json(401, { error: { message: 'bad key' } })) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'key' });
    await expect(checkMeaning(KEY, CARD, (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
    await expect(checkMeaning(KEY, CARD, (async () => json(200, { output: [] })) as unknown as typeof fetch)).rejects.toBeInstanceOf(AiError);
  });

  it('gives up on an answer that stalls, as a lost connection, and leaves no time limit behind', async () => {
    vi.useFakeTimers();
    try {
      // Headers in, then the body never comes: the body breaks off when the request is given up, as fetch's does.
      const stalling = vi.fn(async (_url: string, init: RequestInit) => ({
        ok: true,
        status: 200,
        json: () => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      }));
      const checked = expect(checkMeaning(KEY, CARD, stalling as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
      await vi.advanceTimersByTimeAsync(8000);
      await checked;

      const heard = expect(transcribe(KEY, new Blob(), 'en', stalling as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
      await vi.advanceTimersByTimeAsync(19000);
      expect(stalling).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      await heard;

      await checkMeaning(KEY, CARD, (async () => verdict(true)) as unknown as typeof fetch);
      await transcribe(KEY, new Blob(), 'en', (async () => json(200, { text: 'hi' })) as unknown as typeof fetch);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails as a lost connection when the answer breaks off', async () => {
    const broken = { ok: true, status: 200, json: () => Promise.reject(new DOMException('Aborted', 'AbortError')) } as unknown as Response;
    await expect(checkMeaning(KEY, CARD, (async () => broken) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
    await expect(transcribe(KEY, new Blob(), 'en', (async () => broken) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
  });

  it("doesn't blame the connection for an answer that isn't JSON", async () => {
    const page = new Response('<html>Sign in to the Wi-Fi</html>', { status: 200 });
    await expect(checkMeaning(KEY, CARD, (async () => page) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('the spend estimate', () => {
  beforeEach(() => localStorage.clear());
  const OCT = new Date(2026, 9, 31, 23, 0).getTime();
  const NOV = new Date(2026, 10, 1, 0, 30).getTime();

  it('has a price for every token-billed model the app uses', () => {
    expect(PRICES[CHECK_MODEL]).toBeDefined();
  });

  it('prices tokens from the usage OpenAI reports, cached input at its own rate', () => {
    const price = PRICES[CHECK_MODEL];
    expect(tokenCost(CHECK_MODEL, { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(price.input + price.output);
    expect(tokenCost(CHECK_MODEL, { input_tokens: 1e6, input_tokens_details: { cached_tokens: 1e6 } })).toBeCloseTo(price.cachedInput);
    expect(tokenCost(CHECK_MODEL, undefined)).toBe(0);
    expect(tokenCost('unknown-model', { input_tokens: 100 })).toBe(0);
  });

  it('prices call time by the minute', () => {
    expect(callCost(60)).toBeCloseTo(CENTS_PER_MINUTE / 100);
    expect(callCost(0)).toBe(0);
  });

  it('keeps an all-time total and one for each calendar month', () => {
    expect(getSpend(OCT)).toEqual({ total: 0, month: 0 });
    addSpend(0.25, OCT);
    addSpend(0.5, OCT);
    addSpend(0.1, NOV);
    expect(getSpend(OCT).month).toBeCloseTo(0.75);
    expect(getSpend(NOV).month).toBeCloseTo(0.1);
    expect(getSpend(NOV).total).toBeCloseTo(0.85);
  });

  it('ignores nothing-costs and survives a damaged copy', () => {
    addSpend(0, OCT);
    addSpend(Number.NaN, OCT);
    expect(localStorage.getItem('pinoy-prompt:openai-spend')).toBeNull();
    localStorage.setItem('pinoy-prompt:openai-spend', '{not json');
    addSpend(0.2, OCT);
    expect(getSpend(OCT)).toEqual({ total: 0.2, month: 0.2 });
  });

  it('is kept apart from progress and the key, and forgetting the key keeps it', () => {
    setApiKey(KEY);
    addSpend(1, OCT);
    forgetApiKey();
    expect(Object.keys(localStorage)).toEqual(['pinoy-prompt:openai-spend']);
    expect(getSpend(OCT).total).toBe(1);
  });

  it('adds what a meaning check used', async () => {
    const answer = json(200, {
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"right":true}' }] }],
      usage: { input_tokens: 200, output_tokens: 10 },
    });
    await checkMeaning(KEY, { tl: 'Salamat', en: 'Thank you', answer: 'thanks' }, (async () => answer) as unknown as typeof fetch);
    expect(getSpend().total).toBeCloseTo(tokenCost(CHECK_MODEL, { input_tokens: 200, output_tokens: 10 }));
    expect(getSpend().total).toBeGreaterThan(0);
  });

  it("adds a call's time as OpenAI reports it, counting each second once", async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    const call = await startCall(KEY, PROMPT, f.events, f.deps);
    f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 30 } });
    f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 90 } });
    f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 90 } });
    call.hangUp();
    expect(getSpend().total).toBeCloseTo(callCost(90));
  });

  it("counts the time after OpenAI's last report when the call ends", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
      const call = await startCall(KEY, PROMPT, f.events, f.deps);
      f.peer.channel.emit({ type: 'session.started', session: {} });
      vi.advanceTimersByTime(30_000);
      f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 30 } });
      vi.advanceTimersByTime(25_000);
      call.hangUp();
      expect(getSpend().total).toBeCloseTo(callCost(55));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('hearing a spoken answer', () => {
  it('sends only the recording, in English, and reads back the text', async () => {
    const fetchFn = vi.fn(async () => json(200, { text: ' Thanks a lot. ' }));
    expect(await transcribe(KEY, new Blob(['x'], { type: 'audio/wav' }), 'en', fetchFn as unknown as typeof fetch)).toBe('Thanks a lot.');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = init.body as FormData;
    expect(form.get('model')).toBe(TRANSCRIBE_MODEL);
    expect(form.get('language')).toBe('en');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('hears Tagalog as Tagalog, written as said, without being told the answer', async () => {
    const fetchFn = vi.fn(async () => json(200, { text: 'Salamat po.' }));
    expect(await transcribe(KEY, new Blob(['x']), 'tl', fetchFn as unknown as typeof fetch)).toBe('Salamat po.');
    const form = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get('language')).toBe('tl');
    expect(form.get('prompt')).toBe('Someone saying a Tagalog word or phrase, written down exactly as said, in Tagalog spelling.');
    expect(form.get('prompt')).not.toContain('Salamat');
  });

  it('counts what it cost, audio and text at their own rates', async () => {
    localStorage.clear();
    const usage = { input_tokens: 1e6, input_token_details: { audio_tokens: 0.8e6, text_tokens: 0.2e6 }, output_tokens: 1e6 };
    const cost = 0.8 * TRANSCRIBE_PRICES.audioInput + 0.2 * TRANSCRIBE_PRICES.textInput + TRANSCRIBE_PRICES.output;
    expect(transcriptionCost(usage)).toBeCloseTo(cost);
    expect(transcriptionCost(undefined)).toBe(0);
    await transcribe(KEY, new Blob(), 'en', (async () => json(200, { text: 'hi', usage })) as unknown as typeof fetch);
    expect(getSpend().total).toBeCloseTo(cost);
  });

  it('fails on a bad key or a lost connection', async () => {
    await expect(transcribe(KEY, new Blob(), 'en', (async () => json(401, { error: { message: 'bad key' } })) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'key' });
    await expect(transcribe(KEY, new Blob(), 'en', (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'network' });
  });
});
