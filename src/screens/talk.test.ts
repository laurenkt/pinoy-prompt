// @vitest-environment happy-dom
// The Talk screen, with a stand-in for OpenAI.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../app';
import { setApiKey, type CallDeps, type ChatTurn } from '../openai';
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

function deps(overrides: Partial<TalkDeps> = {}): TalkDeps {
  return {
    textReply: vi.fn(async (_key: string, _instructions: string, turns: ChatTurn[]) =>
      turns.length === 0 ? 'Kumusta! Want some kape?' : 'Oo, salamat!',
    ),
    call: {} as CallDeps,
    callSupported: () => true,
    ...overrides,
  };
}

describe('Talk', () => {
  beforeEach(() => {
    localStorage.clear();
    hangUpTalk();
  });

  it('asks for a key first, and moves on once one is saved', () => {
    const root = talkScreen(fakeApp(), deps());
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
    const root = talkScreen(fakeApp(['salamat']), deps());
    expect(root.textContent).toContain('Learn at least 4 words first');
  });

  it('offers topics with words met, and the new word for that topic', () => {
    setApiKey(KEY);
    const root = talkScreen(fakeApp(), deps());
    const topics = [...root.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(topics).toEqual(['Anything', 'Greetings', 'Yes, no & politeness', 'Food & eating']);
    button(root, 'Food & eating').click();
    expect(root.textContent).toMatch(/New word this time: \S/);
  });

  it('holds a typed conversation and marks the Tagalog it knows', async () => {
    setApiKey(KEY);
    const d = deps();
    const root = talkScreen(fakeApp(), d);
    button(root, 'Type instead').click();
    await flush();
    const words = [...root.querySelectorAll('.bubble.ai .tl-word button')].map((b) => b.textContent);
    expect(words).toEqual(['Kumusta', 'kape']);
    const input = root.querySelector<HTMLTextAreaElement>('.talk-input')!;
    input.value = 'Oo please';
    input.dispatchEvent(new Event('input'));
    root.querySelector('.talk-composer')!.dispatchEvent(new Event('submit'));
    expect(root.querySelector('.bubble.you')!.textContent).toBe('Oo please');
    await flush();
    expect(root.querySelectorAll('.bubble.ai')).toHaveLength(2);
    expect(vi.mocked(d.textReply).mock.calls[1][2].map((t) => t.who)).toEqual(['ai', 'you']);
  });

  it('shows a fresh word with its meaning, and a firm one on tap', async () => {
    setApiKey(KEY);
    const app = fakeApp();
    app.progress.cards.kape.interval = 30;
    app.progress.cards.kumusta.interval = 0;
    const root = talkScreen(app, deps());
    button(root, 'Type instead').click();
    await flush();
    const [kumusta, kape] = [...root.querySelectorAll<HTMLElement>('.bubble.ai .tl-word')];
    expect(kumusta.querySelector('.gloss')!.hasAttribute('hidden')).toBe(false);
    expect(kape.querySelector('.gloss')!.hasAttribute('hidden')).toBe(true);
    kape.querySelector('button')!.click();
    expect(kape.querySelector<HTMLElement>('.gloss')!.hidden).toBe(false);
  });

  it('says what went wrong when OpenAI fails', async () => {
    setApiKey(KEY);
    const { AiError } = await import('../openai');
    const root = talkScreen(fakeApp(), deps({ textReply: async () => { throw new AiError('quota', 'x'); } }));
    button(root, 'Type instead').click();
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('out of credit');
  });

  it('runs a spoken call, shows its transcript and hangs up on leaving', async () => {
    setApiKey(KEY);
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
      fetch: (async () => new Response(JSON.stringify({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 })) as typeof fetch,
      getMicrophone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
      createPeer: () => peer as unknown as RTCPeerConnection,
      createSpeaker: () => ({ srcObject: null }) as unknown as HTMLAudioElement,
    };
    const app = fakeApp();
    const root = talkScreen(app, deps({ call }));
    button(root, 'Start talking').click();
    expect(root.textContent).toContain('Connecting');
    await flush();
    const say = (type: string, delta: string) => channel!.onmessage!({ data: JSON.stringify({ type, delta }) });
    channel!.onmessage!({ data: JSON.stringify({ type: 'session.started' }) });
    say('session.output_transcript.delta', 'Kumusta! ');
    say('session.output_transcript.delta', 'How are you?');
    say('session.input_transcript.delta', 'Mabuti, salamat.');
    channel!.onmessage!({ data: JSON.stringify({ type: 'session.usage.updated', usage: { seconds: 75 } }) });
    root.querySelectorAll('.gloss').forEach((g) => g.remove());
    expect([...root.querySelectorAll('.bubble')].map((b) => b.textContent)).toEqual(['Kumusta! How are you?', 'Mabuti, salamat.']);
    expect(root.querySelector('.talk-meter')!.textContent).toBe('1:15 · about 7¢');
    button(root, 'Mute').click();
    expect(track.enabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[aria-label="Leave Talk"]')!.click();
    expect(peer.closed).toBe(true);
    expect(app.navigate).toHaveBeenCalledWith({ name: 'practice' });
  });
});
