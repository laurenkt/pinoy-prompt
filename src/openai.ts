// Talking to OpenAI with the learner's own API key. The key is kept in this
// browser only, apart from progress so it never ends up in a backup, and is
// sent only to api.openai.com. There is no server of ours in between.

import { getMicrophone, releaseMicrophone } from './microphone';
import type { AnswerLanguage, MeaningJudge } from './meaning';
import { dayKey } from './progress-schema';

const KEY_STORAGE = 'pinoy-prompt:openai-key';
/** What the app's calls are estimated to have cost, kept beside the key and, like it, out of progress and backups. */
const SPEND_STORAGE = 'pinoy-prompt:openai-spend';
/** Where the old voice choice was kept, before Talk only used Beacon. */
const RETIRED_VOICE_STORAGE = 'pinoy-prompt:talk-voice';
const API = 'https://api.openai.com/v1';
/** Spoken conversations. Billed per second of the call. */
export const VOICE_MODEL = 'gpt-live-1';
/** GPT-Live's price per minute of call, in US cents. */
export const CENTS_PER_MINUTE = 5;
/** Calls end on their own after this long, so a forgotten one can't run up a bill. */
export const MAX_CALL_SECONDS = 10 * 60;

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

/** Save a key. False if it doesn't look like an OpenAI key or can't be stored. */
export function setApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (!looksLikeKey(trimmed)) return false;
  try {
    localStorage.setItem(KEY_STORAGE, trimmed);
    return true;
  } catch {
    return false;
  }
}

export function forgetApiKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing stored, or nothing we can do.
  }
}

/** Talk always speaks as Beacon, the one GPT-Live voice with a Filipino accent. */
const TALK_VOICE = 'beacon';

/** Clear the voice choice Settings used to offer, now that there's only Beacon. Safe to delete once old installs have all launched since. */
export function forgetRetiredVoiceChoice(): void {
  try {
    localStorage.removeItem(RETIRED_VOICE_STORAGE);
  } catch {
    // Nothing stored, or nothing we can do.
  }
}

export function looksLikeKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
}

/**
 * OpenAI's list prices for what the app uses, in US dollars per million
 * tokens. Every model the app sends a token-billed request to has a row here
 * (openai.test.ts checks it). GPT-Live is billed by the minute instead
 * (CENTS_PER_MINUTE).
 */
export const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
};

/** The token counts a Responses API answer reports. */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

/** A count or amount from OpenAI or storage, or 0 when it isn't a positive number. */
const positive = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** What a token-billed request cost, in US dollars, from the usage OpenAI reported. */
export function tokenCost(model: string, usage: TokenUsage | undefined): number {
  const price = PRICES[model];
  if (!price || !usage) return 0;
  const input = positive(usage.input_tokens);
  const cached = Math.min(positive(usage.input_tokens_details?.cached_tokens), input);
  return ((input - cached) * price.input + cached * price.cachedInput + positive(usage.output_tokens) * price.output) / 1e6;
}

/** Speech-to-text's list prices, in US dollars per million tokens: it bills audio and text in differently. */
export const TRANSCRIBE_PRICES = { audioInput: 3, textInput: 1.25, output: 5 };

/** The token counts a transcription reports, which split its input into audio and text (the prompt). */
export interface TranscriptionUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { audio_tokens?: number; text_tokens?: number };
}

/** What a transcription cost, in US dollars, from the usage OpenAI reported. Input not split out is priced as audio. */
export function transcriptionCost(usage: TranscriptionUsage | undefined): number {
  if (!usage) return 0;
  const text = Math.min(positive(usage.input_token_details?.text_tokens), positive(usage.input_tokens));
  const audio = positive(usage.input_tokens) - text;
  const p = TRANSCRIBE_PRICES;
  return (audio * p.audioInput + text * p.textInput + positive(usage.output_tokens) * p.output) / 1e6;
}

/** What `seconds` of a GPT-Live call cost, in US dollars. */
export function callCost(seconds: number): number {
  return seconds > 0 ? ((seconds / 60) * CENTS_PER_MINUTE) / 100 : 0;
}

/** The estimated spend so far, in US dollars, by calendar month (YYYY-MM, local time). */
interface Spend {
  total: number;
  months: Record<string, number>;
}

function readSpend(): Spend {
  const spend: Spend = { total: 0, months: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(SPEND_STORAGE) ?? 'null') as { total?: unknown; months?: unknown } | null;
    spend.total = positive(saved?.total);
    if (saved?.months && typeof saved.months === 'object') {
      for (const [month, value] of Object.entries(saved.months)) {
        if (/^\d{4}-\d{2}$/.test(month) && positive(value)) spend.months[month] = positive(value);
      }
    }
  } catch {
    // Unreadable: start again from nothing rather than fail a call over it.
  }
  return spend;
}

/** Add to the estimate. Every request the app makes to OpenAI goes through here once it knows what it cost. */
export function addSpend(dollars: number, now = Date.now()): void {
  if (!(dollars > 0) || !Number.isFinite(dollars)) return;
  const spend = readSpend();
  const month = dayKey(now).slice(0, 7);
  spend.total += dollars;
  spend.months[month] = (spend.months[month] ?? 0) + dollars;
  try {
    localStorage.setItem(SPEND_STORAGE, JSON.stringify(spend));
  } catch {
    // Full storage or private mode: the estimate just misses this one.
  }
}

/** The estimated spend in US dollars: in all, and in the calendar month of `now`. */
export function getSpend(now = Date.now()): { total: number; month: number } {
  const spend = readSpend();
  return { total: spend.total, month: spend.months[dayKey(now).slice(0, 7)] ?? 0 };
}

export type AiErrorKind = 'key' | 'quota' | 'access' | 'network' | 'other';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** What to tell the learner when a request fails. */
export function errorText(e: unknown): string {
  if (!(e instanceof AiError)) return 'Something went wrong. Try again.';
  switch (e.kind) {
    case 'key':
      return "OpenAI didn't accept the API key. Check it in Settings.";
    case 'quota':
      return "OpenAI says this key is out of credit or sending too much. Check billing on your OpenAI account, or wait a minute.";
    case 'access':
      return `This OpenAI key can't use the model Chat needs. ${e.message}`;
    case 'network':
      return "Couldn't reach OpenAI. Check your connection and try again.";
    default:
      return `OpenAI couldn't answer: ${e.message}`;
  }
}

async function failure(response: Response): Promise<AiError> {
  let message = `${response.status}`;
  let code = '';
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? text;
      code = body.error?.code ?? '';
    } catch {
      if (text) message = text;
    }
  } catch {
    // Keep the status alone.
  }
  if (response.status === 401) return new AiError('key', message);
  if (response.status === 429 || code === 'insufficient_quota') return new AiError('quota', message);
  if (response.status === 403 || response.status === 404 || code === 'model_not_found') return new AiError('access', message);
  return new AiError('other', message);
}

/** A request that never got through, or an answer that broke off. */
function unreachable(e: unknown): AiError {
  return new AiError('network', e instanceof Error ? e.message : String(e));
}

/**
 * Run a whole exchange with OpenAI, sending and reading the answer, and give it up after `ms`. The limit is cleared
 * once the exchange is over. AbortSignal.timeout can't be cleared, and iOS only has it from 16.
 */
async function timed<T>(ms: number, exchange: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await exchange(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** An answer's body. One that breaks off (or is given up) is a network failure like any other. */
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (e) {
    if (e instanceof SyntaxError) throw new AiError('other', "OpenAI's answer couldn't be read.");
    throw unreachable(e);
  }
}

async function post(key: string, path: string, body: unknown, fetchFn: typeof fetch, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(`${API}${path}`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw unreachable(e);
  }
  if (!response.ok) throw await failure(response);
  return response;
}

/** Checks a typed meaning in Drills. Small and quick: a yes or no on a short phrase. */
export const CHECK_MODEL = 'gpt-5.4-mini';
/** A check slower than this isn't worth the wait; the learner can judge it themselves. */
const CHECK_TIMEOUT_MS = 8000;

/** What a recall check is told about the Tagalog, after how it was given and how to judge spelling. */
const TL_RULES = `Leaving out a "po" or "ho" that the given Tagalog has is wrong: it's what makes it polite.
It's wrong if the meaning differs: a different word, time, person, number, place, or the opposite.
The answer has to be in Tagalog. It's wrong if they just repeat the English or answer in English (or any other language), even though that means the same thing. Tagalog that uses a word borrowed from English or Spanish, as Filipinos say it (okay, bill, dyip, traffic for trapik), is still Tagalog.`;

const CHECK_INSTRUCTIONS: Record<AnswerLanguage, string> = {
  en: `You check a beginner's answer in a Tagalog listening drill. They heard a Tagalog word or phrase and wrote what they think it means in English, possibly with a phone's dictation.
Judge only whether they understood the meaning. Spelling, grammar, word order and wording don't matter; synonyms, paraphrases and a missing "please" or "very" are still right, and so is any one of the meanings separated by "/".
It's wrong if the meaning differs: a different word, time, person, number, place, or the opposite.
The answer has to be in English. It's wrong if they just repeat the Tagalog or answer in Tagalog (or any other language), even though that means the same thing. English that uses a word Tagalog borrows or English borrows from Tagalog (okay, bill, adobo, jeepney) is still English.`,
  tl: `You check a beginner's answer in a Tagalog recall drill. They were shown an English meaning and said how to say it in Tagalog, written out by a phone's dictation.
Judge whether it's a right way to say that meaning in everyday Tagalog, as the given Tagalog is. Small spelling differences don't matter: common spellings (kamusta, ganun, dyan), o for u, e for i, a letter or two wrong, missing or swapped, and how dictation spells what was said are still right, and so are an added "po" or "ho", "ho" for "po", and other natural wordings that mean the same.
A different word is wrong, even one that looks like the right one (maraming for magandang): that's mixing up two words, not a typo. A shortened or dictated spelling of the right word (san for saan, ung for yung) is still right, and so is a Tagalog number that dictation wrote as digits.
${TL_RULES}`,
};

/** A recall answer typed rather than said: the learner is learning to spell it, so spelling counts. */
const CHECK_TYPED_TAGALOG = `You check a beginner's answer in a Tagalog recall drill. They were shown an English meaning and typed how to say it in Tagalog. They are learning to spell it, so spelling counts.
Judge whether it's a right way to say that meaning in everyday Tagalog, as the given Tagalog is, with every word spelled the standard way. Other natural wordings that mean the same are right when spelled right, and so are an added "po" or "ho" and "ho" for "po". Capitals, accents, punctuation, and spaces or hyphens between parts of a word don't matter.
A misspelt word is wrong, even one letter off and even if it sounds the same (salamt for salamat, magandag for magandang, o for u or e for i where the word isn't written that way), and so is a shortened or texting spelling (san for saan, musta for kumusta) and a number written in digits rather than spelled out.
A different word is wrong, even one that looks like the right one (maraming for magandang).
${TL_RULES}`;

/**
 * Ask OpenAI whether `answer` says the card in `language`: its meaning in
 * English, or its Tagalog. Sends only the card and the answer. Tagalog that was
 * `typed`, not said, has to be spelled right.
 */
export async function checkMeaning(
  key: string,
  { tl, en, answer, language = 'en', typed = false }: { tl: string; en: string; answer: string; language?: AnswerLanguage; typed?: boolean },
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<boolean> {
  type Answer = { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: TokenUsage };
  const body = await timed(CHECK_TIMEOUT_MS, async (signal) =>
    readJson<Answer>(
      await post(
        key,
        '/responses',
        {
          model: CHECK_MODEL,
          reasoning: { effort: 'none' },
          instructions: language === 'tl' && typed ? CHECK_TYPED_TAGALOG : CHECK_INSTRUCTIONS[language],
          input: `Tagalog: ${tl}\nMeaning: ${en}\nAnswer: ${answer.slice(0, 200)}`,
          text: {
            format: {
              type: 'json_schema',
              name: 'verdict',
              strict: true,
              schema: { type: 'object', properties: { right: { type: 'boolean' } }, required: ['right'], additionalProperties: false },
            },
          },
          store: false,
        },
        fetchFn,
        signal,
      ),
    ),
  );
  addSpend(tokenCost(CHECK_MODEL, body.usage));
  const text = body.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text;
  try {
    const verdict = JSON.parse(text ?? '') as { right?: unknown };
    if (typeof verdict.right === 'boolean') return verdict.right;
  } catch {
    // Fall through.
  }
  throw new AiError('other', 'OpenAI answered without a verdict.');
}

/** judgeMeaning's ask, with the learner's key: OpenAI checks an answer the device couldn't match, or null without a key. */
export const askOpenAi: MeaningJudge = async (answer, card, language, typed) => {
  const key = getApiKey();
  return key ? checkMeaning(key, { tl: card.tl, en: card.en, answer, language, typed }) : null;
};

/** What walk and talk's turn check is told: the reply settles whether it was an answer, so the app moves on when the voice does. */
const TURN_INSTRUCTIONS: Record<AnswerLanguage, string> = {
  en: 'The learner heard the Tagalog and is asked what it means, answering in English.',
  tl: 'The learner is given the English and asked how to say it in Tagalog.',
};
const TURN_RULES = `What was said is transcribed speech: Tagalog may come out spelled oddly or as English-looking words.
Don't judge the answer yourself: say whether it was an answer, and what the tutor made of it.
answered: true if what the learner said was their answer to the question, even hedged ("is it salamat?"), unsure, partial or wrong. false if they asked the tutor something instead (what a word means, which sense of the word is meant, to say it again), or made an aside or a filler, rather than answering. Asking to skip or pass counts as an answer. The tutor's reply settles it: if the tutor gave a verdict, gave the answer, said it's checking or moved on, it was an answer; if the tutor answered their question or clarified and is still waiting for an answer, it was not.
tutor: what the tutor's reply said of the answer. "right" if it told them they got it (even with a small correction to how it's said), "wrong" if it told them it's not quite or gave the right answer in its place, "skipped" if they asked to skip or pass and it moved on, "none" if it gave no verdict (it's checking, or it wasn't an answer). The tutor heard them, where the transcript may not have, so go by what it said.`;

/** How a learner's turn in walk and talk went, as the voice took it: whether it was their answer, and the voice's verdict on it. */
export interface TurnVerdict {
  answered: boolean;
  tutor: 'right' | 'wrong' | 'skipped' | 'none';
}

/**
 * Ask OpenAI how the voice took a learner's turn in walk and talk: whether it was their answer, and whether the voice
 * said it was right, given what the voice asked, what the learner said and the voice's reply. Sends only the card and
 * those three. The voice hears the learner, so its verdict counts over the transcript's (see walk-live.ts).
 */
export async function checkTurn(
  key: string,
  { tl, en, language, asked, said, reply }: { tl: string; en: string; language: AnswerLanguage; asked: string; said: string; reply: string },
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<TurnVerdict> {
  type Answer = { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: TokenUsage };
  const body = await timed(CHECK_TIMEOUT_MS, async (signal) =>
    readJson<Answer>(
      await post(
        key,
        '/responses',
        {
          model: CHECK_MODEL,
          reasoning: { effort: 'none' },
          instructions: `A tutor is quizzing a beginner on a Tagalog word out loud. ${TURN_INSTRUCTIONS[language]}\n${TURN_RULES}`,
          input: `Tagalog: ${tl}\nMeaning: ${en}\nTutor asked: ${asked.slice(-300)}\nLearner said: ${said.slice(0, 300)}\nTutor replied: ${reply.slice(0, 400)}`,
          text: {
            format: {
              type: 'json_schema',
              name: 'turn',
              strict: true,
              schema: {
                type: 'object',
                properties: { answered: { type: 'boolean' }, tutor: { type: 'string', enum: ['right', 'wrong', 'skipped', 'none'] } },
                required: ['answered', 'tutor'],
                additionalProperties: false,
              },
            },
          },
          store: false,
        },
        fetchFn,
        signal,
      ),
    ),
  );
  addSpend(tokenCost(CHECK_MODEL, body.usage));
  const text = body.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text;
  try {
    const verdict = JSON.parse(text ?? '') as { answered?: unknown; tutor?: unknown };
    if (typeof verdict.answered === 'boolean' && (['right', 'wrong', 'skipped', 'none'] as unknown[]).includes(verdict.tutor))
      return { answered: verdict.answered, tutor: verdict.answered ? (verdict.tutor as TurnVerdict['tutor']) : 'none' };
  } catch {
    // Fall through.
  }
  throw new AiError('other', 'OpenAI answered without a verdict.');
}

/** checkTurn with the learner's key, or null without one. */
export const askTurnOpenAi = (turn: Parameters<typeof checkTurn>[1]): Promise<TurnVerdict | null> => {
  const key = getApiKey();
  return key ? checkTurn(key, turn) : Promise.resolve(null);
};

/** Turns a spoken answer in Drills into text. */
export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
/** Longer than a check: a few seconds of audio go up first, over a phone's connection. */
const TRANSCRIBE_TIMEOUT_MS = 20000;

/** What the learner was asked to say, to help the transcription: never the answer itself. */
const TRANSCRIBE_PROMPTS: Record<AnswerLanguage, string> = {
  en: 'Someone saying in English what a Tagalog word or phrase means.',
  // Read as text before the audio, not as an order: naming Spanish or English could pull towards the look-alikes it
  // writes on its own ("como esta" for kumusta), so it only says how it's written.
  tl: 'Someone saying a Tagalog word or phrase, written down exactly as said, in Tagalog spelling.',
};

/** What the learner said, as text in `language` (English or Tagalog). Sends only the recording. */
export async function transcribe(
  key: string,
  audio: Blob,
  language: AnswerLanguage = 'en',
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<string> {
  const form = new FormData();
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', language);
  form.append('prompt', TRANSCRIBE_PROMPTS[language]);
  form.append('file', audio, 'answer.wav');
  const body = await timed(TRANSCRIBE_TIMEOUT_MS, async (signal) => {
    let response: Response;
    try {
      response = await fetchFn(`${API}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal });
    } catch (e) {
      throw unreachable(e);
    }
    if (!response.ok) throw await failure(response);
    return readJson<{ text?: unknown; usage?: TranscriptionUsage }>(response);
  });
  addSpend(transcriptionCost(body.usage));
  return typeof body.text === 'string' ? body.text.trim() : '';
}

export interface ChatTurn {
  who: 'you' | 'ai';
  text: string;
}

export interface CallEvents {
  /**
   * A piece of what was said, by the learner or the AI, with when it was said
   * in ms from the start of the call. Pieces carry no turn boundaries.
   */
  onTranscript(who: ChatTurn['who'], text: string, startMs: number, endMs: number): void;
  /** The call is connected and listening. */
  onStarted(): void;
  /** Seconds of the call so far, as OpenAI counts them for billing. */
  onUsage(seconds: number): void;
  /** The call ended, from either side; error is set if it broke. */
  onEnded(error?: AiError): void;
  /** Audio to show as it plays: the learner's microphone once the call is set up, and the AI's voice once it arrives. */
  onAudio?(who: ChatTurn['who'], stream: MediaStream): void;
  /**
   * For a call started with `delegate`: the AI has asked the app for help (it generated <|SpawnThinking|>), and waits
   * for what it's given back with `append` under this id. Nothing says what it wants: that's in the transcript.
   */
  onDelegation?(id: string): void;
  /** The microphone is open, so the page's audio is in the call's audio session: a sound started now isn't moved by it. */
  onMicrophone?(): void;
  /** How the AI's voice is coming through so far, every few seconds once connected. */
  onQuality?(quality: CallQuality): void;
}

/**
 * How the AI's voice has come through so far, from the call's receiving stats: the share of it the browser had to
 * make up for audio lost or late on the network (heard as a stutter or warble), and the share of packets lost.
 */
export interface CallQuality {
  concealed: number;
  lost: number;
}

/** How often a call's receiving stats are read (onQuality). */
const QUALITY_EVERY_MS = 5000;

/** The voice's quality from a peer's stats, or null before any of it has arrived. */
export function callQuality(report: RTCStatsReport): CallQuality | null {
  let quality: CallQuality | null = null;
  report.forEach((s: Record<string, unknown>) => {
    if (s.type !== 'inbound-rtp' || s.kind !== 'audio') return;
    const n = (key: string) => (typeof s[key] === 'number' ? (s[key] as number) : 0);
    const samples = n('totalSamplesReceived');
    const packets = n('packetsReceived') + n('packetsLost');
    if (!samples) return;
    // Silence made up while the voice sent none (between its turns) can't be heard, so isn't counted.
    quality = { concealed: Math.max(0, n('concealedSamples') - n('silentConcealedSamples')) / samples, lost: packets ? n('packetsLost') / packets : 0 };
  });
  return quality;
}

/** How the app adds to what the AI knows mid-call: something to say aloud, to know without saying, or an instruction. */
export type CallAppend = 'commentary' | 'thinking' | 'instructions';

export interface Call {
  setMuted(muted: boolean): void;
  hangUp(): void;
  /** Give the AI something, for a delegation it asked for (its id) or for the call in general (null). */
  append(kind: CallAppend, content: string, delegationId: string | null): void;
}

export interface CallDeps {
  fetch: typeof fetch;
  getMicrophone(): Promise<MediaStream>;
  /** Hands the microphone back when the call ends. Without it, the tracks are stopped. */
  releaseMicrophone?(mic: MediaStream): void;
  createPeer(): RTCPeerConnection;
  /** Plays the AI's voice. */
  createSpeaker(): HTMLAudioElement;
}

export const browserCallDeps: CallDeps = {
  fetch: (...args) => fetch(...args),
  getMicrophone,
  releaseMicrophone,
  createPeer: () => new RTCPeerConnection(),
  createSpeaker: () => {
    const audio = new Audio();
    audio.autoplay = true;
    return audio;
  },
};

export function callSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** How long a delegating call waits before the AI says it's checking: time for the app to tell it not to. */
const DELEGATION_ACK_DELAY_MS = 800;

/** Why a call given up while it was still connecting failed. Nobody is shown it. */
const ABANDONED = 'The call was abandoned while connecting.';

/**
 * Start a spoken conversation with GPT-Live over WebRTC. The browser sends its
 * offer straight to OpenAI with the learner's key, and audio then flows both
 * ways while transcripts arrive on the data channel.
 *
 * Aborting `signal` while the call is still connecting gives it up there and
 * then: the request is cancelled, the connection closed and the microphone
 * handed back, so nothing of it is left running when the next call starts.
 * Once connected, a call is ended with `hangUp`.
 *
 * With `delegate`, the app is the AI's backend (GPT-Live's client delegation): when the AI asks for help, onDelegation
 * says so, and the app answers with `append`. The pause before the AI says it's checking is long enough for the app
 * to tell it not to (an empty thinking append).
 */
export async function startCall(
  key: string,
  { instructions, greeting, signal, delegate = false }: { instructions: string; greeting: string; signal?: AbortSignal; delegate?: boolean },
  events: CallEvents,
  deps: CallDeps = browserCallDeps,
): Promise<Call> {
  if (signal?.aborted) throw new AiError('other', ABANDONED);
  // Made inside the tap that started the call, so iOS lets it play.
  const speaker = deps.createSpeaker();
  let mic: MediaStream;
  try {
    mic = await deps.getMicrophone();
  } catch {
    throw new AiError('other', 'Chat needs the microphone. Allow it for this site and try again.');
  }
  if (!signal?.aborted) events.onMicrophone?.();
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let ended = false;
  let greeted = false;
  /** Appends sent, for their event ids. */
  let appended = 0;
  /** Seconds of the call already added to the spend estimate. */
  let charged = 0;
  /** When the call started listening, to count the time after OpenAI's last usage report. */
  let startedAt: number | undefined;
  /** Add the call's billed time beyond what is already counted. */
  const charge = (seconds: number) => {
    if (seconds <= charged) return;
    addSpend(callCost(seconds - charged));
    charged = seconds;
  };
  let limit: ReturnType<typeof setTimeout> | undefined;
  let dropping: ReturnType<typeof setTimeout> | undefined;
  let qualityTimer: ReturnType<typeof setInterval> | undefined;

  /** Why the call finished, if it did while still connecting. */
  let failure: AiError | undefined;
  let released = false;
  function release(): void {
    // Can be reached twice (the call fails while it's still being set up), but the microphone is handed back once.
    if (released) return;
    released = true;
    clearTimeout(limit);
    clearTimeout(dropping);
    clearInterval(qualityTimer);
    if (deps.releaseMicrophone) deps.releaseMicrophone(mic);
    else mic.getTracks().forEach((t) => t.stop());
    peer?.close();
    speaker.srcObject = null;
  }

  function finish(error?: AiError): void {
    if (ended) return;
    ended = true;
    failure = error ?? new AiError('network', 'The call dropped.');
    // No usage report comes after this, so the time since the last one is counted by the clock.
    if (startedAt !== undefined) charge((Date.now() - startedAt) / 1000);
    try {
      if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'session.close' }));
    } catch {
      // Closing the connection ends the session anyway.
    }
    release();
    events.onEnded(error);
  }

  const abandon = () => {
    ended = true;
    release();
  };
  signal?.addEventListener('abort', abandon);
  /** Between the steps of connecting: stop if the call was given up, or dropped, meanwhile. */
  const still = () => {
    if (signal?.aborted) throw new AiError('other', ABANDONED);
    // Dropped while connecting: onEnded has already said why.
    if (failure) throw failure;
  };

  try {
    still();
    peer = deps.createPeer();
    const pc = peer;
    pc.ontrack = (e) => {
      const voice = e.streams[0] ?? new MediaStream([e.track]);
      speaker.srcObject = voice;
      void speaker.play().catch(() => {});
      if (!ended) events.onAudio?.('ai', voice);
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
    // Listeners go on before the offer, so no early event is missed.
    channel = pc.createDataChannel('oai-events');
    channel.onmessage = (e) => onEvent(String(e.data));
    // The channel closing without session.closed means the call was lost.
    channel.onclose = () => finish(new AiError('network', 'The call dropped.'));
    pc.onconnectionstatechange = () => {
      clearTimeout(dropping);
      if (pc.connectionState === 'failed') finish(new AiError('network', 'The call dropped.'));
      // A disconnection can recover by itself, but not after a few seconds.
      else if (pc.connectionState === 'disconnected') dropping = setTimeout(() => finish(new AiError('network', 'The call dropped.')), 5000);
    };

    const offer = await pc.createOffer();
    still();
    await pc.setLocalDescription(offer);
    still();
    const response = await post(key, '/live/sessions', {
      session: {
        model: VOICE_MODEL,
        instructions,
        audio: { output: { voice: TALK_VOICE } },
        ...(delegate && { delegation: { type: 'client', acknowledgement_delay_ms: DELEGATION_ACK_DELAY_MS } }),
        // OpenAI's guide: greeting instructions as a developer message at startup, then again once started.
        input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: greeting }] }],
      },
      transport: { type: 'webrtc', sdp: offer.sdp },
    }, deps.fetch, signal);
    const body = await readJson<{ transport?: { sdp?: string } }>(response);
    still();
    if (!body.transport?.sdp) throw new AiError('other', 'OpenAI started the call without an answer.');
    await pc.setRemoteDescription({ type: 'answer', sdp: body.transport.sdp });
    still();
    events.onAudio?.('you', mic);
    if (events.onQuality) {
      const onQuality = events.onQuality;
      qualityTimer = setInterval(() => {
        if (ended || typeof pc.getStats !== 'function') return;
        pc.getStats().then(
          (report) => {
            const quality = callQuality(report);
            if (quality && !ended) onQuality(quality);
          },
          () => {},
        );
      }, QUALITY_EVERY_MS);
    }
  } catch (e) {
    ended = true;
    release();
    if (signal?.aborted) throw new AiError('other', ABANDONED);
    if (failure) throw failure;
    throw e instanceof AiError ? e : new AiError('other', e instanceof Error ? e.message : String(e));
  } finally {
    signal?.removeEventListener('abort', abandon);
  }

  function onEvent(data: string): void {
    let event: {
      type?: string;
      delta?: string;
      start_ms?: number;
      end_ms?: number;
      usage?: { seconds?: number };
      error?: { message?: string };
      delegation?: { id?: string; target?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (ended) return;
    switch (event.type) {
      case 'session.started':
        startedAt ??= Date.now();
        events.onStarted();
        if (!greeted && channel?.readyState === 'open') {
          greeted = true;
          try {
            channel.send(JSON.stringify({ type: 'session.commentary.append', event_id: 'greeting', delegation_id: null, content: greeting }));
          } catch {
            // The developer message already asks for the greeting; this is a nudge.
          }
        }
        break;
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta':
        if (event.delta) {
          const who = event.type === 'session.input_transcript.delta' ? 'you' : 'ai';
          events.onTranscript(who, event.delta, event.start_ms ?? 0, event.end_ms ?? event.start_ms ?? 0);
        }
        break;
      case 'session.usage.updated':
        if (typeof event.usage?.seconds === 'number') {
          // OpenAI reports the call's running total; only the time since the last report is new.
          charge(event.usage.seconds);
          events.onUsage(event.usage.seconds);
        }
        break;
      case 'session.delegation.created':
        if (event.delegation?.id) events.onDelegation?.(event.delegation.id);
        break;
      case 'session.closed':
        finish();
        break;
      case 'error':
        // A rejected command doesn't end the call; there are none we rely on.
        console.warn('Talk:', event.error?.message);
        break;
    }
  }

  limit = setTimeout(() => finish(), MAX_CALL_SECONDS * 1000);
  return {
    setMuted(muted) {
      for (const track of mic.getAudioTracks()) track.enabled = !muted;
    },
    hangUp: () => finish(),
    append(kind, content, delegationId) {
      if (ended || channel?.readyState !== 'open') return;
      try {
        channel.send(JSON.stringify({ type: `session.${kind}.append`, event_id: `app_${++appended}`, delegation_id: delegationId, content }));
      } catch {
        // The channel is closing; the call ends with it.
      }
    },
  };
}
