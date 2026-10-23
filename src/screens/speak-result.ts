// The results of a spoken attempt, sound by sound: the recording drawn as a
// ribbon with each sound marked on it (the sound aimed for above, what was
// heard below; tap one to open it), and for the chosen sound a map of where
// it's made in the mouth, with what the learner said and the target. Holding
// the slider under the map plays one or the other, made in code rather than cut
// from the recording: what was said to the left of the middle, what to aim for
// to the right, louder the further the finger goes.

import type { Tip } from '../coach';
import type { Comparison, SoundResult, SoundVerdict } from '../phonetics';
import { canSynthesize } from '../phone-synth';
import type { Held, Player } from '../player';
import { MANNERS, PLACES, placeOf, soundName, type Place } from '../sound-map';
import { createSpectrogram, type Segment, type Spectrogram } from '../spectrogram';
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

  // --- Detail for one sound --------------------------------------------------
  const detail = h('div', { class: 'sound-detail', 'aria-live': 'polite' });

  function select(index: number): void {
    if (index === selected) return;
    selected = index;
    letGo();
    marks.forEach((m, i) => {
      m.classList.toggle('selected', i === index);
      m.setAttribute('aria-pressed', String(i === index));
    });
    const p = list[index];
    if (p.heardAt !== undefined) ribbon?.setFocus(span(p.heardAt));
    else ribbon?.setFocus(gapFor(index));
    renderDetail(p, index);
  }

  /**
   * The coaching tip for a sound that needs work. An added sound that counts takes the
   * tip for the sound before it, which is where the coach puts "leave it out". A tip that
   * only says what was heard and what to aim for is left out: the labels over the slider say it.
   */
  function tipFor(index: number): string | undefined {
    const p = list[index];
    let owner: Pair | undefined;
    if (p.result) owner = p.result.verdict === 'good' ? undefined : p;
    else if (p.extraCounts) owner = list.slice(0, index).reverse().find((q) => q.result);
    const at = owner?.result?.phone.from;
    return at === undefined ? undefined : attempt.tips.find((t) => t.at.includes(at) && !t.plain)?.text;
  }

  function renderDetail(p: Pair, index: number): void {
    const ipa = target(p);
    const heard = p.heardAt !== undefined ? attempt.heard[p.heardAt] : null;
    const verdict = verdictOf(p);
    const closeness = p.result?.closeness ?? 0;
    const tip = tipFor(index) ?? (!ipa && !p.extraCounts ? 'A small extra sound like this is a natural part of speech. No need to change it.' : undefined);
    const drawn = drawChart(ipa ?? null, heard);
    // Right, even if the recogniser wrote it another way (an accepted variant): nothing to slide between.
    const said = p.result?.verdict === 'good';

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
    const press = () => {
      letGo();
      holding = player.hold(sound, BUTTON_VOLUME);
      button.classList.toggle('holding', holding !== null);
    };
    const lift = () => {
      letGo();
      button.classList.remove('holding');
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
    return button;
  }

  function slider(from: string, to: string, drawn: Chart): HTMLElement {
    /** Where the thumb is, 0 (far left) to 1 (far right); it rests in the middle, where nothing plays. */
    let at = 0.5;
    /** The side playing now: what was said, what to aim for, or neither. */
    let side: 'heard' | 'target' | null = null;
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
    const show = () => {
      const loud = loudness(at);
      track.style.setProperty('--at', String(at));
      track.style.setProperty('--reach', String(Math.abs(at - 0.5) * 2));
      track.dataset.side = side ?? '';
      track.setAttribute('aria-valuenow', String(Math.round((at - 0.5) * 200)));
      track.setAttribute(
        'aria-valuetext',
        side === null ? 'Silent' : `${side === 'heard' ? `What you said, ${from}` : `What to aim for, ${to}`}, ${Math.round(loud * 100)}% loud`,
      );
    };
    /** Play the side the thumb is on, at its loudness, starting or switching the sound only when the side changes. */
    const sound = (pressed: boolean) => {
      const next = pressed ? sideOf(at) : null;
      if (next !== side) {
        // Into the middle with the finger still down: silent now, not after a tap's length.
        if (pressed) holding?.setVolume(0);
        letGo();
        if (side) marks[side]?.classList.remove('speaking');
        side = next;
        if (side) {
          holding = player.hold(side === 'heard' ? from : to, loudness(at));
          marks[side]?.classList.add('speaking');
        }
      } else {
        holding?.setVolume(loudness(at));
      }
      track.classList.toggle('holding', pressed);
      show();
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
        if (holding) sound(true);
        else {
          sound(true);
          sound(false);
        }
      } else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        sound(true);
      }
    });
    track.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') sound(false);
    });
    track.addEventListener('blur', () => sound(false));
    show();
    return track;
  }

  // Start on the first sound that needs work (an added sound counts), or the first sound.
  const firstProblem = list.findIndex((p) => (p.result ? p.result.verdict !== 'good' : p.extraCounts));
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
