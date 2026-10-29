// @vitest-environment happy-dom
// Walk and talk, both ways of running it, with stand-ins for the microphone, the speech model and the call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard, type Card } from '../deck';
import { setApiKey, forgetApiKey, type CallDeps } from '../openai';
import { toPhones } from '../phonetics';
import type { Take } from '../recorder';
import { drillNote } from '../session';
import prompts from '../prompt-clips.json';
import { spokenMeaning, WALK_LINES } from '../walk';
import { FakeAudioContext, chimes } from '../test/fake-audio';
import { fakeRecognition } from '../test/fake-speech';
import { button, fakeApp, flush } from '../test/screen';
import type { SpeakDeps } from './speak';
import { settingsScreen } from './settings';
import { endWalk, walkScreen, type WalkDeps, type WalkView } from './walk';
import { startLiveWalk } from './walk-live';
import type { WalkOutcome, WalkQuestion, WalkRound } from '../walk';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const KNOWN = ['salamat', 'kumusta', 'oo', 'kape', 'paalam'];

/** The card on show, from its prompt. */
function asked(): Card {
  const en = document.querySelector('.prompt-en')?.textContent;
  const tl = document.querySelector('.prompt .tl')?.textContent;
  return KNOWN.map((id) => getCard(id)!).find((c) => spokenMeaning(c) === en || c.tl === tl)!;
}

const sounds = (text: string) => toPhones(text).filter((p) => !p.optional).map((p) => p.ipa);

/** Waits until `check` holds, letting the round's own short waits run. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out in: ${document.body.textContent}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A microphone whose takes the test answers, and a model that hears what the test says was said. */
function clipsDeps() {
  const takes: ((t: Take) => void)[] = [];
  let heard: string[] = [];
  /** Takes answered so far. */
  let answered = 0;
  const speak = {
    recordingSupported: () => true,
    modelDownloaded: async () => true,
    record: (() => {
      const audio = new Promise<Take>((r) => takes.push(r));
      return { audio, stop() {}, cancel: () => takes.at(-1)?.({ samples: new Float32Array(0), speech: false }) };
    }) as unknown as SpeakDeps['record'],
    loadPhoneModel: async () => ({ recognise: async () => fakeRecognition(heard) }),
    holdMicrophone: vi.fn(),
    askMicrophone: async () => true,
  } as unknown as SpeakDeps;
  const deps: WalkDeps = { speak, call: {} as CallDeps, callSupported: () => true, askMeaning: null };
  return {
    deps,
    speak,
    /** Wait for the round to listen, then answer with these sounds (none: silence). */
    async say(text: string | null) {
      await until(() => takes.length > answered);
      heard = text ? sounds(text) : [];
      takes[answered++]({ samples: new Float32Array(1), speech: text !== null });
    },
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  chimes.count = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  endWalk();
  forgetApiKey();
  vi.unstubAllGlobals();
});

describe('opening walk and talk', () => {
  it('is opened from Settings, in either version', () => {
    const app = fakeApp(KNOWN);
    const root = settingsScreen(app);
    button(root, 'Walk and talk').click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'walk', engine: 'clips' });
    button(root, 'Walk and talk live').click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'walk', engine: 'live' });
  });

  it('is a session that closes to Home', () => {
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'clips', clipsDeps().deps);
    expect(root.querySelectorAll('.session-header')).toHaveLength(1);
    expect(root.querySelectorAll('.back-bar')).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('.session-header .icon-btn')!.click();
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' });
  });

  it('needs the sound and the mic on, and words to drill', () => {
    expect(walkScreen(fakeApp(KNOWN, { sound: false }), 'clips', clipsDeps().deps).textContent).toContain('needs the sound and the mic on');
    expect(walkScreen(fakeApp(KNOWN, { mic: false }), 'clips', clipsDeps().deps).textContent).toContain('needs the sound and the mic on');
    expect(walkScreen(fakeApp(['salamat']), 'clips', clipsDeps().deps).textContent).toContain('Learn at least');
  });

  it('asks for a key before the live version', () => {
    expect(walkScreen(fakeApp(KNOWN), 'live', clipsDeps().deps).textContent).toContain('Connect OpenAI');
  });
});

describe('walk and talk with recorded clips', () => {
  it('judges the Tagalog said on the phone, and holds the microphone for the round', async () => {
    const f = clipsDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'clips', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    expect(f.speak.holdMicrophone).toHaveBeenCalledWith(true);
    await until(() => !!document.querySelector('.prompt-en'));
    const card = asked();
    await f.say(card.tl);
    await until(() => !!root.querySelector('.feedback'));
    expect(root.querySelector('.feedback strong')?.textContent).toBe('Tama!');
    button(root, 'Stop').click();
    expect(f.speak.holdMicrophone).toHaveBeenLastCalledWith(false);
    expect(root.textContent).toContain('Start again');
  });

  it('asks again after a silence, and after a second gives the answer, noted as needing help', async () => {
    const f = clipsDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'clips', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => !!document.querySelector('.prompt-en'));
    const card = asked();
    await f.say(null);
    await f.say(null);
    await until(() => !!root.querySelector('.feedback'));
    expect(root.querySelector('.feedback strong')?.textContent).toBe('The answer:');
    expect(drillNote(app.progress.cards[card.id], 'recall').help).toBe(1);
  });

  it('says "once more" before a word back after a miss', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (fetched.push(String(url)), { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const once = (prompts as Record<string, string>)[WALK_LINES.again];
    const f = clipsDeps();
    const root = walkScreen(fakeApp(KNOWN), 'clips', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => !!document.querySelector('.prompt-en'));
    const card = asked();
    const saidOnce = () => fetched.some((u) => u.includes(once));
    expect(saidOnce()).toBe(false);
    await f.say('wala');
    await until(saidOnce, 12_000);
    expect(asked().id).toBe(card.id);
  }, 15_000);

  it('moves past a word said "skip", leaving it as it was', async () => {
    const f = clipsDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'clips', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => !!document.querySelector('.prompt-en'));
    const card = asked();
    const before = structuredClone(app.progress.cards[card.id]);
    await f.say('iskip');
    await until(() => !!root.querySelector('.feedback'));
    expect(root.querySelector('.feedback strong')?.textContent).toBe('Skipped.');
    expect(app.progress.cards[card.id]).toEqual(before);
  });
});

/** A call that connects straight away, remembering what the app sends on its data channel. */
function liveDeps() {
  let channel: { onmessage: ((e: { data: string }) => void) | null; readyState: string; send: (d: string) => void } | null = null;
  const sent: { type: string; content?: string; delegation_id?: string | null }[] = [];
  const peer = {
    ontrack: null,
    onconnectionstatechange: null,
    connectionState: 'connected',
    addTrack() {},
    createDataChannel() {
      channel = { onmessage: null, readyState: 'open', send: (d) => void sent.push(JSON.parse(d)) };
      return channel;
    },
    createOffer: async () => ({ type: 'offer', sdp: 'offer' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {},
    close() {},
  };
  const track = { enabled: true, stop() {} };
  const response = new Response(JSON.stringify({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 });
  const fetch = vi.fn(async () => response);
  const call: CallDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    getMicrophone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    createPeer: () => peer as unknown as RTCPeerConnection,
    createSpeaker: () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLAudioElement,
  };
  const send = (event: object) => channel!.onmessage!({ data: JSON.stringify(event) });
  const deps: WalkDeps = { speak: clipsDeps().speak, call, callSupported: () => true, askMeaning: null };
  return { deps, sent, send, fetch };
}

describe('walk and talk live', () => {
  it('starts a call that delegates, opening with the first question and the one after', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const root = walkScreen(fakeApp(KNOWN), 'live', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    const body = JSON.parse(String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.session.delegation.type).toBe('client');
    const greeting = body.session.input[0].content[0].text as string;
    expect(greeting).toContain('The question now:');
    expect(greeting).toContain('The question after it');
  });
});

describe('the live engine', () => {
  /** A round that asks these questions in turn, keeping what it was told. */
  function fixedRound(qs: WalkQuestion[]) {
    const noted: WalkOutcome[] = [];
    const round: WalkRound = { next: () => qs.shift() ?? null, note: (_q, o) => (noted.push(o), true), done: 0, help: () => 0 };
    const view: WalkView = { status() {}, asked() {}, answered() {}, ended() {} };
    return { round, view, noted };
  }
  const recall = (id: string): WalkQuestion => ({ card: getCard(id)!, way: 'recall' });

  async function started(qs: WalkQuestion[], setup: (deps: WalkDeps) => void = () => {}) {
    setApiKey(KEY);
    const f = liveDeps();
    setup(f.deps);
    const r = fixedRound(qs);
    const run = startLiveWalk(r.round, r.view, f.deps);
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    f.send({ type: 'session.started', session: {} });
    const updates = () => f.sent.filter((e) => e.type === 'session.thinking.append' && e.content);
    const said = (who: 'ai' | 'you', delta: string, start_ms: number, end_ms: number) =>
      f.send({ type: who === 'ai' ? 'session.output_transcript.delta' : 'session.input_transcript.delta', delta, start_ms, end_ms });
    return { ...f, ...r, run, updates, said };
  }

  it('lets the voice react itself, and checks the answer behind it, telling the voice how it went and what is next', async () => {
    const f = await started([recall('salamat'), recall('kumusta'), recall('oo')]);
    f.said('ai', 'How do you say thank you?', 0, 1500);
    f.said('you', 'Salamat', 3000, 3500);
    f.said('ai', 'Tama! Now, how would you say how are you?', 4000, 6000);
    await until(() => f.updates().length > 0);
    expect(f.noted).toEqual(['right']);
    expect(chimes.count).toBe(1);
    const update = f.updates()[0].content!;
    expect(update).toContain('"Salamat": right');
    expect(update).toContain('The question now: ask how to say "How are you?"');
    expect(update).toContain('The question after it');
    // Nothing for the voice to say: it has already reacted.
    expect(f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id !== null)).toBe(false);
    f.run.stop();
  });

  it('takes "Hindi ko alam" as the answer to the card that is "Hindi ko alam", not as not knowing', async () => {
    const f = await started([recall('hindi-ko-alam'), recall('salamat')]);
    f.said('you', 'Hindi ko alam', 2000, 2800);
    f.said('ai', 'Ayos!', 3000, 3500);
    await until(() => f.noted.length > 0);
    expect(f.noted).toEqual(['right']);
    f.run.stop();
  });

  it('gives the verdict aloud when the voice asks the app', async () => {
    const f = await started([recall('salamat'), recall('oo')]);
    f.said('you', 'salamaat', 2000, 2500);
    f.said('ai', 'Hmm, let me check that.', 3000, 4000);
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'session.thinking.append', delegation_id: 'item_1', content: '' }));
    await until(() => f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1'));
    expect(f.sent.find((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1')!.content).toContain('The app checked');
    f.run.stop();
  });

  it('takes an answer that is itself a question, when it is the card', async () => {
    const f = await started([{ card: getCard('kumusta')!, way: 'listen' }, recall('salamat')]);
    f.said('you', 'How are you?', 2000, 2600);
    f.said('ai', 'Yes!', 3000, 3500);
    await until(() => f.noted.length > 0);
    expect(f.noted).toEqual(['right']);
    f.run.stop();
  });

  it('checks an answer that reaches the transcript after the voice has replied', async () => {
    const f = await started([recall('salamat'), recall('oo')]);
    f.said('ai', 'Tama!', 3000, 3500);
    await new Promise((r) => setTimeout(r, 700));
    f.said('you', 'Salamat', 2000, 2500);
    await until(() => f.noted.length > 0);
    expect(f.noted).toEqual(['right']);
    f.run.stop();
  });

  it('checks the answer once, when the voice asks the app before its reply reaches the transcript', async () => {
    const f = await started([recall('salamat'), recall('oo'), recall('kumusta')]);
    f.said('you', 'salamaat po', 2000, 2500);
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    f.said('ai', 'Hmm, let me check that.', 3000, 4000);
    await until(() => f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1'));
    await new Promise((r) => setTimeout(r, 800));
    expect(f.noted).toHaveLength(1);
    f.run.stop();
  });

  it("doesn't take a question from the learner for an answer", async () => {
    const f = await started([recall('salamat'), recall('oo')]);
    f.said('you', 'What does that mean?', 2000, 2500);
    f.said('ai', 'It means thank you!', 3000, 4000);
    await new Promise((r) => setTimeout(r, 800));
    expect(f.noted).toEqual([]);
    f.run.stop();
  });

  it("doesn't count an answer it couldn't check with OpenAI", async () => {
    const f = await started([recall('salamat'), recall('oo')], (deps) => {
      deps.askMeaning = async () => {
        throw new Error('offline');
      };
    });
    f.said('you', 'many thanks friend', 2000, 2500);
    f.said('ai', 'Hmm.', 3000, 3200);
    await until(() => f.updates().length > 0);
    expect(f.noted).toEqual(['skip']);
    expect(chimes.count).toBe(0);
    expect(f.updates()[0].content).toContain("couldn't check");
    f.run.stop();
  });
});
