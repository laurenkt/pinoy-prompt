// The results of a spoken attempt, sound by sound: the recording drawn as a
// ribbon with each sound marked on it (the sound aimed for above, what was
// heard below; tap one to open it), and for the chosen sound a map of where
// it's made in the mouth, with what the learner said and the target. Holding
// the slider under the map plays one or the other, made in code rather than cut
// from the recording: what was said to the left of the middle, what to aim for
// to the right, louder the further the finger goes. The word itself, coloured
// sound by sound, and the ribbon are scrubbers too: drag along the letters or the
// recording to move between sounds. For a single word whose stress is judged,
// one more page shows which of its last two syllables was leaned on, against
// which to aim for, opened from a line under the word.

import { stressLine, type Tip } from '../coach';
import type { Comparison, SoundResult, SoundVerdict } from '../phonetics';
import { canSynthesize } from '../phone-synth';
import type { Held, Player } from '../player';
import { MANNERS, PLACES, placeOf, soundName, type Place } from '../sound-map';
import { createSpectrogram, type Segment, type Spectrogram } from '../spectrogram';
import { scrubbable } from '../speech';
import { leanAgainst, leanedOn, stressVerdict, type Stress } from '../stress';
import { h, icon, svg } from '../ui';

export interface Attempt {
  /** The card text (or accepted variant) the attempt was judged against. */
  text: string;
  comparison: Comparison;
  tips: Tip[];
  /** What was heard, with timing in seconds. */
  heard: string[];
  timing: { start: number; end: number }[];
  /** The recording, 16 kHz mono. */
  samples: Float32Array;
  features: { data: Float32Array; frames: number };
  /** Which syllable it leaned on, when its stress was judged. */
  stress?: Stress | null;
}

const SAMPLE_RATE = 16000;
const COLORS: Record<SoundVerdict | 'extra', string> = {
  good: '#2ec4b6',
  close: '#ffb627',
  off: '#e83f6f',
  missing: '#e83f6f',
  extra: '#ff6b92',
};
const VERDICT_LABEL: Record<SoundVerdict, string> = { good: 'Spot on', close: 'Nearly', off: 'Off', missing: 'Missing' };

/** How each sound verdict ranks when several sounds share letters: the worst one shows. */
const RANK: Record<SoundVerdict, number> = { good: 0, close: 1, off: 2, missing: 2 };

/** The card's text split into runs of letters, each marked with how it was said. */
function markLetters(text: string, comparison: Comparison): { text: string; verdict: SoundVerdict | null }[] {
  const marks: (SoundVerdict | null)[] = Array.from(text, () => null);
  for (const s of comparison.sounds) {
    if (s.phone.optional) continue;
    for (let i = s.phone.from; i < s.phone.to; i++) {
      const current = marks[i];
      if (current === null || RANK[s.verdict] > RANK[current]) marks[i] = s.verdict;
    }
  }
  const runs: { text: string; verdict: SoundVerdict | null }[] = [];
  Array.from(text).forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.verdict === marks[i]) last.text += ch;
    else runs.push({ text: ch, verdict: marks[i] });
  });
  return runs;
}

/** The card's text, each letter coloured by how its sound came out, and the letters one by one. */
export function colouredWord(text: string, comparison: Comparison, attrs: Record<string, string> = {}): { el: HTMLElement; letters: HTMLElement[] } {
  const letters: HTMLElement[] = [];
  const el = h(
    'p',
    { ...attrs, class: ['letters', text.length > 16 && 'long', attrs.class].filter(Boolean).join(' '), lang: 'fil' },
    markLetters(text, comparison).map((run) =>
      h(
        'span',
        { class: run.verdict ? `sound-${run.verdict}` : '' },
        Array.from(run.text, (ch) => {
          const letter = h('span', null, ch);
          letters.push(letter);
          return letter;
        }),
      ),
    ),
  );
  return { el, letters };
}

/** The stretch of the recording that holds heard sound i: halfway to its neighbours, at least 120 ms. */
export function spanOf(timing: Attempt['timing'], i: number, duration: number): { start: number; end: number } {
  const t = timing[i];
  let start = i > 0 ? (timing[i - 1].end + t.start) / 2 : Math.max(0, t.start - 0.08);
  let end = i < timing.length - 1 ? (t.end + timing[i + 1].start) / 2 : Math.min(duration, t.end + 0.1);
  const short = 0.12 - (end - start);
  if (short > 0) {
    start = Math.max(0, start - short / 2);
    end = Math.min(duration, end + short / 2);
  }
  return { start, end };
}

/** One mark on the ribbon: an expected sound and what came out, or a sound that was added. */
interface Pair {
  result?: SoundResult;
  /** Index into heard, if something was heard here. */
  heardAt?: number;
  /** For an added sound: whether it counted against the attempt. */
  extraCounts?: boolean;
}

function pairs(attempt: Attempt): Pair[] {
  const { sounds, extra } = attempt.comparison;
  const out: Pair[] = [];
  sounds.forEach((r, k) => {
    for (const e of extra.filter((x) => x.before === k)) out.push({ heardAt: e.at, extraCounts: e.counts });
    if (!r.phone.optional || r.heardAt !== undefined) out.push({ result: r, heardAt: r.heardAt });
  });
  for (const e of extra.filter((x) => x.before === sounds.length)) out.push({ heardAt: e.at, extraCounts: e.counts });
  // Optional sounds nobody said (a glottal catch left out) aren't worth a column.
  return out.filter((p) => !(p.result?.phone.optional && p.heardAt === undefined));
}

const verdictOf = (p: Pair): SoundVerdict | 'extra' => p.result?.verdict ?? 'extra';

export interface ResultOptions {
  player: Player;
  /** Offered on the stress page when only stress failed the attempt: the learner says it was right after all. */
  onClaim?: () => void;
}

export interface ResultView {
  el: HTMLElement;
  /** The word, coloured by how each sound came out; drag along it to open each sound in turn. */
  word: HTMLElement;
  /** How its stress came out, in a line that opens the stress page, when it was judged. */
  stress: HTMLElement | null;
  /** Play the learner's whole attempt, without the silence either side. */
  playWhole(): void;
  dispose(): void;
}

export function resultView(attempt: Attempt, options: ResultOptions): ResultView {
  const { player } = options;
  const duration = attempt.samples.length / SAMPLE_RATE;
  const list = pairs(attempt);
  const span = (i: number) => spanOf(attempt.timing, i, duration);

  // Where an expected sound nobody said would have been: the gap between its neighbours.
  const gapFor = (index: number) => {
    const before = list.slice(0, index).reverse().find((p) => p.heardAt !== undefined);
    const after = list.slice(index + 1).find((p) => p.heardAt !== undefined);
    const start = before?.heardAt !== undefined ? span(before.heardAt).start : 0;
    const end = after?.heardAt !== undefined ? span(after.heardAt).end : duration;
    return { start, end };
  };
  // --- The ribbon -----------------------------------------------------------
  // The recording, with each sound marked along it: the sound aimed for above,
  // what was heard below. Tapping a mark opens that sound.
  const segments: Segment[] = list
    .filter((p) => p.heardAt !== undefined)
    .map((p) => ({ ...span(p.heardAt!), color: p.extraCounts === false ? '#4a4290' : COLORS[verdictOf(p)] }));
  const whole = () => ({
    start: Math.max(0, (attempt.timing[0]?.start ?? 0) - 0.2),
    end: Math.min(duration, (attempt.timing[attempt.timing.length - 1]?.end ?? duration) + 0.25),
  });
  // Show just the speech, not the silence either side.
  const view = whole();
  const at = (t: number) => Math.min(100, Math.max(0, ((t - view.start) / Math.max(view.end - view.start, 1e-3)) * 100));
  let ribbon: Spectrogram | null = null;
  try {
    ribbon = createSpectrogram(attempt.features, segments, { height: 60, view });
  } catch {
    // No canvas at all: the marks still work.
  }
  const playhead = (t: number | null) => ribbon?.setPlayhead(t);

  const playMine = (range: { start: number; end: number }) => {
    const playback = player.playSlice(attempt.samples, SAMPLE_RATE, range.start, range.end, playhead);
    void playback.done.then(() => playhead(null));
    return playback;
  };

  const target = (p: Pair) => p.result?.phone.ipa;
  const letters = (p: Pair) => (p.result ? attempt.text.slice(p.result.phone.from, p.result.phone.to).toLowerCase() : '');
  let selected = -1;

  const marks = list.map((p, index) => {
    const ipa = target(p);
    const heard = p.heardAt !== undefined ? attempt.heard[p.heardAt] : null;
    const verdict = verdictOf(p);
    // A sound nobody said gets a slim mark where it should have been.
    let style: Record<string, string> = {};
    let gap: { at: number; shift: number } | null = null;
    if (p.heardAt !== undefined) {
      const s = span(p.heardAt);
      style = { left: `${at(s.start)}%`, width: `${at(s.end) - at(s.start)}%` };
    } else {
      const before = list.slice(0, index).reverse().find((q) => q.heardAt !== undefined);
      const after = list.slice(index + 1).find((q) => q.heardAt !== undefined);
      const middle = before ? span(before.heardAt!).end : after ? span(after.heardAt!).start : (view.start + view.end) / 2;
      // Several missing in a row sit side by side, centred on the gap, and stay inside the ribbon.
      const run = (from: number, step: number) => {
        let n = 0;
        for (let i = from + step; list[i] && list[i].heardAt === undefined; i += step) n++;
        return n;
      };
      gap = { at: at(middle), shift: (run(index, -1) - run(index, 1)) * 13 - 13 };
    }
    const label = [
      ipa ? `Aim for ${soundName(ipa)}` : 'Added sound',
      heard ? `you said ${soundName(heard)}` : 'nothing heard',
    ].join(', ');
    const mark = h(
      'button',
      {
        class: `ribbon-mark mark-${verdict}${p.heardAt === undefined ? ' mark-gap' : ''}${p.extraCounts === false ? ' mark-harmless' : ''}`,
        style,
        'aria-label': label,
        'aria-pressed': 'false',
        onclick: () => select(index),
      },
      h('span', { class: 'mark-target', lang: 'und-fonipa' }, ipa ?? '+'),
      h('span', { class: 'mark-heard', lang: 'und-fonipa' }, heard ?? '–'),
    );
    if (gap) {
      mark.style.setProperty('--at', `${gap.at}%`);
      mark.style.setProperty('--shift', `${gap.shift}px`);
    }
    return mark;
  });

  const ribbonEl = h('div', { class: 'ribbon' }, h('div', { class: 'ribbon-lane lane-target', 'aria-hidden': 'true' }), ribbon?.el, h('div', { class: 'ribbon-lane lane-heard', 'aria-hidden': 'true' }), h('div', { class: 'ribbon-marks', role: 'group', 'aria-label': 'Your sounds' }, marks));

  // --- The word --------------------------------------------------------------
  // The card's text, coloured by how each sound came out, with the open sound's
  // letters underlined. A finger dragged along it opens each sound in turn, so
  // the part of the recording to hear can be found by its letters rather than
  // by its marks on the ribbon; a tap opens the sound under it.
  const chars = Array.from(attempt.text);
  /** Whether mark k's sound is spelled by letter i. */
  const covers = (k: number, i: number) => {
    const phone = list[k]?.result?.phone;
    return phone !== undefined && phone.from <= i && i < phone.to;
  };
  /**
   * The mark each letter belongs to, or -1 (a space, a hyphen, a sound left out). A letter can spell two sounds (a
   * glottal catch before its vowel): it belongs to the one that isn't optional, so the vowel can be reached.
   */
  const own = chars.map((_, i) => {
    const found = list.map((_, k) => k).filter((k) => covers(k, i));
    return found.find((k) => !list[k].result!.phone.optional) ?? found[0] ?? -1;
  });
  /** The mark letter i opens: its own, or the nearest letter's that has one. */
  const markAt = (i: number) => {
    for (let d = 0; i >= 0 && d < chars.length; d++) {
      if (own[i - d] >= 0) return own[i - d];
      if (own[i + d] >= 0) return own[i + d];
    }
    return -1;
  };
  const { el: word, letters: letterEls } = colouredWord(attempt.text, attempt.comparison, {
    class: 'word-scrub',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'The word. Drag along it to choose a sound',
    'aria-valuemin': '1',
    'aria-valuemax': String(list.length),
  });
  /**
   * Finds the one of `els` nearest a point, by where each sat as the drag began (read once, rather than at every
   * move): on its line first, then along it. Of several under the point, a missing sound's mark wins, as it sits on
   * top of its neighbours'.
   */
  const finder = (els: HTMLElement[]) => {
    let boxes: DOMRect[] = [];
    return {
      start: () => (boxes = els.map((el) => el.getBoundingClientRect())),
      nearest: (e: PointerEvent) => {
        let best = -1;
        let far = Infinity;
        boxes.forEach((r, i) => {
          const d = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom) * 1000 + Math.max(r.left - e.clientX, 0, e.clientX - r.right);
          if (d < far || (d === far && els[i].classList.contains('mark-gap'))) [best, far] = [i, d];
        });
        return best;
      },
    };
  };
  /** Opens a sound, and says which it is, for the ticks. */
  const open = (index: number): string | null => {
    if (index < 0) return null;
    select(index);
    return String(index);
  };
  // Like the memory chart: a drag sideways along the word's letters, or along the recording's marks, opens each sound
  // in turn. A tap on a letter opens its sound; a tap on a mark is the mark's own press.
  const letterFinder = finder(letterEls);
  const letterPick = (e: PointerEvent) => open(markAt(letterFinder.nearest(e)));
  scrubbable(word, { start: letterFinder.start, pick: letterPick, tap: letterPick });
  const markFinder = finder(marks);
  scrubbable(ribbonEl, { start: markFinder.start, pick: (e) => open(markFinder.nearest(e)) });
  word.addEventListener('keydown', (e) => {
    const to = ({ ArrowLeft: selected - 1, ArrowDown: selected - 1, ArrowRight: selected + 1, ArrowUp: selected + 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined || list.length === 0) return;
    e.preventDefault();
    select(Math.min(list.length - 1, Math.max(0, to)));
  });

  // --- Detail for one sound --------------------------------------------------
  // Every sound's page is made up front and stacked in one place, only the open one showing, so the panel is as tall
  // as its tallest page and each piece keeps one row for all of them (see .sound-detail): moving between sounds moves
  // nothing on the screen.
  /** How to put each page's slider or button back at rest, as a finger still on it is let go when another opens. */
  const resets = new WeakMap<HTMLElement, () => void>();
  const pages = list.map((p) => page(p));
  // The stress page comes after the sounds', opened only from its line.
  const stress = attempt.stress ?? null;
  const STRESS = list.length;
  /** The stretch of the recording that holds the last two vowels, the ones stress is judged on. */
  const stressSpan = stress && { start: span(stress.heardAt[0]).start, end: span(stress.heardAt[1]).end };
  if (stress) pages.push(stressPage(stress));
  const detail = h('div', { class: 'sound-detail' }, pages);
  // Showing a page that was already there isn't read out, so the open sound is said here.
  const announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  function select(index: number): void {
    if (index === selected) return;
    letGo();
    const control = pages[selected]?.querySelector<HTMLElement>('.sound-slider, .hold-btn');
    if (control) resets.get(control)?.();
    selected = index;
    marks.forEach((m, i) => {
      m.classList.toggle('selected', i === index);
      m.setAttribute('aria-pressed', String(i === index));
    });
    letterEls.forEach((el, i) => el.classList.toggle('on', covers(index, i)));
    stressLink?.setAttribute('aria-pressed', String(index === STRESS));
    pages.forEach((el, i) => {
      el.classList.toggle('open', i === index);
      el.inert = i !== index;
    });
    if (stress && stressSpan && index === STRESS) {
      ribbon?.setFocus(stressSpan);
      word.setAttribute('aria-valuetext', 'Stress');
      announce.textContent = `${VERDICT_LABEL[stressVerdict(stress)]}. ${stressLine(stress)}`;
      return;
    }
    word.setAttribute('aria-valuenow', String(index + 1));
    word.setAttribute('aria-valuetext', marks[index].getAttribute('aria-label')!);
    const p = list[index];
    if (p.heardAt !== undefined) ribbon?.setFocus(span(p.heardAt));
    else ribbon?.setFocus(gapFor(index));
    announce.textContent = [pages[index].querySelector('.verdict-chip')?.textContent, marks[index].getAttribute('aria-label'), tipFor(p)].filter(Boolean).join('. ');
  }

  /**
   * The coaching tip for a sound that needs work. A tip that only says what was heard and what
   * to aim for is left out: the labels over the slider say it. That includes the coach's "leave it
   * out" for an added sound, so an added sound has none (the sound before it may have its own).
   */
  function tipFor(p: Pair): string | undefined {
    if (!p.result || p.result.verdict === 'good') return undefined;
    const at = p.result.phone.from;
    return attempt.tips.find((t) => t.at.includes(at) && !t.plain)?.text;
  }

  function page(p: Pair): HTMLElement {
    const ipa = target(p);
    const heard = p.heardAt !== undefined ? attempt.heard[p.heardAt] : null;
    const verdict = verdictOf(p);
    const closeness = p.result?.closeness ?? 0;
    const tip = tipFor(p) ?? (!ipa && !p.extraCounts ? 'A small extra sound like this is a natural part of speech. No need to change it.' : undefined);
    const drawn = drawChart(ipa ?? null, heard);
    // Right, even if the recogniser wrote it another way (an accepted variant): nothing to slide between.
    const said = p.result?.verdict === 'good';

    return h(
      'div',
      { class: 'detail-page' },
      ...([
        h(
          'div',
          { class: `detail-head detail-${verdict}` },
          ipa
            ? h(
                'p',
                { class: 'detail-title' },
                h('span', { class: 'detail-letters', lang: 'fil' }, `“${letters(p)}”`),
                ' ',
                h('span', { class: 'verdict-chip' }, p.result ? VERDICT_LABEL[p.result.verdict] : 'Added'),
              )
            : h('p', { class: 'detail-title' }, h('span', { class: 'verdict-chip' }, p.extraCounts ? 'Added sound' : 'Natural extra')),
          p.result &&
            h(
              'div',
              { class: 'closeness', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(closeness * 100)), 'aria-label': 'How close' },
              h('span', { style: { width: `${Math.round(closeness * 100)}%` } }),
            ),
        ),
        tip && h('p', { class: 'detail-tip' }, tip),
        drawn.el,
        h(
          'div',
          { class: 'sound-ends' },
          // The symbols themselves are on the slider's ends below.
          // Said as aimed for: once is enough.
          !said && h('p', { class: 'end-heard' }, h('span', { class: 'end-label' }, 'You said'), heard ? soundName(heard) : 'nothing here'),
          h('p', { class: 'end-target' }, h('span', { class: 'end-label' }, 'Aim for'), ipa ? soundName(ipa) : 'leave it out'),
        ),
        listener(said ? null : heard, ipa ?? null, drawn),
      ].filter(Boolean) as Node[]),
    );
  }

  /**
   * The stress page: the word's syllables, with bars for its last two, as tall as each was high and as wide as it was
   * long, for the attempt and for what to aim for; then which it leaned on and how to lean on the other, a button to hear the attempt's two again, and when
   * only stress failed the attempt, one to say it was right after all.
   */
  function stressPage(stress: Stress): HTMLElement {
    const verdict = stressVerdict(stress);
    const { syllables, expected } = stress;
    const said = leanedOn(stress);
    // Most sure it leaned the card's way, full; most sure it leaned the other way, empty.
    const closeness = 1 / (1 + Math.exp(leanAgainst(stress)));
    return h(
      'div',
      { class: 'detail-page stress-page' },
      h(
        'div',
        { class: `detail-head detail-${verdict}` },
        h('p', { class: 'detail-title' }, h('span', { class: 'detail-letters' }, 'Stress'), ' ', h('span', { class: 'verdict-chip' }, VERDICT_LABEL[verdict])),
        h(
          'div',
          { class: 'closeness', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(closeness * 100)), 'aria-label': 'How close' },
          h('span', { style: { width: `${Math.round(closeness * 100)}%` } }),
        ),
      ),
      drawStress(stress, verdict),
      h(
        'div',
        { class: 'sound-ends' },
        said !== expected && h('p', { class: 'end-heard' }, h('span', { class: 'end-label' }, 'You leaned on'), syllables[said].toUpperCase()),
        // Said the card's way, the syllable is enough; otherwise, how to lean on it.
        h('p', { class: 'end-target' }, h('span', { class: 'end-label' }, 'Aim for'), verdict === 'good' ? syllables[expected] : `${syllables[expected]}, higher and longer`),
      ),
      h(
        'div',
        { class: 'stress-actions' },
        h(
          'button',
          // It makes its own sound.
          { class: 'btn secondary hold-btn', 'data-no-tap': true, 'aria-label': `Your ${syllables.slice(-2).join('-')}`, onclick: () => void playMine(stressSpan!) },
          icon('speaker'),
          ' Yours',
        ),
        options.onClaim && h('button', { class: 'btn secondary claim', onclick: options.onClaim }, 'I had it right'),
      ),
    );
  }

  const stressLink = stress
    ? h(
        'button',
        { class: `stress-line detail-${stressVerdict(stress)}`, 'aria-pressed': 'false', onclick: () => select(STRESS) },
        stressLine(stress),
      )
    : null;

  /** The sound held now, so a new one, a redraw or leaving lets it go. */
  let holding: Held | null = null;
  const letGo = () => {
    holding?.release();
    holding = null;
  };

  /**
   * How the open sound is heard: when what was said and what to aim for differ and both can be made, a slider held
   * either side of its middle to hear one or the other; otherwise a button held to hear the one sound there is.
   */
  function listener(heard: string | null, ipa: string | null, drawn: Chart): HTMLElement | null {
    const from = heard && canSynthesize(heard) ? heard : null;
    const to = ipa && canSynthesize(ipa) ? ipa : null;
    if (from && to && from !== to) return slider(from, to, drawn);
    const only = to ?? from;
    return only ? holdButton(only) : null;
  }

  function holdButton(sound: string): HTMLElement {
    /** Whether this button is pressed, so lifting a finger from it after another sound opened stops nothing. */
    let down = false;
    const press = () => {
      letGo();
      down = true;
      holding = player.hold(sound, BUTTON_VOLUME);
      button.classList.toggle('holding', holding !== null);
    };
    const reset = () => {
      down = false;
      button.classList.remove('holding');
    };
    const lift = () => {
      if (down) letGo();
      reset();
    };
    const button = h(
      'button',
      {
        class: 'btn secondary hold-btn',
        // It makes its own sound.
        'data-no-tap': true,
        onpointerdown: (e: PointerEvent) => {
          button.setPointerCapture?.(e.pointerId);
          press();
        },
        onpointerup: lift,
        onpointercancel: lift,
        // From the keyboard, a press is a tap.
        onclick: (e: MouseEvent) => {
          if (e.detail !== 0) return;
          press();
          lift();
        },
        oncontextmenu: (e: Event) => e.preventDefault(),
      },
      icon('speaker'),
      ' Hold to hear ',
      h('strong', { lang: 'und-fonipa' }, sound),
    );
    resets.set(button, reset);
    return button;
  }

  function slider(from: string, to: string, drawn: Chart): HTMLElement {
    /** Where the thumb is, 0 (far left) to 1 (far right); it rests in the middle, where nothing plays. */
    let at = 0.5;
    /** The sound held now, even while silent in the middle: what was said, what to aim for, or neither. */
    let playing: 'heard' | 'target' | null = null;
    /** Whether space or enter is down. */
    let keyed = false;
    const thumb = h('span', { class: 'slider-thumb' }, icon('speaker'));
    const track = h(
      'div',
      {
        class: 'sound-slider',
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Hold to hear. Left for what you said, right for what to aim for, louder further out',
        'aria-valuemin': '-100',
        'aria-valuemax': '100',
      },
      h('span', { class: 'slider-cap cap-heard', lang: 'und-fonipa', 'aria-hidden': 'true' }, from),
      h(
        'span',
        { class: 'slider-rail', 'aria-hidden': 'true' },
        h('span', { class: 'slider-ramp ramp-heard' }),
        h('span', { class: 'slider-ramp ramp-target' }),
        thumb,
      ),
      h('span', { class: 'slider-cap cap-target', lang: 'und-fonipa', 'aria-hidden': 'true' }, to),
    );
    const marks = { heard: drawn.heard, target: drawn.target };
    const show = (down: boolean) => {
      const side = sideOf(at);
      track.style.setProperty('--at', String(at));
      track.style.setProperty('--reach', String(Math.abs(at - 0.5) * 2));
      track.dataset.side = side ?? '';
      track.classList.toggle('holding', down);
      for (const key of ['heard', 'target'] as const) marks[key]?.classList.toggle('speaking', down && side === key);
      track.setAttribute('aria-valuenow', String(Math.round((at - 0.5) * 200)));
      track.setAttribute(
        'aria-valuetext',
        side === null ? 'Silent' : `${side === 'heard' ? `What you said, ${from}` : `What to aim for, ${to}`}, ${Math.round(loudness(at) * 100)}% loud`,
      );
    };
    /**
     * Play the side the thumb is on at its loudness while `down`, or let go. A sound starts only on reaching a side
     * other than the one held: in the middle it's held silent, so wavering there doesn't restart it, and only
     * lifting lets it go, which on iOS is what can start audio (see Player.hold).
     */
    const sound = (down: boolean) => {
      const side = down ? sideOf(at) : null;
      if (!down) {
        letGo();
        playing = null;
      } else if (side && side !== playing) {
        // Holding another stops this one.
        holding = player.hold(side === 'heard' ? from : to, loudness(at));
        playing = side;
      } else {
        holding?.setVolume(side ? loudness(at) : 0);
      }
      show(down);
    };
    /** Where a finger is along the rail, 0–1. */
    const atX = (x: number) => {
      const rail = track.querySelector('.slider-rail')!.getBoundingClientRect();
      const inner = rail.width - thumb.offsetWidth;
      const t = inner > 0 ? (x - rail.left - thumb.offsetWidth / 2) / inner : 0.5;
      return Math.min(1, Math.max(0, t));
    };
    let finger: number | null = null;
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      finger = e.pointerId;
      track.setPointerCapture?.(e.pointerId);
      at = atX(e.clientX);
      sound(true);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId !== finger) return;
      at = atX(e.clientX);
      sound(true);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== finger) return;
      finger = null;
      // Back to the middle, ready for the next press.
      at = 0.5;
      sound(false);
    };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    track.addEventListener('contextmenu', (e) => e.preventDefault());
    // From the keyboard the thumb stays where it's put: a step plays there as a tap, and space or enter holds it.
    track.addEventListener('keydown', (e) => {
      const step = ({ ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1, Home: -1, End: 1 } as Record<string, number>)[e.key];
      if (step !== undefined) {
        e.preventDefault();
        at = Math.min(1, Math.max(0, Math.round((at + step) * 10) / 10));
        sound(true);
        if (!keyed && finger === null) sound(false);
      } else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        keyed = true;
        sound(true);
      }
    });
    track.addEventListener('keyup', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      keyed = false;
      sound(false);
    });
    track.addEventListener('blur', () => {
      keyed = false;
      sound(false);
    });
    show(false);
    // Another sound opened under a finger: back to the middle, silent, and later moves and lifts left alone.
    resets.set(track, () => {
      finger = null;
      keyed = false;
      at = 0.5;
      playing = null;
      show(false);
    });
    return track;
  }

  // Start on the first sound that needs work (an added sound counts), or the first sound.
  const firstProblem = list.findIndex((p) => (p.result ? p.result.verdict !== 'good' : p.extraCounts));
  const el = h(
    'div',
    { class: 'sound-results' },
    ribbonEl,
    detail,
    announce,
  );
  // Stress that's off is why a word with its sounds right failed, so it opens first.
  if (stress && stressVerdict(stress) === 'off') select(STRESS);
  else if (list.length > 0) select(firstProblem >= 0 ? firstProblem : 0);

  return {
    el,
    word,
    stress: stressLink,
    playWhole: () => void playMine(whole()),
    dispose: () => {
      letGo();
      player.stop();
      ribbon?.dispose();
    },
  };
}

// --- Charts -------------------------------------------------------------------

/** How far either side of the slider's middle is silent, as a share of its length. */
const MIDDLE = 0.06;
/** How close to either end of the slider is as loud as it goes, as a share of its length. */
const END = 0.04;
/** The quietest a sound plays, just out of the middle, of its full loudness. */
const QUIETEST = 0.06;
/** How loud the one-sound button plays: it has no slider to turn it up or down. */
export const BUTTON_VOLUME = 0.4;

/** Which sound the slider plays at `at` (0–1): what was said to the left of the middle, what to aim for to the right. */
function sideOf(at: number): 'heard' | 'target' | null {
  return at < 0.5 - MIDDLE ? 'heard' : at > 0.5 + MIDDLE ? 'target' : null;
}

/** How loud the slider plays at `at`, 0–1: quiet just out of the middle, rising to full at either end. */
export function loudness(at: number): number {
  const reach = Math.min(1, Math.max(0, (Math.abs(at - 0.5) - MIDDLE) / (0.5 - MIDDLE - END)));
  // Squared, as loudness is heard: an even slide sounds like an even rise.
  return sideOf(at) ? QUIETEST + (1 - QUIETEST) * reach * reach : 0;
}

interface Chart {
  el: SVGSVGElement;
  /** The mark for what was heard, if it's on this chart. */
  heard: SVGGElement | null;
  /** The mark for the target, if there is one. */
  target: SVGGElement | null;
}

const W = 300;
const H = 126;
const PAD = { left: 56, right: 14, top: 20, bottom: 8 };
/** How far the vowel chart's front edge leans in at the bottom, as a share of its width. */
const SLANT = 0.45;

/** A place on a chart, in SVG units. */
function chartPoint(place: Place): { x: number; y: number } | null {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  if (place.chart === 'vowel') {
    // Inset from the frame so marks never sit on its edge.
    const y = 0.05 + place.y * 0.9;
    const left = SLANT * y + 0.04;
    return { x: PAD.left + (left + place.x * (0.96 - left)) * iw, y: PAD.top + y * ih };
  }
  if (place.chart === 'consonant') {
    return { x: PAD.left + ((place.place + 0.5) / PLACES.length) * iw, y: PAD.top + ((place.manner + 0.5) / MANNERS.length) * ih };
  }
  return null;
}

function drawChart(target: string | null, heard: string | null): Chart {
  const targetPlace = target ? placeOf(target) : heard ? placeOf(heard) : ({ chart: 'none' } as Place);
  const kind = targetPlace.chart;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `sound-chart chart-${kind}`, role: 'img' });
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  if (kind === 'vowel') {
    root.setAttribute('aria-label', 'Vowel map: where the tongue sits');
    const pts = [
      [0, 0],
      [1, 0],
      [1, 1],
      [SLANT, 1],
    ].map(([x, y]) => `${PAD.left + x * iw},${PAD.top + y * ih}`);
    root.append(svg('polygon', { points: pts.join(' '), class: 'chart-frame' }));
    root.append(svg('text', { x: PAD.left, y: 14, class: 'chart-axis' }, 'front'));
    root.append(svg('text', { x: W - PAD.right, y: 14, class: 'chart-axis', 'text-anchor': 'end' }, 'back of mouth'));
    root.append(svg('text', { x: 8, y: PAD.top + 10, class: 'chart-axis' }, 'tongue'));
    root.append(svg('text', { x: 8, y: PAD.top + 24, class: 'chart-axis' }, 'high'));
    root.append(svg('text', { x: 8, y: H - PAD.bottom, class: 'chart-axis' }, 'low'));
    // The five Tagalog vowels, faintly, for bearings.
    for (const v of ['i', 'ɛ', 'a', 'o', 'u']) {
      const p = chartPoint(placeOf(v))!;
      root.append(svg('text', { x: p.x, y: p.y + 4, class: 'chart-ghost', 'text-anchor': 'middle' }, v));
    }
  } else if (kind === 'consonant') {
    root.setAttribute('aria-label', 'Consonant map: where and how the sound is made');
    PLACES.forEach((name, i) => {
      root.append(svg('text', { x: PAD.left + ((i + 0.5) / PLACES.length) * iw, y: 14, class: 'chart-axis', 'text-anchor': 'middle' }, name));
    });
    MANNERS.forEach((name, i) => {
      const y = PAD.top + ((i + 0.5) / MANNERS.length) * ih;
      root.append(svg('text', { x: 6, y: y + 4, class: 'chart-axis' }, name));
      root.append(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: y, y2: y, class: 'chart-grid' }));
    });
    PLACES.forEach((_, i) => {
      const x = PAD.left + ((i + 0.5) / PLACES.length) * iw;
      root.append(svg('line', { x1: x, x2: x, y1: PAD.top, y2: H - PAD.bottom, class: 'chart-grid' }));
    });
  } else {
    root.setAttribute('aria-label', 'No map for this sound');
  }

  const goal = target ? chartPoint(placeOf(target)) : null;
  let from = heard ? chartPoint(placeOf(heard)) : null;
  // A heard sound on the other chart (a vowel for a consonant) can't be placed on this one.
  if (heard && target && placeOf(heard).chart !== kind) from = null;
  // Same spot but not the same sound (a puff of air, voicing): nudge it so both show.
  if (from && goal && heard !== target && Math.abs(from.x - goal.x) < 2 && Math.abs(from.y - goal.y) < 2) from = { x: from.x + 14, y: from.y + 10 };

  if (goal && from && (from.x !== goal.x || from.y !== goal.y)) {
    root.append(svg('line', { x1: from.x, y1: from.y, x2: goal.x, y2: goal.y, class: 'chart-arrow' }));
  }
  let targetMark: SVGGElement | null = null;
  if (goal) {
    targetMark = svg('g', { class: 'chart-target', transform: `translate(${goal.x} ${goal.y})` }, svg('circle', { r: 15 }), svg('text', { 'text-anchor': 'middle', y: 5 }, target!));
    root.append(targetMark);
  }
  let heardMark: SVGGElement | null = null;
  if (from && heard) {
    heardMark = svg('g', { class: 'chart-heard', transform: `translate(${from.x} ${from.y})` }, svg('circle', { r: 12 }), svg('text', { 'text-anchor': 'middle', y: 4 }, heard));
    root.append(heardMark);
  }
  return { el: root, heard: heardMark, target: targetMark };
}

/** How tall a stress bar is at its lowest, and how much taller each semitone above the other makes it, in SVG units. */
const BAR_LOW = 12;
const BAR_PER_SEMITONE = 4;
/** A semitone gap past this draws as this: the chart shows which was higher, not by how much past a point. */
const MOST_SEMITONES = 8;
/** What to aim for, drawn: the stressed syllable this many semitones higher, and this much longer, than the other. */
const AIM = { semitones: 6, length: 1.6 };

/**
 * The stress chart: a column for each of the hint's syllables, and in two rows, the attempt's and what to aim for,
 * a bar for each of the last two: as tall as it was high against the other, as wide as it was long. Earlier
 * syllables, which stress doesn't fall on, get a low mark. The one leaned on, from pitch, length and loudness together,
 * is coloured by how that came out, so it can be the wider bar rather than the taller.
 */
function drawStress(stress: Stress, verdict: SoundVerdict): SVGSVGElement {
  const { syllables, expected } = stress;
  const n = syllables.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sound-chart chart-stress', role: 'img' });
  root.setAttribute('aria-label', `Stress chart: you leaned on ${syllables[leanedOn(stress)].toUpperCase()}, aim for ${syllables[expected]}`);
  const iw = W - PAD.left - PAD.right;
  const col = iw / n;
  const centre = (i: number) => PAD.left + (i + 0.5) * col;
  syllables.forEach((syllable, i) => {
    root.append(svg('text', { x: centre(i), y: 14, class: 'chart-axis', 'text-anchor': 'middle' }, syllable));
  });
  /** One row: its label, a low mark for each earlier syllable, and the last two syllables' bars. */
  const row = (label: string, base: number, semitones: number, lengthRatio: number, className: (i: number) => string) => {
    root.append(svg('text', { x: 6, y: base - 4, class: 'chart-axis' }, label));
    root.append(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: base, y2: base, class: 'chart-grid' }));
    for (let i = 0; i < n - 2; i++) root.append(svg('rect', { x: centre(i) - col * 0.15, y: base - 6, width: col * 0.3, height: 6, rx: 3, class: 'stress-bar' }));
    // Second-to-last over last: how much higher, and how much longer.
    const rise = Math.max(-MOST_SEMITONES, Math.min(MOST_SEMITONES, semitones));
    const heights = [BAR_LOW + Math.max(rise, 0) * BAR_PER_SEMITONE, BAR_LOW + Math.max(-rise, 0) * BAR_PER_SEMITONE];
    const longest = Math.max(lengthRatio, 1);
    const widths = [lengthRatio / longest, 1 / longest].map((w) => col * Math.max(0.3, 0.9 * w));
    [0, 1].forEach((k) => {
      const i = n - 2 + k;
      root.append(svg('rect', { x: centre(i) - widths[k] / 2, y: base - heights[k], width: widths[k], height: heights[k], rx: 6, class: `stress-bar ${className(i)}` }));
    });
  };
  const { length, pitch } = stress.differences;
  row('You', 64, pitch * 6, Math.exp(length), (i) => (i === leanedOn(stress) ? `bar-${verdict}` : ''));
  const aimFirst = expected === n - 2;
  row('Aim for', H - PAD.bottom, aimFirst ? AIM.semitones : -AIM.semitones, aimFirst ? AIM.length : 1 / AIM.length, (i) => (i === expected ? 'bar-good' : ''));
  return root;
}
