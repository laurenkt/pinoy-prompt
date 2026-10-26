// The shape of saved progress, and how any saved copy is read back.
//
// Saved progress is the learner's work, so reading it never throws and never
// discards more than it must:
// - Each copy carries a schema version. Older copies are upgraded step by step
//   through MIGRATIONS; a copy from a newer version of the app is read as far
//   as this version understands it, and fields it doesn't know are kept.
// - A damaged card is repaired field by field rather than dropped. Only an
//   entry that isn't an object at all is skipped.
// - Unknown fields anywhere are carried through untouched, so a save from an
//   older build can't strip data a newer build added.
//
// Changing the schema: bump SCHEMA, add MIGRATIONS[old] that turns an old
// progress object into the new shape, and add a fixture for the new version
// under src/test/fixtures/. The tests fail until both exist.

import { WAYS, cardKey, getCard, studyWays, type Way } from './deck';
import { DAY_MS, DRILL_STREAK, MAX_HELP, MIN_EASE, START_EASE, startOfDayAfter, type CardState } from './srs';

export interface Settings {
  /** New cards introduced per day. */
  dailyNew: number;
  /** Play audio automatically when a card is shown. */
  autoplay: boolean;
  /** The microphone may be used: off, nothing asks the learner to speak (quiet mode, screens/quiet.ts). */
  mic: boolean;
  /** Audio may play: off, nothing plays and nothing asks to be heard. */
  sound: boolean;
  /** A soft tick when a button is pressed. */
  tapSounds: boolean;
  /** Show how many cards are due on the Home Screen icon (badge.ts). */
  iconBadge: boolean;
}

/** How a day's reviews of already-learned cards went. */
export interface DayTally {
  /** Reviews of cards answered before, not counting retries within the hour. */
  reviews: number;
  /** How many of those were forgotten ("Again"). */
  missed: number;
}

export interface Progress {
  cards: Record<string, CardState>;
  today: { day: string; newCount: number; reviewCount: number };
  /** Review results by local day (YYYY-MM-DD), for measuring recall. */
  history: Record<string, DayTally>;
  settings: Settings;
}

/** A saved copy of progress. */
export interface Envelope {
  /** Schema version of `progress`. */
  schema: number;
  /** Goes up by one on every save, so copies can be ordered. */
  rev: number;
  /** When the copy was written, as epoch milliseconds. */
  savedAt: number;
  /** When progress was last reset (0 if never). Cards from before it must not be merged back in. */
  resetAt: number;
  progress: Progress;
}

/** The schema this build writes. */
export const SCHEMA = 4;

type Data = Record<string, unknown>;

/** MIGRATIONS[n] turns a schema n progress object into schema n + 1. */
export const MIGRATIONS: Record<number, (data: Data) => Data> = {
  // 1 → 2: progress moved into a versioned envelope (handled by decode) and
  // the day streak, kept by the first builds, was removed.
  1: ({ streak: _streak, ...rest }) => rest,
  // 2 → 3: review results are tallied by day. Nothing earlier was recorded, so it starts empty.
  2: (data) => ({ history: {}, ...data }),
  // 3 → 4: each way Study asks a word or phrase is a card of its own (see Way in deck.ts). The card kept so far stays
  // as it was, as reading's. Its other ways start from its schedule, as Study had been asking them in turn, once it
  // has settled; a word met since joins those ways as it settles, as a new learner's do. Only added, so a build from
  // before them, still open elsewhere, keeps working on reading's card and carries the rest through untouched.
  3: (data) => (isObject(data.cards) ? { ...data, cards: { ...data.cards, ...splitWays(data.cards) } } : data),
};

/** The fields of a card that make up its schedule, which another way of studying it starts from (MIGRATIONS[3]). */
const SCHEDULE = ['ease', 'interval', 'reps', 'lapses', 'due', 'introduced', 'reviewed', 'log'];

/** For each word or phrase that has settled (as settled() in session.ts has it), its other ways, as copies of its schedule. */
function splitWays(cards: Data): Data {
  const added: Data = {};
  for (const [id, value] of Object.entries(cards)) {
    const card = getCard(id);
    if (!card || !isObject(value)) continue;
    const { interval, reps, lapses } = value;
    if (!isNumber(interval) || interval < 1 || !((isNumber(reps) && reps >= 2) || (isNumber(lapses) && lapses > 0))) continue;
    for (const way of studyWays(card)) {
      const key = cardKey(id, way);
      if (key in cards) continue;
      added[key] = { ...Object.fromEntries(SCHEDULE.filter((f) => f in value).map((f) => [f, structuredClone(value[f])])), split: true };
    }
  }
  return added;
}

export const DEFAULT_SETTINGS: Settings = { dailyNew: 8, autoplay: true, mic: true, sound: true, tapSounds: true, iconBadge: false };

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptyProgress(now: number): Progress {
  return {
    cards: {},
    today: { day: dayKey(now), newCount: 0, reviewCount: 0 },
    history: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

export type Decoded = { kind: 'ok'; envelope: Envelope } | { kind: 'unreadable'; reason: string };

/**
 * Read a saved copy: either an envelope, or the bare progress object that
 * schema 1 saved. Never throws.
 */
export function decode(text: string, now: number): Decoded {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', reason: 'not JSON' };
  }
  return decodeValue(value, now);
}

export function decodeValue(value: unknown, now: number): Decoded {
  if (!isObject(value)) return { kind: 'unreadable', reason: 'not an object' };

  let schema: number;
  let rev = 0;
  let savedAt = 0;
  let resetAt = 0;
  let data: Data;
  if ('schema' in value) {
    if (!isWhole(value.schema) || value.schema < 1 || !isObject(value.progress)) {
      return { kind: 'unreadable', reason: 'bad envelope' };
    }
    schema = value.schema;
    rev = isWhole(value.rev) && value.rev >= 0 ? value.rev : 0;
    savedAt = isNumber(value.savedAt) ? value.savedAt : 0;
    resetAt = isNumber(value.resetAt) && value.resetAt >= 0 ? value.resetAt : 0;
    data = value.progress;
  } else if ('cards' in value || 'today' in value || 'settings' in value) {
    schema = 1;
    data = value;
  } else {
    return { kind: 'unreadable', reason: 'not progress' };
  }

  try {
    for (let v = schema; v < SCHEMA; v++) {
      const migrate = MIGRATIONS[v];
      if (!migrate) throw new Error(`no migration from schema ${v}`);
      data = migrate(data);
    }
  } catch (e) {
    return { kind: 'unreadable', reason: e instanceof Error ? e.message : 'migration failed' };
  }

  return {
    kind: 'ok',
    envelope: { schema: Math.max(schema, SCHEMA), rev, savedAt, resetAt, progress: sanitize(data, now) },
  };
}

export function encode(envelope: Envelope): string {
  const { settings } = envelope.progress;
  return JSON.stringify({ ...envelope, progress: { ...envelope.progress, settings: { ...settings, ...legacyQuiet(settings) } } });
}

/**
 * Quiet mode as builds before the mic and sound switches kept it, written beside them so such a build still open in
 * another tab or installed app keeps to it: `quiet` meant no speaking, and without `headphones`, no sound either. It
 * had no way to say sound off but mic on, so that's kept as both off, the side that stays quiet.
 */
function legacyQuiet({ mic, sound }: Settings): { quiet: boolean; headphones: boolean } {
  return { quiet: !mic || !sound, headphones: sound };
}

/**
 * The mic and sound switches, or for a copy saved by a build from before them (which may also be open alongside this
 * one, writing this schema), worked out from its quiet mode: `quiet` meant no speaking, and without `headphones`, no
 * sound either. Quiet mode from before `headphones` existed kept its audio.
 */
function quietSwitches(s: Data): Pick<Settings, 'mic' | 'sound'> {
  const quiet = s.quiet === true;
  const headphones = typeof s.headphones === 'boolean' ? s.headphones : quiet;
  return {
    mic: typeof s.mic === 'boolean' ? s.mic : !quiet,
    sound: typeof s.sound === 'boolean' ? s.sound : !quiet || headphones,
  };
}

/** Coerce a migrated progress object into a valid one, keeping unknown fields. */
export function sanitize(data: Data, now: number): Progress {
  const cards: Record<string, CardState> = {};
  if (isObject(data.cards)) {
    for (const [id, value] of Object.entries(data.cards)) {
      if (id === '__proto__') continue;
      const card = sanitizeCard(value, now);
      if (card) cards[id] = card;
    }
  }

  const fresh = emptyProgress(now);
  const t = data.today;
  const today =
    isObject(t) && typeof t.day === 'string' && DAY.test(t.day) && isCount(t.newCount) && isCount(t.reviewCount)
      ? { day: t.day, newCount: t.newCount, reviewCount: t.reviewCount }
      : fresh.today;

  const history: Record<string, DayTally> = {};
  if (isObject(data.history)) {
    for (const [day, value] of Object.entries(data.history)) {
      if (!DAY.test(day) || !isObject(value) || !isCount(value.reviews) || !isCount(value.missed)) continue;
      history[day] = { reviews: value.reviews, missed: Math.min(value.missed, value.reviews) };
    }
  }

  const s = isObject(data.settings) ? data.settings : {};
  // Quiet mode as older builds kept it is read into the switches, and written afresh from them by encode.
  const { quiet: _quiet, headphones: _headphones, ...rest } = s;
  const settings: Settings = {
    ...rest,
    dailyNew: isWhole(s.dailyNew) && s.dailyNew >= 1 && s.dailyNew <= 100 ? s.dailyNew : DEFAULT_SETTINGS.dailyNew,
    autoplay: typeof s.autoplay === 'boolean' ? s.autoplay : DEFAULT_SETTINGS.autoplay,
    ...quietSwitches(s),
    tapSounds: typeof s.tapSounds === 'boolean' ? s.tapSounds : DEFAULT_SETTINGS.tapSounds,
    iconBadge: typeof s.iconBadge === 'boolean' ? s.iconBadge : DEFAULT_SETTINGS.iconBadge,
  };

  return { ...data, cards, today, history, settings };
}

/**
 * Repair a saved card. Being introduced is what matters most, so any object
 * counts: missing or broken scheduling fields get safe values and the card
 * comes up for review.
 */
export function sanitizeCard(value: unknown, now: number): CardState | null {
  if (!isObject(value)) return null;
  const time = (v: unknown) => (isNumber(v) && v >= 0 ? v : undefined);
  const due = time(value.due) ?? now;
  const card: CardState = {
    ...value,
    ease: isNumber(value.ease) && value.ease >= MIN_EASE && value.ease <= 10 ? value.ease : START_EASE,
    interval: isNumber(value.interval) && value.interval >= 0 && value.interval <= 36500 ? value.interval : 0,
    reps: isCount(value.reps) ? value.reps : 0,
    lapses: isCount(value.lapses) ? value.lapses : 0,
    due,
    introduced: time(value.introduced) ?? Math.min(due, now),
  };
  const reviewed = time(value.reviewed);
  if (reviewed === undefined) delete card.reviewed;
  else card.reviewed = reviewed;
  if (!isCount(value.reviews)) delete card.reviews;
  if (value.reviewsAtLeast !== true) delete card.reviewsAtLeast;
  // Builds before reviews ran on elapsed time made a card due at local midnight
  // of the day its interval landed on, so a batch fell due together just after
  // midnight. Such a card comes due a whole interval after its review instead.
  // Done on every read, as an older build still open elsewhere can write those
  // due times back; where the two rules agree this changes nothing.
  if (reviewed !== undefined && card.interval >= 1 && card.due === startOfDayAfter(reviewed, card.interval)) {
    card.due = reviewed + card.interval * DAY_MS;
  }
  // Keep only well-formed steps, in time order; the log is a nicety, never worth failing over.
  const log = Array.isArray(value.log)
    ? value.log
        .filter(
          (step): step is [number, number] =>
            Array.isArray(step) && step.length === 2 && time(step[0]) !== undefined && time(step[1]) !== undefined,
        )
        .sort((a, b) => a[0] - b[0])
    : [];
  if (log.length) card.log = log;
  else delete card.log;
  if (value.split !== true) delete card.split;
  // Drill counts for each way, help needed and right in a row.
  const help = wayCounts(value.help, MAX_HELP);
  const streak = wayCounts(value.streak, DRILL_STREAK);
  if (Object.keys(streak).length) card.streak = streak;
  else delete card.streak;
  let helpAt = time(value.helpAt);
  // Builds of October 24 2026 kept one count for the whole card (`hinted`), only ever from a typed meaning or a typed
  // Tagalog: half of it is read as each until this build has counted anything itself (`helpAt`). It's dated as old
  // as can be, so any count this build kept wins over it in a merge. The old field is left as it is, for an older
  // build still open elsewhere.
  if (helpAt === undefined && !isObject(value.help) && isCount(value.hinted) && value.hinted > 0) {
    help.listen = help.recall = Math.ceil(Math.min(value.hinted, MAX_HELP) / 2);
    helpAt = 0;
  }
  if (Object.keys(help).length || card.streak) {
    if (Object.keys(help).length) card.help = help;
    else delete card.help;
    card.helpAt = helpAt ?? changedAt(card);
  } else {
    delete card.help;
    if (helpAt === undefined) delete card.helpAt;
    else card.helpAt = helpAt;
  }
  return card;
}

/** Counts kept for each way a card is asked, up to `most`: ways a newer build added are kept as they are, the ways this build asks are checked. */
function wayCounts(value: unknown, most: number): Partial<Record<Way, number>> {
  const counts: Partial<Record<Way, number>> = isObject(value) ? { ...value } : {};
  for (const way of WAYS) {
    const count = counts[way];
    if (isCount(count) && count > 0) counts[way] = Math.min(count, most);
    else delete counts[way];
  }
  return counts;
}

/** A card's drill help and streaks, with their time; a copy without any still has these keys, so spreading it clears the other's. */
function helpOf(card: CardState): Pick<CardState, 'help' | 'streak' | 'helpAt'> {
  return { help: card.help, streak: card.streak, helpAt: card.helpAt };
}

/**
 * Whether `theirs` should replace `mine`'s schedule: the later review, but a card answered this way always over one only
 * started from reading's when the ways were split (`split`), which never replaces one that was.
 */
function newerSchedule(theirs: CardState, mine: CardState): boolean {
  if (!!theirs.split !== !!mine.split) return !theirs.split;
  return changedAt(theirs) > changedAt(mine);
}

/** When a card's schedule last changed; later wins when two copies disagree. */
function changedAt(card: CardState): number {
  return card.reviewed ?? card.introduced;
}

/**
 * Fold another copy of progress into `target`, so no card in either is lost.
 * Where both have a card, the more recently reviewed schedule wins, and apart
 * from it the more recently changed drill counts (`helpAt`) of the same card
 * (met at the same time: not one met again after a reset). Settings stay as
 * they are in `target`. With `since`, only what `other` changed after that time
 * is taken (used to keep answers given after a reset). Returns how many cards
 * were added or updated.
 */
export function mergeInto(target: Progress, other: Progress, { since = -Infinity } = {}): number {
  let changed = 0;
  for (const [id, card] of Object.entries(other.cards)) {
    const mine = target.cards[id];
    // A card's schedule and its drill help change separately (a drill never touches the schedule), so each keeps the later copy.
    const theirHelp =
      (card.helpAt ?? -Infinity) > Math.max(since, mine?.helpAt ?? -Infinity) && (!mine || mine.introduced === card.introduced);
    if (changedAt(card) > since && (!mine || newerSchedule(card, mine))) {
      target.cards[id] = theirHelp || !mine ? card : { ...card, ...helpOf(mine) };
      changed++;
    } else if (mine && theirHelp) {
      target.cards[id] = { ...mine, ...helpOf(card) };
      changed++;
    }
  }
  if (other.today.day === target.today.day) {
    target.today.newCount = Math.max(target.today.newCount, other.today.newCount);
    target.today.reviewCount = Math.max(target.today.reviewCount, other.today.reviewCount);
  } else if (other.today.day > target.today.day) {
    target.today = { ...other.today };
  }
  // Days before a reset stay erased. Where both copies have a day, keep the
  // fuller tally whole, so its reviews and misses still belong together.
  const sinceDay = since === -Infinity ? '' : dayKey(since);
  for (const [day, theirs] of Object.entries(other.history)) {
    if (day <= sinceDay) continue;
    const mine = target.history[day];
    if (!mine || theirs.reviews > mine.reviews) target.history[day] = { ...theirs };
  }
  const extra = target as unknown as Data;
  for (const [key, value] of Object.entries(other)) {
    if (!(key in extra) && key !== '__proto__') extra[key] = value;
  }
  return changed;
}

/** Make `target` hold exactly what `source` does, so anything holding `target` sees the change. */
export function replaceContents(target: Progress, source: Progress): void {
  for (const key of Object.keys(target)) delete (target as unknown as Data)[key];
  Object.assign(target, source);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isObject(v: unknown): v is Data {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isWhole(v: unknown): v is number {
  return Number.isInteger(v);
}

function isCount(v: unknown): v is number {
  return isWhole(v) && v >= 0;
}
