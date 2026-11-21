// An experiment: when Study opens on a big backlog (after a few days away), a small burn-down under its header
// shows how far down the pile the session has come, on a true scale, and how many answers are done.
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

/**
 * Keep the latest count on the header's: it can change between answers (the sound turned off, a new day, caught up),
 * and the next answer's step should only show what that answer did.
 */
export function settleLeft(burn: BurnDown, left: number): void {
  burn.left[burn.left.length - 1] = left;
}

/**
 * The chart, on a true scale: up the side, nothing to the most cards left this session (labelled); along the
 * bottom, the answers so far and as many again as there are cards left, re-fitted after every answer. Behind the
 * latest answer, the cards left after each one, in saffron; ahead of it, hatched like Home's forecast, the way down
 * to nothing if every answer from here cleared a card. So three answers into a pile of 439 is a sliver at the left.
 * On a pile that size a single card is a fraction of a pixel: the chart shows how far down the pile has come, not
 * each answer, which the header's count does.
 */
export function burnDownChart(burn: BurnDown): HTMLElement {
  const { left } = burn;
  const done = left.length - 1;
  const now = left[done];
  const top = Math.max(...left, 1);
  // The answers so far, and at least as many again as there are cards left.
  const span = Math.max(done + now, 1);
  const yOf = (n: number) => f(H - (n / top) * H);
  const xOf = (i: number) => f((i / span) * W);
  // Level for each answer, then a step to the next count.
  let line = `M0,${yOf(left[0])}`;
  for (let i = 1; i <= done; i++) line += ` H${xOf(i)} V${yOf(left[i])}`;
  const here = `${xOf(done)},${yOf(now)}`;
  const ahead = `M${here} L${xOf(span)},${H}`;
  const plot = svg(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      class: 'burn-svg',
      role: 'img',
      'aria-label': `Cards left after each answer: ${left[0]} at the start, ${now} now, after ${done} ${done === 1 ? 'answer' : 'answers'}.`,
    },
    svg(
      'defs',
      {},
      svg(
        'pattern',
        { id: 'burn-hatch', patternUnits: 'userSpaceOnUse', width: 8, height: 8, patternTransform: 'rotate(45)' },
        svg('rect', { width: 4, height: 8, class: 'hatch' }),
      ),
    ),
    svg('path', { d: `${ahead} L${xOf(done)},${H} Z`, class: 'burn-ahead' }),
    done ? svg('path', { d: `${line} V${H} H0 Z`, class: 'burn-area' }) : '',
    svg('path', { d: `M0,${H} H${W}`, class: 'burn-base', 'vector-effect': 'non-scaling-stroke' }),
    svg('path', { d: ahead, class: 'burn-edge burn-ahead-edge', 'vector-effect': 'non-scaling-stroke' }),
    done ? svg('path', { d: line, class: 'burn-edge', 'vector-effect': 'non-scaling-stroke' }) : '',
  );
  return h(
    'div',
    { class: 'burn-down' },
    h('p', { class: 'burn-done' }, h('strong', null, String(done)), ' done'),
    h(
      'div',
      { class: 'burn-frame' },
      plot,
      // The scale, so a sliver reads as a sliver of the whole pile.
      h('span', { class: 'burn-scale top small', 'aria-hidden': 'true' }, String(top)),
      h('span', { class: 'burn-scale bottom small', 'aria-hidden': 'true' }, '0'),
    ),
  );
}

function f(n: number): string {
  return n.toFixed(1);
}
