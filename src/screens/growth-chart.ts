// A stacked stream of how many words are held at each strength over time:
// the height shows how many words you know, the colors how firmly. Drag across
// it to see any earlier day.

import { STRENGTHS, type MemoryHistory, type Strength } from '../memory';
import { DAY_MS } from '../srs';
import { h } from '../ui';

const SVG = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 160;
/** Bottom layer first: the firmest words are the foundation the rest sit on. */
const LAYERS: Strength[] = [...STRENGTHS].reverse().map((s) => s.id);

/**
 * Smooth one series with a small Gaussian, so day-to-day steps read as a
 * trend. The last value is kept exact so the chart ends on today's numbers.
 */
export function smooth(values: number[], sigma = 1.5): number[] {
  const reach = Math.ceil(sigma * 3);
  const out = values.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(values.length - 1, i + reach); j++) {
      const w = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma));
      sum += values[j] * w;
      weight += w;
    }
    return sum / weight;
  });
  out[out.length - 1] = values[values.length - 1];
  return out;
}

/**
 * Commands for a smooth curve through the points that never overshoots them
 * (monotone cubic, Fritsch–Carlson), so a layer never bulges past its data.
 */
export function curve(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 2) return '';
  const slopes = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const tangents = xs.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const a = slopes[i - 1];
    const b = slopes[i];
    return a * b <= 0 ? 0 : (3 * a * b) / (2 * Math.max(a, b) + Math.min(a, b));
  });
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += ` C${f(xs[i] + dx)},${f(ys[i] + tangents[i] * dx)} ${f(xs[i + 1] - dx)},${f(ys[i + 1] - tangents[i + 1] * dx)} ${f(xs[i + 1])},${f(ys[i + 1])}`;
  }
  return d;
}

function f(n: number): string {
  return n.toFixed(1);
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The chart, with a caption and legend that follow the point being looked at.
 * `legendCounts` holds the legend's count element for each strength.
 */
export function growthChart(
  history: MemoryHistory,
  legendCounts: Record<Strength, HTMLElement>,
): HTMLElement {
  const { times } = history;
  const last = times.length - 1;
  const raw = Object.fromEntries(LAYERS.map((id) => [id, history.counts[id]])) as Record<Strength, number[]>;
  const smoothed = Object.fromEntries(LAYERS.map((id) => [id, smooth(raw[id])])) as Record<Strength, number[]>;

  // Running totals: tops[k] is the top edge of layer k.
  const tops: number[][] = [];
  LAYERS.forEach((id, k) => tops.push(smoothed[id].map((v, i) => v + (k ? tops[k - 1][i] : 0))));
  const peak = Math.max(1, ...tops[tops.length - 1]);
  // Headroom above the tallest point, so the top outline isn't clipped.
  const yOf = (v: number) => H - (v / (peak * 1.12)) * H;
  const xs = times.map((_, i) => (i / last) * W);

  const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'growth-svg', 'aria-hidden': 'true' });
  const backXs = [...xs].reverse();
  LAYERS.forEach((id, k) => {
    // Along the layer's top edge, then back along the edge of the one below.
    const top = tops[k].map(yOf);
    const below = (k ? tops[k - 1].map(yOf) : xs.map(() => H)).reverse();
    const d = `M${f(xs[0])},${f(top[0])}${curve(xs, top)} L${f(W)},${f(below[0])}${curve(backXs, below)} Z`;
    plot.append(svg('path', { d, class: `layer s-${id}` }));
  });
  // Outlines on top of every fill, so each edge is drawn whole.
  LAYERS.forEach((_, k) => {
    const top = tops[k].map(yOf);
    plot.append(
      svg('path', {
        d: `M${f(xs[0])},${f(top[0])}` + curve(xs, top),
        class: k === LAYERS.length - 1 ? 'edge outer' : 'edge',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  });

  const total = (i: number) => LAYERS.reduce((sum, id) => sum + raw[id][i], 0);
  const value = h('strong', { class: 'growth-total' });
  const when = h('span', { class: 'muted' });
  const back = h('button', { class: 'link-btn growth-back', hidden: true, onclick: () => show(last) }, 'Back to today');
  const marker = h('div', { class: 'growth-marker', hidden: true, 'aria-hidden': 'true' });

  function show(i: number): void {
    const today = i === last;
    const n = total(i);
    value.textContent = String(n);
    when.textContent = ` ${n === 1 ? 'word' : 'words'} ${today ? 'today' : `on ${shortDate(times[i])}`}`;
    for (const id of LAYERS) legendCounts[id].textContent = String(raw[id][i]);
    marker.hidden = today;
    marker.style.left = `${(i / last) * 100}%`;
    back.hidden = today;
  }

  const frame = h(
    'div',
    {
      class: 'growth-frame',
      role: 'img',
      'aria-label': `Words by strength over time: ${total(0)} on ${shortDate(times[0])}, ${total(last)} today.`,
    },
    plot,
    marker,
    // In the first days the stream is a sliver at the edge; say what is coming.
    times[last] - history.since < 2 * DAY_MS &&
      h('p', { class: 'growth-hint small' }, 'Keep coming back and this fills in, day by day, as your words settle.'),
  );
  const pick = (e: PointerEvent) => {
    const box = frame.getBoundingClientRect();
    if (!box.width) return;
    show(Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * last));
  };
  frame.addEventListener('pointerdown', pick);
  frame.addEventListener('pointermove', (e) => {
    // A mouse looks by hovering; a finger by dragging.
    if (e.pointerType === 'mouse' || e.buttons) pick(e);
  });
  frame.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') show(last);
  });

  const mid = Math.round(last / 2);
  const el = h(
    'div',
    { class: 'growth' },
    h('p', { class: 'growth-caption' }, value, when, back),
    frame,
    h(
      'div',
      { class: 'growth-axis muted small', 'aria-hidden': 'true' },
      h('span', null, shortDate(times[0])),
      h('span', null, shortDate(times[mid])),
      h('span', null, 'Today'),
    ),
  );
  show(last);
  return el;
}
