// @vitest-environment happy-dom
// The OpenAI client, with stand-ins for the network, microphone and WebRTC.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiError,
  errorText,
  forgetApiKey,
  getApiKey,
  MAX_CALL_SECONDS,
  setApiKey,
  getTalkVoice,
  setTalkVoice,
  startCall,
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

describe('the Talk voice', () => {
  afterEach(() => localStorage.clear());

  it('is Beacon, the Filipino-accented voice, until another is chosen', () => {
    expect(getTalkVoice()).toBe('beacon');
    setTalkVoice('marin');
    expect(getTalkVoice()).toBe('marin');
  });

  it('falls back to the default for a voice Talk no longer offers', () => {
    localStorage.setItem('pinoy-prompt:talk-voice', 'alloy');
    expect(getTalkVoice()).toBe('beacon');
  });
});

describe('startCall', () => {
  afterEach(() => vi.useRealTimers());

  it('starts a GPT-Live session with the browser offer and applies the answer', async () => {
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

  it('speaks in the chosen voice', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, { ...PROMPT, voice: 'marin' }, f.events, f.deps);
    expect(JSON.parse(String(f.fetchFn.mock.calls[0][1]!.body)).session.audio).toEqual({ output: { voice: 'marin' } });
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
