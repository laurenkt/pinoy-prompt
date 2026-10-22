// Every piece of Tagalog the app can say has its recorded clip, and every clip listed is there to keep offline.

import { describe, expect, it } from 'vitest';
import clips from './clips.json';
import { VOCAB } from './deck';
import { GUIDES } from './guides';
import { drillSentence } from './session';
import { allClipUrls } from './speech';
import { allSpoken, spokenText } from './spoken';

const CLIPS: Record<string, string> = clips;
/** The clip files in public/audio, by name. */
const onDisk = new Set(Object.keys(import.meta.glob('../public/audio/*')).map((path) => path.split('/').pop()));

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

  it('has both files of every clip, and nothing else, so all of them can be kept offline', () => {
    const files = allClipUrls().map((url) => url.split('/').pop());
    expect(files).toHaveLength(2 * Object.keys(CLIPS).length);
    expect(files.filter((f) => !onDisk.has(f))).toEqual([]);
    expect(onDisk.size).toBe(files.length);
  });
});
