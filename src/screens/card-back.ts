// The back of a drill card: how well it's known, turned over by a tap on the card (see promptBlock in
// guide-question.ts). Every way it's asked side by side, how long it has held over its life, how it fades until
// Study asks it again, and a few counts. All read from saved progress; nothing here is stored.

import { studyWays, type Card, type Way } from '../deck';
import { STRENGTHS, intervalSteps, lastSeen, recallChance, strengthOf } from '../memory';
import type { Progress } from '../progress-schema';
import { drillHelp, wayState } from '../session';
import { DAY_MS, MAX_HELP, answersOf, formatInterval, formatWait, type CardState } from '../srs';
import { h, svg } from '../ui';

const W = 300;
const H = 72;
const LABEL = new Map(STRENGTHS.map((s) => [s.id, s.label]));

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
  return h(
    'div',
    { class: 'card-back' },
    h('p', { class: 'back-title' }, 'How well you know it'),
    waysStrip(progress, card, way, ways),
    state && [
      !own && h('p', { class: 'back-note' }, `Study ${studyWays(card).includes(way) ? `hasn’t asked ${shown} yet` : `doesn’t ask ${shown}`}, so this is reading it.`),
      section(own ? `${shown}: how it has held` : 'How it has held', skyline(state, now)),
      section('How it fades till Study asks again', fading(state, now)),
      counts(state, now),
    ],
  );
}

function section(title: string, body: Element[]): HTMLElement {
  return h('div', { class: 'back-section' }, h('p', { class: 'back-label' }, title), ...body);
}

/** Every way the card is asked, each a block in its strength's colour, with a pip for each answer the drills had to help with lately. */
function waysStrip(progress: Progress, card: Card, asked: Way, ways: { id: Way; title: string }[]): HTMLElement {
  const read = progress.cards[card.id];
  return h(
    'div',
    { class: 'way-strip' },
    ways.map(({ id, title }) => {
      const state = wayState(progress, card, id);
      const strength = state && strengthOf(state);
      const help = drillHelp(read, id);
      const pips = Array.from({ length: MAX_HELP }, (_, i) => h('span', { class: `pip${i < help ? ' on' : ''}` }));
      const held = strength ? LABEL.get(strength)! : 'Not yet';
      return h(
        'div',
        {
          class: `way-tile ${strength ? `s-${strength}` : 'none'}${id === asked ? ' asked' : ''}`,
          role: 'img',
          'aria-label': `${title}: ${held}${help ? `, the drills helped ${help === 1 ? 'once' : `${help} times`} lately` : ''}${id === asked ? ', asked now' : ''}`,
        },
        h('span', { class: 'way-name' }, title),
        h('span', { class: 'way-held' }, held),
        h('span', { class: 'pips' }, pips),
      );
    }),
  );
}

/**
 * How long the card was expected to hold over its life, as a skyline: from the day it was met to now, each step as
 * high as its interval (on a log scale, so days and months both show) and in its strength's colour. A forgotten
 * card drops back to the ground.
 */
function skyline(state: CardState, now: number): Element[] {
  const steps = intervalSteps(state, now);
  const longest = Math.max(state.interval, ...steps.map(([, i]) => i));
  // The last step holds today's interval, which can have changed within one strength since the move was logged.
  steps[steps.length - 1] = [steps[steps.length - 1][0], state.interval];
  const start = steps[0][0];
  const span = Math.max(now - start, DAY_MS);
  // The tallest step reaches near the top, a week at the least, so a young card's days still stand up.
  const top = Math.log2(1 + Math.max(7, longest));
  const x = (t: number) => ((t - start) / span) * W;
  const y = (interval: number) => H - 6 - (Math.log2(1 + interval) / top) * (H - 12);
  const bars = steps.map(([at, interval], i) => {
    const from = x(at);
    const to = i + 1 < steps.length ? x(steps[i + 1][0]) : W;
    return svg('rect', {
      class: `step s-${strengthOf({ ...state, interval })}`,
      x: from.toFixed(1),
      y: y(interval).toFixed(1),
      width: Math.max(to - from, 2).toFixed(1),
      height: (H - y(interval)).toFixed(1),
    });
  });
  const edge = steps
    .map(([at, interval], i) => `${i ? 'L' : 'M'}${x(at).toFixed(1)},${y(interval).toFixed(1)} H${(i + 1 < steps.length ? x(steps[i + 1][0]) : W).toFixed(1)}`)
    .join(' ');
  const days = Math.floor((now - start) / DAY_MS);
  const label = `Over ${days ? `${days} days` : 'today'}, the longest it was expected to hold was ${formatInterval(longest)}; now ${formatInterval(state.interval)}.`;
  return [
    svg(
      'svg',
      { class: 'back-chart skyline', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
      ...bars,
      svg('path', { class: 'edge', d: edge }),
      svg('line', { class: 'ground', x1: 0, x2: W, y1: H - 1.5, y2: H - 1.5 }),
    ),
    h(
      'div',
      { class: 'back-axis' },
      h('span', null, days ? `Met ${formatWait(now - start)} ago` : 'Met today'),
      h('span', null, state.interval < 1 ? 'Still settling' : `Holds ${formatInterval(state.interval)} now`),
    ),
  ];
}

/**
 * The chance of remembering it from when it was last answered on to when Study asks it again and a little past, the
 * area under it in its strength's colour, a dot where it is now, and a hatched post where Study asks.
 */
function fading(state: CardState, now: number): Element[] {
  const seen = lastSeen(state, now);
  const until = Math.max(state.due, now);
  const end = seen + Math.max((until - seen) * 1.25, 60 * 60_000);
  const x = (t: number) => ((t - seen) / (end - seen)) * W;
  const y = (p: number) => H - 3 - p * (H - 8);
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = seen + ((end - seen) * i) / 48;
    return `${x(t).toFixed(1)},${y(recallChance(state, t)).toFixed(1)}`;
  });
  const chance = recallChance(state, now);
  const percent = Math.round(chance * 100);
  const strength = strengthOf(state);
  const due = x(state.due);
  const asks = state.due <= now ? 'Study asks it now' : `Study asks in ${formatWait(state.due - now)}`;
  return [
    svg(
      'svg',
      {
        class: 'back-chart fading',
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': `About ${percent}% likely to come to mind now. ${asks}.`,
      },
      svg('path', { class: `area s-${strength}`, d: `M0,${H} L${points.join(' L')} L${W},${H} Z` }),
      svg('path', { class: 'edge', d: `M${points.join(' L')}` }),
      // Drawn as strokes that don't scale, so the chart can stretch to the card's width and these keep their shape.
      svg('line', { class: 'post', x1: Math.min(due, W).toFixed(1), x2: Math.min(due, W).toFixed(1), y1: 0, y2: H }),
      svg('line', { class: 'ground', x1: 0, x2: W, y1: H - 1.5, y2: H - 1.5 }),
      ...['now-ring', 'now'].map((cls) => svg('line', { class: cls, x1: x(now).toFixed(1), x2: x(now).toFixed(1), y1: y(chance).toFixed(1), y2: y(chance).toFixed(1) })),
    ),
    h('div', { class: 'back-axis' }, h('span', null, `${percent}% likely now`), h('span', null, asks)),
  ];
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
    count(`${answers.count}${answers.atLeast ? '+' : ''}`, answers.count === 1 && !answers.atLeast ? 'answer in Study' : 'answers in Study'),
    count(String(lapses), lapses === 1 ? 'time forgotten' : 'times forgotten'),
    count(String(days), days === 1 ? 'day since you met' : 'days since you met'),
  );
}
