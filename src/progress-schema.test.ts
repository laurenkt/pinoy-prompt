import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MIGRATIONS, SCHEMA, decode, decodeValue, emptyProgress, encode, mergeInto, sanitizeCard, type Progress } from './progress-schema';
import { DAY_MS, newCardState, review, startOfDayAfter } from './srs';

const NOW = new Date(2026, 9, 19, 12).getTime();

const fixtures = import.meta.glob<string>('./test/fixtures/progress-schema-*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function schemaOf(path: string): number {
  return Number(/progress-schema-(\d+)/.exec(path)![1]);
}

/** The cards a fixture holds, wherever its schema keeps them. */
function cardsIn(text: string): Record<string, unknown> {
  const raw = JSON.parse(text);
  return (raw.progress ?? raw).cards;
}

function decodeOk(text: string) {
  const decoded = decode(text, NOW);
  if (decoded.kind !== 'ok') throw new Error(`unreadable: ${decoded.reason}`);
  return decoded.envelope;
}

describe('saved progress from every schema version', () => {
  it('has a fixture for every schema up to the current one, and a migration for every step', () => {
    const versions = new Set(Object.keys(fixtures).map(schemaOf));
    for (let v = 1; v <= SCHEMA; v++) expect(versions, `fixture for schema ${v}`).toContain(v);
    for (let v = 1; v < SCHEMA; v++) expect(MIGRATIONS[v], `migration from schema ${v}`).toBeTypeOf('function');
  });

  for (const [path, text] of Object.entries(fixtures)) {
    it(`loads ${path.split('/').pop()} with every card and setting intact`, () => {
      const { schema, progress } = decodeOk(text);
      expect(schema).toBe(SCHEMA);
      // Every card as it was; from before schema 4, the other ways of a word that has settled join it (see splitWays).
      const raw = cardsIn(text);
      const added = schemaOf(path) < 4 ? ['kumusta:listen', 'kumusta:recall'] : [];
      expect(Object.keys(progress.cards).sort()).toEqual([...Object.keys(raw), ...added].sort());
      for (const [key, card] of Object.entries(raw)) expect(progress.cards[key]).toEqual(card);
      for (const key of added) expect(progress.cards[key]).toEqual({ ...(raw.kumusta as object), split: true });
      const envelope = JSON.parse(text);
      // Settings added since keep their defaults.
      expect(progress.settings).toEqual({ ...DEFAULT_SETTINGS, ...(envelope.progress ?? envelope).settings });
      expect(progress.today).toEqual((envelope.progress ?? envelope).today);
      // Review results were first kept in schema 3; earlier copies start with none.
      expect(progress.history).toEqual((envelope.progress ?? envelope).history ?? {});
      expect('streak' in progress).toBe(false);
    });

    it(`round-trips ${path.split('/').pop()} through a save unchanged`, () => {
      const first = decodeOk(text);
      expect(decodeOk(encode(first))).toEqual(first);
    });
  }

  it('keeps the revision of an envelope and starts a bare schema 1 copy at 0', () => {
    expect(decodeOk(fixtures['./test/fixtures/progress-schema-2.json']).rev).toBe(41);
    expect(decodeOk(fixtures['./test/fixtures/progress-schema-1.json']).rev).toBe(0);
  });
});

describe('reviews scheduled by the old midnight rule', () => {
  const evening = new Date(2026, 9, 18, 21).getTime();
  const midnightCard = (interval: number) => ({
    ...newCardState(evening - DAY_MS),
    interval,
    reps: 2,
    reviewed: evening,
    due: startOfDayAfter(evening, interval),
  });

  it('come due a whole interval after the review instead', () => {
    expect(sanitizeCard(midnightCard(1), NOW)!.due).toBe(evening + DAY_MS);
    expect(sanitizeCard(midnightCard(7.5), NOW)!.due).toBe(evening + 7.5 * DAY_MS);
  });

  it('leave cards that were not scheduled that way alone', () => {
    const relearning = { ...midnightCard(0), due: evening + 60_000 };
    const elapsed = { ...midnightCard(3), due: evening + 3 * DAY_MS };
    const { reviewed: _reviewed, ...unknownReview } = midnightCard(2);
    expect(sanitizeCard(relearning, NOW)).toEqual(relearning);
    expect(sanitizeCard(elapsed, NOW)).toEqual(elapsed);
    expect(sanitizeCard(unknownReview, NOW)).toEqual(unknownReview);
  });

  it('do not change again once moved, even for a review at midnight', () => {
    const moved = sanitizeCard(midnightCard(1), NOW)!;
    expect(sanitizeCard(moved, NOW)).toEqual(moved);
    const atMidnight = new Date(2026, 9, 18).getTime();
    const card = { ...midnightCard(2), reviewed: atMidnight, due: atMidnight + 2 * DAY_MS };
    expect(sanitizeCard(card, NOW)).toEqual(card);
  });
});

describe("a card's count of drill answers needing help", () => {
  const card = newCardState(NOW);

  it('is kept for each way of asking, up to the most it counts', () => {
    const read = sanitizeCard({ ...card, help: { recall: 2, speak: 9, read: -1, sideways: 4 }, helpAt: NOW }, NOW)!;
    // A way a newer build asks is kept as it is.
    expect(read.help).toEqual({ recall: 2, speak: 3, sideways: 4 });
    expect(read.helpAt).toBe(NOW);
  });

  it('is dropped when there are none or it is broken, keeping when it was cleared', () => {
    for (const count of [0, -1, 1.5, '2', null]) {
      expect(sanitizeCard({ ...card, help: { listen: count } }, NOW)).toEqual(card);
    }
    expect(sanitizeCard({ ...card, help: 'lots' }, NOW)).toEqual(card);
    expect(sanitizeCard({ ...card, helpAt: NOW }, NOW)).toEqual({ ...card, helpAt: NOW });
  });

  it("reads a whole-card count from October 24's builds as needing help typing the meaning and the Tagalog", () => {
    // Half each, so the card isn't asked more than it was; dated as old as can be, so any count kept since wins in a merge.
    const read = sanitizeCard({ ...card, hinted: 3 }, NOW)!;
    expect(read.help).toEqual({ listen: 2, recall: 2 });
    expect(read.helpAt).toBe(0);
    expect(sanitizeCard({ ...card, hinted: 9 }, NOW)!.help).toEqual({ listen: 2, recall: 2 });
    // Kept for an older build still open elsewhere.
    expect((read as { hinted?: number }).hinted).toBe(3);
    for (const hinted of [0, -1, 1.5, '2', null]) expect(sanitizeCard({ ...card, hinted }, NOW)).toEqual({ ...card, hinted });
    // Once this build has counted for itself, the old count is left out, even after its counts are cleared.
    expect(sanitizeCard({ ...card, hinted: 2, help: { read: 1 }, helpAt: NOW }, NOW)!.help).toEqual({ read: 1 });
    expect(sanitizeCard({ ...card, hinted: 2, helpAt: NOW }, NOW)!.help).toBeUndefined();
  });
});

describe('splitting each word into the ways Study asks it (schema 3 to 4)', () => {
  const settledCard = { ease: 2.4, interval: 9, reps: 3, lapses: 1, due: NOW + 9 * DAY_MS, introduced: NOW - 30 * DAY_MS, reviewed: NOW, log: [[NOW - 30 * DAY_MS, 0], [NOW - 20 * DAY_MS, 1]] };
  const v3 = (cards: Record<string, unknown>) => JSON.stringify({ schema: 3, rev: 9, savedAt: NOW, resetAt: 0, progress: { ...emptyProgress(NOW), cards } });

  it("starts a settled word's other ways from its schedule, keeping the card itself exactly as it was", () => {
    const kept = { ...settledCard, help: { recall: 2 }, helpAt: NOW };
    const { cards } = decodeOk(v3({ kumusta: kept })).progress;
    expect(cards.kumusta).toEqual(kept);
    // The schedule, and its history for the chart; not the drills' counts, which stay on the word.
    expect(cards['kumusta:listen']).toEqual({ ...settledCard, split: true });
    expect(cards['kumusta:recall']).toEqual({ ...settledCard, split: true });
    expect(Object.keys(cards).sort()).toEqual(['kumusta', 'kumusta:listen', 'kumusta:recall']);
  });

  it('leaves a word still settling in, a guide, and a card since removed from the deck to their own', () => {
    const learning = { ...settledCard, interval: 1, reps: 1, lapses: 0 };
    const { cards } = decodeOk(v3({ kumusta: learning, 'p-gusto': settledCard, 'a-card-since-removed': settledCard })).progress;
    expect(Object.keys(cards).sort()).toEqual(['a-card-since-removed', 'kumusta', 'p-gusto']);
  });

  it('never overwrites a way already there, and keeps ways and cards this build does not know', () => {
    const recall = { ...settledCard, interval: 2, reps: 1 };
    const { cards } = decodeOk(v3({ kumusta: settledCard, 'kumusta:recall': recall, 'kumusta:speak': recall, 'gone:listen': recall })).progress;
    expect(cards['kumusta:recall']).toEqual(recall);
    expect(cards['kumusta:speak']).toEqual(recall);
    expect(cards['gone:listen']).toEqual(recall);
  });

  it('keeps the later review of each way when an older copy (the mirror, a backup) is merged in', () => {
    const now = decodeOk(v3({ kumusta: settledCard })).progress;
    // Recalled since, on this copy.
    now.cards['kumusta:recall'] = review(now.cards['kumusta:recall'], 'again', NOW + DAY_MS);
    const older = decodeOk(v3({ kumusta: settledCard })).progress;
    expect(mergeInto(now, older)).toBe(0);
    expect(now.cards['kumusta:recall'].reviewed).toBe(NOW + DAY_MS);
    expect(now.cards['kumusta:recall'].split).toBeUndefined();
    // A copy from a build before the split (a backup from another phone), saved later with a newer review of the word
    // itself, brings that in only: its other ways were only started from it, and this copy has answered recall itself.
    const later = decodeOk(v3({ kumusta: { ...settledCard, reviewed: NOW + 2 * DAY_MS } })).progress;
    mergeInto(now, later);
    expect(now.cards.kumusta.reviewed).toBe(NOW + 2 * DAY_MS);
    expect(now.cards['kumusta:recall'].reviewed).toBe(NOW + DAY_MS);
    // Where neither copy has answered that way, the later start is as good as any.
    expect(now.cards['kumusta:listen']).toEqual({ ...settledCard, reviewed: NOW + 2 * DAY_MS, split: true });
  });
});

describe('a copy from a newer version of the app', () => {
  it('keeps its schema number and every field this version does not know', () => {
    const future = {
      schema: SCHEMA + 3,
      rev: 7,
      savedAt: NOW,
      progress: {
        ...emptyProgress(NOW),
        cards: { isa: { ...newCardState(NOW), audioScore: 0.9 } },
        goals: ['travel'],
        settings: { dailyNew: 8, autoplay: true, theme: 'night' },
      },
    };
    const { schema, progress } = decodeOk(JSON.stringify(future));
    expect(schema).toBe(SCHEMA + 3);
    const saved = JSON.parse(encode({ schema, rev: 8, savedAt: NOW, resetAt: 0, progress }));
    expect(saved.progress.goals).toEqual(['travel']);
    expect(saved.progress.settings.theme).toBe('night');
    expect(saved.progress.cards.isa.audioScore).toBe(0.9);
  });
});

describe('damaged saved progress', () => {
  it('reports text that is not progress as unreadable instead of throwing', () => {
    for (const text of ['', '{', 'null', '42', '"hi"', '[]', '{"hello":1}', '{"schema":"2","progress":{}}', '{"schema":2}']) {
      expect(decode(text, NOW).kind, text).toBe('unreadable');
    }
  });

  it('repairs a damaged card rather than dropping it', () => {
    const card = sanitizeCard({ ease: 'high', interval: -3, reps: 1.5, lapses: null, due: NaN, introduced: 1000 }, NOW)!;
    expect(card).toEqual({ ease: 2.5, interval: 0, reps: 0, lapses: 0, due: NOW, introduced: 1000 });
  });

  it('keeps only well-formed strength moves, oldest first', () => {
    const card = sanitizeCard({ ...newCardState(1000), log: [[3000, 7], 'x', [2000, 1], [-1, 2], [4000]] }, NOW)!;
    expect(card.log).toEqual([
      [2000, 1],
      [3000, 7],
    ]);
    expect(sanitizeCard({ ...newCardState(1000), log: 'x' }, NOW)!).not.toHaveProperty('log');
  });

  it('keeps a card that is only an empty object, so the word stays learned', () => {
    const card = sanitizeCard({}, NOW)!;
    expect(card.introduced).toBe(NOW);
    expect(card.due).toBe(NOW);
  });

  it('skips only entries that are not cards at all', () => {
    const { progress } = decodeOk(
      JSON.stringify({ cards: { isa: newCardState(NOW), dalawa: null, tatlo: 3, apat: [], lima: {} }, today: null, settings: 'x' }),
    );
    expect(Object.keys(progress.cards).sort()).toEqual(['isa', 'lima']);
    expect(progress.today).toEqual(emptyProgress(NOW).today);
    expect(progress.settings).toEqual(emptyProgress(NOW).settings);
  });

  it('ignores a __proto__ card id', () => {
    const { progress } = decodeOk('{"cards":{"__proto__":{"ease":2.5},"isa":{}}}');
    expect(Object.keys(progress.cards)).toEqual(['isa']);
    expect(Object.getPrototypeOf(progress.cards)).toBe(Object.prototype);
  });

  it('drops only the damaged days of review history', () => {
    const history = { '2026-10-17': { reviews: 4, missed: 9 }, '2026-10-18': { reviews: 'x', missed: 0 }, yesterday: { reviews: 1, missed: 0 }, '2026-10-19': { reviews: 2, missed: 0 } };
    const { progress } = decodeOk(JSON.stringify({ schema: 3, progress: { ...emptyProgress(NOW), history } }));
    expect(progress.history).toEqual({ '2026-10-17': { reviews: 4, missed: 4 }, '2026-10-19': { reviews: 2, missed: 0 } });
  });

  it('reads quiet mode and headphones, as older builds save them, into the mic and sound switches', () => {
    // At this schema too: a build from before the switches, still open alongside this one, saves it.
    const settingsFrom = (old: object) => decodeOk(JSON.stringify({ schema: SCHEMA, progress: { ...emptyProgress(NOW), settings: { dailyNew: 8, autoplay: true, ...old } } })).progress.settings;
    expect(settingsFrom({ quiet: false, headphones: false })).toMatchObject({ mic: true, sound: true });
    expect(settingsFrom({ quiet: true, headphones: false })).toMatchObject({ mic: false, sound: false });
    expect(settingsFrom({ quiet: true, headphones: true })).toMatchObject({ mic: false, sound: true });
    // Quiet mode from before the headphones setting kept its audio.
    expect(settingsFrom({ quiet: true })).toMatchObject({ mic: false, sound: true });
    expect(settingsFrom({})).toMatchObject({ mic: true, sound: true });
    const settings = settingsFrom({ quiet: true, headphones: false, later: 'kept' });
    expect(settings).not.toHaveProperty('quiet');
    expect(settings).not.toHaveProperty('headphones');
    expect(settings).toHaveProperty('later', 'kept');
  });

  it('goes by the mic and sound switches over quiet mode where a copy has both', () => {
    const { progress } = decodeOk(JSON.stringify({ schema: SCHEMA, progress: { ...emptyProgress(NOW), settings: { quiet: false, headphones: false, mic: false, sound: false } } }));
    expect(progress.settings).toMatchObject({ mic: false, sound: false });
  });

  it('saves quiet mode beside the switches, so an older build still open keeps quiet', () => {
    const saved = (mic: boolean, sound: boolean) => {
      const envelope = { schema: SCHEMA, rev: 1, savedAt: NOW, resetAt: 0, progress: { ...emptyProgress(NOW), settings: { ...DEFAULT_SETTINGS, mic, sound } } };
      return JSON.parse(encode(envelope)).progress.settings;
    };
    expect(saved(true, true)).toMatchObject({ quiet: false, headphones: true });
    expect(saved(false, true)).toMatchObject({ quiet: true, headphones: true });
    expect(saved(false, false)).toMatchObject({ quiet: true, headphones: false });
    // Older builds can't have sound off with the mic on: they get both off, which stays quiet.
    expect(saved(true, false)).toMatchObject({ quiet: true, headphones: false });
    for (const [mic, sound] of [[true, true], [false, true], [false, false], [true, false]]) {
      const envelope = { schema: SCHEMA, rev: 1, savedAt: NOW, resetAt: 0, progress: { ...emptyProgress(NOW), settings: { ...DEFAULT_SETTINGS, mic, sound } } };
      expect(decodeOk(encode(envelope)).progress.settings).toEqual({ ...DEFAULT_SETTINGS, mic, sound });
    }
  });

  it('falls back to defaults for out-of-range settings', () => {
    const { progress } = decodeOk(JSON.stringify({ ...emptyProgress(NOW), settings: { dailyNew: 0, autoplay: 'yes', mic: 1, sound: 'no' } }));
    expect(progress.settings).toEqual({ dailyNew: 8, autoplay: true, mic: true, sound: true, tapSounds: true, iconBadge: false });
  });

  it('never throws and always yields valid progress, whatever is stored', () => {
    const junk = [null, undefined, true, -1, 0, 1e308, NaN, 'x', '', [], [1], {}, { a: 1 }];
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    const base = JSON.parse(fixtures[`./test/fixtures/progress-schema-${SCHEMA}.json`]);

    for (let i = 0; i < 2000; i++) {
      const copy = structuredClone(base);
      // Swap a few random fields, at any depth, for junk.
      for (let n = 0; n < 3; n++) {
        let node = copy;
        for (;;) {
          const keys = Object.keys(node);
          if (keys.length === 0) break;
          const key = pick(keys);
          if (random() < 0.4 || typeof node[key] !== 'object' || node[key] === null) {
            node[key] = pick(junk);
            break;
          }
          node = node[key];
        }
      }
      const decoded = decodeValue(copy, NOW);
      if (decoded.kind === 'ok') expectValid(decoded.envelope.progress);
    }
  });
});

function expectValid(p: Progress): void {
  for (const card of Object.values(p.cards)) {
    for (const field of ['ease', 'interval', 'reps', 'lapses', 'due', 'introduced'] as const) {
      expect(Number.isFinite(card[field])).toBe(true);
    }
    expect(card.ease).toBeGreaterThanOrEqual(1.3);
  }
  expect(p.today.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  for (const [day, tally] of Object.entries(p.history)) {
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isInteger(tally.reviews) && tally.reviews >= 0).toBe(true);
    expect(Number.isInteger(tally.missed) && tally.missed >= 0 && tally.missed <= tally.reviews).toBe(true);
  }
  expect(Number.isInteger(p.settings.dailyNew)).toBe(true);
  expect(typeof p.settings.autoplay).toBe('boolean');
}

describe('merging two copies', () => {
  it('keeps every card from both and the more recently reviewed version of each', () => {
    const a = emptyProgress(NOW);
    const b = emptyProgress(NOW);
    a.cards.isa = review(newCardState(NOW), 'good', NOW);
    a.cards.dalawa = review(newCardState(NOW), 'good', NOW + 1000);
    b.cards.dalawa = review(newCardState(NOW), 'again', NOW + 2000);
    b.cards.tatlo = newCardState(NOW);

    expect(mergeInto(a, b)).toBe(2);
    expect(Object.keys(a.cards).sort()).toEqual(['dalawa', 'isa', 'tatlo']);
    expect(a.cards.dalawa.reviewed).toBe(NOW + 2000);
  });

  it('keeps the fuller review tally for each day from either copy, whole', () => {
    const a = emptyProgress(NOW);
    const b = emptyProgress(NOW);
    a.history = { '2026-10-17': { reviews: 5, missed: 1 }, '2026-10-18': { reviews: 10, missed: 0 } };
    b.history = { '2026-10-18': { reviews: 3, missed: 3 }, '2026-10-19': { reviews: 1, missed: 1 } };
    mergeInto(a, b);
    expect(a.history).toEqual({
      '2026-10-17': { reviews: 5, missed: 1 },
      // Not { reviews: 10, missed: 3 }, which neither copy recorded.
      '2026-10-18': { reviews: 10, missed: 0 },
      '2026-10-19': { reviews: 1, missed: 1 },
    });
  });

  it('does not bring back review history from before a reset', () => {
    const reset = emptyProgress(NOW);
    const old = emptyProgress(NOW);
    old.history = { '2026-10-18': { reviews: 9, missed: 2 }, '2026-10-20': { reviews: 2, missed: 0 } };
    mergeInto(reset, old, { since: new Date(2026, 9, 19, 9).getTime() });
    expect(reset.history).toEqual({ '2026-10-20': { reviews: 2, missed: 0 } });
  });

  it("keeps the later drill counts apart from the later schedule, as a drill never changes the schedule", () => {
    const a = emptyProgress(NOW);
    const b = emptyProgress(NOW);
    // Reviewed in Study on one copy, drilled later on the other.
    a.cards.isa = review(newCardState(NOW), 'good', NOW + 5000);
    b.cards.isa = { ...review(newCardState(NOW), 'good', NOW), help: { speak: 2 }, helpAt: NOW + 9000 };
    expect(mergeInto(a, b)).toBe(1);
    expect(a.cards.isa.reviewed).toBe(NOW + 5000);
    expect(a.cards.isa.help).toEqual({ speak: 2 });
    // Drilled on this copy after the other's newer review: the review comes in, the counts stay.
    a.cards.dalawa = { ...review(newCardState(NOW), 'good', NOW), help: { read: 1 }, helpAt: NOW + 9000 };
    b.cards.dalawa = review(newCardState(NOW), 'again', NOW + 5000);
    mergeInto(a, b);
    expect(a.cards.dalawa.reviewed).toBe(NOW + 5000);
    expect(a.cards.dalawa.help).toEqual({ read: 1 });
    // Cleared later on the other copy: cleared here too.
    b.cards.dalawa = { ...a.cards.dalawa, help: undefined, helpAt: NOW + 10_000 };
    mergeInto(a, b);
    expect(a.cards.dalawa.help).toBeUndefined();
    // A count from before a reset doesn't bring back a card the reset cleared.
    const reset = emptyProgress(NOW);
    const old = emptyProgress(NOW);
    old.cards.isa = { ...review(newCardState(NOW), 'good', NOW), help: { recall: 1 }, helpAt: NOW + 20_000 };
    mergeInto(reset, old, { since: NOW + 10_000 });
    expect(reset.cards.isa).toBeUndefined();
    // Nor do they join the card met again since.
    reset.cards.isa = review(newCardState(NOW + 15_000), 'good', NOW + 15_000);
    mergeInto(reset, old, { since: NOW + 10_000 });
    expect(reset.cards.isa.help).toBeUndefined();
  });

  it('keeps the newer day counters', () => {
    const a = emptyProgress(NOW);
    const b = emptyProgress(NOW + 86_400_000);
    b.today.newCount = 3;
    mergeInto(a, b);
    expect(a.today).toEqual(b.today);
  });
});
