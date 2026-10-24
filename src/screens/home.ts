import type { App } from '../app';
import {
  MIN_MEASURED_REVIEWS,
  STRENGTHS,
  forecast,
  memoryHistory,
  memorySummary,
  type Forecast,
  type MemoryHistory,
  type MemorySummary,
  type Strength,
} from '../memory';
import { MAX_LEARNING, abilities, learningCount, newCardsLeftToday, nextStudyAt, studyQueue, upcomingNewCards, upcomingWays } from '../session';
import { canPlay } from '../speech';
import { DAY_MS, formatInterval } from '../srs';
import { rollDay } from '../store';
import { h, icon, settingsToggle } from '../ui';
import { growthChart } from './growth-chart';
import { quietToggle } from './quiet';

/** A Tagalog greeting for the time of day. */
function greeting(hour: number): { tl: string; en: string } {
  if (hour < 12) return { tl: 'Magandang umaga!', en: 'Good morning!' };
  if (hour < 13) return { tl: 'Magandang tanghali!', en: 'Good noon!' };
  if (hour < 18) return { tl: 'Magandang hapon!', en: 'Good afternoon!' };
  return { tl: 'Magandang gabi!', en: 'Good evening!' };
}

export function homeScreen(app: App): HTMLElement {
  const { progress } = app;
  const now = app.now();
  const hello = greeting(new Date(now).getHours());
  const memory = memorySummary(progress, now);
  const isFirstRun = memory.total === 0;

  const memoryEl = isFirstRun ? null : memoryCard(memory, memoryHistory(progress, now), forecast(progress, now));
  // Only its numbers, not the chart, which a finger may be scrubbing.
  const redrawMemory = () => {
    const facts = memoryEl?.querySelector('.coming');
    if (facts) facts.textContent = memoryFacts(memorySummary(app.progress, app.now()));
  };

  // The last word of the greeting gets the accent color.
  const split = hello.tl.lastIndexOf(' ');

  return h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'home-header' },
      // Settings above quiet mode, at the right, with the greeting flowing around them: its first word keeps the width
      // beside Settings, and the wider quiet mode sits beside the shorter last word, so Home still fits one screen.
      settingsToggle(app, false),
      quietSwitch(app),
      h('h1', { class: 'greeting', lang: 'fil' }, hello.tl.slice(0, split + 1), h('span', { class: 'accent' }, hello.tl.slice(split + 1))),
      h('p', { class: 'muted' }, hello.en),
    ),

    isFirstRun ? welcomeCard() : null,
    h(
      'nav',
      { class: 'hub', 'aria-label': 'Main' },
      // When what's due changes, so do the memory card's numbers, which would otherwise count a card twice.
      liveStudyButton(app, isFirstRun, redrawMemory),
      h(
        'button',
        { class: 'hub-btn big chat-btn', 'data-tap': 'before', onclick: () => app.navigate({ name: 'talk', start: true }) },
        icon('mic'),
        h('span', { class: 'hub-title' }, 'Chat'),
      ),
      // It may open the microphone, so its tap sounds first (docs/ARCHITECTURE.md, "Audio").
      h('button', { class: 'hub-btn drills-btn', 'data-tap': 'before', onclick: () => app.navigate({ name: 'practice' }) }, h('span', { class: 'hub-title' }, 'Drills')),
      h('button', { class: 'hub-btn library-btn', onclick: () => app.navigate({ name: 'words' }) }, h('span', { class: 'hub-title' }, 'Library')),
    ),
    memoryEl,
  );
}

/** The mic and sound toggle, redrawn in place so the page doesn't jump. */
function quietSwitch(app: App): HTMLElement {
  const el: HTMLElement = quietToggle(app, () => el.replaceWith(quietSwitch(app)));
  return el;
}

function welcomeCard(): HTMLElement {
  return h(
    'section',
    { class: 'card welcome' },
    h('h2', null, 'Mabuhay! Welcome'),
    h('p', null, 'Tap Study to meet your first words. Each card comes back right before you would forget it.'),
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A short wait, e.g. "25m", "3h", "2d", "2mo": rounded up, so the learner never comes back to find nothing yet. */
function waitLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return formatInterval(Math.ceil(hours / 24), { up: true });
}

/** The one Home's Study button waits on, so a Home drawn again doesn't leave an older one running. */
let studyTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The Study button, brought up to date in place whenever what it says changes (a card falls due, the wait ticks
 * down, a new day brings new cards) for as long as Home is on show, so it never says "Next in 25m" half an hour later.
 * In place, so a finger or focus on it stays there; `changed` is told when it says something new. While the app is
 * hidden it stops: main.ts draws Home again on coming back.
 */
function liveStudyButton(app: App, isFirstRun: boolean, changed: () => void): HTMLElement {
  clearTimeout(studyTimer);
  const { el, changesIn } = studyButton(app, isFirstRun);
  const wait = (ms: number | null) => {
    if (ms !== null) studyTimer = setTimeout(check, ms);
  };
  const check = () => {
    if (!el.isConnected || document.hidden) return;
    const next = studyButton(app, isFirstRun);
    if (next.el.className !== el.className || next.el.textContent !== el.textContent) {
      // Only a wait counting down says nothing new about what's due.
      const counted = next.el.className !== el.className || !el.classList.contains('study-caught-up');
      el.className = next.el.className;
      el.replaceChildren(...next.el.childNodes);
      if (counted) changed();
    }
    wait(next.changesIn);
  };
  wait(changesIn);
  return el;
}

/**
 * Study does one of two things, and the button says which: review what's due,
 * or learn new cards. Once caught up it says how long until there's more
 * (Study then points to Drills).
 * Each looks different, so it's clear at a glance.
 * Also how long until it may say something else (at most an hour, to look again), or null if it never will.
 */
function studyButton(app: App, isFirstRun: boolean): { el: HTMLElement; changesIn: number | null } {
  const now = app.now();
  // As Study will see it: a new day brings new cards even if Home was drawn the day before.
  const progress = rollDay(app.progress, now);
  // The same checks Study makes for its next step, so the button never promises something else.
  const can = abilities(progress, canPlay());
  const reviews = studyQueue(progress, now, can).length;
  const fresh =
    learningCount(progress, can) < MAX_LEARNING
      ? upcomingWays(progress, can).length + Math.min(newCardsLeftToday(progress), upcomingNewCards(progress, Infinity).length)
      : 0;
  const next = isFirstRun ? null : nextStudyAt(progress, now, can);
  let mode: { kind: string; icon: 'cards' | 'plus'; kicker: string; title: string };
  // A count changes once the next card falls due; a wait, each time the unit it's counted in runs out.
  let changesIn = next === null ? null : next - now;
  if (isFirstRun) mode = { kind: 'learn', icon: 'plus', kicker: 'Start here', title: 'Learn' };
  else if (reviews > 0) mode = { kind: 'review', icon: 'cards', kicker: `${plural(reviews, 'card')} due`, title: 'Review' };
  else if (fresh > 0) mode = { kind: 'learn', icon: 'plus', kicker: plural(fresh, 'new card'), title: 'Learn' };
  else {
    mode = { kind: 'caught-up', icon: 'cards', kicker: next === null ? 'All caught up' : `Next in ${waitLabel(next - now)}`, title: 'Study' };
    if (next !== null) {
      const wait = next - now;
      const unit = wait <= HOUR ? MINUTE : wait <= DAY_MS ? HOUR : DAY_MS;
      changesIn = wait % unit || unit;
    }
  }
  const el = h(
    'button',
    { class: `hub-btn big study-btn study-${mode.kind}`, onclick: () => app.navigate({ name: 'study' }) },
    icon(mode.icon),
    h('span', { class: 'hub-kicker' }, mode.kicker),
    h('span', { class: 'hub-title' }, mode.title),
  );
  return { el, changesIn: changesIn === null ? null : Math.min(Math.max(changesIn, 0), HOUR) };
}

/** The chart carries the story; the text around it is just the numbers it can't show. */
function memoryCard(memory: MemorySummary, history: MemoryHistory, ahead: Forecast): HTMLElement {
  const { strengths } = memory;

  const counts = Object.fromEntries(
    STRENGTHS.map((s) => [s.id, h('span', { class: 'legend-count' }, strengths[s.id])]),
  ) as Record<Strength, HTMLElement>;


  return h(
    'section',
    { class: 'card strength-card', 'aria-labelledby': 'memory-title' },
    h('h2', { class: 'sr-only', id: 'memory-title' }, 'Your memory'),
    growthChart(history, counts, ahead),
    h(
      'ul',
      { class: 'strength-legend' },
      STRENGTHS.map((s) =>
        h(
          'li',
          { title: s.desc },
          h('span', { class: `swatch s-${s.id}`, 'aria-hidden': 'true' }),
          // The legend stays short on screen; screen readers still get what each strength means.
          h('span', { class: 'legend-label' }, s.label, h('span', { class: 'sr-only' }, `, ${s.desc}`)),
          counts[s.id],
        ),
      ),
    ),
    h('p', { class: 'coming muted small' }, memoryFacts(memory)),
  );
}

/** The numbers under the chart that it can't show. */
function memoryFacts({ recent, estimatedRecall, due }: MemorySummary): string {
  const measured = recent.reviews >= MIN_MEASURED_REVIEWS;
  const recall = measured ? 1 - recent.missed / recent.reviews : (estimatedRecall ?? 0);
  const pct = `${Math.round(recall * 100)}%`;
  const facts = [measured ? `${pct} recalled` : `≈${pct} recall`];
  if (due.tomorrow > 0) facts.push(`${due.tomorrow} more due by tomorrow`);
  return facts.join(' · ');
}
