// The results of a spoken attempt, sound by sound: the recording drawn as a
// ribbon with each sound marked on it (the sound aimed for above, what was
// heard below; tap one to open it and hear it), and for the chosen sound a map
// of where it's made in the mouth, with the learner's version and the target.

import type { Tip } from '../coach';
import type { Comparison, SoundResult, SoundVerdict } from '../phonetics';
import type { Player } from '../player';
import REFERENCES from '../reference-sounds.json';
import { MANNERS, PLACES, placeOf, soundName, type Place } from '../sound-map';
import { createSpectrogram, type Segment, type Spectrogram } from '../spectrogram';
import { h, svg } from '../ui';

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

const references = REFERENCES as Record<string, { file: string; syllable: string; word: string }>;

/** A native speaker saying the sound, if we have one. Allophones share a clip. */
export function referenceFor(ipa: string): { url: string; syllable: string; word: string } | null {
  const key = ({ e: 'ɛ', ɔ: 'o', r: 'ɾ' } as Record<string, string>)[ipa] ?? ipa;
  const ref = references[key];
  return ref ? { url: `${import.meta.env.BASE_URL}sounds/${ref.file}`, syllable: ref.syllable, word: ref.word } : null;
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
}

export interface ResultView {
  el: HTMLElement;
  /** Play the learner's whole attempt, without the silence either side. */
  playWhole(): void;
  dispose(): void;
}

export function resultView(attempt: Attempt, options: ResultOptions): ResultView {
  const { player } = options;
  const duration = attempt.samples.length / SAMPLE_RATE;
  const list = pairs(attempt);
  const span = (i: number) => spanOf(attempt.timing, i, duration);

  // Where to listen for an expected sound nobody said: the gap between its neighbours.
  const gapFor = (index: number) => {
    const before = list.slice(0, index).reverse().find((p) => p.heardAt !== undefined);
    const after = list.slice(index + 1).find((p) => p.heardAt !== undefined);
    const start = before?.heardAt !== undefined ? span(before.heardAt).start : 0;
    const end = after?.heardAt !== undefined ? span(after.heardAt).end : duration;
    return { start, end };
  };
  const yoursFor = (index: number) => {
    const p = list[index];
    return p.heardAt !== undefined ? span(p.heardAt) : gapFor(index);
  };

  // --- The ribbon -----------------------------------------------------------
  // The recording, with each sound marked along it: the sound aimed for above,
  // what was heard below. Tapping a mark opens that sound and plays your part.
  const segments: Segment[] = list
    .filter((p) => p.heardAt !== undefined)
    .map((p) => ({ ...span(p.heardAt!), color: p.extraCounts === false ? '#4a4290' : COLORS[verdictOf(p)] }));
  const whole = () => ({
    start: Math.max(0, (attempt.timing[0]?.start ?? 0) - 0.2),
    end: Math.min(duration, (attempt.timing[attempt.timing.length - 1]?.end ?? duration) + 0.25),
  });
  // Show just the speech, not the silence either side.
  const view = whole();
  const at = (t: number) => Math.min(100, Math.max(0, ((t - view.start) / (view.end - view.start)) * 100));
  let ribbon: Spectrogram | null = null;
  try {
    ribbon = createSpectrogram(attempt.features, segments, { height: 60, view });
  } catch {
    // No canvas at all: the marks still work.
  }
  const playhead = (t: number | null) => ribbon?.setPlayhead(t);

  // Counts playbacks started (and dispose), so a sequence can tell it was interrupted.
  let plays = 0;
  const playMine = (range: { start: number; end: number }) => {
    plays++;
    const playback = player.playSlice(attempt.samples, SAMPLE_RATE, range.start, range.end, playhead);
    void playback.done.then(() => playhead(null));
    return playback;
  };

  const target = (p: Pair) => p.result?.phone.ipa;
  const letters = (p: Pair) => (p.result ? attempt.text.slice(p.result.phone.from, p.result.phone.to).toLowerCase() : '');
  let selected = -1;

  const playTarget = (index: number): Promise<void> => {
    const ipa = target(list[index]);
    const ref = ipa ? referenceFor(ipa) : null;
    if (!ref) return Promise.resolve();
    plays++;
    return player.playUrl(ref.url).done;
  };

  const marks = list.map((p, index) => {
    const ipa = target(p);
    const heard = p.heardAt !== undefined ? attempt.heard[p.heardAt] : null;
    const verdict = verdictOf(p);
    // A sound nobody said gets a slim mark where it should have been.
    let style: Record<string, string>;
    if (p.heardAt !== undefined) {
      const s = span(p.heardAt);
      style = { left: `${at(s.start)}%`, width: `${at(s.end) - at(s.start)}%` };
    } else {
      const before = list.slice(0, index).reverse().find((q) => q.heardAt !== undefined);
      const after = list.slice(index + 1).find((q) => q.heardAt !== undefined);
      const middle = before ? span(before.heardAt!).end : after ? span(after.heardAt!).start : (view.start + view.end) / 2;
      style = { left: `calc(${at(middle)}% - 13px)`, width: '26px' };
    }
    const label = [
      ipa ? `Aim for ${soundName(ipa)}` : 'Added sound',
      heard ? `you said ${soundName(heard)}` : 'nothing heard',
    ].join(', ');
    return h(
      'button',
      {
        class: `ribbon-mark mark-${verdict}${p.heardAt === undefined ? ' mark-gap' : ''}${p.extraCounts === false ? ' mark-harmless' : ''}`,
        style,
        'aria-label': label,
        'aria-pressed': 'false',
        onclick: () => {
          select(index);
          playMine(yoursFor(index));
        },
      },
      h('span', { class: 'mark-target', lang: 'und-fonipa' }, ipa ?? '+'),
      h('span', { class: 'mark-heard', lang: 'und-fonipa' }, heard ?? '–'),
    );
  });

  const ribbonEl = h('div', { class: 'ribbon' }, h('div', { class: 'ribbon-lane lane-target', 'aria-hidden': 'true' }), ribbon?.el, h('div', { class: 'ribbon-lane lane-heard', 'aria-hidden': 'true' }), h('div', { class: 'ribbon-marks', role: 'group', 'aria-label': 'Your sounds' }, marks));

  // --- Detail for one sound --------------------------------------------------
  const detail = h('div', { class: 'sound-detail', 'aria-live': 'polite' });
  let chart: { heard: SVGGElement | null; moveTo: (p: { x: number; y: number }, ms: number) => void; reset: () => void } | null = null;

  function select(index: number): void {
    if (index === selected) return;
    selected = index;
    marks.forEach((m, i) => {
      m.classList.toggle('selected', i === index);
      m.setAttribute('aria-pressed', String(i === index));
    });
    const p = list[index];
    if (p.heardAt !== undefined) ribbon?.setFocus(span(p.heardAt));
    else ribbon?.setFocus(gapFor(index));
    renderDetail(p, index);
  }

  /** The coaching tip for a sound; an added sound borrows the tip for the sound before it. */
  function tipFor(index: number): string | undefined {
    const p = list[index];
    const owner = p.result ? p : list.slice(0, index).reverse().find((q) => q.result);
    const want = owner ? letters(owner) : '';
    return want ? attempt.tips.find((t) => t.letters.toLowerCase() === want)?.text : undefined;
  }

  function renderDetail(p: Pair, index: number): void {
    const ipa = target(p);
    const heard = p.heardAt !== undefined ? attempt.heard[p.heardAt] : null;
    const verdict = verdictOf(p);
    const ref = ipa ? referenceFor(ipa) : null;
    const closeness = p.result?.closeness ?? 0;
    const tip = tipFor(index) ?? (!ipa ? (p.extraCounts ? 'This sound isn’t in the word. Try leaving it out.' : 'A small extra sound like this is a natural part of speech. No need to change it.') : undefined);
    const drawn = drawChart(ipa ?? null, heard);
    chart = drawn;

    const yours = h('button', { class: 'btn secondary small', onclick: () => playMine(yoursFor(index)) }, '▶ Yours');
    const theirs = ref && h('button', { class: 'btn secondary small', onclick: () => void playTarget(index) }, '▶ Target');
    const both =
      ref &&
      heard &&
      h(
        'button',
        {
          class: 'btn primary small',
          'aria-label': 'Yours, then the target',
          onclick: async () => {
            drawn.reset();
            drawn.heard?.classList.add('speaking');
            const mine = playMine(yoursFor(index));
            const turn = plays;
            await mine.done;
            drawn.heard?.classList.remove('speaking');
            // Something else was played, or the screen closed: don't carry on.
            if (plays !== turn) return;
            const goal = ipa ? chartPoint(placeOf(ipa)) : null;
            if (goal) drawn.moveTo(goal, 700);
            await playTarget(index);
            setTimeout(() => chart === drawn && drawn.reset(), 1600);
          },
        },
        '▶ Both',
      );

    detail.replaceChildren(
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
        h(
          'dl',
          { class: 'detail-sounds' },
          ipa && [h('dt', null, 'Aim for'), h('dd', null, h('strong', { lang: 'und-fonipa' }, ipa), ' ', soundName(ipa), ref && h('span', { class: 'muted' }, ` (from “${ref.word}”)`))],
          [h('dt', null, 'You said'), h('dd', null, heard ? [h('strong', { lang: 'und-fonipa' }, heard), ' ', soundName(heard)] : 'nothing here')],
        ),
        drawn.el,
        tip && h('p', { class: 'detail-tip' }, tip),
        h('div', { class: 'row detail-actions' }, yours, theirs, both),
      ].filter(Boolean) as Node[]),
    );
  }

  // Start on the first sound that needs work, or the first sound.
  const firstProblem = list.findIndex((p) => p.result && p.result.verdict !== 'good');
  const el = h(
    'div',
    { class: 'sound-results' },
    ribbonEl,
    detail,
  );
  if (list.length > 0) select(firstProblem >= 0 ? firstProblem : 0);

  return {
    el,
    playWhole: () => void playMine(whole()),
    dispose: () => {
      plays++;
      player.stop();
      ribbon?.dispose();
    },
  };
}

// --- Charts -------------------------------------------------------------------

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

function drawChart(target: string | null, heard: string | null) {
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
  if (goal) {
    root.append(
      svg('g', { class: 'chart-target', transform: `translate(${goal.x} ${goal.y})` }, svg('circle', { r: 15 }), svg('text', { 'text-anchor': 'middle', y: 5 }, target!)),
    );
  }
  let heardMark: SVGGElement | null = null;
  if (from && heard) {
    heardMark = svg('g', { class: 'chart-heard', transform: `translate(${from.x} ${from.y})` }, svg('circle', { r: 12 }), svg('text', { 'text-anchor': 'middle', y: 4 }, heard));
    // CSS transform too, so moving it can animate.
    heardMark.style.transform = `translate(${from.x}px, ${from.y}px)`;
    root.append(heardMark);
  }
  const start = from;
  return {
    el: root,
    heard: heardMark,
    moveTo(p: { x: number; y: number }, ms: number) {
      if (!heardMark) return;
      heardMark.style.transition = `transform ${ms}ms cubic-bezier(.5,0,.2,1)`;
      heardMark.setAttribute('transform', `translate(${p.x} ${p.y})`);
      heardMark.style.transform = `translate(${p.x}px, ${p.y}px)`;
      heardMark.classList.add('arrived');
    },
    reset() {
      if (!heardMark || !start) return;
      heardMark.style.transition = 'none';
      heardMark.setAttribute('transform', `translate(${start.x} ${start.y})`);
      heardMark.style.transform = `translate(${start.x}px, ${start.y}px)`;
      heardMark.classList.remove('arrived');
    },
  };
}
