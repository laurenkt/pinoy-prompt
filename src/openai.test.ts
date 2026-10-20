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
  startCall,
  textReply,
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

describe('textReply', () => {
  it('sends the conversation and reads the reply text', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json(200, {
        output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', content: [{ type: 'output_text', text: 'Kumusta? ' }, { type: 'output_text', text: 'How was your day?' }] },
        ],
      }),
    );
    const text = await textReply(KEY, 'Be kind.', [
      { who: 'ai', text: 'Hi!' },
      { who: 'you', text: 'Mabuti naman.' },
    ], fetchFn as typeof fetch);
    expect(text).toBe('Kumusta? How was your day?');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init!.body));
    expect(body.instructions).toBe('Be kind.');
    expect(body.store).toBe(false);
    // An opening user turn comes first, since the AI spoke first.
    expect(body.input.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('turns failures into errors the learner can act on', async () => {
    const reply = (response: Response | Error) =>
      textReply(KEY, '', [], (async () => {
        if (response instanceof Error) throw response;
        return response;
      }) as typeof fetch).then(
        () => { throw new Error('expected a failure'); },
        (e: AiError) => e,
      );
    expect((await reply(json(401, { error: { message: 'Incorrect API key' } }))).kind).toBe('key');
    expect((await reply(json(429, { error: { code: 'insufficient_quota', message: 'quota' } }))).kind).toBe('quota');
    expect((await reply(json(404, { error: { code: 'model_not_found', message: 'nope' } }))).kind).toBe('access');
    expect((await reply(new TypeError('Failed to fetch'))).kind).toBe('network');
    const other = await reply(new Response('Bad gateway', { status: 502 }));
    expect(other.kind).toBe('other');
    expect(errorText(other)).toContain('Bad gateway');
    expect((await reply(json(200, { output: [] }))).message).toBe('The reply was empty.');
  });
});

class FakeChannel {
  readyState = 'open';
  sent: unknown[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
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

describe('startCall', () => {
  afterEach(() => vi.useRealTimers());

  it('starts a GPT-Live session with the browser offer and applies the answer', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }));
    await startCall(KEY, 'Talk Tagalog.', f.events, f.deps);
    const [url, init] = f.fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    const body = JSON.parse(String(init!.body));
    expect(body.session.model).toBe(VOICE_MODEL);
    expect(body.session.instructions).toBe('Talk Tagalog.');
    expect(body.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' });
    expect(f.peer.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(f.peer.tracks).toHaveLength(1);
  });

  it('passes on transcripts and usage, and hangs up cleanly', async () => {
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    const call = await startCall(KEY, '', f.events, f.deps);
    f.peer.channel.emit({ type: 'session.started', session: {} });
    f.peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Kumusta' });
    f.peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Mabuti' });
    f.peer.channel.emit({ type: 'session.usage.updated', usage: { seconds: 12.5 } });
    expect(f.events.onStarted).toHaveBeenCalledOnce();
    expect(f.events.onTranscript.mock.calls).toEqual([['ai', 'Kumusta'], ['you', 'Mabuti']]);
    expect(f.events.onUsage).toHaveBeenCalledWith(12.5);
    call.setMuted(true);
    expect(f.track.enabled).toBe(false);
    call.hangUp();
    call.hangUp();
    expect(f.peer.channel.sent).toEqual([{ type: 'session.close' }]);
    expect(f.peer.closed).toBe(true);
    expect(f.track.stopped).toBe(true);
    expect(f.events.onEnded).toHaveBeenCalledOnce();
  });

  it('ends on its own after the time limit', async () => {
    vi.useFakeTimers();
    const f = fakeCall(json(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }));
    await startCall(KEY, '', f.events, f.deps);
    vi.advanceTimersByTime(MAX_CALL_SECONDS * 1000);
    expect(f.events.onEnded).toHaveBeenCalledOnce();
    expect(f.peer.closed).toBe(true);
  });

  it('releases the microphone when OpenAI refuses the call', async () => {
    const f = fakeCall(json(401, { error: { message: 'Incorrect API key' } }));
    await expect(startCall(KEY, '', f.events, f.deps)).rejects.toMatchObject({ kind: 'key' });
    expect(f.track.stopped).toBe(true);
    expect(f.peer.closed).toBe(true);
    expect(f.events.onEnded).not.toHaveBeenCalled();
  });

  it('says so when the microphone is refused', async () => {
    const f = fakeCall(json(201, {}));
    f.deps.getMicrophone = async () => {
      throw new DOMException('denied', 'NotAllowedError');
    };
    await expect(startCall(KEY, '', f.events, f.deps)).rejects.toThrow(/microphone/);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });
});
