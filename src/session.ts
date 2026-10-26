// Builds a study session and tracks it as the learner works through it.
// Kept free of DOM code so it can be unit tested.

import { LEARN_ORDER, VOCAB, buildsOn, cardForWord, cardKey, closeInMeaning, getCard, isVocab, keyed, studyWays, tagalogWords, variantsOf, type Card, type CardKind, type Drill, type Way } from './deck';
import { canTypeMeaning } from './meaning';
import { recallChance } from './memory';
import { DAY_MS, DRILL_STREAK, MAX_HELP, START_EASE, isDue, newCardState, startOfDayAfter, type CardState } from './srs';
import type { Progress } from './store';

export type StepKind = 'new' | 'review';

export interface Step {
  cardId: string;
  kind: StepKind;
  /** The way it's studied, its own card (see Way); read when it's left out. Only read is ever new: the rest follow it. */
  way?: Way;
  /** How to ask it; the session picks one when it's left out. */
  format?: Format;
}

/** Where saved progress keeps a step's card (see cardKey). */
export const stepKey = (step: Step): string => cardKey(step.cardId, step.way ?? 'read');

/** How far back in the queue a missed card is re-inserted. */
const REQUEUE_GAP = 3;

export function isIntroduced(progress: Progress, cardId: string): boolean {
  return cardId in progress.cards;
}

/**
 * The cards Study schedules that the learner has met, each a card asked one way, by its key in saved progress. Skips
 * progress for cards since removed from the deck, and ways Study doesn't ask.
 */
function studied(progress: Progress): { key: string; card: Card; way: Way; state: CardState }[] {
  return Object.entries(progress.cards).flatMap(([key, state]) => {
    const found = keyed(key);
    return found && studyWays(found.card).includes(found.way) ? [{ key, ...found, state }] : [];
  });
}

/** The schedule of a card asked one way, if Study keeps one for it: a guide's is its own whichever way it's asked. */
export function wayState(progress: Progress, card: Card, way: Way): CardState | undefined {
  return progress.cards[isVocab(card) ? cardKey(card.id, way) : card.id];
}

/** Due cards, by key (see cardKey), soonest due first. */
export function dueCards(progress: Progress, now: number): string[] {
  return studied(progress)
    .filter(({ state }) => isDue(state, now))
    .sort((a, b) => a.state.due - b.state.due)
    .map(({ key }) => key);
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
  return leftToSettle(progress.cards[id]) === 0;
}

/** Right answers in Study a card asked one way still needs to settle (see settled): a day after the first, if it hasn't been remembered yet. */
function leftToSettle(state: CardState | undefined): number {
  if (!state) return 2;
  if (state.interval >= 1) return state.reps >= 2 || state.lapses > 0 ? 0 : 1;
  // Still being learned: forgotten once, it was remembered before, so a right answer now settles it.
  return state.lapses > 0 ? 1 : 2;
}

/** Whether a drill asks a card one way typed, rather than picked from choices, and what Drills or Study still need before it does. */
export interface Typing {
  typed: boolean;
  /** Right answers in a row Drills still need this way (DRILL_STREAK in all); missing when this way is never typed. */
  inARow?: number;
  /** Right answers Study still needs this way; missing when this way is never typed (Read, Speak, a meaning that's only a note). */
  left?: number;
  /** When Study next asks it this way; missing until Study has started this way. */
  due?: number;
}

/**
 * How a drill asks a word card `way` (Recall, and Listen when its meaning can be typed): typed once it has been got
 * right DRILL_STREAK times in a row that way in Drills, or that way of studying it has settled in Study, whichever
 * comes first; from choices until then. Guides have drills of their own.
 */
export function typing(progress: Progress, card: Card, way: Way): Typing {
  if (!(way === 'recall' || (way === 'listen' && canTypeMeaning(card)))) return { typed: false };
  const inARow = DRILL_STREAK - drillNote(progress.cards[card.id], way).streak;
  const state = progress.cards[cardKey(card.id, way)];
  const left = leftToSettle(state);
  if (!left || inARow <= 0) return { typed: true };
  return { typed: false, inARow, left, due: state?.due };
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

/** What this device can do now, which decides the ways Study asks: listening needs a voice and the sound on. */
export interface Abilities {
  listen: boolean;
}

/** What Study can ask now, from the settings and whether the device has a voice at all (canPlay in speech.ts). */
export function abilities(progress: Progress, voice = true): Abilities {
  return { listen: voice && progress.settings.sound };
}

/** Whether a way of studying a card can be asked now. One that can't waits, exactly as it is, until it can. */
function canAsk(way: Way, can: Abilities): boolean {
  return way !== 'listen' || can.listen;
}

/**
 * How Study asks a card, the way it's studied. Words still being learned get a multiple-choice check; learned words
 * are self-rated, because a lucky guess would push a word weeks out.
 */
export function pickFormat(state: CardState, way: Way = 'read', random: () => number = Math.random, kind: CardKind = 'word'): Format {
  if (kind === 'pattern') return state.interval < 1 ? 'gap' : random() < 0.5 ? 'build' : 'think';
  if (kind !== 'word' && kind !== 'phrase') return state.interval < 1 ? 'gap' : 'think';
  const learning = state.interval < 1;
  if (way === 'listen') return learning ? 'listen' : 'hear';
  if (way === 'recall') return learning ? 'recall' : 'produce';
  return learning ? 'read' : 'remember';
}

/** New cards wait while this many cards are still being learned (just met, or just forgotten). */
export const MAX_LEARNING = 3;
/** A card shown in the last few steps isn't shown again yet, so a miss gets a short gap. */
const RECENT_GAP = 3;

/** Cards still being learned that Study can ask now: a listening card waiting for the sound doesn't hold new ones back. */
export function learningCount(progress: Progress, can: Abilities = { listen: true }): number {
  return studied(progress).filter(({ way, state }) => state.interval < 1 && canAsk(way, can)).length;
}

/**
 * Cards to study now, by key (see cardKey): everything due that can be asked now, weakest first, then cards still
 * being learned that aren't quite due (they're due again within a minute anyway).
 */
export function studyQueue(progress: Progress, now: number, can: Abilities = { listen: true }): string[] {
  return studied(progress)
    .filter(({ way, state }) => (isDue(state, now) || state.interval < 1) && canAsk(way, can))
    .map(({ key, state }) => ({ key, early: !isDue(state, now), recall: recallChance(state, now) }))
    .sort((a, b) => Number(a.early) - Number(b.early) || a.recall - b.recall)
    .map(({ key }) => key);
}

/**
 * The ways of studying words met that are ready to start, as steps, in the order the words were met: each once the
 * word's reading card has settled (see settled), so a word is learned one way before another, and only ways that can
 * be asked now.
 */
export function upcomingWays(progress: Progress, can: Abilities = { listen: true }): Step[] {
  return studied(progress)
    .filter(({ key, way }) => way === 'read' && settled(progress, key))
    .sort((a, b) => a.state.introduced - b.state.introduced)
    .flatMap(({ card }) =>
      studyWays(card)
        .filter((way) => !(cardKey(card.id, way) in progress.cards) && canAsk(way, can))
        .map((way): Step => ({ cardId: card.id, way, kind: 'review', format: pickFormat(newCardState(0), way) })),
    );
}

/**
 * What open-ended study has left to ask before it's caught up: the cards to study now (see studyQueue), and the
 * cards still to start today, ways of words already met (see upcomingWays) and new words the daily rate allows.
 * Fresh ones count even while too many cards are being learned to start them (see MAX_LEARNING): those cards are
 * in studyQueue, so there are reviews to do first anyway.
 */
export function studyLeft(progress: Progress, now: number, can: Abilities = { listen: true }): { reviews: number; fresh: number } {
  return {
    reviews: studyQueue(progress, now, can).length,
    fresh: upcomingWays(progress, can).length + upcomingNewCards(progress, newCardsLeftToday(progress)).length,
  };
}

/**
 * When Study next has something to ask, once it's caught up: the next review
 * falling due, or tomorrow's new cards if today's rate is what holds them back.
 * Null when nothing ever comes back (no cards met, and none left to meet).
 */
export function nextStudyAt(progress: Progress, now: number, can: Abilities = { listen: true }): number | null {
  const dues = studied(progress)
    .filter(({ way, state }) => state.due > now && canAsk(way, can))
    .map(({ state }) => state.due);
  if (progress.settings.dailyNew > 0 && upcomingNewCards(progress, 1).length) dues.push(startOfDayAfter(now, 1));
  return dues.length ? Math.min(...dues) : null;
}

/**
 * The next step of open-ended study. In order:
 * 1. Due reviews, weakest first.
 * 2. Once few cards are still being learned: another way of studying a word
 *    already met (see upcomingWays), then a new word, if the daily new-word rate
 *    allows it. Ways of words already met don't count towards that rate.
 * Null once caught up: practice beyond that is Drills' (see pickDrillCard).
 * `recent` is the cards shown this session, by key (see stepKey), latest last.
 * A card isn't asked again within a few steps, whichever way: one way of asking
 * a word would give away another.
 */
export function nextStudyStep(progress: Progress, now: number, recent: string[], can: Abilities, random: () => number = Math.random): Step | null {
  const idOf = (key: string) => keyed(key)?.card.id ?? key;
  const shownRecently = new Set(recent.slice(-RECENT_GAP).map(idOf));
  const last = recent.length ? idOf(recent[recent.length - 1]) : undefined;
  const reviewOf = (key: string): Step => {
    const { card, way } = keyed(key)!;
    return { cardId: card.id, way, kind: 'review', format: pickFormat(progress.cards[key], way, random, card.kind) };
  };
  // A full gap when there's enough to fill it; otherwise just not the same card twice running.
  const queue = studyQueue(progress, now, can);
  const review = queue.find((key) => !shownRecently.has(idOf(key))) ?? queue.find((key) => idOf(key) !== last);
  if (review) return reviewOf(review);

  if (learningCount(progress, can) < MAX_LEARNING) {
    const ways = upcomingWays(progress, can);
    const way = ways.find((s) => !shownRecently.has(s.cardId)) ?? ways.find((s) => s.cardId !== last);
    if (way) return way;
  }
  if (newCardsLeftToday(progress) > 0 && learningCount(progress, can) < MAX_LEARNING) {
    const [fresh] = upcomingNewCards(progress, 1);
    if (fresh) return { cardId: fresh, kind: 'new', format: isVocab(getCard(fresh)!) ? 'read' : 'gap' };
  }
  // Nothing else to ask: the card just shown again, rather than calling Study caught up while it's still being learned.
  // Not a guide with nothing to ask, which Study skips: it would come straight back.
  const again = queue[0] && keyed(queue[0])!.card;
  return again && (isVocab(again) || again.drills?.length) ? reviewOf(queue[0]) : null;
}

/** How many of the last cards drilled are kept out of the next pick, so nothing comes straight back. */
export const DRILL_GAP = 3;
/** A drill round waits until this many words are met, so its questions aren't the same few over and over. */
export const DRILL_MIN_WORDS = 4;

/** Whether there are words enough for a drill round. */
export function canDrill(progress: Progress): boolean {
  return Object.keys(progress.cards).filter((id) => getCard(id) && isVocab(getCard(id)!)).length >= DRILL_MIN_WORDS;
}
/** Cards met within this long that haven't held yet count as new in a drill round, and come up more. */
const FRESH_MS = 7 * DAY_MS;
/** Cards met within this long that haven't held yet are still settling in, and share the focus part of a round (see pickDrillCard). */
const SETTLING_MS = 3 * DAY_MS;
/**
 * The share of a drill round kept for cards still settling in, so they come up as often in a big deck as in a
 * small one (weights alone get spread thinner with every card met): FOCUS_PER_CARD for each, up to FOCUS_SHARE,
 * so one or two new words don't come round every few questions. Never less than their weights would give them.
 */
const FOCUS_SHARE = 0.5;
const FOCUS_PER_CARD = 0.1;
/**
 * The share of a drill round kept for ways the drills had to help with: HELP_PER_ANSWER for each answer still
 * needing help (drillHelp, up to MAX_HELP a way), up to HELP_SHARE, so a way that needed help three times has 45% of
 * the picks to itself and one helped with once 15%, however big the deck. Taken before the focus part.
 */
const HELP_SHARE = 0.6;
const HELP_PER_ANSWER = 0.15;
/** The share of a drill round always left for cards neither helped with nor settling in, so the ones known well still turn up. */
const REST_SHARE = 0.2;

/** A card and a way of asking it: what a drill round picks, and what it keeps count of. */
export interface DrillPick {
  card: Card;
  way: Way;
}

/** The key for a card asked one way, as a round's `missed` holds it. */
export const drillKey = (id: string, way: Way): string => `${id} ${way}`;

/**
 * Whether a card has held in Study: remembered twice in a row, the second time a day or more after the first. A card
 * relearned after a lapse holds again only once it has been remembered twice since.
 */
function held(state: CardState): boolean {
  return state.interval >= 1 && state.reps >= 2;
}

/**
 * How much a card needs drilling, by its schedule, whichever way it's asked. Every card starts at 1, so the strong
 * ones still turn up now and then; on top of that come how likely it is to have been forgotten, being still learned
 * or recently met and not yet held, how often it has been forgotten before, and a hard start (answered Again or Hard
 * while it hasn't yet held a week, which lowers its ease). How each way of asking it has gone in drills comes on top
 * (see pickDrillCard).
 */
export function drillWeight(state: CardState, now: number): number {
  const fading = 1 - recallChance(state, now);
  const learning = state.interval < 1 ? 3 : state.interval < 7 ? 1.5 : 0;
  // Once it has held, how long ago it was met says nothing more.
  const fresh = !held(state) && now - state.introduced < FRESH_MS ? 2 : 0;
  // Ease never comes back up on Good, so a hard start stops counting once the card has held a week. A lapse counts on its own.
  const struggled = state.interval < 7 && state.lapses === 0 ? Math.min(3, 10 * Math.max(0, START_EASE - state.ease)) : 0;
  return 1 + 8 * fading + learning + fresh + struggled + 2 * Math.min(state.lapses, 3);
}

/** How many answers asked this way needed help, less those got right unaided since (CardState.help). */
export function drillHelp(state: CardState | undefined, way: Way): number {
  return state?.help?.[way] ?? 0;
}

/** What the drills have noted on a card (its read key) asked one way: answers needing help, and right in a row. */
export interface DrillNote {
  help: number;
  streak: number;
}

export function drillNote(state: CardState | undefined, way: Way): DrillNote {
  return { help: drillHelp(state, way), streak: state?.streak?.[way] ?? 0 };
}

/** Whether a card's schedule puts it in the focus part of a drill round: still being learned, or met in the last few days and not yet held. */
function settlingIn(state: CardState, now: number): boolean {
  return state.interval < 1 || (!held(state) && now - state.introduced < SETTLING_MS);
}

/**
 * The next question for a drill round, which runs until the learner stops it: any card met, words and guides alike,
 * asked any way `ways` allows it. A way missed this round comes back on its own (`repeats`, see noteDrillRepeat): the
 * first one due by `asked`, the number of questions asked this round before this one, is asked, whatever has just
 * been asked. Otherwise it's picked at random by weight. Each way of asking a card is weighed on its own: the
 * drillWeight of that way's schedule in Study (reading's for a way Study doesn't keep), shared between its ways (so a
 * word asked four ways comes up no more than a guide asked one),
 * plus, most of all, misses this round asked that way and answers asked that way the drills had to help with
 * (drillHelp): what was seen to go wrong outweighs what the calendar guesses. So a word read easily but never recalled
 * from the English is asked for its Tagalog, not read again.
 *
 * Ways the drills had to help with get a share of the picks of their own, more the more they needed help (see
 * HELP_SHARE); a share of the rest (see FOCUS_SHARE) are among cards settling in (settlingIn), or ways missed this
 * round, while there are any, the rest among the others. The last few cards asked (`recent`, latest last) sit out,
 * every way, while that leaves one to ask. Null with nothing to ask. Picked by the chances drillOdds gives.
 */
export function pickDrillCard(
  progress: Progress,
  now: number,
  recent: string[],
  repeats: ReadonlyMap<string, DrillRepeat>,
  asked: number,
  ways: (card: Card) => readonly Way[],
  random: () => number = Math.random,
): DrillPick | null {
  const due = dueRepeat(progress, repeats, asked, ways);
  if (due) return due;
  const odds = drillOdds(progress, now, recent, repeats, ways);
  if (odds.length === 0) return null;
  // One draw decides both which part of the round and which question in it: the parts come in order.
  let r = random();
  return (odds.find((o) => (r -= o.chance) <= 0) ?? odds[odds.length - 1]).pick;
}

/**
 * The gaps, in other questions, before a way missed in a drill round comes back, one after each time it's asked again:
 * the very next question, then after one other, then easing off. Got right at the end of them, it goes back to taking
 * its chances with the rest. Missed again on the way, it starts over, and each miss this round past the first adds
 * another one-question gap before it eases off (up to MAX_HELP), so a word that keeps slipping stays close.
 */
export const DRILL_REPEATS = [0, 1, 3, 6];

/** A way missed in a drill round coming back on its own (see DRILL_REPEATS), by drillKey. */
export interface DrillRepeat {
  /** Times missed this round. */
  misses: number;
  /** Times got right since it was last missed. */
  rights: number;
  /** The question it's due as, counting from 0 at the round's first. */
  due: number;
}

/** The gaps a way missed `misses` times this round comes back after (see DRILL_REPEATS). */
function repeatGaps(misses: number): number[] {
  const extra = Math.min(misses - 1, MAX_HELP);
  return [DRILL_REPEATS[0], ...Array<number>(extra).fill(1), ...DRILL_REPEATS.slice(1)];
}

/**
 * Note how question number `asked` (from 0) of a drill round went, asked one way (`key`, by drillKey), so a miss comes
 * back on its own (see DRILL_REPEATS). Changes `repeats`.
 */
export function noteDrillRepeat(repeats: Map<string, DrillRepeat>, key: string, right: boolean, asked: number): void {
  const before = repeats.get(key);
  if (!right) {
    const misses = (before?.misses ?? 0) + 1;
    repeats.set(key, { misses, rights: 0, due: asked + 1 + repeatGaps(misses)[0] });
    return;
  }
  if (!before) return;
  const rights = before.rights + 1;
  const gaps = repeatGaps(before.misses);
  if (rights >= gaps.length) repeats.delete(key);
  else repeats.set(key, { ...before, rights, due: asked + 1 + gaps[rights] });
}

/** The repeat due soonest by question `asked` that can be asked now, if any. */
function dueRepeat(progress: Progress, repeats: ReadonlyMap<string, DrillRepeat>, asked: number, ways: (card: Card) => readonly Way[]): DrillPick | null {
  let best: { pick: DrillPick; due: number } | null = null;
  for (const [key, { due }] of repeats) {
    if (due > asked || (best && best.due <= due)) continue;
    const split = key.lastIndexOf(' ');
    const id = key.slice(0, split);
    const way = key.slice(split + 1) as Way;
    const card = progress.cards[id] ? getCard(id) : undefined;
    if (card && ways(card).includes(way)) best = { pick: { card, way }, due };
  }
  return best?.pick ?? null;
}

/** A question pickDrillCard could ask next, and the chance it does. */
export interface DrillOdds {
  pick: DrillPick;
  chance: number;
}

/**
 * The chance of each question pickDrillCard could ask next at random, adding up to 1: ways the drills had to help with
 * first, then the rest of the focus part of the round, then the rest. Empty with nothing to ask. Also what a card's back
 * shows of how often Drills picks it.
 */
export function drillOdds(
  progress: Progress,
  now: number,
  recent: string[],
  repeats: ReadonlyMap<string, DrillRepeat>,
  ways: (card: Card) => readonly Way[],
): DrillOdds[] {
  const entries = Object.entries(progress.cards);
  // The ways with a schedule of their own (see cardKey), found once rather than looked up for every word.
  const ownKeys = new Set(entries.flatMap(([key]) => (key.includes(':') ? [key] : [])));
  const pool = entries.flatMap(([id, state]) => {
    // A way's own key is reached through its word's read key.
    const card = id.includes(':') ? undefined : getCard(id);
    const asks = card ? ways(card) : [];
    if (asks.length === 0) return [];
    let read: { weight: number; settling: boolean } | undefined;
    return asks.map((way) => {
      // Each way by its own schedule, where Study keeps one; otherwise (Speak, or a way not started yet) by reading's.
      const own = way !== 'read' && ownKeys.size > 0 && ownKeys.has(cardKey(id, way)) ? progress.cards[cardKey(id, way)] : state;
      const { weight, settling } =
        own === state ? (read ??= { weight: drillWeight(state, now), settling: settlingIn(state, now) }) : { weight: drillWeight(own, now), settling: settlingIn(own, now) };
      const misses = repeats.get(drillKey(id, way))?.misses ?? 0;
      const help = drillHelp(state, way);
      return { pick: { card: card!, way }, w: weight / asks.length + 4 * misses + 8 * help, help, focus: settling || misses > 0 };
    });
  });
  if (pool.length === 0) return [];
  const cards = (ps: typeof pool) => new Set(ps.map((p) => p.pick.card.id));
  const keep = Math.min(DRILL_GAP, cards(pool).size - 1);
  const skip = new Set(keep > 0 ? recent.slice(-keep) : []);
  const open = pool.filter((p) => !skip.has(p.pick.card.id));
  const total = (ps: typeof open) => ps.reduce((sum, p) => sum + p.w, 0);
  const all = total(open);
  // Each part's share is never less than its questions would get by weight alone, within its cap.
  const helped = open.filter((p) => p.help > 0);
  // Only the ways open now count towards it: helped ways sitting out would hand their share to the others.
  // Never more than HELP_SHARE, even by weight, so a small deck with many helped still has room for the rest.
  const helpShare = Math.min(HELP_SHARE, Math.max(total(helped) / all, HELP_PER_ANSWER * helped.reduce((sum, p) => sum + p.help, 0)));
  const rest = open.filter((p) => p.help === 0);
  const focus = rest.filter((p) => p.focus);
  // Counted before the sit-out, which so often holds cards settling in that it would shrink their share.
  const settling = cards(pool.filter((p) => p.focus && p.help === 0)).size;
  // What's left after the ways helped with, keeping REST_SHARE for the others.
  const focusShare = Math.max(0, Math.min(1 - REST_SHARE - helpShare, Math.max(total(focus) / all, Math.min(FOCUS_SHARE, FOCUS_PER_CARD * settling))));
  const parts: [typeof open, number][] = [
    [helped, helpShare],
    [focus, focusShare],
    [rest.filter((p) => !p.focus), 1 - helpShare - focusShare],
  ];
  // A part with nothing to ask has its share spread over the others, in proportion.
  const filled = parts.filter(([ps]) => ps.length > 0);
  const given = filled.reduce((sum, [, share]) => sum + share, 0);
  return filled.flatMap(([ps, share]) => {
    const sum = total(ps);
    return ps.map((p) => ({ pick: p.pick, chance: (share / given) * (p.w / sum) }));
  });
}

/**
 * Note how a drill question asked one way went, for pickDrillCard and typing: helped (got wrong, or picked from the
 * choices after "Show choices") adds one, up to MAX_HELP, and ends its run of right answers; right unaided takes one
 * off and adds one to the run, up to DRILL_STREAK. Never the schedule. Whether progress changed, to be saved.
 */
export function noteDrillAnswer(progress: Progress, cardId: string, way: Way, helped: boolean, now: number): boolean {
  return setDrillNote(progress, cardId, way, (n) => afterDrillAnswer(n, helped), now);
}

/** What a drill answer makes of a card's drill note asked that way (see noteDrillAnswer). */
export function afterDrillAnswer(note: DrillNote, helped: boolean): DrillNote {
  return helped
    ? { help: Math.min(note.help + 1, MAX_HELP), streak: 0 }
    : { help: Math.max(note.help - 1, 0), streak: Math.min(note.streak + 1, DRILL_STREAK) };
}

/** Set a card's drill note asked one way, from what it was. Whether that changed it. */
export function setDrillNote(progress: Progress, cardId: string, way: Way, to: (before: DrillNote) => DrillNote, now: number): boolean {
  const state = progress.cards[cardId];
  if (!state) return false;
  const before = drillNote(state, way);
  const after = to(before);
  if (after.help === before.help && after.streak === before.streak) return false;
  const help = withCount(state.help, way, after.help);
  if (help) state.help = help;
  else delete state.help;
  const streak = withCount(state.streak, way, after.streak);
  if (streak) state.streak = streak;
  else delete state.streak;
  // Kept even once they're back to none, so a sync keeps the clearing too.
  state.helpAt = now;
  return true;
}

/** Counts for each way with `way`'s set to `n` (none at 0); undefined when that leaves none. */
function withCount(counts: Partial<Record<Way, number>> | undefined, way: Way, n: number): Partial<Record<Way, number>> | undefined {
  const next = { ...counts };
  if (n) next[way] = n;
  else delete next[way];
  return Object.keys(next).length ? next : undefined;
}

/** How often a phrase with variants the learner can be asked is asked as one of them, rather than as itself. */
export const VARIANT_CHANCE = 0.5;

/**
 * The card as it's asked this time, `way`: itself, or now and then (VARIANT_CHANCE) one of its variants (variantsOf in
 * deck.ts), picked from those whose words the learner has all met, so a variant never brings a word they don't know.
 * Only once the phrase has settled that way (reading's schedule for Speak, which Study doesn't keep), so a phrase still
 * being learned is asked as itself. Decided once per question, as askWithPicture is, so a redraw keeps it.
 */
export function askAs(progress: Progress, card: Card, way: Way, random: () => number = Math.random): Card {
  if (!settled(progress, cardKey(card.id, studyWays(card).includes(way) ? way : 'read'))) return card;
  const met = (word: string) => {
    const id = cardForWord(word);
    return !id || isIntroduced(progress, id);
  };
  const ready = variantsOf(card).filter((v) => tagalogWords(v.tl).every(met));
  if (!ready.length || random() >= VARIANT_CHANCE) return card;
  return ready[Math.floor(random() * ready.length)];
}

/** A few more new cards beyond the daily rate, for when the learner wants them. */
export function buildExtraSession(progress: Progress, size = 5): Step[] {
  return upcomingNewCards(progress, size).map((cardId) => ({ cardId, kind: 'new' }));
}

/** Put a missed card back a few steps later so it comes round again this session. */
export function requeue(queue: Step[], step: Step): Step[] {
  const next = [...queue];
  next.splice(Math.min(REQUEUE_GAP, next.length), 0, { cardId: step.cardId, way: step.way, kind: 'review' });
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
