// An experiment: when Study opens on a big backlog (after a few days away), a small burn-down under its header
// shows the cards left after every answer, which can rise as missed cards come back, and how many are done.
// Self-contained so it can be taken out again: Study's screen only starts it and feeds it its own count.

import { svg, h } from '../ui';

/** A session that opens with at least this many cards left gets the chart. */
export const BIG_BACKLOG = 50;

const W = 320;
const H = 100;

/** The cards left after each answer, starting from what the session opened with. */
export type BurnDown = { left: number[] };

/** A record to keep for this session, or null when it opened small enough not to need one. */
export function startBurnDown(left: number): BurnDown | null {
  return left >= BIG_BACKLOG ? { left: [left] } : null;
}

/** Note the count after an answer. */
export function noteLeft(burn: BurnDown, left: number): void {
  burn.left.push(left);
}

/** Caught up means nothing is left, as the header says, even if the last count still held a way it won't ask yet. */
export function caughtUp(burn: BurnDown): void {
  if (burn.left.length > 1) burn.left[burn.left.length - 1] = 0;
}

/** The fewest answers the chart spans, so the first few don't each stretch across the whole width. */
const MIN_SPAN = 20;
/** The fewest cards the chart's height spans, so one card more or less is a small step, not a cliff. */
const MIN_RANGE = 20;

/**
 * The chart: cards left after each answer, a step per answer, so each one shows whether the pile went down or a
 * missed card came back. Its height spans the counts this session has seen rather than starting from nothing, so the
 * steps can be told apart on a pile of a hundred or more; the dashed line is where the session started. It spans
 * the answers so far (at least MIN_SPAN), filling out as the session goes on.
 */
export function burnDownChart(burn: BurnDown): HTMLElement {
  const { left } = burn;
  const done = left.length - 1;
  const now = left[done];
  const span = Math.max(done, MIN_SPAN);
  const low = Math.min(...left);
  const high = Math.max(...left, low + MIN_RANGE);
  // A little room above and below, so the outline at either end isn't clipped.
  const pad = (high - low) * 0.1;
  const yOf = (n: number) => f(H - ((n - low + pad) / (high - low + 2 * pad)) * H);
  const xOf = (i: number) => f((i / span) * W);
  // Level for each answer, then a step to the next count.
  let line = `M0,${yOf(left[0])}`;
  for (let i = 1; i <= done; i++) line += ` H${xOf(i)} V${yOf(left[i])}`;
  const end = xOf(Math.max(done, 0.5));
  if (!done) line += ` H${end}`;
  const plot = svg(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      class: 'burn-svg',
      role: 'img',
      'aria-label': `Cards left after each answer: ${left[0]} at the start, ${now} now.`,
    },
    svg('path', { d: `${line} V${H} H0 Z`, class: 'burn-area' }),
    svg('path', { d: `M0,${yOf(left[0])} H${W}`, class: 'burn-start', 'vector-effect': 'non-scaling-stroke' }),
    svg('path', { d: line, class: 'burn-edge', 'vector-effect': 'non-scaling-stroke' }),
  );
  return h(
    'div',
    { class: 'burn-down' },
    h('p', { class: 'burn-done' }, h('strong', null, String(done)), ' done', h('span', { class: 'small' }, `from ${left[0]}`)),
    h('div', { class: 'burn-frame' }, plot),
  );
}

function f(n: number): string {
  return n.toFixed(1);
}
