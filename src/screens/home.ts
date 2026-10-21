import type { App } from '../app';
import {
  MIN_MEASURED_REVIEWS,
  STRENGTHS,
  memoryHistory,
  memorySummary,
  type MemoryHistory,
  type MemorySummary,
  type Strength,
} from '../memory';
import { dueCards, newCardsLeftToday, upcomingNewCards } from '../session';
import { h, icon } from '../ui';
import { growthChart } from './growth-chart';

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

  // The last word of the greeting gets the accent color.
  const split = hello.tl.lastIndexOf(' ');

  return h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'home-header' },
      h(
        'div',
        null,
        h('h1', { class: 'greeting', lang: 'fil' }, hello.tl.slice(0, split + 1), h('span', { class: 'accent' }, hello.tl.slice(split + 1))),
        h('p', { class: 'muted' }, hello.en),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => app.navigate({ name: 'settings' }) }, icon('settings')),
    ),

    isFirstRun ? welcomeCard() : null,
    h(
      'nav',
      { class: 'hub', 'aria-label': 'Main' },
      h(
        'button',
        { class: 'hub-btn big study-btn', onclick: () => app.navigate({ name: 'study' }) },
        h('span', { class: 'hub-top' }, icon('cards'), h('span', { class: 'hub-badge' }, studyLabel(app, isFirstRun))),
        h('span', { class: 'hub-title' }, 'Study'),
      ),
      h(
        'button',
        { class: 'hub-btn big chat-btn', onclick: () => app.navigate({ name: 'talk' }) },
        h('span', { class: 'hub-top' }, icon('mic')),
        h('span', { class: 'hub-title' }, 'Chat'),
      ),
      h('button', { class: 'hub-btn drills-btn', onclick: () => app.navigate({ name: 'practice' }) }, h('span', { class: 'hub-title' }, 'Drills')),
      h('button', { class: 'hub-btn library-btn', onclick: () => app.navigate({ name: 'words' }) }, h('span', { class: 'hub-title' }, 'Library')),
    ),
    isFirstRun ? null : memoryCard(memory, memoryHistory(progress, now)),
  );
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

/** What Study will do next, in a couple of words. */
function studyLabel(app: App, isFirstRun: boolean): string {
  const { progress } = app;
  const reviews = dueCards(progress, app.now()).length;
  const fresh = Math.min(newCardsLeftToday(progress), upcomingNewCards(progress, Infinity).length);
  if (isFirstRun) return 'Start here';
  if (reviews > 0) return `${reviews} due`;
  if (fresh > 0) return `${plural(fresh, 'new card')}`;
  return 'All caught up';
}

/** The chart carries the story; the text around it is just the numbers it can't show. */
function memoryCard(memory: MemorySummary, history: MemoryHistory): HTMLElement {
  const { strengths, recent, due } = memory;
  const measured = recent.reviews >= MIN_MEASURED_REVIEWS;
  const recall = measured ? 1 - recent.missed / recent.reviews : (memory.estimatedRecall ?? 0);
  const pct = `${Math.round(recall * 100)}%`;

  const counts = Object.fromEntries(
    STRENGTHS.map((s) => [s.id, h('span', { class: 'legend-count' }, strengths[s.id])]),
  ) as Record<Strength, HTMLElement>;

  const facts = [measured ? `${pct} recalled` : `≈${pct} recall`];
  if (due.tomorrow > 0) facts.push(`${due.tomorrow} more due by tomorrow`);

  return h(
    'section',
    { class: 'card strength-card', 'aria-labelledby': 'memory-title' },
    h('h2', { class: 'sr-only', id: 'memory-title' }, 'Your memory'),
    growthChart(history, counts),
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
    h('p', { class: 'coming muted small' }, facts.join(' · ')),
  );
}
