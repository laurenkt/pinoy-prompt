// Builds a study session and tracks it as the learner works through it.
// Kept free of DOM code so it can be unit tested.

import { LEARN_ORDER, VOCAB, buildsOn, closeInMeaning, getCard, isVocab, type Card, type CardKind, type Drill } from './deck';
import { recallChance } from './memory';
import { DAY_MS, MAX_HINTED, START_EASE, isDue, startOfDayAfter, type CardState } from './srs';
import type { Progress } from './store';

export type StepKind = 'new' | 'review';

export interface Step {
  cardId: string;
  kind: StepKind;
  /** How to ask it; the session picks one when it's left out. */
  format?: Format;
}

/** How far back in the queue a missed card is re-inserted. */
const REQUEUE_GAP = 3;

export function isIntroduced(progress: Progress, cardId: string): boolean {
  return cardId in progress.cards;
}

export function dueCards(progress: Progress, now: number): string[] {
  return Object.entries(progress.cards)
    // Skip progress for cards since removed from the deck.
    .filter(([id, state]) => isDue(state, now) && getCard(id))
    .sort(([, a], [, b]) => a.due - b.due)
    .map(([id]) => id);
}

export function newCardsLeftToday(progress: Progress): number {
  return Math.max(0, progress.settings.dailyNew - progress.today.newCount);
}

/** Guides (patterns, sounds and so on) wait until the learner has met this many cards. */
export const GUIDE_START = 8;
/** Patterns are grammar, so they wait longer. */
export const PATTERN_START = 20;

/** At most one guide in this many new cards: sparse at first, a little more often once there is more to build on. */
export function guideEvery(met: number): number {
  return met >= 100 ? 4 : 6;
}

/**
 * A card has settled once it has been remembered at least a day after it was
 * met. A card forgotten later and relearned still counts: it was remembered once.
 */
export function settled(progress: Progress, id: string): boolean {
  const state = progress.cards[id];
  return !!state && hasSettled(state);
}

function hasSettled(state: CardState): boolean {
  return state.interval >= 1 && (state.reps >= 2 || state.lapses > 0);
}

/** How many cards in the deck the learner hasn't met, guides that aren't ready yet included. */
export function unmetCount(progress: Progress): number {
  return LEARN_ORDER.filter((id) => getCard(id) && !isIntroduced(progress, id)).length;
}

/**
 * The next cards to introduce, most useful first (see LEARN_ORDER). A card waits
 * until the cards it builds on (`buildsOn`) have settled: a phrase until the
 * words it is made of have been remembered a day after they were met, so each
 * phrase is one new thing on top of words already known; meanwhile the next
 * card in the order comes first. A guide also waits until the learner has met
 * enough cards and enough new cards have come since the last guide; then it
 * comes in at the first chance.
 */
export function upcomingNewCards(progress: Progress, limit: number): string[] {
  const met = Object.entries(progress.cards)
    .filter(([id]) => getCard(id))
    .sort(([, a], [, b]) => a.introduced - b.introduced);
  let count = met.length;
  let lastGuide = -1;
  met.forEach(([id], i) => {
    if (!isVocab(getCard(id)!)) lastGuide = i;
  });
  let sinceGuide = lastGuide === -1 ? Infinity : met.length - 1 - lastGuide;

  const grounded = (card: Card) => buildsOn(card).every((id) => settled(progress, id));
  const unmetCards = LEARN_ORDER.map(getCard).filter((c): c is Card => !!c && !isIntroduced(progress, c.id));
  // Cards this brings in won't have settled yet either, so a phrase that isn't grounded now stays out.
  const unmet = unmetCards.filter((c) => !isVocab(c) || grounded(c));
  // Words still to come, waiting or not, space guides out; once every word is met there is nothing to space them with.
  const wordsWaiting = unmetCards.some((c) => isVocab(c) && !grounded(c));
  const ready = (card: Card) =>
    count >= (card.kind === 'pattern' ? PATTERN_START : GUIDE_START) &&
    (sinceGuide >= guideEvery(count) - 1 || (i >= unmet.length && !wordsWaiting)) &&
    grounded(card);

  /** Guides reached in the order but not ready yet, still in order. */
  const waiting: Card[] = [];
  const result: string[] = [];
  let i = 0;
  while (result.length < limit) {
    while (i < unmet.length && !isVocab(unmet[i])) waiting.push(unmet[i++]);
    const guide = waiting.find(ready);
    if (guide) {
      waiting.splice(waiting.indexOf(guide), 1);
      sinceGuide = 0;
    } else if (i < unmet.length) {
      sinceGuide++;
    } else {
      break;
    }
    count++;
    result.push((guide ?? unmet[i++]).id);
  }
  return result;
}

/** How a card is asked. One memory per card: these are different ways of testing it, not separate things to learn. */
export type Format =
  /** See the Tagalog, pick the meaning. */
  | 'read'
  /** Hear the Tagalog, pick the meaning. */
  | 'listen'
  /** See the English, pick the Tagalog. */
  | 'recall'
  /** See the Tagalog, remember the meaning, rate yourself. */
  | 'remember'
  /** Hear the Tagalog, remember the meaning, rate yourself. */
  | 'hear'
  /** See the English, come up with the Tagalog, rate yourself. */
  | 'produce'
  /** A guide: answer one of its questions, often filling a gap in a sentence. */
  | 'gap'
  /** A pattern: put a sentence's words in order, from the English. */
  | 'build'
  /** A guide: think of the answer to one of its questions, then rate yourself. */
  | 'think';

/** What this device can do, which decides the formats on offer. */
export interface Abilities {
  listen: boolean;
}

/**
 * Words still being learned get a multiple-choice check. Learned words are
 * self-rated, because a lucky guess would push a word weeks out; they move from
 * reading and hearing to producing the Tagalog from the English as they hold.
 */
export function pickFormat(state: CardState, can: Abilities, random: () => number = Math.random, kind: CardKind = 'word'): Format {
  if (kind === 'pattern') return state.interval < 1 ? 'gap' : random() < 0.5 ? 'build' : 'think';
  if (kind !== 'word' && kind !== 'phrase') return state.interval < 1 ? 'gap' : 'think';
  if (state.interval < 1) return 'read';
  const formats: Format[] = state.interval < 7 ? ['remember'] : ['remember', 'produce', 'produce'];
  if (can.listen) formats.push('hear');
  return formats[Math.floor(random() * formats.length)];
}

/** New cards wait while this many cards are still being learned (just met, or just forgotten). */
export const MAX_LEARNING = 3;
/** A card shown in the last few steps isn't shown again yet, so a miss gets a short gap. */
const RECENT_GAP = 3;

export function learningCount(progress: Progress): number {
  return Object.entries(progress.cards).filter(([id, state]) => state.interval < 1 && getCard(id)).length;
}

/**
 * Words to study now: everything due, weakest first, then words still being
 * learned that aren't quite due (they're due again within a minute anyway).
 */
export function studyQueue(progress: Progress, now: number): string[] {
  return Object.entries(progress.cards)
    .filter(([id, state]) => (isDue(state, now) || state.interval < 1) && getCard(id))
    .map(([id, state]) => ({ id, early: !isDue(state, now), recall: recallChance(state, now) }))
    .sort((a, b) => Number(a.early) - Number(b.early) || a.recall - b.recall)
    .map(({ id }) => id);
}

/**
 * When Study next has something to ask, once it's caught up: the next review
 * falling due, or tomorrow's new cards if today's rate is what holds them back.
 * Null when nothing ever comes back (no cards met, and none left to meet).
 */
export function nextStudyAt(progress: Progress, now: number): number | null {
  const dues = Object.entries(progress.cards)
    .filter(([id, state]) => state.due > now && getCard(id))
    .map(([, state]) => state.due);
  if (progress.settings.dailyNew > 0 && upcomingNewCards(progress, 1).length) dues.push(startOfDayAfter(now, 1));
  return dues.length ? Math.min(...dues) : null;
}

/**
 * The next step of open-ended study. In order:
 * 1. Due reviews, weakest first.
 * 2. A new word, but only once nothing is due, few words are still being
 *    learned, and the daily new-word rate allows it.
 * Null once caught up: practice beyond that is Drills' (see pickDrillCard).
 * `recent` is the cards shown this session, latest last.
 */
export function nextStudyStep(progress: Progress, now: number, recent: string[], can: Abilities, random: () => number = Math.random): Step | null {
  const shownRecently = new Set(recent.slice(-RECENT_GAP));
  const last = recent[recent.length - 1];
  const reviewOf = (id: string): Step => ({ cardId: id, kind: 'review', format: pickFormat(progress.cards[id], can, random, getCard(id)!.kind) });
  // A full gap when there's enough to fill it; otherwise just not the same card twice running.
  const queue = studyQueue(progress, now);
  const review = queue.find((id) => !shownRecently.has(id)) ?? queue.find((id) => id !== last);
  if (review) return reviewOf(review);

  if (newCardsLeftToday(progress) > 0 && learningCount(progress) < MAX_LEARNING) {
    const [fresh] = upcomingNewCards(progress, 1);
    if (fresh) return { cardId: fresh, kind: 'new', format: isVocab(getCard(fresh)!) ? 'read' : 'gap' };
  }
  // Nothing else to ask: the card just shown again, rather than calling Study caught up while it's still being learned.
  // Not a guide with nothing to ask, which Study skips: it would come straight back.
  const again = queue[0] && getCard(queue[0])!;
  return again && (isVocab(again) || again.drills?.length) ? reviewOf(again.id) : null;
}

/** How many of the last cards drilled are kept out of the next pick, so nothing comes straight back. */
export const DRILL_GAP = 3;
/** A drill round waits until this many words are met, so its questions aren't the same few over and over. */
export const DRILL_MIN_WORDS = 4;

/** Whether there are words enough for a drill round. */
export function canDrill(progress: Progress): boolean {
  return Object.keys(progress.cards).filter((id) => getCard(id) && isVocab(getCard(id)!)).length >= DRILL_MIN_WORDS;
}
/** Cards met within this long that haven't settled yet count as new in a drill round, and come up more. */
const FRESH_MS = 7 * DAY_MS;
/** Cards met within this long that haven't settled yet are still settling in, and share the focus part of a round (see pickDrillCard). */
const SETTLING_MS = 3 * DAY_MS;
/**
 * The share of a drill round kept for cards still settling in, so they come up as often in a big deck as in a
 * small one (weights alone get spread thinner with every card met): FOCUS_PER_CARD for each, up to FOCUS_SHARE,
 * so one or two new words don't come round every few questions. Never less than their weights would give them.
 */
const FOCUS_SHARE = 0.5;
const FOCUS_PER_CARD = 0.1;

/**
 * How much a card needs drilling. Every card starts at 1, so the strong ones
 * still turn up now and then; on top of that come how likely it is to have
 * been forgotten, being still learned or recently met and not yet settled,
 * how often it has been forgotten before, a hard start (answered Again or Hard
 * while it hasn't yet held a week, which lowers its ease), and misses this
 * round (`missed`) and, most of all, answers the drills had to help with
 * (`hinted`, kept across rounds): what was seen to go wrong outweighs what the
 * calendar guesses.
 */
export function drillWeight(state: CardState, now: number, missed = 0): number {
  const fading = 1 - recallChance(state, now);
  const learning = state.interval < 1 ? 3 : state.interval < 7 ? 1.5 : 0;
  // Once it has settled (remembered a day after it was met), how long ago it was met says nothing more.
  const fresh = !hasSettled(state) && now - state.introduced < FRESH_MS ? 2 : 0;
  // Ease never comes back up on Good, so a hard start stops counting once the card has held a week. A lapse counts on its own.
  const struggled = state.interval < 7 && state.lapses === 0 ? Math.min(3, 10 * Math.max(0, START_EASE - state.ease)) : 0;
  return 1 + 8 * fading + learning + fresh + struggled + 2 * Math.min(state.lapses, 3) + 4 * missed + 8 * (state.hinted ?? 0);
}

/**
 * Whether a card is in the focus part of a drill round: still being learned, met in the last few days and not yet
 * settled, missed this round, or one the drills had to help with (`hinted`).
 */
function settlingIn(state: CardState, now: number, missed = 0): boolean {
  return state.interval < 1 || (!hasSettled(state) && now - state.introduced < SETTLING_MS) || missed > 0 || !!state.hinted;
}

/**
 * The next card for a drill round, which runs until the learner stops it: any
 * card met, words and guides alike, that `askable` allows, picked at random by
 * drillWeight. A share of the picks (see FOCUS_SHARE) are among cards
 * settling in (settlingIn) while there are any, the rest among the others. The last few
 * cards asked (`recent`, latest last) sit out while that leaves one to ask.
 * Null with nothing to ask.
 */
export function pickDrillCard(
  progress: Progress,
  now: number,
  recent: string[],
  missed: ReadonlyMap<string, number>,
  askable: (card: Card) => boolean = () => true,
  random: () => number = Math.random,
): Card | null {
  const pool = Object.entries(progress.cards)
    .map(([id, state]) => ({ card: getCard(id), state }))
    .filter((p): p is { card: Card; state: CardState } => !!p.card && askable(p.card))
    .map(({ card, state }) => {
      const misses = missed.get(card.id);
      return { card, w: drillWeight(state, now, misses), focus: settlingIn(state, now, misses) };
    });
  const keep = Math.min(DRILL_GAP, pool.length - 1);
  const skip = new Set(keep > 0 ? recent.slice(-keep) : []);
  const open = pool.filter((p) => !skip.has(p.card.id));
  if (open.length === 0) return null;
  const focus = open.filter((p) => p.focus);
  const total = (ps: typeof open) => ps.reduce((sum, p) => sum + p.w, 0);
  // Never less than the cards settling in would get by weight alone.
  // Counted before the sit-out, which so often holds cards settling in that it would shrink their share.
  const settling = pool.filter((p) => p.focus).length;
  const share = Math.max(total(focus) / total(open), Math.min(FOCUS_SHARE, FOCUS_PER_CARD * settling));
  // One draw decides both which part of the round and which card in it.
  let r = random();
  let from = open;
  if (focus.length > 0 && focus.length < open.length) {
    if (r < share) {
      from = focus;
      r /= share;
    } else {
      from = open.filter((p) => !p.focus);
      r = (r - share) / (1 - share);
    }
  }
  r *= total(from);
  return (from.find((p) => (r -= p.w) <= 0) ?? from[from.length - 1]).card;
}

/**
 * Note how a typed drill question on a card went, for drillWeight: helped (`hinted`: answered from the choices after
 * "Show choices", or typed wrong), or typed right without help. Only `hinted` changes, never the schedule. Whether
 * progress changed, to be saved.
 */
export function noteDrillAnswer(progress: Progress, cardId: string, hinted: boolean): boolean {
  const state = progress.cards[cardId];
  if (!state) return false;
  const before = state.hinted ?? 0;
  const after = hinted ? Math.min(before + 1, MAX_HINTED) : Math.max(before - 1, 0);
  if (after === before) return false;
  if (after) state.hinted = after;
  else delete state.hinted;
  return true;
}

/** A few more new cards beyond the daily rate, for when the learner wants them. */
export function buildExtraSession(progress: Progress, size = 5): Step[] {
  return upcomingNewCards(progress, size).map((cardId) => ({ cardId, kind: 'new' }));
}

/** Put a missed card back a few steps later so it comes round again this session. */
export function requeue(queue: Step[], step: Step): Step[] {
  const next = [...queue];
  next.splice(Math.min(REQUEUE_GAP, next.length), 0, { cardId: step.cardId, kind: 'review' });
  return next;
}

/**
 * Pick wrong answers for a multiple-choice question on a word or phrase.
 * Prefers cards of the same kind (word vs phrase) so the right answer can't be
 * spotted by its length, and never one that could also be right (CLOSE_MEANINGS).
 * Guides are never used.
 */
export function distractors(
  card: Card,
  field: 'en' | 'tl',
  count: number,
  pool: Card[] = VOCAB,
  random: () => number = Math.random,
): Card[] {
  const seen = new Set([card[field].toLowerCase()]);
  const candidates = shuffle(
    pool.filter((c) => c.id !== card.id && isVocab(c) && !closeInMeaning(c.id, card.id)),
    random,
  ).sort((a, b) => Number(b.kind === card.kind) - Number(a.kind === card.kind));
  const picked: Card[] = [];
  for (const c of candidates) {
    const key = c[field].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length === count) break;
  }
  return picked;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A drill's whole Tagalog sentence, with the answer in its gap. */
export function drillSentence(drill: Drill): string {
  return drill.tl ? drill.tl.replace('___', drill.answer) : drill.answer;
}

/**
 * The words to build a drill's sentence from, lower case and without
 * punctuation, so a capital or a full stop doesn't give the order away. A
 * one-word wrong answer joins them as a decoy.
 */
export function buildTiles(drill: Drill): { words: string[]; decoy?: string } {
  const words = tileWords(drillSentence(drill));
  const decoy = drill.wrong.find((w) => !w.includes(' ') && !words.includes(tileWords(w)[0]));
  return { words, decoy: decoy && tileWords(decoy)[0] };
}

function tileWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?"]/g, '')
    .split(' ')
    .filter(Boolean);
}

/** Whether a drill makes a sentence worth building from tiles. */
export function canBuild(drill: Drill): boolean {
  return !!drill.tl && buildTiles(drill).words.length >= 3;
}

/**
 * One of a guide's drills to ask, at random so a pattern turns up in fresh
 * sentences. Prefers drills made only of cards the learner has met, and for
 * `build`, ones with a sentence to build. Never the drill asked last time, if
 * there is another.
 */
export function pickDrill(
  card: Card,
  progress: Progress,
  format: Format,
  last?: Drill,
  random: () => number = Math.random,
): Drill | undefined {
  let drills = card.drills ?? [];
  if (format === 'build') drills = drills.filter(canBuild);
  const known = drills.filter((d) => (d.uses ?? []).every((id) => isIntroduced(progress, id)));
  if (known.length > 0) drills = known;
  if (drills.length > 1 && last) drills = drills.filter((d) => d !== last);
  return drills[Math.floor(random() * drills.length)];
}
