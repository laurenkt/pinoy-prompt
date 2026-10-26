// Every piece of Tagalog the app can say has its recorded clip, and every clip listed is there to keep offline.
// Every card's clips (and each phrase variant's) pass Speak as that card, and never as a different one.

import { describe, expect, it } from 'vitest';
import clips from './clips.json';
import clipSounds from './clip-sounds.json';
import { ASKED_VOCAB, VOCAB, type Card } from './deck';
import { GUIDES } from './guides';
import { drillSentence } from './session';
import { compare, englishReadings, judge, lostFirstSound, PASS, passes, ROUGHLY, toPhones, unpackOdds, type Heard } from './phonetics';
import { allClipUrls } from './speech';
import { allSpoken, spokenText } from './spoken';
import type { Measure } from './prosody';
import { cardStress, CLIP_MARGIN, leanAgainst, measureStress, stressVerdict, UNJUDGED } from './stress';

const CLIPS: Record<string, string[]> = clips;
/** What Speak's recogniser hears in each clip file, as scripts/generate-audio.mjs listened to it. */
const HEARD: Record<string, { sounds: string[]; runnersUp?: string[][]; odds?: string; start?: string; prosody?: number[][] }> = clipSounds;
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

  it('has a clip in both voices for every text, as the app picks between them', () => {
    expect(Object.keys(CLIPS).filter((t) => CLIPS[t].length !== 2)).toEqual([]);
  });

  it('has both files of every clip, and nothing else, so all of them can be kept offline', () => {
    const files = allClipUrls().map((url) => url.split('/').pop());
    expect(files).toHaveLength(2 * Object.values(CLIPS).flat().length);
    expect(files.filter((f) => !onDisk.has(f))).toEqual([]);
    expect(onDisk.size).toBe(files.length);
  });
});

describe('recorded clips, heard by Speak', () => {
  /** Every clip file of a text: each voice, at both speeds. */
  const files = (text: string) => (CLIPS[text] ?? []).flatMap((name) => [name, `${name}-slow`]);
  const texts = (card: { tl: string; accept?: string[] }) => [card.tl, ...(card.accept ?? [])];
  const said = (file: string): Heard => {
    const { sounds = [], runnersUp, odds } = HEARD[file] ?? {};
    return { sounds, runnersUp, odds: odds === undefined ? undefined : unpackOdds(odds) };
  };

  it('has heard every clip (run `npm run audio` to listen to new ones)', () => {
    const all = Object.keys(CLIPS).flatMap(files);
    expect(all.filter((f) => !HEARD[f])).toEqual([]);
    expect(Object.keys(HEARD).filter((f) => !all.includes(f))).toEqual([]);
  });

  it("passes every card's own clips, so a learner who says it like them passes too", () => {
    const failing = ASKED_VOCAB.flatMap((card) =>
      files(spokenText(card)).flatMap((file) => {
        const heard = said(file);
        const { comparison } = judge(texts(card), heard);
        return passes(comparison) ? [] : [`${file}: ${Math.round(comparison.score * 100)}%, heard ${heard.sounds.join(' ')}`];
      }),
    );
    expect(failing).toEqual([]);
  });

  it('starts every clip with its first sound, so "Kailan" never plays as "ailan", nor "Kailangan" as "pailangan"', () => {
    const lost = Object.keys(CLIPS).flatMap((text) =>
      files(text).flatMap((file) => {
        const { odds, start } = HEARD[file] ?? {};
        const kept = odds ?? start;
        if (kept === undefined) return [`${file}: not listened to for its start (run \`npm run audio\`)`];
        const found = lostFirstSound(text, said(file).sounds, unpackOdds(kept));
        return found ? [`${file}: "${found.letters}" heard as ${found.heard}`] : [];
      }),
    );
    expect(lost).toEqual([]);
  });

  it('never says a letter the English way', () => {
    const misread = Object.keys(CLIPS).flatMap((text) =>
      files(text).flatMap((file) => englishReadings(text, said(file).sounds).map((r) => `${file}: "${r.letters}" said ${r.heard}`)),
    );
    expect(misread).toEqual([]);
  });

  it("doesn't pass a card's clip as a different card, so a wrong word still fails", () => {
    // Clearly different: one said perfectly is less than ROUGHLY the other, so it couldn't pass as it however likely.
    // Words closer than that (kanan and kanin, Salamat and Salamat po) are left to how likely the recording is each.
    const perfectly = (text: string) => toPhones(text).filter((p) => !p.optional).map((p) => p.ipa);
    const different = (a: Card, b: Card) => texts(a).every((t) => judge(texts(b), { sounds: perfectly(t) }).comparison.score < ROUGHLY);
    // At natural speed: the slow clips are the same takes.
    let pairs = 0;
    const passing = ASKED_VOCAB.flatMap((card) => {
      const others = ASKED_VOCAB.filter((other) => other !== card && different(card, other));
      return (CLIPS[spokenText(card)] ?? []).flatMap((file) => {
        const heard = said(file);
        pairs += others.length;
        return others.filter((other) => passes(judge(texts(other), heard).comparison)).map((other) => `${file} passes as "${other.tl}"`);
      });
    });
    // A few short words the recogniser itself can't tell apart in these voices (opo and apo, doon and taon) are
    // allowed, as long as they stay rare: about one in 20,000 pairs. More than that means scoring got too lenient.
    expect(passing.length, passing.join('\n')).toBeLessThan(pairs / 20_000);
    // Judging every clip as every card takes a few seconds.
  }, 30_000);

  it('rarely passes a clip as a card a sound or two away', () => {
    // Near: one said perfectly scores at least ROUGHLY the other, short of passing outright (kanan and kanin,
    // Salamat and Salamat po). How likely the recording is decides these, and some the recogniser itself can't
    // tell apart pass: about 8% today. More than 10% means the likelihood check got too lenient.
    const perfectly = (text: string) => toPhones(text).filter((p) => !p.optional).map((p) => p.ipa);
    const closeness = (a: Card, b: Card) => Math.max(...texts(a).map((t) => judge(texts(b), { sounds: perfectly(t) }).comparison.score));
    let pairs = 0;
    const passing = ASKED_VOCAB.flatMap((card) => {
      const near = ASKED_VOCAB.filter((other) => other !== card && closeness(card, other) >= ROUGHLY && closeness(card, other) < PASS);
      return (CLIPS[spokenText(card)] ?? []).flatMap((file) => {
        const heard = said(file);
        pairs += near.length;
        return near.filter((other) => passes(judge(texts(other), heard).comparison)).map((other) => `${file} passes as "${other.tl}"`);
      });
    });
    expect(passing.length, passing.join('\n')).toBeLessThan(pairs / 10);
  }, 30_000);
});

describe('recorded clips, measured for stress', () => {
  const files = (text: string) => (CLIPS[text] ?? []).flatMap((name) => [name, `${name}-slow`]);
  /** How long (ms), high (Hz) and loud (dB) each sound in a clip was, as scripts/generate-audio.mjs measured it. */
  const prosodyOf = (file: string): Measure => (i) => {
    const measured = HEARD[file]?.prosody?.[i];
    return measured && { length: measured[0] / 1000, pitch: measured[1], level: measured[2] };
  };
  const measured = (card: Card) =>
    files(spokenText(card)).map((file) => ({ file, comparison: compare(toPhones(card.tl), HEARD[file]?.sounds ?? [], HEARD[file]?.runnersUp) }));

  it('has measured every clip Speak asks (run `npm run audio` to measure new ones)', () => {
    expect(ASKED_VOCAB.flatMap((card) => files(spokenText(card)).filter((f) => !HEARD[f]?.prosody))).toEqual([]);
  });

  it("hears every clip of a judged card leaned the way its hint says", () => {
    const told = ASKED_VOCAB.flatMap((card) =>
      measured(card).flatMap(({ file, comparison }) => {
        const stress = cardStress(card, card.tl, comparison, prosodyOf(file));
        return stress && stressVerdict(stress) !== 'good' ? [`${file}: ${stressVerdict(stress)}`] : [];
      }),
    );
    expect(told).toEqual([]);
  });

  it('keeps CLIP_MARGIN about as wide as native takes of one word vary', () => {
    // The spread of each word's clips around their own average, pooled over the words with three or more.
    const spreads = ASKED_VOCAB.flatMap((card) => {
      const leans = measured(card).flatMap(({ file, comparison }) => measureStress(card.tl, card.hint ?? '', comparison, prosodyOf(file)) ?? []).map(leanAgainst);
      if (leans.length < 3) return [];
      const mean = leans.reduce((a, b) => a + b, 0) / leans.length;
      return [leans.reduce((a, b) => a + (b - mean) ** 2, 0) / (leans.length - 1)];
    });
    const spread = Math.sqrt(spreads.reduce((a, b) => a + b, 0) / spreads.length);
    expect(spread).toBeGreaterThan(CLIP_MARGIN * 0.8);
    expect(spread).toBeLessThanOrEqual(CLIP_MARGIN);
  });

  it("judges stress on exactly the words whose clips all measure as their hint says, by CLIP_MARGIN (else add them to UNJUDGED)", () => {
    const unsure = ASKED_VOCAB.filter((card) => {
      const stresses = measured(card).flatMap(({ file, comparison }) => measureStress(card.tl, card.hint ?? '', comparison, prosodyOf(file)) ?? []);
      return stresses.length > 0 && stresses.some((s) => leanAgainst(s) > -CLIP_MARGIN);
    }).map((card) => card.id);
    expect([...UNJUDGED].sort()).toEqual(unsure.sort());
  });
});
