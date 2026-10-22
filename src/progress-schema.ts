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

import { MIN_EASE, START_EASE, type CardState } from './srs';

export interface Settings {
  /** New cards introduced per day. */
  dailyNew: number;
  /** Play audio automatically when a card is shown. */
  autoplay: boolean;
  /** Quiet mode, for public places: nothing asks the learner to speak. */
  quiet: boolean;
  /** With quiet mode: headphones are in, so audio can still play. Without them, quiet mode is silent. */
  headphones: boolean;
  /** A soft tick when a button is pressed. */
  tapSounds: boolean;
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
export const SCHEMA = 3;

type Data = Record<string, unknown>;

/** MIGRATIONS[n] turns a schema n progress object into schema n + 1. */
export const MIGRATIONS: Record<number, (data: Data) => Data> = {
  // 1 → 2: progress moved into a versioned envelope (handled by decode) and
  // the day streak, kept by the first builds, was removed.
  1: ({ streak: _streak, ...rest }) => rest,
  // 2 → 3: review results are tallied by day. Nothing earlier was recorded, so it starts empty.
  2: (data) => ({ history: {}, ...data }),
};

export const DEFAULT_SETTINGS: Settings = { dailyNew: 8, autoplay: true, quiet: false, headphones: false, tapSounds: true };

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
  return JSON.stringify(envelope);
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
  const settings: Settings = {
    ...s,
    dailyNew: isWhole(s.dailyNew) && s.dailyNew >= 1 && s.dailyNew <= 100 ? s.dailyNew : DEFAULT_SETTINGS.dailyNew,
    autoplay: typeof s.autoplay === 'boolean' ? s.autoplay : DEFAULT_SETTINGS.autoplay,
    quiet: typeof s.quiet === 'boolean' ? s.quiet : DEFAULT_SETTINGS.quiet,
    // Quiet mode used to keep audio playing, so a quiet copy saved before this setting keeps it.
    headphones: typeof s.headphones === 'boolean' ? s.headphones : s.quiet === true,
    tapSounds: typeof s.tapSounds === 'boolean' ? s.tapSounds : DEFAULT_SETTINGS.tapSounds,
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
  return card;
}

/** When a card last changed; later wins when two copies disagree. */
function changedAt(card: CardState): number {
  return card.reviewed ?? card.introduced;
}

/**
 * Fold another copy of progress into `target`, so no card in either is lost.
 * Where both have a card, the more recently reviewed one wins. Settings stay
 * as they are in `target`. With `since`, only cards from `other` reviewed after
 * that time are taken (used to keep answers given after a reset). Returns how
 * many cards were added or updated.
 */
export function mergeInto(target: Progress, other: Progress, { since = -Infinity } = {}): number {
  let changed = 0;
  for (const [id, card] of Object.entries(other.cards)) {
    if (changedAt(card) <= since) continue;
    const mine = target.cards[id];
    if (!mine || changedAt(card) > changedAt(mine)) {
      target.cards[id] = card;
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
