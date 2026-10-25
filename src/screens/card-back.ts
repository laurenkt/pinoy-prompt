// The back of a drill card: how well it's known, turned over by a tap on the card (see promptBlock in
// guide-question.ts). A dial leads with the one number that matters, how likely it is to come to mind now; then three
// pictures explain it, each under a plain title and a short line on how to read it: the slope a memory slides down
// until Study asks again, the stairs each way it's asked climbs as it sticks for longer, and a skyline of the gaps
// between reviews over its life. Then a few counts. All read from saved progress; nothing here is stored.

import { studyWays, type Card, type Way } from '../deck';
import { STRENGTHS, intervalSteps, lastSeen, recallChance, strengthOf, type Strength } from '../memory';
import type { Progress } from '../progress-schema';
import { drillHelp, wayState, type DrillOdds } from '../session';
import { DAY_MS, MINUTE_MS, answersOf, formatInterval, formatWait, type CardState } from '../srs';
import { h, svg } from '../ui';

const LABEL = new Map(STRENGTHS.map((s) => [s.id, s.label]));
/** The width of every picture's viewBox, and of the gutter at its left that holds its scale. */
const W = 300;
const GUTTER = 36;
/** The skyline's gridlines, in days: ones past its top are left out, but a month is always shown. */
const MARKS: [number, string][] = [
  [1, '1d'],
  [7, '1w'],
  [30, '1mo'],
  [365, '1y'],
];

const f = (n: number) => n.toFixed(1);

/**
 * The back of `card`, asked `way` now, among `ways` (the ways Drills can ask it, with their names). A way Study
 * doesn't keep a schedule for (Speak, or one not started yet) is drawn from reading's, and says so. `drills` gives the
 * chance of each question Drills could ask at a time (drillOdds, as this round would pick them), for how often it
 * picks this card.
 */
export function cardBack(
  progress: Progress,
  card: Card,
  way: Way,
  ways: { id: Way; title: string }[],
  now: number,
  drills?: (at: number) => DrillOdds[],
): HTMLElement {
  // A way only copied from reading's schedule when the ways were split has no past of its own yet.
  const found = wayState(progress, card, way);
  const own = found && !found.split ? found : undefined;
  const state = own ?? progress.cards[card.id];
  const shown = ways.find((w) => w.id === way)?.title ?? way;
  const read = ways.find((w) => w.id === 'read')?.title ?? 'Read';
  return h(
    'div',
    { class: 'card-back' },
    state && !own && h('p', { class: 'back-note' }, `Study ${studyWays(card).includes(way) ? `hasn’t asked ${shown} yet` : `doesn’t ask ${shown}`}, so these are ${read}’s numbers.`),
    state && hero(state, own ? shown : read, now),
    state && slope(state, now),
    state && drills && picks(card, state, ways, now, drills),
    stairs(progress, card, way, ways),
    state && skyline(state, now),
    state && counts(state, now),
  );
}

/** A titled picture: what it shows in bold, how to read it, then the picture in a frame. */
function figure(title: string, how: string, picture: Element, ...after: (Element | false)[]): HTMLElement {
  return h(
    'figure',
    { class: 'back-fig' },
    h('figcaption', null, h('strong', { class: 'back-label' }, title), h('span', { class: 'back-how' }, how)),
    h('div', { class: 'back-frame' }, picture),
    ...after,
  );
}

function picture(cls: string, height: number, label: string, ...children: SVGElement[]): SVGElement {
  return svg('svg', { class: `back-chart ${cls}`, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label }, ...children);
}

function text(cls: string, x: number, y: number, anchor: 'start' | 'middle' | 'end', words: string): SVGElement {
  const el = svg('text', { class: cls, x: f(x), y: f(y), 'text-anchor': anchor });
  el.textContent = words;
  return el;
}

/** Where a label goes beside x in a picture: centred on it, unless that would run off an edge. */
function anchorAt(x: number, room = 40): 'start' | 'middle' | 'end' {
  return x < GUTTER + room ? 'start' : x > W - room ? 'end' : 'middle';
}

/** The headline: a dial of how likely it is to come to mind now, asked `title`'s way, and when Study asks it again. */
function hero(state: CardState, title: string, now: number): HTMLElement {
  const chance = recallChance(state, now);
  const percent = Math.round(chance * 100);
  // A half circle from the left (0) over the top to the right (100%), with a needle at the chance.
  const arc = 'M10,60 A50,50 0 0 1 110,60';
  const angle = Math.PI * (1 - chance);
  const dial = svg(
    'svg',
    { class: 'gauge', viewBox: '0 0 120 68', 'aria-hidden': 'true' },
    svg('path', { class: 'gauge-rim', d: arc }),
    svg('path', { class: 'gauge-track', d: arc }),
    // Nothing at 0%: a dash of no length would still draw a round cap.
    ...(percent > 0 ? [svg('path', { class: `gauge-fill s-${strengthOf(state)}`, d: arc, pathLength: 100, 'stroke-dasharray': `${percent} 100` })] : []),
    svg('line', { class: 'gauge-needle', x1: 60, y1: 60, x2: f(60 + 38 * Math.cos(angle)), y2: f(60 - 38 * Math.sin(angle)) }),
    svg('circle', { class: 'gauge-hub', cx: 60, cy: 60, r: 6 }),
  );
  return h(
    'div',
    { class: 'back-hero' },
    dial,
    h(
      'p',
      { class: 'hero-text' },
      h('span', { class: 'hero-way' }, title),
      h('span', { class: 'hero-n' }, `${percent}%`),
      h('strong', null, 'chance it comes to mind now'),
      h('span', null, state.due <= now ? 'Study asks it again now.' : `Study asks it again in ${formatWait(state.due - now)}.`),
    ),
  );
}

/**
 * The chance of remembering it from when it was last answered on to when Study asks it again and a little past, as
 * a hill in its strength's colour that the card slides down: a ball where it is now, a flag where Study asks.
 */
function slope(state: CardState, now: number): HTMLElement {
  const H = 112;
  const top = 26;
  const base = H - 4;
  const seen = lastSeen(state, now);
  const until = Math.max(state.due, now);
  // A day at the least, so a card asked again within the hour still shows how it would fade.
  const end = seen + Math.max((until - seen) * 1.2, DAY_MS);
  // Clear of the scale, so a ball at the very start doesn't sit on it.
  const left = GUTTER + 8;
  const x = (t: number) => left + ((t - seen) / (end - seen)) * (W - left);
  const y = (p: number) => base - p * (base - top);
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = seen + ((end - seen) * i) / 48;
    return `${f(x(t))},${f(y(recallChance(state, t)))}`;
  });
  const chance = recallChance(state, now);
  const percent = Math.round(chance * 100);
  const strength = strengthOf(state);
  const ball = { x: x(now), y: y(chance) };
  const flag = Math.min(x(state.due), W - 2);
  // The flag flies away from the edge it's near; its words sit beside it, the same side.
  const side = flag > W - 90 ? -1 : 1;
  const asks = state.due <= now ? 'Study asks it now' : `Study asks in ${formatWait(state.due - now)}`;
  // The ball's words go under it, on the hill, unless it has slid too near the ground.
  const under = base - ball.y > 30;
  return figure(
    'Memories slide out of your mind',
    'The hill is the chance you’d remember it. The ball is today; the flag is when Study asks.',
    picture(
      'slope',
      H,
      `About ${percent}% likely to come to mind now, sliding since it was last answered ${ago(now - seen)}. ${asks}.`,
      svg('line', { class: 'grid', x1: GUTTER, x2: W, y1: f(y(1)), y2: f(y(1)) }),
      svg('line', { class: 'grid', x1: GUTTER, x2: W, y1: f(y(0.5)), y2: f(y(0.5)) }),
      text('tick', GUTTER - 6, y(1) + 4, 'end', '100%'),
      text('tick', GUTTER - 6, y(0.5) + 4, 'end', '50%'),
      svg('path', { class: `hill s-${strength}`, d: `M${f(left)},${base} L${points.join(' L')} L${W},${base} Z` }),
      svg('line', { class: 'pole', x1: f(flag), x2: f(flag), y1: 6, y2: base }),
      svg('path', { class: 'flag', d: `M${f(flag)},6 l${side * 16},6 l${-side * 16},6 Z` }),
      text('flag-label', flag + side * 20, 16, side > 0 ? 'start' : 'end', 'Study asks'),
      svg('circle', { class: 'ball', cx: f(ball.x), cy: f(ball.y), r: 7 }),
      text(under ? 'on-hill' : 'over-hill', ball.x + { start: 8, middle: 0, end: -8 }[anchorAt(ball.x)], under ? ball.y + 22 : ball.y - 12, anchorAt(ball.x), 'now'),
    ),
    h('div', { class: 'back-axis' }, h('span', null, `Answered ${ago(now - seen)}`)),
  );
}

/** A chance as a percent: to a tenth below 1%, so a small one doesn't read as none. */
function percentOf(chance: number): string {
  return chance < 0.01 ? `${(Math.round(chance * 1000) / 10).toFixed(1)}%` : `${Math.round(chance * 100)}%`;
}

/**
 * How often Drills picks the card: the chance any one question is this card, any way (from drillOdds, the chances
 * pickDrillCard draws by), from now on to a little past when Study asks again, if it isn't reviewed before then. As a
 * line over a wash, with the chance now and at the end labelled, and how it splits between the ways asked under it.
 */
function picks(card: Card, state: CardState, ways: { id: Way; title: string }[], now: number, drills: (at: number) => DrillOdds[]): HTMLElement {
  const H = 84;
  const top = 18;
  const base = H - 4;
  const end = now + Math.min(Math.max((Math.max(state.due, now) - now) * 1.2, 7 * DAY_MS), 90 * DAY_MS);
  const chanceAt = (at: number) => {
    const odds = drills(at).filter((o) => o.pick.card.id === card.id);
    return { all: odds.reduce((sum, o) => sum + o.chance, 0), odds };
  };
  const samples = Array.from({ length: 13 }, (_, i) => {
    const at = now + ((end - now) * i) / 12;
    return [at, chanceAt(at).all] as const;
  });
  const [, first] = samples[0];
  const [, last] = samples[samples.length - 1];
  const highest = Math.max(...samples.map(([, c]) => c), 0.001);
  const x = (t: number) => GUTTER + ((t - now) / (end - now)) * (W - GUTTER);
  const y = (c: number) => base - (c / (highest * 1.15)) * (base - top);
  const points = samples.map(([at, c]) => `${f(x(at))},${f(y(c))}`);
  const split = chanceAt(now)
    .odds.filter((o) => o.chance > 0)
    .sort((a, b) => b.chance - a.chance)
    .map((o) => `${ways.find((w) => w.id === o.pick.way)?.title ?? o.pick.way} ${percentOf(o.chance)}`);
  const later = formatWait(end - now);
  const oneIn = (chance: number) => Math.round(1 / chance);
  // Within a tenth either way reads as no change.
  const trend =
    first === 0 ? '' : Math.abs(last - first) <= first / 10 ? `, about the same in ${later}` : `, ${last > first ? 'rising' : 'falling'} to 1 in ${oneIn(last)} in ${later}`;
  return figure(
    'How often Drills picks it',
    'The chance a drill question is this card, from now on if you don’t review it.',
    picture(
      'picks',
      H,
      `About ${percentOf(first)} of drill questions are this card now${split.length > 1 ? ` (${split.join(', ')})` : ''}; ${percentOf(last)} in ${later} if it isn't reviewed.`,
      svg('line', { class: 'grid', x1: GUTTER, x2: W, y1: f(y(highest)), y2: f(y(highest)) }),
      text('tick', GUTTER - 6, y(highest) + 4, 'end', percentOf(highest)),
      svg('path', { class: 'hill picks-area', d: `M${GUTTER},${base} L${points.join(' L')} L${W},${base} Z` }),
      svg('line', { class: 'ground', x1: GUTTER, x2: W, y1: base, y2: base }),
      svg('circle', { class: 'ball', cx: f(x(now)), cy: f(y(first)), r: 6 }),
      text('over-hill', x(now) + 10, y(first) - 10, 'start', `${percentOf(first)} now`),
      text('over-hill', W - 2, y(last) - 10, 'end', `${percentOf(last)} in ${later}`),
    ),
    h('div', { class: 'back-axis' }, h('span', null, 'Today'), h('span', null, `In ${later}`)),
    h('p', { class: 'back-help back-odds' }, first > 0 ? `About 1 in ${oneIn(first)} drill questions is this card now${trend}.` : 'This round’s drills don’t ask it.'),
    split.length > 1 && h('p', { class: 'back-help back-split' }, `By way: ${split.join(' · ')}`),
  );
}

/**
 * Every way the card is asked as a tag on a staircase of strengths: on the ground until Study has asked it, then a
 * step up for each strength it reaches, Just met to Long-term. The way asked now is in saffron, labelled. Then, in words,
 * the ways the drills had to help with.
 */
function stairs(progress: Progress, card: Card, asked: Way, ways: { id: Way; title: string }[]): HTMLElement {
  const column = W / (STRENGTHS.length + 1);
  const rise = 16;
  const tag = { width: 56, height: 20, gap: 4 };
  const read = progress.cards[card.id];
  const placed = ways.map(({ id, title }) => {
    const state = wayState(progress, card, id);
    return { id, title, strength: state && strengthOf(state), help: drillHelp(read, id) };
  });
  const level = (strength: Strength | undefined) => (strength ? STRENGTHS.findIndex((s) => s.id === strength) + 1 : 0);
  // Tags stand in a pile on their step, so the picture is as tall as the highest pile.
  // The way asked now goes on top of its pile, so its label above it has room.
  const order = [...placed.filter((p) => p.id !== asked), ...placed.filter((p) => p.id === asked)];
  const piles = order.map((p) => ({ ...p, at: level(p.strength), n: order.filter((q) => level(q.strength) === level(p.strength)).indexOf(p) }));
  const lift = 16;
  const tallest = Math.max(...piles.map((p) => p.at * rise + (p.n + 1) * (tag.height + tag.gap) + (p.id === asked ? lift : 0)));
  const base = tallest + 8;
  const H = base + 20;
  const steps = STRENGTHS.map((s, i) =>
    svg('rect', { class: `stair s-${s.id}`, x: f(column * (i + 1)), y: f(base - rise * (i + 1)), width: f(column), height: f(rise * (i + 1)) }),
  );
  const names = ['Not yet', ...STRENGTHS.map((s) => s.label)].map((name, i) => text('tick', column * (i + 0.5), H - 4, 'middle', name));
  const tags = piles.flatMap(({ id, title, at, n }) => {
    const cx = column * (at + 0.5);
    const y = base - rise * at - (n + 1) * (tag.height + tag.gap);
    const cls = id === asked ? ' asked' : '';
    return [
      svg('rect', { class: `tag${cls}`, x: f(cx - tag.width / 2), y: f(y), width: tag.width, height: tag.height, rx: 10 }),
      text(`tag-name${cls}`, cx, y + 14, 'middle', title),
      ...(cls ? [text('asked-label', cx, y - 6, 'middle', 'asked now')] : []),
    ];
  });
  const helped = placed.filter((p) => p.help);
  const label = placed
    .map(({ id, title, strength, help }) => `${title}: ${strength ? LABEL.get(strength) : 'not started yet'}${help ? `, the drills helped ${times(help)} lately` : ''}${id === asked ? ', asked now' : ''}`)
    .join('. ');
  return figure(
    'Learning is like climbing stairs',
    'Each way you’re asked climbs as it sticks for longer.',
    picture('stairs', H, `${label}.`, svg('line', { class: 'ground', x1: 0, x2: W, y1: base, y2: base }), ...steps, ...names, ...tags),
    helped.length > 0 && h('p', { class: 'back-help back-helped' }, `Lately the drills had to help with ${list(helped.map((p) => `${p.title} ${times(p.help)}`))}.`),
  );
}

/**
 * The gaps Study left between reviews over the card's life, as a skyline: from the day it was met to now, a building
 * for each stretch at one strength, as tall as the wait (on a log scale, gridlined at a day, a week and a month, so
 * days and months both show) and in that strength's colour. A forgotten card drops back to the ground.
 */
function skyline(state: CardState, now: number): HTMLElement {
  const H = 104;
  const base = H - 4;
  const roof = 10;
  const steps = intervalSteps(state, now);
  const longest = Math.max(state.interval, ...steps.map(([, i]) => i));
  // The last step holds today's interval, which can have changed within one strength since the move was logged.
  steps[steps.length - 1] = [steps[steps.length - 1][0], state.interval];
  const start = steps[0][0];
  const span = Math.max(now - start, DAY_MS);
  const top = Math.log2(1 + Math.max(30, longest) * 1.15);
  const y = (interval: number) => base - (Math.log2(1 + interval) / top) * (base - roof);
  const x = (t: number) => GUTTER + ((t - start) / span) * (W - GUTTER);
  const marks = MARKS.filter(([days]) => y(days) >= roof);
  const buildings = steps.flatMap(([at, interval], i) => {
    // A step taken just now still stands, as a sliver at the right edge.
    const from = Math.min(x(at) + (i ? 1 : 0), W - 3);
    const to = i + 1 < steps.length ? x(steps[i + 1][0]) - 1 : W;
    const width = Math.max(to - from, 3);
    // Still settling in stands a little off the ground, so it shows.
    const roofY = Math.min(y(interval), base - 5);
    const lit: SVGElement[] = [];
    // Windows, in rows, on buildings wide and tall enough to have them.
    for (let wy = roofY + 7; base - roofY > 24 && wy + 6 < base - 4; wy += 11) {
      for (let wx = from + 6; wx + 5 < from + width - 4; wx += 12) lit.push(svg('rect', { class: 'window', x: f(wx), y: f(wy), width: 5, height: 6 }));
    }
    return [svg('rect', { class: `building s-${strengthOf({ ...state, interval })}`, x: f(from), y: f(roofY), width: f(width), height: f(base - roofY), rx: 2 }), ...lit];
  });
  const days = Math.floor((now - start) / DAY_MS);
  const label = `Over ${days ? `${days} days` : 'today'}, the longest Study waited was ${formatInterval(longest)}; now ${formatInterval(state.interval)}.`;
  return figure(
    'Gaps between reviews',
    'Study waits longer each time you remember it. A drop means you forgot.',
    picture(
      'skyline',
      H,
      label,
      ...marks.flatMap(([days, mark]) => [
        svg('line', { class: 'grid', x1: GUTTER, x2: W, y1: f(y(days)), y2: f(y(days)) }),
        text('tick', GUTTER - 6, y(days) + 4, 'end', mark),
      ]),
      svg('line', { class: 'ground', x1: GUTTER, x2: W, y1: base, y2: base }),
      ...buildings,
    ),
    h(
      'div',
      { class: 'back-axis' },
      h('span', null, 'First seen'),
      h('span', null, state.interval < 1 ? 'Today: still settling in' : `Study waits ${formatInterval(state.interval)} now`),
    ),
  );
}

/** Big numbers, each under the words saying what it counts: reviews in Study, times forgotten there, how long it has been known. */
function counts(state: CardState, now: number): HTMLElement {
  const answers = answersOf(state);
  // A way only copied from reading's schedule carries reading's lapses too, not its own.
  const lapses = state.split ? 0 : state.lapses;
  const days = Math.floor((now - Math.min(state.introduced, now)) / DAY_MS);
  const count = (label: string, n: string, unit: string) =>
    h('div', { class: 'count' }, h('span', { class: 'count-label' }, label), h('span', { class: 'count-value' }, h('span', { class: 'count-n' }, n), ` ${unit}`));
  return h(
    'div',
    { class: 'counts' },
    count('Reviewed in Study', `${answers.count}${answers.atLeast ? '+' : ''}`, answers.count === 1 && !answers.atLeast ? 'time' : 'times'),
    count('Forgotten in Study', String(lapses), lapses === 1 ? 'time' : 'times'),
    count('Known for', String(days), days === 1 ? 'day' : 'days'),
  );
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** How long ago, rounded down (formatWait rounds up, for a wait still to come), so it agrees with the days counted. */
function ago(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / MINUTE_MS));
  const days = Math.floor(ms / DAY_MS);
  const since = minutes < 60 ? `${minutes}m` : days < 1 ? `${Math.floor(minutes / 60)}h` : days < 30 ? `${days}d` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
  return `${since} ago`;
}

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
