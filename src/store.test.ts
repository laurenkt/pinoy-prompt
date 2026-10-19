// @vitest-environment happy-dom
// Saved progress must survive broken storage, other tabs, schema changes and
// lost writes. Each test plays out one way it could be lost.

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mirrorSettled, readMirror, resetMirrorForTests, writeMirror } from './progress-mirror';
import { SCHEMA, decode, encode } from './progress-schema';
import { DAY_MS } from './srs';
import {
  BEFORE_RESET_KEY,
  LEGACY_KEY,
  STORAGE_KEY,
  UNREADABLE_KEY,
  dayKey,
  emptyProgress,
  exportBackup,
  importBackup,
  load,
  loadDurable,
  onExternalChange,
  recordAnswer,
  reset,
  resetStoreForTests,
  rollDay,
  save,
} from './store';
import { FakeStorage } from './test/fake-storage';

const NOW = new Date(2026, 9, 19, 12).getTime();
const LEGACY_V1 = (await import('./test/fixtures/progress-schema-1-streak.json?raw')).default;

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('indexedDB', new IDBFactory());
  resetMirrorForTests();
  resetStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh page load: forget everything held in memory, keep what is stored. */
function restart(): void {
  resetMirrorForTests();
  resetStoreForTests();
}

function stored() {
  const decoded = decode(storage.items.get(STORAGE_KEY)!, NOW);
  if (decoded.kind !== 'ok') throw new Error('stored copy unreadable');
  return decoded.envelope;
}

function learn(...ids: string[]) {
  const p = emptyProgress(NOW);
  for (const id of ids) recordAnswer(p, id, 'good', NOW);
  return p;
}

describe('daily counters', () => {
  it('counts new cards and reviews, and resets on a new day', () => {
    let p = emptyProgress(NOW);
    recordAnswer(p, 'isa', 'good', NOW);
    recordAnswer(p, 'isa', 'good', NOW);
    expect(p.today).toEqual({ day: dayKey(NOW), newCount: 1, reviewCount: 1 });
    p = rollDay(p, NOW + DAY_MS);
    expect(p.today.newCount).toBe(0);
  });
});

describe('saving and loading', () => {
  it('starts fresh when nothing is saved', () => {
    expect(load(NOW)).toEqual(emptyProgress(NOW));
  });

  it('loads exactly what was saved, in a versioned envelope', () => {
    const p = learn('isa', 'dalawa');
    p.settings.dailyNew = 12;
    expect(save(p)).toBe(true);
    restart();
    expect(load(NOW)).toEqual(p);
    expect(stored().schema).toBe(SCHEMA);
  });

  it('counts revisions up across saves and restarts', () => {
    const p = learn('isa');
    save(p);
    save(p);
    restart();
    save(load(NOW));
    expect(stored().rev).toBe(3);
  });

  it('keeps progress for cards no longer in the deck', () => {
    save(learn('isa', 'a-card-since-removed'));
    restart();
    const p = load(NOW);
    save(p);
    expect(Object.keys(stored().progress.cards)).toContain('a-card-since-removed');
  });
});

describe('upgrading from the first storage format', () => {
  it('reads the old key, drops the streak, and saves under the new key', () => {
    storage.setItem(LEGACY_KEY, LEGACY_V1);
    const p = load(NOW);
    expect(Object.keys(p.cards).sort()).toEqual(['kumusta', 'oo', 'salamat']);
    expect(p.settings).toEqual({ dailyNew: 12, autoplay: false });
    expect('streak' in p).toBe(false);

    recordAnswer(p, 'isa', 'good', NOW);
    save(p);
    expect(Object.keys(stored().progress.cards).sort()).toEqual(['isa', 'kumusta', 'oo', 'salamat']);
    expect(storage.items.get(STORAGE_KEY)).not.toContain('streak');
    // The old copy stays as it was, as a fallback.
    expect(storage.items.get(LEGACY_KEY)).toBe(LEGACY_V1);
  });

  it('stops reading the old key once the new one exists', () => {
    storage.setItem(LEGACY_KEY, LEGACY_V1);
    save(load(NOW));
    storage.setItem(LEGACY_KEY, JSON.stringify(learn('stale')));
    restart();
    expect(Object.keys(load(NOW).cards)).not.toContain('stale');
  });
});

describe('storage that misbehaves', () => {
  it('sets aside a copy it cannot read before anything replaces it', () => {
    storage.setItem(STORAGE_KEY, '{"cards": {"isa": trunc');
    const p = load(NOW);
    expect(p.cards).toEqual({});
    expect(storage.items.get(UNREADABLE_KEY)).toBe('{"cards": {"isa": trunc');
    save(learn('dalawa'));
    expect(storage.items.get(UNREADABLE_KEY)).toBe('{"cards": {"isa": trunc');
  });

  it('leaves an unreadable copy in place if it cannot be set aside', () => {
    storage.setItem(STORAGE_KEY, '{"cards": trunc');
    storage.failWrites = true;
    const p = load(NOW);
    storage.failWrites = false;
    // Only the set-aside write fails from here on.
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      if (k === UNREADABLE_KEY) throw new DOMException('full', 'QuotaExceededError');
      setItem(k, v);
    };
    recordAnswer(p, 'isa', 'good', NOW);
    expect(save(p)).toBe(false);
    expect(storage.items.get(STORAGE_KEY)).toBe('{"cards": trunc');
  });

  it('does not overwrite saved progress it failed to read at start-up', () => {
    save(learn('isa', 'dalawa', 'tatlo'));
    restart();

    // Storage is unavailable as the app opens, so it starts empty...
    storage.failReads = true;
    const p = load(NOW);
    expect(p.cards).toEqual({});
    // ...and while it stays unavailable nothing is written over the saved copy.
    recordAnswer(p, 'apat', 'good', NOW);
    expect(save(p)).toBe(false);
    expect(Object.keys(stored().progress.cards)).toHaveLength(3);

    // Once it comes back, the next save keeps the old cards and the new one.
    storage.failReads = false;
    recordAnswer(p, 'lima', 'good', NOW);
    expect(save(p)).toBe(true);
    expect(Object.keys(stored().progress.cards).sort()).toEqual(['apat', 'dalawa', 'isa', 'lima', 'tatlo']);
    expect(Object.keys(p.cards)).toHaveLength(5);
  });

  it('reports a full storage, and keeps the work in the mirror', async () => {
    save(learn('isa'));
    storage.failWrites = true;
    const p = load(NOW);
    recordAnswer(p, 'dalawa', 'good', NOW);
    expect(save(p)).toBe(false);
    await mirrorSettled();

    storage.failWrites = false;
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards).sort()).toEqual(['dalawa', 'isa']);
    // localStorage is brought back up to date.
    expect(Object.keys(stored().progress.cards).sort()).toEqual(['dalawa', 'isa']);
  });

  it('restores everything from the mirror when localStorage is wiped', async () => {
    save(learn('isa', 'dalawa'));
    await mirrorSettled();
    storage.clear();
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards).sort()).toEqual(['dalawa', 'isa']);
  });

  it('restores from the mirror when the stored copy is unreadable', async () => {
    save(learn('isa'));
    await mirrorSettled();
    storage.setItem(STORAGE_KEY, 'garbage');
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards)).toEqual(['isa']);
  });

  it('recovers writes localStorage lost, as when iOS kills the app before flushing', async () => {
    const p = learn('isa');
    save(p);
    const before = storage.items.get(STORAGE_KEY)!;
    recordAnswer(p, 'dalawa', 'good', NOW);
    save(p);
    await mirrorSettled();
    storage.items.set(STORAGE_KEY, before);
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards).sort()).toEqual(['dalawa', 'isa']);
  });

  it('ignores an older mirror', async () => {
    save(learn('isa'));
    await mirrorSettled();
    vi.stubGlobal('indexedDB', new IDBFactory());
    resetMirrorForTests();
    writeMirror(encode({ schema: SCHEMA, rev: 0, savedAt: 0, resetAt: 0, progress: learn('stale') }));
    await mirrorSettled();
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards)).toEqual(['isa']);
  });

  it('starts without the mirror if IndexedDB never answers', async () => {
    save(learn('isa'));
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    restart();
    vi.useFakeTimers();
    const loading = loadDurable(NOW);
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(Object.keys((await loading).cards)).toEqual(['isa']);
  });

  it('works where even looking at IndexedDB throws', async () => {
    save(learn('isa'));
    restart();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      expect(Object.keys((await loadDurable(NOW)).cards)).toEqual(['isa']);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
    }
  });

  it('works with no IndexedDB at all', async () => {
    vi.stubGlobal('indexedDB', undefined);
    save(learn('isa'));
    restart();
    expect(Object.keys((await loadDurable(NOW)).cards)).toEqual(['isa']);
  });

  it('keeps the mirror in step with the latest save', async () => {
    const p = learn('isa');
    for (let i = 0; i < 5; i++) save(p);
    await mirrorSettled();
    expect(decode((await readMirror())!, NOW)).toMatchObject({ kind: 'ok', envelope: { rev: 5 } });
  });
});

describe('two copies of the app open at once', () => {
  async function freshTab() {
    vi.resetModules();
    return await import('./store');
  }

  it('keeps both tabs’ answers instead of the last save winning', async () => {
    save(learn('seed'));
    const a = await freshTab();
    const b = await freshTab();
    const pa = a.load(NOW);
    const pb = b.load(NOW);

    a.recordAnswer(pa, 'isa', 'good', NOW);
    a.save(pa);
    b.recordAnswer(pb, 'dalawa', 'good', NOW + 1000);
    b.save(pb);

    expect(Object.keys(stored().progress.cards).sort()).toEqual(['dalawa', 'isa', 'seed']);
  });

  it('keeps the more recent review when both tabs answer the same card', async () => {
    save(learn('isa'));
    const a = await freshTab();
    const b = await freshTab();
    const pa = a.load(NOW);
    const pb = b.load(NOW);
    a.recordAnswer(pa, 'isa', 'again', NOW + 5000);
    a.save(pa);
    b.recordAnswer(pb, 'isa', 'easy', NOW + 1000);
    b.save(pb);
    expect(stored().progress.cards.isa.reviewed).toBe(NOW + 5000);
  });

  it('picks up another tab’s save as it happens', () => {
    const p = load(NOW);
    let latest = p;
    onExternalChange((next) => (latest = next));
    const other = encode({ schema: SCHEMA, rev: 9, savedAt: NOW, resetAt: 0, progress: learn('isa') });
    storage.items.set(STORAGE_KEY, other);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: other }));
    expect(Object.keys(latest.cards)).toEqual(['isa']);
  });
});

describe('resetting', () => {
  it('erases progress, keeps a copy of what was there, and stays erased after a restart', async () => {
    storage.setItem(LEGACY_KEY, LEGACY_V1);
    const p = load(NOW);
    save(p);
    await mirrorSettled();

    expect(reset(NOW)).toEqual(emptyProgress(NOW));
    await mirrorSettled();
    expect(storage.items.has(LEGACY_KEY)).toBe(false);
    expect(storage.items.get(BEFORE_RESET_KEY)).toContain('kumusta');

    restart();
    expect((await loadDurable(NOW)).cards).toEqual({});
  });

  it('stays erased when only the mirror got the reset', async () => {
    save(learn('isa', 'dalawa'));
    await mirrorSettled();
    storage.failWrites = true;
    reset(NOW);
    await mirrorSettled();
    storage.failWrites = false;
    restart();
    expect((await loadDurable(NOW)).cards).toEqual({});
  });

  it('is honoured by another tab that still holds the old progress', async () => {
    save(learn('isa', 'dalawa'));
    vi.resetModules();
    const a = await import('./store');
    vi.resetModules();
    const b = await import('./store');
    a.load(NOW);
    const pb = b.load(NOW);

    a.reset(NOW);
    b.recordAnswer(pb, 'tatlo', 'good', NOW);
    b.save(pb);
    expect(Object.keys(stored().progress.cards)).not.toContain('isa');
    expect(Object.keys(pb.cards)).not.toContain('isa');
  });
});

describe('backups', () => {
  it('restores a backup into another device’s progress without losing anything there', () => {
    const phone = learn('isa', 'dalawa');
    const backup = exportBackup(phone);

    const laptop = learn('tatlo');
    expect(importBackup(laptop, backup, NOW)).toBe(2);
    expect(Object.keys(laptop.cards).sort()).toEqual(['dalawa', 'isa', 'tatlo']);
  });

  it('reads a copy of the old storage format as a backup', () => {
    const p = emptyProgress(NOW);
    expect(importBackup(p, LEGACY_V1, NOW)).toBe(3);
  });

  it('rejects a file that is not a backup and leaves progress alone', () => {
    const p = learn('isa');
    expect(importBackup(p, '{"name":"something else"}', NOW)).toBeNull();
    expect(importBackup(p, 'not json', NOW)).toBeNull();
    expect(Object.keys(p.cards)).toEqual(['isa']);
  });
});
