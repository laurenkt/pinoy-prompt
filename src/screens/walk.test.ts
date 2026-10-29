// @vitest-environment happy-dom
// Walk and talk, with stand-ins for the microphone and the call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../deck';
import { setApiKey, forgetApiKey, type CallDeps } from '../openai';
import { FakeAudioContext, chimes, ticks } from '../test/fake-audio';
import { button, fakeApp, flush } from '../test/screen';
import { homeScreen } from './home';
import { settingsScreen } from './settings';
import { endWalk, walkScreen, type WalkDeps, type WalkView } from './walk';
import { startLiveWalk } from './walk-live';
import type { WalkOutcome, WalkQuestion, WalkRound } from '../walk';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const KNOWN = ['salamat', 'kumusta', 'oo', 'kape', 'paalam'];

/** Waits until `check` holds, letting the round's own short waits run. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out in: ${document.body.textContent}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  document.body.replaceChildren();
  chimes.count = 0;
  ticks.count = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  endWalk();
  forgetApiKey();
  vi.unstubAllGlobals();
});

/** The tally on show, by its labels. */
function tally(root: HTMLElement): Record<string, string> {
  return Object.fromEntries([...root.querySelectorAll('.stat')].map((s) => [s.querySelector('.stat-label')!.textContent, s.querySelector('.stat-value')!.textContent]));
}

describe('opening walk and talk', () => {
  it('is opened from Home, in the place Library had', () => {
    const app = fakeApp(KNOWN);
    const home = homeScreen(app);
    const hub = [...home.querySelectorAll('.hub .hub-title')].map((t) => t.textContent);
    // After Study (whatever it says) and Chat, beside Drills.
    expect(hub.slice(1)).toEqual(['Chat', 'Drills', 'Walk & talk']);
    home.querySelector<HTMLButtonElement>('.walk-btn')!.click();
    expect(app.navigate).toHaveBeenLastCalledWith({ name: 'walk' });
  });

  it('has left Settings, and Settings has no Experimental section', () => {
    const settings = settingsScreen(fakeApp(KNOWN));
    expect([...settings.querySelectorAll('button')].some((b) => b.textContent === 'Walk and talk')).toBe(false);
    expect([...settings.querySelectorAll('h2')].map((t) => t.textContent)).not.toContain('Experimental');
  });

  it('is a session that closes to Home', () => {
    setApiKey(KEY);
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, liveDeps().deps);
    expect(root.querySelectorAll('.session-header')).toHaveLength(1);
    expect(root.querySelectorAll('.back-bar')).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('.session-header .icon-btn')!.click();
    expect(app.navigate).toHaveBeenCalledWith({ name: 'home' });
  });

  it('needs the sound and the mic on, and words to drill', () => {
    setApiKey(KEY);
    const deps = liveDeps().deps;
    expect(walkScreen(fakeApp(KNOWN, { sound: false }), deps).textContent).toContain('needs the sound and the mic on');
    expect(walkScreen(fakeApp(KNOWN, { mic: false }), deps).textContent).toContain('needs the sound and the mic on');
    expect(walkScreen(fakeApp(['salamat']), deps).textContent).toContain('Learn at least');
    // Before asking for a key.
    forgetApiKey();
    const unkeyed = walkScreen(fakeApp(['salamat']), deps).textContent;
    expect(unkeyed).toContain('Learn at least');
    expect(unkeyed).not.toContain('Connect OpenAI');
  });

  it('asks for a key first', () => {
    expect(walkScreen(fakeApp(KNOWN), liveDeps().deps).textContent).toContain('Connect OpenAI');
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
  const deps: WalkDeps = { call, callSupported: () => true, askMeaning: null, askTurn: null };
  return { deps, sent, send, fetch };
}

describe('walk and talk', () => {
  it('starts a call that delegates, opening with the first question and the one after', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const root = walkScreen(fakeApp(KNOWN), f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    const body = JSON.parse(String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.session.delegation.type).toBe('client');
    const greeting = body.session.input[0].content[0].text as string;
    expect(greeting).toContain('The question now:');
    expect(greeting).toContain('The question after it');
  });

  it('sounds while it connects, and again once it is ready', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const root = walkScreen(fakeApp(KNOWN), f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    const waiting = ticks.count;
    expect(waiting).toBeGreaterThan(0);
    expect(chimes.count).toBe(0);
    f.send({ type: 'session.started', session: {} });
    await until(() => chimes.count === 1);
    // The waiting sound has stopped.
    await new Promise((r) => setTimeout(r, 1300));
    expect(ticks.count).toBe(waiting);
  });

  it('shows how the round is going rather than the question, with a big Stop, and the tally once stopped', async () => {
    setApiKey(KEY);
    const f = liveDeps();
    const app = fakeApp(KNOWN);
    const root = walkScreen(app, f.deps);
    document.body.append(root);
    button(root, 'Start').click();
    await until(() => f.fetch.mock.calls.length > 0);
    await flush();
    f.send({ type: 'session.started', session: {} });
    expect(root.querySelector('.prompt')).toBeNull();
    expect(tally(root)).toEqual({ asked: '0', right: '0', wrong: '0', skipped: '0' });
    expect(root.querySelector('.walk-stop')?.textContent).toBe('Stop');
    f.send({ type: 'session.input_transcript.delta', delta: 'skip', start_ms: 2000, end_ms: 2400 });
    f.send({ type: 'session.output_transcript.delta', delta: 'Okay, next one!', start_ms: 3000, end_ms: 3500 });
    await until(() => tally(root).skipped === '1');
    expect(tally(root)).toEqual({ asked: '1', right: '0', wrong: '0', skipped: '1' });
    expect(root.querySelector('.prompt')).toBeNull();
    button(root, 'Stop').click();
    expect(root.textContent).toContain('Start again');
    expect(tally(root).asked).toBe('1');
  });
});

describe('the live engine', () => {
  /** A round that asks these questions in turn, keeping what it was told. */
  function fixedRound(qs: WalkQuestion[]) {
    const noted: WalkOutcome[] = [];
    const round: WalkRound = { next: () => qs.shift() ?? null, note: (_q, o) => (noted.push(o), true), done: 0, help: () => 0 };
    const view: WalkView = { status() {}, answered() {}, ended() {} };
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
    // The ready sound, then the right answer's chime.
    expect(chimes.count).toBe(2);
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

  it.each(['Can you explain to me what this word means?', 'what does kumusta mean again', 'Could you say that again?', 'Hmm'])(
    'answers an aside ("%s") without moving on',
    async (aside) => {
      const f = await started([recall('salamat'), recall('oo')]);
      f.said('you', aside, 2000, 2500);
      f.said('ai', 'Sure! It means...', 3000, 4000);
      await new Promise((r) => setTimeout(r, 800));
      expect(f.noted).toEqual([]);
      f.said('you', 'Salamat', 6000, 6500);
      f.said('ai', 'Tama!', 7000, 7500);
      await until(() => f.noted.length > 0);
      expect(f.noted).toEqual(['right']);
      f.run.stop();
    },
  );

  it.each([
    ['is it salamat?', 'salamat', 'recall', 'right'],
    ['oh wait, salamat', 'salamat', 'recall', 'right'],
    ['sorry, I don\'t know', 'salamat', 'recall', 'dont-know'],
    ['wait a second', 'teka', 'listen', 'wrong'],
    ['do you have rice', 'salamat', 'listen', 'wrong'],
  ] as const)('takes "%s" for an answer', async (said, id, way, outcome) => {
    const f = await started([{ card: getCard(id)!, way }, recall('oo')]);
    f.said('you', said, 2000, 2500);
    f.said('ai', 'Okay!', 3000, 3500);
    await until(() => f.noted.length > 0);
    expect(f.noted).toEqual([outcome]);
    f.run.stop();
  });

  it('asks OpenAI, with the voice\'s reply, whether what was said was an answer, and moves on only if it was', async () => {
    const asks: { asked: string; said: string; reply: string }[] = [];
    const f = await started([recall('tama'), recall('oo'), recall('salamat')], (deps) => {
      deps.askTurn = async (turn) => (asks.push(turn), { answered: !turn.said.startsWith('do you mean'), tutor: 'none' });
    });
    f.said('ai', 'How do you say right?', 0, 1500);
    f.said('you', 'do you mean right as in direction or right as in correct', 2000, 4000);
    f.said('ai', 'Good question, I mean correct. So, how do you say right, as in correct?', 4500, 7000);
    await until(() => asks.length === 1, 5000);
    expect(asks[0]).toEqual({
      tl: getCard('tama')!.tl,
      en: getCard('tama')!.en,
      language: 'tl',
      asked: 'How do you say right?',
      said: 'do you mean right as in direction or right as in correct',
      reply: 'Good question, I mean correct. So, how do you say right, as in correct?',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.noted).toEqual([]);
    expect(f.updates()).toEqual([]);
    f.said('you', 'Tama', 9000, 9500);
    f.said('ai', 'Yes!', 10000, 10500);
    await until(() => f.noted.length > 0, 5000);
    expect(f.noted).toEqual(['right']);
    expect(f.updates()[0].content).toContain('The question now: ask how to say "Yes');
    f.run.stop();
  }, 10_000);

  it("gives OpenAI the voice's whole reply, when the learner's words reach the transcript after it", async () => {
    const asks: { asked: string; reply: string }[] = [];
    const f = await started([recall('tama'), recall('oo')], (deps) => {
      deps.askTurn = async (turn) => (asks.push(turn), { answered: true, tutor: 'none' });
    });
    f.said('ai', 'How do you say right?', 0, 1500);
    f.said('ai', ' Yes,', 2600, 2800);
    f.said('ai', ' I mean correct.', 2900, 3200);
    f.said('you', 'right as in correct', 1600, 2400);
    await until(() => asks.length === 1, 5000);
    expect(asks[0].asked).toBe('How do you say right?');
    expect(asks[0].reply).toBe('Yes, I mean correct.');
    f.run.stop();
  }, 10_000);

  it("takes what was said as an answer, without waiting on the reply, once the voice asks the app", async () => {
    const asks: unknown[] = [];
    const f = await started([recall('tama'), recall('oo')], (deps) => {
      deps.askTurn = async (turn) => (asks.push(turn), { answered: false, tutor: 'none' });
    });
    f.said('you', 'tamo', 2000, 2500);
    f.said('ai', 'Hmm, let me check.', 3000, 3500);
    await new Promise((r) => setTimeout(r, 700));
    f.send({ type: 'session.delegation.created', delegation: { id: 'item_1' } });
    await until(() => f.sent.some((e) => e.type === 'session.commentary.append' && e.delegation_id === 'item_1'), 2000);
    expect(asks).toEqual([]);
    expect(f.noted).toEqual(['wrong']);
    f.run.stop();
  });

  it("notes the voice's verdict, as it heard the answer where the transcript may be far off", async () => {
    const f = await started([recall('salamat'), recall('oo')], (deps) => {
      deps.askTurn = async () => ({ answered: true, tutor: 'right' });
      deps.askMeaning = async () => false;
    });
    f.said('ai', 'How do you say thank you?', 0, 1500);
    f.said('you', 'sa la mot', 2000, 2500);
    f.said('ai', 'Tama! Now, how do you say yes?', 3000, 4500);
    await until(() => f.noted.length > 0, 5000);
    expect(f.noted).toEqual(['right']);
    f.run.stop();
  }, 10_000);

  it('follows the voice when it has gone on to the next question without the app', async () => {
    const f = await started([recall('salamat'), recall('kumusta'), recall('oo')]);
    // The answer to "thank you" never reached the transcript; the voice reacted and asked the next question.
    f.said('ai', 'How do you say thank you?', 0, 1500);
    f.said('ai', 'Great! Now, how do you say how are you?', 5000, 7000);
    f.said('you', 'Kumusta', 8000, 8500);
    f.said('ai', 'Tama!', 9000, 9500);
    await until(() => f.noted.length > 1);
    expect(f.noted).toEqual(['skip', 'right']);
    expect(f.updates()[0].content).toContain('"Kumusta": right');
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
    expect(chimes.count).toBe(1);
    expect(f.updates()[0].content).toContain("couldn't check");
    f.run.stop();
  });
});
