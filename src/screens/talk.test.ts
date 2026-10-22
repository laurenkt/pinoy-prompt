// @vitest-environment happy-dom
// The Talk screen, with stand-ins for OpenAI, the microphone and WebRTC.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { setApiKey, type CallDeps } from '../openai';
import { stop } from '../speech';
import { emptyProgress, recordAnswer } from '../store';
import { hangUpTalk, talkScreen, type TalkDeps } from './talk';

vi.mock('../speech', async (actual) => ({ ...(await actual<typeof import('../speech')>()), stop: vi.fn() }));

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const KNOWN = ['salamat', 'kumusta', 'oo', 'kape'];

function fakeApp(known = KNOWN) {
  const now = Date.now();
  const progress = emptyProgress(now);
  for (const id of known) recordAnswer(progress, id, 'good', now);
  const app = { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: vi.fn<App['navigate']>(), onKey: () => {}, onBack: () => {} };
  return app satisfies App;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No "${text}" button`);
  return found;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A call that connects straight away; `say` sends what OpenAI would on the data channel. */
function fakeCall(response: Response = new Response(JSON.stringify({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 })) {
  let channel: { onmessage: ((e: { data: string }) => void) | null; readyState: string; send: () => void } | null = null;
  const peer = {
    closed: false,
    ontrack: null as ((e: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null,
    addTrack() {},
    createDataChannel() {
      channel = { onmessage: null, readyState: 'open', send() {} };
      return channel;
    },
    createOffer: async () => ({ type: 'offer', sdp: 'offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {},
    close() {
      this.closed = true;
    },
  };
  const track = { enabled: true, stop() {} };
  const visual = { shown: [] as string[], muted: false, stopped: false };
  const visualizer = () => ({
    listen: (who: string) => void visual.shown.push(who),
    setMuted: (m: boolean) => void (visual.muted = m),
    stop: () => void (visual.stopped = true),
  });
  const call: CallDeps = {
    fetch: (async () => response) as typeof fetch,
    getMicrophone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    createPeer: () => peer as unknown as RTCPeerConnection,
    createSpeaker: () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLAudioElement,
  };
  const send = (event: object) => channel!.onmessage!({ data: JSON.stringify(event) });
  return {
    peer,
    track,
    visual,
    deps: { call, callSupported: () => true, visualizer } satisfies TalkDeps,
    send,
    say: (who: 'ai' | 'you', delta: string) => send({ type: who === 'ai' ? 'session.output_transcript.delta' : 'session.input_transcript.delta', delta }),
  };
}

/** The transcript as shown, without the meanings beside words. */
function transcript(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.bubble')].map((b) => {
    const copy = b.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.gloss').forEach((g) => g.remove());
    return copy.textContent ?? '';
  });
}

describe('Talk', () => {
  beforeEach(() => {
    localStorage.clear();
    hangUpTalk();
  });

  it('asks for a key first, and moves on once one is saved', () => {
    const root = talkScreen(fakeApp(), fakeCall().deps);
    expect(root.textContent).toContain('own OpenAI API key');
    const input = root.querySelector<HTMLInputElement>('.key-input')!;
    input.value = 'not a key';
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(root.querySelector('.key-problem')!.hasAttribute('hidden')).toBe(false);
    input.value = KEY;
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(button(root, 'Start talking')).toBeTruthy();
  });

  it('waits until a few words are known', () => {
    setApiKey(KEY);
    const root = talkScreen(fakeApp(['salamat']), fakeCall().deps);
    expect(root.textContent).toContain('Learn at least 4 words first');
  });

  it('offers topics with words met, and the new word for that topic', () => {
    setApiKey(KEY);
    const root = talkScreen(fakeApp(), fakeCall().deps);
    const topics = [...root.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(topics).toEqual(['Anything', 'Greetings', 'Yes, no & politeness', 'Food & eating']);
    button(root, 'Food & eating').click();
    expect(root.textContent).toMatch(/New word this time: \S/);
  });

  it('starts the call straight away when opened from Home, and offers topics after', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps, true);
    expect(root.textContent).toContain('Connecting');
    await flush();
    f.send({ type: 'session.started' });
    button(root, 'End call').click();
    button(root, 'Change topic').click();
    expect(button(root, 'Start talking')).toBeTruthy();
  });

  it('still asks for a key first when opened from Home', () => {
    const root = talkScreen(fakeApp(), fakeCall().deps, true);
    expect(root.textContent).toContain('own OpenAI API key');
  });

  it('runs a call, shows its transcript, and hangs up on leaving', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const app = fakeApp();
    const root = talkScreen(app, f.deps);
    button(root, 'Start talking').click();
    expect(root.textContent).toContain('Connecting');
    await flush();
    f.send({ type: 'session.started' });
    expect(root.textContent).toContain('Listening');
    f.say('ai', 'Kumusta! ');
    f.say('ai', 'Want some kape?');
    f.say('you', 'Oo, salamat.');
    f.send({ type: 'session.usage.updated', usage: { seconds: 75 } });
    expect(transcript(root)).toEqual(['Kumusta! Want some kape?', 'Oo, salamat.']);
    expect([...root.querySelectorAll('.bubble.ai .tl-word button')].map((b) => b.textContent)).toEqual(['Kumusta', 'kape']);
    expect(root.querySelector('.talk-meter')!.textContent).toBe('1:15 · about 7¢');
    button(root, 'Mute').click();
    expect(f.track.enabled).toBe(false);
    expect(root.textContent).toContain('Muted');
    root.querySelector<HTMLButtonElement>('[aria-label="Leave Chat"]')!.click();
    expect(f.peer.closed).toBe(true);
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' });
  });

  it('shows a word\'s meaning once tapped, and keeps it through later redraws', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const app = fakeApp();
    const root = talkScreen(app, f.deps);
    button(root, 'Start talking').click();
    await flush();
    f.say('ai', 'Kumusta! Want some kape?');
    const gloss = (word: string) =>
      [...root.querySelectorAll<HTMLElement>('.tl-word')].find((w) => w.querySelector('button')!.textContent === word)!.querySelector<HTMLElement>('.gloss')!;
    expect(gloss('Kumusta').hidden).toBe(true);
    expect(gloss('kape').hidden).toBe(true);
    gloss('kape').parentElement!.querySelector('button')!.click();
    expect(gloss('kape').hidden).toBe(false);
    f.say('ai', ' Or tea?');
    expect(gloss('kape').hidden).toBe(false);
  });

  it('ends the call from the button, and offers another', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    await flush();
    f.send({ type: 'session.started' });
    button(root, 'End call').click();
    expect(f.peer.closed).toBe(true);
    expect(button(root, 'Chat again')).toBeTruthy();
  });

  it("stops a word still playing before the call starts", async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps);
    vi.mocked(stop).mockClear();
    button(root, 'Start talking').click();
    expect(stop).toHaveBeenCalled();
  });

  it('says what went wrong when OpenAI refuses the call', async () => {
    setApiKey(KEY);
    const f = fakeCall(new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'x' } }), { status: 429 }));
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('out of credit');
  });

  it('hangs up a call that connects after it was ended, and keeps the next one', async () => {
    setApiKey(KEY);
    const answer = () => new Response(JSON.stringify({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 });
    const first = fakeCall();
    const second = fakeCall();
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    let calls = 0;
    const deps: TalkDeps = {
      ...first.deps,
      call: {
        ...first.deps.call,
        createPeer: () => (calls === 0 ? first.deps.call.createPeer() : second.deps.call.createPeer()),
        fetch: (async () => {
          if (calls++ === 0) await slow;
          return answer();
        }) as typeof fetch,
      },
    };
    const root = talkScreen(fakeApp(), deps);
    button(root, 'Start talking').click();
    await flush();
    button(root, 'End call').click();
    button(root, 'Chat again').click();
    await flush();
    second.send({ type: 'session.started' });
    release();
    await flush();
    expect(first.peer.closed).toBe(true);
    expect(second.peer.closed).toBe(false);
    second.say('ai', 'Kumusta!');
    expect(transcript(root)).toEqual(['Kumusta!']);
    button(root, 'End call').click();
    expect(second.peer.closed).toBe(true);
  });

  it("keeps the controls in place while the transcript grows", async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    await flush();
    f.send({ type: 'session.started' });
    const end = button(root, 'End call');
    const first = root.querySelector('.bubble');
    f.say('ai', 'Kumusta!');
    f.say('ai', ' Salamat.');
    expect(button(root, 'End call')).toBe(end);
    expect(first).toBeNull();
    expect(transcript(root)).toEqual(['Kumusta! Salamat.']);
  });

  it('shows both voices moving while the call is on, and stops when it ends', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    expect(root.querySelector('canvas.talk-backdrop')).not.toBeNull();
    await flush();
    f.send({ type: 'session.started' });
    f.peer.ontrack!({ streams: [{} as MediaStream], track: {} as MediaStreamTrack });
    expect(f.visual.shown).toEqual(['you', 'ai']);
    button(root, 'Mute').click();
    expect(f.visual.muted).toBe(true);
    button(root, 'End call').click();
    expect(f.visual.stopped).toBe(true);
    expect(root.querySelector('canvas.talk-backdrop')).toBeNull();
  });

  it('stops the visual when a call fails to start, or on leaving', async () => {
    setApiKey(KEY);
    const failed = fakeCall(new Response('{}', { status: 401 }));
    let root = talkScreen(fakeApp(), failed.deps);
    button(root, 'Start talking').click();
    await flush();
    expect(failed.visual.stopped).toBe(true);
    const left = fakeCall();
    root = talkScreen(fakeApp(), left.deps);
    button(root, 'Start talking').click();
    await flush();
    root.querySelector<HTMLButtonElement>('[aria-label="Leave Chat"]')!.click();
    expect(left.visual.stopped).toBe(true);
  });

  it('follows new words in the transcript unless the learner has scrolled back', async () => {
    setApiKey(KEY);
    const f = fakeCall();
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    await flush();
    f.send({ type: 'session.started' });
    const log = root.querySelector<HTMLElement>('.talk-log')!;
    // Each bubble's height, as the browser would lay it out.
    Object.defineProperty(log, 'scrollHeight', { get: () => 300 + [...log.children].reduce((sum, b) => sum + b.textContent!.length * 10, 0) });
    Object.defineProperty(log, 'clientHeight', { get: () => 300 });
    f.say('ai', 'Kumusta!');
    expect(log.scrollTop).toBe(log.scrollHeight);
    f.say('you', 'Mabuti naman.');
    expect(log.scrollTop).toBe(log.scrollHeight);
    log.scrollTop = 0;
    f.say('you', ' Ikaw?');
    expect(log.scrollTop).toBe(0);
  });

  it("explains when the browser can't make calls", () => {
    setApiKey(KEY);
    const root = talkScreen(fakeApp(), { ...fakeCall().deps, callSupported: () => false });
    expect(button(root, 'Start talking').disabled).toBe(true);
    expect(root.textContent).toContain("can't use the microphone");
  });
});
