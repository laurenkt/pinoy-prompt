// The back of a drill card: how well it's known, turned over by a tap on the card (see promptBlock in
// guide-question.ts). It leads with the one number that matters (how likely it is to come to mind now), then explains
// it: how that fades until Study asks again, where each way it's asked stands on the ladder of strengths, how long it
// has lasted between reviews over its life, and a few counts. Every chart says in words what it shows and how to read
// it. All read from saved progress; nothing here is stored.

import { studyWays, type Card, type Way } from '../deck';
import { STRENGTHS, intervalSteps, lastSeen, recallChance, strengthOf } from '../memory';
import type { Progress } from '../progress-schema';
import { drillHelp, wayState } from '../session';
import { DAY_MS, answersOf, formatInterval, formatWait, type CardState } from '../srs';
import { h, svg } from '../ui';

const W = 300;
const H = 64;
const LABEL = new Map(STRENGTHS.map((s) => [s.id, s.label]));
const LEVEL = new Map(STRENGTHS.map((s, i) => [s.id, i]));
/** The skyline's gridlines, in days: ones past its top are left out, but a month is always shown. */
const MARKS: [number, string][] = [
  [1, '1d'],
  [7, '1w'],
  [30, '1mo'],
  [180, '6mo'],
  [365, '1y'],
];

/**
 * The back of `card`, asked `way` now, among `ways` (the ways Drills can ask it, with their names). A way Study
 * doesn't keep a schedule for (Speak, or one not started yet) is drawn from reading's, and says so.
 */
export function cardBack(progress: Progress, card: Card, way: Way, ways: { id: Way; title: string }[], now: number): HTMLElement {
  // A way only copied from reading's schedule when the ways were split has no past of its own yet.
  const found = wayState(progress, card, way);
  const own = found && !found.split ? found : undefined;
  const state = own ?? progress.cards[card.id];
  const shown = ways.find((w) => w.id === way)?.title ?? way;
  const read = ways.find((w) => w.id === 'read')?.title ?? 'Read';
  return h(
    'div',
    { class: 'card-back' },
    state && hero(state, now),
    state && !own && h('p', { class: 'back-note' }, `Study ${studyWays(card).includes(way) ? `hasn’t asked ${shown} yet` : `doesn’t ask ${shown}`}, so this is ${read}’s.`),
    state && fading(state, now),
    ladder(progress, card, way, ways),
    state && skyline(state, now),
    state && counts(state, now),
  );
}

/** The headline: how likely it is to come to mind now, and when Study asks it again. */
function hero(state: CardState, now: number): HTMLElement {
  const percent = Math.round(recallChance(state, now) * 100);
  return h(
    'div',
    { class: 'back-hero' },
    h('span', { class: 'hero-n' }, `${percent}%`),
    h(
      'p',
      { class: 'hero-text' },
      h('strong', null, 'chance it comes to mind now'),
      h('span', null, state.due <= now ? 'Study asks it again today.' : `Study asks it again in ${formatWait(state.due - now)}.`),
    ),
  );
}

/** A titled part of the back: what it shows in bold, then how to read it. */
function figure(title: string, how: string, ...body: (Element | false | undefined)[]): HTMLElement {
  return h('figure', { class: 'back-fig' }, h('figcaption', null, h('strong', { class: 'back-label' }, title), h('span', { class: 'back-how' }, how)), ...body);
}

/** A chart with its scale's labels in a gutter at the left, at the heights (0 at the bottom to 1 at the top) given. */
function plot(chart: Element, ticks: [number, string][]): HTMLElement {
  return h(
    'div',
    { class: 'back-plot' },
    h(
      'div',
      { class: 'back-ticks', 'aria-hidden': 'true' },
      ticks.map(([at, label]) => h('span', { style: { bottom: `${(at * 100).toFixed(1)}%` } }, label)),
    ),
    chart,
  );
}

function gridline(y: number): SVGElement {
  return svg('line', { class: 'grid', x1: 0, x2: W, y1: y.toFixed(1), y2: y.toFixed(1) });
}

/**
 * The chance of remembering it from when it was last answered on to when Study asks it again and a little past: a
 * line over a wash in its strength's colour, a dot where it is now, and a saffron post where Study asks.
 */
function fading(state: CardState, now: number): HTMLElement {
  const seen = lastSeen(state, now);
  const until = Math.max(state.due, now);
  // A day at the least, so a card asked again within the hour still shows how it would fade.
  const end = seen + Math.max((until - seen) * 1.2, DAY_MS);
  const x = (t: number) => ((t - seen) / (end - seen)) * W;
  const y = (p: number) => H - p * H;
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = seen + ((end - seen) * i) / 48;
    return `${x(t).toFixed(1)},${y(recallChance(state, t)).toFixed(1)}`;
  });
  const chance = recallChance(state, now);
  const strength = strengthOf(state);
  const due = Math.min(x(state.due), W).toFixed(1);
  const overdue = state.due <= now;
  const asks = overdue ? 'Study asks it now' : `Study asks in ${formatWait(state.due - now)}`;
  const chart = svg(
    'svg',
    {
      class: 'back-chart fading',
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `About ${Math.round(chance * 100)}% likely to come to mind now, falling since it was last answered ${formatWait(now - seen)} ago. ${asks}.`,
    },
    gridline(0),
    gridline(H / 2),
    svg('path', { class: `area s-${strength}`, d: `M0,${H} L${points.join(' L')} L${W},${H} Z` }),
    svg('path', { class: `line s-${strength}`, d: `M${points.join(' L')}` }),
    svg('line', { class: 'ground', x1: 0, x2: W, y1: H, y2: H }),
    // Drawn as strokes that don't scale, so the chart can stretch to the card's width and these keep their shape.
    svg('line', { class: 'post', x1: due, x2: due, y1: 0, y2: H }),
    ...['now-ring', 'now'].map((cls) => svg('line', { class: cls, x1: x(now).toFixed(1), x2: x(now).toFixed(1), y1: y(chance).toFixed(1), y2: y(chance).toFixed(1) })),
  );
  return figure(
    'It fades between reviews',
    'The chance it comes to mind, falling till Study asks. Each review lifts it and slows the next fall.',
    plot(chart, [
      [1, '100%'],
      [0.5, '50%'],
    ]),
    h(
      'div',
      { class: 'back-axis' },
      h('span', null, `Answered ${formatWait(now - seen)} ago`),
      h('span', { class: 'back-key' }, h('i', { class: 'key-now' }), 'Now'),
      h('span', { class: 'back-key' }, h('i', { class: 'key-post' }), overdue ? 'Study’s due' : 'Study asks'),
    ),
  );
}

/**
 * Every way the card is asked, each a row on the ladder of strengths (Just met to Long-term), filled up to where it
 * stands in each rung's colour, with the way asked now marked. Then, in words, the ways the drills had to help with.
 */
function ladder(progress: Progress, card: Card, asked: Way, ways: { id: Way; title: string }[]): HTMLElement {
  const read = progress.cards[card.id];
  const helped = ways.map(({ id, title }) => [title, drillHelp(read, id)] as const).filter(([, n]) => n);
  return figure(
    'Each way it’s asked',
    'Further right holds longer before Study asks again.',
    h(
      'div',
      { class: 'ladder' },
      h('span'),
      STRENGTHS.map((s) => h('span', { class: 'rung-name', 'aria-hidden': 'true' }, s.label)),
      ways.map(({ id, title }) => {
        const state = wayState(progress, card, id);
        const strength = state && strengthOf(state);
        const level = strength ? LEVEL.get(strength)! : -1;
        const help = drillHelp(read, id);
        const held = strength ? LABEL.get(strength)! : 'Not started yet';
        return h(
          'div',
          {
            class: `way-tile ${strength ? `s-${strength}` : 'none'}${id === asked ? ' asked' : ''}`,
            role: 'img',
            'aria-label': `${title}: ${held}${help ? `, the drills helped ${help === 1 ? 'once' : `${help} times`} lately` : ''}${id === asked ? ', asked now' : ''}`,
          },
          h('span', { class: 'way-name' }, title),
          strength
            ? STRENGTHS.map((s, i) => h('span', { class: `rung${i <= level ? ` on s-${s.id}` : ''}` }))
            : h('span', { class: 'rung-none' }, 'Not started yet'),
        );
      }),
    ),
    helped.length > 0 &&
      h(
        'p',
        { class: 'back-help' },
        `Lately the drills had to help with ${list(helped.map(([title, n]) => `${title} ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}`))}.`,
      ),
  );
}

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * How long the card was expected to hold over its life, as a skyline: from the day it was met to now, each step as
 * high as its interval (on a log scale, gridlined at a day, a week and a month, so days and months both show) and in
 * its strength's colour. A forgotten card drops back to the ground.
 */
function skyline(state: CardState, now: number): HTMLElement {
  const steps = intervalSteps(state, now);
  const longest = Math.max(state.interval, ...steps.map(([, i]) => i));
  // The last step holds today's interval, which can have changed within one strength since the move was logged.
  steps[steps.length - 1] = [steps[steps.length - 1][0], state.interval];
  const start = steps[0][0];
  const span = Math.max(now - start, DAY_MS);
  const top = Math.log2(1 + Math.max(30, longest) * 1.15);
  const height = (interval: number) => Math.log2(1 + interval) / top;
  const x = (t: number) => ((t - start) / span) * W;
  const bars = steps.map(([at, interval], i) => {
    const from = x(at);
    const to = i + 1 < steps.length ? x(steps[i + 1][0]) - 2 : W;
    const tall = Math.max(height(interval) * H, 4);
    return svg('rect', {
      class: `step s-${strengthOf({ ...state, interval })}`,
      x: from.toFixed(1),
      y: (H - tall).toFixed(1),
      width: Math.max(to - from, 2).toFixed(1),
      height: tall.toFixed(1),
    });
  });
  const marks = MARKS.filter(([days]) => height(days) <= 1).map(([days, label]): [number, string] => [height(days), label]);
  const days = Math.floor((now - start) / DAY_MS);
  const label = `Over ${days ? `${days} days` : 'today'}, the longest it was expected to hold was ${formatInterval(longest)}; now ${formatInterval(state.interval)}.`;
  const chart = svg(
    'svg',
    { class: 'back-chart skyline', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    ...marks.map(([at]) => gridline(H - at * H)),
    ...bars,
    svg('line', { class: 'ground', x1: 0, x2: W, y1: H, y2: H }),
  );
  return figure(
    'How long it lasts',
    'How long Study waits to ask again. Good answers stretch it; forgetting drops it.',
    plot(chart, marks),
    h(
      'div',
      { class: 'back-axis' },
      h('span', null, days ? `Met ${formatWait(now - start)} ago` : 'Met today'),
      h('span', null, state.interval < 1 ? 'Still settling in' : `Now ${formatInterval(state.interval)}`),
    ),
  );
}

/** Big numbers: answers in Study, times forgotten, days since it was met. */
function counts(state: CardState, now: number): HTMLElement {
  const answers = answersOf(state);
  // A way only copied from reading's schedule carries reading's lapses too, not its own.
  const lapses = state.split ? 0 : state.lapses;
  const days = Math.floor((now - Math.min(state.introduced, now)) / DAY_MS);
  const count = (n: string, label: string) => h('div', { class: 'count' }, h('span', { class: 'count-n' }, n), h('span', { class: 'count-label' }, label));
  return h(
    'div',
    { class: 'counts' },
    count(`${answers.count}${answers.atLeast ? '+' : ''}`, answers.count === 1 && !answers.atLeast ? 'answer' : 'answers'),
    count(String(lapses), 'forgotten'),
    count(String(days), days === 1 ? 'day known' : 'days known'),
  );
}
