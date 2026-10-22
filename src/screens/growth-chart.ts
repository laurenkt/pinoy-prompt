// A stacked stream of how many words are held at each strength over time:
// the height shows how many words you know, the colors how firmly. Drag across
// it to see any earlier day. With a forecast, the stream carries on hatched from
// today towards the next milestone, with roughly when it might be reached.

import { STRENGTHS, curveAt, type Forecast, type MemoryHistory, type Strength } from '../memory';
import { DAY_MS } from '../srs';
import { h, svg } from '../ui';

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

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function monthYear(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Roughly how long from `now` until `at`, in plain words: weeks, then months, then years. */
export function timeUntil(at: number, now: number): string {
  const days = (at - now) / DAY_MS;
  if (days < 4) return 'in a few days';
  if (days < 11) return 'in about a week';
  if (days < 60) return `in about ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.4);
  if (months === 12) return 'in about a year';
  if (months < 24) return `in about ${months} months`;
  const years = Math.round(days / 365 * 2) / 2;
  return `in about ${years.toLocaleString()} years`;
}

/** Share of the chart's width for the past when a projection follows it. */
const PAST = 0.7;

/**
 * How far along the projection is, 0 today to 1 at the milestone, `u` of the
 * way there in time: along the learner's curve, so a pace that eases off rises
 * early and flattens, or in a straight line without one.
 */
export function projected(forecast: Forecast, at: number, now: number, u: number): number {
  const { curve } = forecast;
  if (!curve) return u;
  const start = curveAt(curve, now);
  const end = curveAt(curve, at);
  return end > start ? (curveAt(curve, now + u * (at - now)) - start) / (end - start) : u;
}

/** The milestone the projection runs to: the next one with a date, if any. */
export function nextMilestone(forecast: Forecast | undefined): { cards: number; label: string; at: number } | null {
  const next = forecast?.milestones.find((m) => m.at !== 'reached');
  return next && typeof next.at === 'number' ? { ...next, at: next.at } : null;
}

/** Each milestone and roughly when it might be reached, kept short. */
export function forecastView(forecast: Forecast): HTMLElement {
  return h(
    'div',
    { class: 'growth-forecast small', id: 'growth-forecast' },
    h(
      'ul',
      null,
      forecast.milestones.map((m) =>
        h(
          'li',
          null,
          h('span', null, m.label, h('span', { class: 'muted' }, ` · ${m.cards.toLocaleString()} cards`)),
          h('strong', null, m.at === 'reached' ? 'Reached' : m.at === null ? '–' : `~${monthYear(m.at)}`),
        ),
      ),
    ),
    h('p', { class: 'muted' }, forecast.early ? 'A rough early guess.' : 'A rough estimate.'),
  );
}

/**
 * The chart, with a caption and legend that follow the point being looked at.
 * `legendCounts` holds the legend's count element for each strength. With a
 * forecast that has a date ahead, the past takes the left of the chart and a
 * hatched projection the rest; tapping its milestone opens the others below.
 */
export function growthChart(
  history: MemoryHistory,
  legendCounts: Record<Strength, HTMLElement>,
  forecast?: Forecast,
): HTMLElement {
  const { times } = history;
  const last = times.length - 1;
  const raw = history.counts;
  const smoothed = Object.fromEntries(LAYERS.map((id) => [id, smooth(raw[id])])) as Record<Strength, number[]>;
  const next = nextMilestone(forecast);
  const past = next ? PAST : 1;

  // Running totals: tops[k] is the top edge of layer k.
  const tops: number[][] = [];
  LAYERS.forEach((id, k) => tops.push(smoothed[id].map((v, i) => v + (k ? tops[k - 1][i] : 0))));
  const peak = Math.max(1, ...tops[tops.length - 1]);
  // Headroom above the tallest point, so the top outline isn't clipped; with a
  // projection, room for it to rise towards its milestone above the stream.
  const yOf = (v: number) => H - (v / (peak * (next ? 1.8 : 1.12))) * H;
  const xs = times.map((_, i) => (i / last) * W * past);

  const total = (i: number) => LAYERS.reduce((sum, id) => sum + raw[id][i], 0);
  // The svg is the picture, labelled for screen readers; the controls around it stay controls.
  const plot = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    class: 'growth-svg',
    role: 'img',
    'aria-label': `Words by strength over time: ${total(0)} on ${shortDate(times[0])}, ${total(last)} today.`,
  });
  const backXs = [...xs].reverse();
  LAYERS.forEach((id, k) => {
    // Along the layer's top edge, then back along the edge of the one below.
    const top = tops[k].map(yOf);
    const below = (k ? tops[k - 1].map(yOf) : xs.map(() => H)).reverse();
    const d = `M${f(xs[0])},${f(top[0])}${curve(xs, top)} L${f(xs[last])},${f(below[0])}${curve(backXs, below)} Z`;
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
  if (next) {
    // The stream carries on as a hatched area, rising along the learner's curve from today towards the
    // milestone in the corner under its tag (its date on the axis), with the same outline dashed. The
    // milestone is off this scale, so it shows the direction and the tag the numbers.
    const from = yOf(tops[tops.length - 1][last]);
    const steps = Array.from({ length: 25 }, (_, i) => i / 24);
    const aheadXs = steps.map((u) => xs[last] + u * (W - xs[last]));
    const aheadYs = steps.map((u) => from + (8 - from) * projected(forecast!, next.at, times[last], u));
    plot.prepend(
      svg(
        'defs',
        {},
        svg(
          'pattern',
          { id: 'growth-hatch', patternUnits: 'userSpaceOnUse', width: 8, height: 8, patternTransform: 'rotate(45)' },
          svg('rect', { width: 4, height: 8, class: 'hatch' }),
        ),
      ),
    );
    plot.append(
      svg('path', { d: `M${f(xs[last])},${f(H)} L${f(xs[last])},${f(from)}${curve(aheadXs, aheadYs)} L${f(W)},${f(H)} Z`, class: 'projection' }),
      svg('path', { d: `M${f(xs[last])},${f(from)}${curve(aheadXs, aheadYs)}`, class: 'edge outer projection-edge', 'vector-effect': 'non-scaling-stroke' }),
    );
  }

  const value = h('strong', { class: 'growth-total' });
  const when = h('span', { class: 'muted' });
  const back = h('button', { class: 'link-btn growth-back', hidden: true, onclick: () => show(last) }, 'Back to today');
  const marker = h('div', { class: 'growth-marker', hidden: true, 'aria-hidden': 'true' });
  const ahead = next && forecast && forecastView(forecast);
  if (ahead) ahead.hidden = true;
  const goal =
    next &&
    ahead &&
    h(
      'button',
      {
        class: 'growth-goal',
        'aria-expanded': 'false',
        'aria-controls': 'growth-forecast',
        'aria-label': `${forecast!.early ? 'Early guess: ' : ''}${next.label} ${timeUntil(next.at, times[last])}, around ${monthYear(next.at)}, at your recent pace. Show all milestones.`,
        // Its own tap, not a look along the chart; a mouse over it doesn't look either.
        onpointerdown: (e: PointerEvent) => e.stopPropagation(),
        onpointermove: (e: PointerEvent) => e.stopPropagation(),
        onpointerenter: (e: PointerEvent) => {
          if (e.pointerType === 'mouse') show(last);
        },
        onclick: () => {
          ahead.hidden = !ahead.hidden;
          goal!.setAttribute('aria-expanded', String(!ahead.hidden));
          // On a short phone the list opens below the fold; bring it up.
          if (!ahead.hidden) ahead.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        },
      },
      h('strong', null, next.label),
      h('span', null, timeUntil(next.at, times[last])),
    );

  function show(i: number): void {
    const today = i === last;
    const n = total(i);
    value.textContent = String(n);
    when.textContent = ` ${n === 1 ? 'card' : 'cards'} ${today ? 'today' : `on ${shortDate(times[i])}`}`;
    for (const id of LAYERS) legendCounts[id].textContent = String(raw[id][i]);
    lookAt(today, (i / last) * past);
  }

  /** A point `u` of the way from today to the next milestone, read off the projection. */
  function showAhead(u: number): void {
    if (!next) return;
    // From where the drawn projection starts, today's top of the stream.
    const from = total(last);
    value.textContent = `~${Math.round(from + projected(forecast!, next.at, times[last], u) * (next.cards - from))}`;
    for (const id of LAYERS) legendCounts[id].textContent = String(raw[id][last]);
    when.textContent = ` cards by ${monthYear(times[last] + u * (next.at - times[last]))}`;
    lookAt(false, past + u * (1 - past));
  }

  /** The marker and the caption's corner, for any point but today. */
  function lookAt(today: boolean, x: number): void {
    marker.hidden = today;
    marker.style.left = `${x * 100}%`;
    back.hidden = today;
  }

  const frame = h(
    'div',
    { class: 'growth-frame' },
    plot,
    marker,
    goal,
    // In the first days the stream is a sliver at the edge; say what is coming.
    times[last] - history.since < 2 * DAY_MS &&
      h('p', { class: next ? 'growth-hint small under-goal' : 'growth-hint small', style: next ? { right: `${(1 - PAST) * 100 + 4}%` } : null }, 'This fills in day by day as your cards settle.'),
  );
  const pick = (e: PointerEvent) => {
    const box = frame.getBoundingClientRect();
    if (!box.width) return;
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    if (x > past && next) showAhead(Math.min(1, (x - past) / (1 - past)));
    else show(Math.round(Math.min(1, x / past) * last));
  };
  // A mouse looks by hovering. A finger looks by dragging sideways or tapping;
  // a drag that starts up or down is left to scroll the page.
  let touch: { x: number; y: number; scrub: boolean } | null = null;
  frame.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') pick(e);
    else touch = { x: e.clientX, y: e.clientY, scrub: false };
  });
  frame.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return pick(e);
    if (!touch) return;
    const dx = Math.abs(e.clientX - touch.x);
    const dy = Math.abs(e.clientY - touch.y);
    if (!touch.scrub && dy > 8 && dy >= dx) touch = null;
    else if (touch.scrub || (dx > 8 && dx > dy)) {
      touch.scrub = true;
      pick(e);
    }
  });
  frame.addEventListener('pointerup', (e) => {
    if (touch && !touch.scrub) pick(e);
    touch = null;
  });
  frame.addEventListener('pointercancel', () => {
    touch = null;
  });
  frame.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') show(last);
  });

  const mid = Math.round(last / 2);
  const el = h(
    'div',
    { class: 'growth' },
    h('div', { class: 'growth-caption' }, value, when, back),
    frame,
    h(
      'div',
      { class: 'growth-axis muted small', 'aria-hidden': 'true' },
      h(
        'span',
        { class: 'growth-axis-past', style: { width: `${past * 100}%` } },
        h('span', null, shortDate(times[0])),
        h('span', null, shortDate(times[mid])),
        h('span', null, 'Today'),
      ),
      next && h('span', { class: 'growth-axis-ahead' }, `~${monthYear(next.at)}`),
    ),
    ahead,
  );
  show(last);
  return el;
}
