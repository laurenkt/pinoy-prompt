// @vitest-environment happy-dom
// The Talk screen, with stand-ins for OpenAI, the microphone and WebRTC.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { setApiKey, type CallDeps } from '../openai';
import { emptyProgress, recordAnswer } from '../store';
import { hangUpTalk, talkScreen, type TalkDeps } from './talk';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const KNOWN = ['salamat', 'kumusta', 'oo', 'kape'];

function fakeApp(known = KNOWN) {
  const now = Date.now();
  const progress = emptyProgress(now);
  for (const id of known) recordAnswer(progress, id, 'good', now);
  const app = { progress, now: () => now, commit: () => {}, replaceProgress: () => {}, navigate: vi.fn<App['navigate']>(), onKey: () => {} };
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
  const call: CallDeps = {
    fetch: (async () => response) as typeof fetch,
    getMicrophone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    createPeer: () => peer as unknown as RTCPeerConnection,
    createSpeaker: () => ({ srcObject: null }) as unknown as HTMLAudioElement,
  };
  const send = (event: object) => channel!.onmessage!({ data: JSON.stringify(event) });
  return {
    peer,
    track,
    deps: { call, callSupported: () => true } satisfies TalkDeps,
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
    root.querySelector<HTMLButtonElement>('[aria-label="Leave Talk"]')!.click();
    expect(f.peer.closed).toBe(true);
    expect(app.navigate).toHaveBeenCalledWith({ name: 'practice' });
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
    expect(button(root, 'Talk again')).toBeTruthy();
  });

  it('says what went wrong when OpenAI refuses the call', async () => {
    setApiKey(KEY);
    const f = fakeCall(new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'x' } }), { status: 429 }));
    const root = talkScreen(fakeApp(), f.deps);
    button(root, 'Start talking').click();
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('out of credit');
  });

  it("explains when the browser can't make calls", () => {
    setApiKey(KEY);
    const root = talkScreen(fakeApp(), { ...fakeCall().deps, callSupported: () => false });
    expect(button(root, 'Start talking').disabled).toBe(true);
    expect(root.textContent).toContain("can't use the microphone");
  });
});
