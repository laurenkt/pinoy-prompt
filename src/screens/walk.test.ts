// @vitest-environment happy-dom
// Walk and talk, both ways of running it, with stand-ins for the microphone, the speech model and the call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard, type Card } from '../deck';
import { setApiKey, forgetApiKey, type CallDeps } from '../openai';
import { toPhones } from '../phonetics';
import type { Take } from '../recorder';
import { drillNote } from '../session';
import { spokenMeaning } from '../walk';
import { FakeAudioContext } from '../test/fake-audio';
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
  it('judges the answer when the voice asks, and gives it the verdict, the answer and the next question', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'live', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    const body = JSON.parse(String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.session.delegation.type).toBe('client');
    f.send({ type: 'session.started', session: {} });
    const card = asked();
    const answer = document.querySelector('.prompt-en') ? card.tl : card.en.split('/')[0];
    f.send({ type: 'session.input_transcript.delta', delta: answer, start_ms: 0, end_ms: 500 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1', type: 'delegation', target: 'client' } });
    // Told at once not to say it's checking.
    expect(f.sent).toContainEqual(expect.objectContaining({ type: 'session.thinking.append', delegation_id: 'item_1', content: '' }));
    await until(() => f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1'));
    const verdict = f.sent.find((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1')!.content!;
    expect(verdict).toContain('Tama!');
    expect(verdict).toContain(`"${card.tl}"`);
    expect(verdict).toMatch(/Then, straight away: (Ask|Say)/);
    expect(root.querySelector('.feedback strong')?.textContent).toBe('Tama!');
  });

  it('gives the answer to "I don\'t know", noted as needing help', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, 'live', f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    f.send({ type: 'session.started', session: {} });
    const card = asked();
    const way = document.querySelector('.prompt-en') ? 'recall' : 'listen';
    f.send({ type: 'session.input_transcript.delta', delta: "Um, I don't know.", start_ms: 0, end_ms: 500 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_2', type: 'delegation', target: 'client' } });
    await until(() => f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_2'));
    expect(f.sent.find((e) => e.delegation_id === 'item_2' && e.type === 'session.commentary.append')!.content).toContain(`"${card.tl}"`);
    expect(drillNote(app.progress.cards[card.id], way).help).toBe(1);
  });
});

describe('the live engine', () => {
  /** A round that asks these questions in turn, keeping what it was told. */
  function fixedRound(qs: WalkQuestion[]) {
    const noted: WalkOutcome[] = [];
    const round: WalkRound = { next: () => qs.shift() ?? null, note: (_q, o) => (noted.push(o), true), done: 0 };
    const view: WalkView = { status() {}, asked() {}, answered() {}, ended() {} };
    return { round, view, noted };
  }
  const recall = (id: string): WalkQuestion => ({ card: getCard(id)!, way: 'recall' });

  async function started(qs: WalkQuestion[]) {
    setApiKey(KEY);
    const f = liveDeps();
    const r = fixedRound(qs);
    const run = startLiveWalk(r.round, r.view, f.deps);
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    f.send({ type: 'session.started', session: {} });
    const verdicts = () => f.sent.filter((e) => e.type === 'session.commentary.append' && e.delegation_id !== null);
    return { ...f, ...r, run, verdicts };
  }

  it('takes "Hindi ko alam" as the answer to the card that is "Hindi ko alam", not as not knowing', async () => {
    const f = await started([recall('hindi-ko-alam'), recall('salamat')]);
    f.send({ type: 'session.input_transcript.delta', delta: 'Hindi ko alam', start_ms: 0, end_ms: 800 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    await until(() => f.verdicts().length > 0);
    expect(f.noted).toEqual(['right']);
    f.run.stop();
  });

  it('only counts what was said after the voice stopped speaking, with its pieces joined', async () => {
    const f = await started([recall('salamat'), recall('kumusta'), recall('oo')]);
    f.send({ type: 'session.input_transcript.delta', delta: 'Salamat', start_ms: 0, end_ms: 500 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    await until(() => f.verdicts().length === 1);
    // Said along with the verdict, before the voice asks the next one: not an answer to it.
    f.send({ type: 'session.input_transcript.delta', delta: 'salamat', start_ms: 1000, end_ms: 1400 });
    f.send({ type: 'session.output_transcript.delta', delta: 'Tama! How do you say how are you?', start_ms: 900, end_ms: 3000 });
    f.send({ type: 'session.input_transcript.delta', delta: 'Kumus', start_ms: 3500, end_ms: 3900 });
    f.send({ type: 'session.input_transcript.delta', delta: 'ta', start_ms: 3900, end_ms: 4100 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_2' } });
    await until(() => f.verdicts().length === 2);
    expect(f.noted).toEqual(['right', 'right']);
    f.run.stop();
  });

  it("doesn't count an answer it couldn't check with OpenAI", async () => {
    setApiKey(KEY);
    const f = liveDeps();
    f.deps.askMeaning = async () => {
      throw new Error('offline');
    };
    const r = fixedRound([recall('salamat'), recall('oo')]);
    const run = startLiveWalk(r.round, r.view, f.deps);
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    f.send({ type: 'session.started', session: {} });
    f.send({ type: 'session.input_transcript.delta', delta: 'many thanks friend', start_ms: 0, end_ms: 500 });
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    await until(() => f.sent.some((e) => e.delegation_id === 'item_1' && e.type === 'session.commentary.append'));
    expect(r.noted).toEqual(['skip']);
    expect(f.sent.find((e) => e.delegation_id === 'item_1' && e.type === 'session.commentary.append')!.content).toContain("couldn't check");
    run.stop();
  });
});
