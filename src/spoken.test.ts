// Every piece of Tagalog the app can say has its recorded clip, and the service worker keeps them all offline.

import { describe, expect, it } from 'vitest';
import files from '../public/audio/files.json';
import clips from './clips.json';
import { VOCAB } from './deck';
import { GUIDES } from './guides';
import { drillSentence } from './session';
import { allSpoken, spokenText } from './spoken';

const CLIPS: Record<string, string> = clips;
/** The clip files in public/audio, by name. */
const onDisk = new Set(Object.keys(import.meta.glob('../public/audio/*.mp3')).map((path) => path.split('/').pop()));

describe('recorded clips', () => {
  it('lists every card, guide example and drill sentence', () => {
    const spoken = allSpoken();
    expect(spoken).toContain(spokenText(VOCAB.find((c) => c.id === 'ng')!));
    for (const g of GUIDES) {
      for (const ex of g.examples ?? []) expect(spoken).toContain(ex.tl);
      for (const d of g.drills ?? []) if (d.tl) expect(spoken).toContain(drillSentence(d));
    }
  });

  it('has a clip for everything the app says (run `npm run audio` after changing cards)', () => {
    expect(allSpoken().filter((t) => !CLIPS[t])).toEqual([]);
  });

  it('keeps no clips for text the app no longer says', () => {
    const spoken = new Set(allSpoken());
    expect(Object.keys(CLIPS).filter((t) => !spoken.has(t))).toEqual([]);
  });

  it('has both files of every clip, and lists them for the service worker', () => {
    const expected = Object.values(CLIPS).flatMap((name) => [`${name}.mp3`, `${name}-slow.mp3`]);
    expect([...files].sort()).toEqual(expected.sort());
    expect(files.filter((f) => !onDisk.has(f))).toEqual([]);
    expect(onDisk.size).toBe(files.length);
  });
});
