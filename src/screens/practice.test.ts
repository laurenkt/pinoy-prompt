// Picking words for a drill round that runs until the learner stops it.

import { describe, expect, it } from 'vitest';
import type { App } from '../app';
import { fakeApp as screenApp } from '../test/screen';
import { pickNext } from './practice';

const KNOWN = ['salamat', 'kumusta', 'oo', 'hindi', 'paalam', 'kape'];

const fakeApp = (known = KNOWN) => screenApp(known);

/** How often each word comes up over many picks. */
function counts(app: App, recent: string[], missed = new Map<string, number>()): Map<string, number> {
  const seen = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const id = pickNext(app, recent, missed)!.id;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return seen;
}

describe('picking the next drill word', () => {
  it('keeps the last three words out', () => {
    const seen = counts(fakeApp(), ['kape', 'salamat', 'oo', 'hindi']);
    expect([...seen.keys()].sort()).toEqual(['kape', 'kumusta', 'paalam']);
  });

  it('only keeps out what leaves a word to ask, when few are known', () => {
    const app = fakeApp(['salamat', 'oo']);
    expect(pickNext(app, ['salamat', 'oo'], new Map())!.id).toBe('salamat');
    expect(pickNext(app, ['oo', 'salamat'], new Map())!.id).toBe('oo');
  });

  it('brings a word missed this round back more often', () => {
    const plain = counts(fakeApp(), []).get('kape')!;
    const missed = counts(fakeApp(), [], new Map([['kape', 2]])).get('kape')!;
    expect(missed).toBeGreaterThan(plain * 1.5);
  });

  it('asks the only word known again and again', () => {
    expect(pickNext(fakeApp(['oo']), ['oo'], new Map())!.id).toBe('oo');
  });

  it('has nothing to ask with no words', () => {
    const app = fakeApp([]);
    expect(pickNext(app, [], new Map())).toBeNull();
  });
});
