import { describe, expect, it } from 'vitest';
import { MIGRATIONS, SCHEMA, decode, decodeValue, emptyProgress, encode, mergeInto, sanitizeCard, type Progress } from './progress-schema';
import { newCardState, review } from './srs';

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
      expect(progress.cards).toEqual(cardsIn(text));
      const raw = JSON.parse(text);
      expect(progress.settings).toEqual((raw.progress ?? raw).settings);
      expect(progress.today).toEqual((raw.progress ?? raw).today);
      // Review results were first kept in schema 3; earlier copies start with none.
      expect(progress.history).toEqual((raw.progress ?? raw).history ?? {});
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

  it('falls back to defaults for out-of-range settings', () => {
    const { progress } = decodeOk(JSON.stringify({ ...emptyProgress(NOW), settings: { dailyNew: 0, autoplay: 'yes' } }));
    expect(progress.settings).toEqual({ dailyNew: 8, autoplay: true });
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

  it('keeps the newer day counters', () => {
    const a = emptyProgress(NOW);
    const b = emptyProgress(NOW + 86_400_000);
    b.today.newCount = 3;
    mergeInto(a, b);
    expect(a.today).toEqual(b.today);
  });
});
