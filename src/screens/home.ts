import type { App } from '../app';
import {
  MIN_MEASURED_REVIEWS,
  RECALL_WINDOW_DAYS,
  STRENGTHS,
  memoryHistory,
  memorySummary,
  type MemoryHistory,
  type MemorySummary,
  type Strength,
} from '../memory';
import { buildExtraSession, dueCards, newCardsLeftToday, unmetCount, upcomingNewCards } from '../session';
import { talkPlan } from '../talk';
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
    todayCard(app, memory, isFirstRun),
    isFirstRun ? null : talkCard(app),
    isFirstRun ? null : moreLinks(app),
    isFirstRun ? null : memorySection(memory, memoryHistory(progress, now)),
  );
}

function welcomeCard(): HTMLElement {
  return h(
    'section',
    { class: 'card welcome' },
    h('h2', null, 'Mabuhay! Welcome'),
    h('p', null, 'Learn Tagalog a few minutes a day. Here is how it works:'),
    h(
      'ol',
      { class: 'how' },
      h('li', null, h('strong', null, 'Meet something new.'), ' Words and phrases first, then how sentences fit together, sounds, and everyday know-how.'),
      h('li', null, h('strong', null, 'Quick check.'), ' Answer one question so it sticks.'),
      h('li', null, h('strong', null, 'Review just in time.'), ' Each card comes back right before you would forget it.'),
    ),
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function todayCard(app: App, memory: MemorySummary, isFirstRun: boolean): HTMLElement {
  const { progress } = app;
  const now = app.now();
  const reviews = dueCards(progress, now).length;
  const unmet = unmetCount(progress);
  const fresh = Math.min(newCardsLeftToday(progress), upcomingNewCards(progress, Infinity).length);
  const rate = progress.settings.dailyNew;

  const rateLine = h(
    'p',
    { class: 'today-meta' },
    unmet === 0 ? "You've met every card in the deck." : `Up to ${plural(rate, 'new card')} a day`,
    unmet > 0 && h('button', { class: 'link-btn', onclick: () => app.navigate({ name: 'settings' }) }, 'Change'),
  );

  let title: string;
  let plan: string;
  if (isFirstRun) {
    title = 'Your first words';
    plan = 'Meet a few words, then check them before moving on.';
  } else if (reviews > 0) {
    title = `${plural(reviews, 'card')} to review`;
    plan = fresh > 0 ? 'Weakest first. New cards come in once these have settled.' : 'Weakest first.';
  } else if (fresh > 0) {
    title = 'Ready for something new';
    plan = 'Nothing is due, so study starts with new cards.';
  } else {
    title = "You're caught up";
    plan = "Nothing is due. Study gives extra practice on your weakest cards, without changing when they come back.";
  }

  return h(
    'section',
    { class: 'card today' },
    !isFirstRun && studyStats(memory),
    rateLine,
    h('h2', null, title),
    h('p', null, plan),
    h('button', { class: 'btn primary big', onclick: () => app.navigate({ name: 'study' }) }, isFirstRun ? 'Start learning' : 'Study'),
    !isFirstRun &&
      unmet > 0 &&
      h(
        'button',
        {
          class: 'link-btn learn-more',
          onclick: () => app.navigate({ name: 'session', steps: buildExtraSession(app.progress), title: 'Something new' }),
        },
        'Learn something new now',
      ),
  );
}

/** How often reviews come back right: measured once there are enough of them, estimated before. */
function recallOf(memory: MemorySummary): { measured: boolean; pct: string } {
  const { recent } = memory;
  const measured = recent.reviews >= MIN_MEASURED_REVIEWS;
  const recall = measured ? 1 - recent.missed / recent.reviews : (memory.estimatedRecall ?? 0);
  return { measured, pct: `${Math.round(recall * 100)}%` };
}

/** What you know and how well it's holding, at the top of the card that keeps it that way. */
function studyStats(memory: MemorySummary): HTMLElement {
  const { measured, pct } = recallOf(memory);
  return h(
    'div',
    { class: 'study-stats' },
    h('p', { class: 'study-stat' }, h('strong', null, memory.total), ' ', memory.total === 1 ? 'card known' : 'cards known'),
    h('p', { class: 'study-stat' }, h('strong', null, measured ? pct : `≈${pct}`), ' ', measured ? 'recalled' : 'recall, estimated'),
  );
}

/** Talk is the payoff for everything else, so it gets its own block on Home. */
function talkCard(app: App): HTMLElement {
  const known = talkPlan(app.progress, null).known.length;
  return h(
    'section',
    { class: 'card talk-card' },
    h('h2', null, 'Talk'),
    h('p', null, `A spoken conversation in English, with the ${plural(known, 'Tagalog word')} you know mixed in.`),
    h('button', { class: 'btn big talk-start', onclick: () => app.navigate({ name: 'talk' }) }, icon('mic'), ' Start talking'),
  );
}

function moreLinks(app: App): HTMLElement {
  return h(
    'div',
    { class: 'more-links' },
    h(
      'button',
      { class: 'more-link drills-link', onclick: () => app.navigate({ name: 'practice' }) },
      h('span', { class: 'more-title' }, 'Drills'),
      h('span', { class: 'more-desc' }, 'Listen, read, recall or speak'),
    ),
    h(
      'button',
      { class: 'more-link library-link', onclick: () => app.navigate({ name: 'words' }) },
      h('span', { class: 'more-title' }, 'Library'),
      h('span', { class: 'more-desc' }, 'Everything there is to learn'),
    ),
  );
}

function memorySection(memory: MemorySummary, history: MemoryHistory): HTMLElement {
  const { strengths, due, recent } = memory;
  const { measured, pct } = recallOf(memory);
  const counts = Object.fromEntries(
    STRENGTHS.map((s) => [s.id, h('span', { class: 'legend-count' }, strengths[s.id])]),
  ) as Record<Strength, HTMLElement>;

  const coming: string[] = [];
  if (due.tomorrow > 0) coming.push(`${due.tomorrow} by tomorrow`);
  if (due.week > 0) coming.push(`${due.week} ${due.tomorrow > 0 ? 'more ' : ''}this week`);

  return h(
    'section',
    { class: 'memory', 'aria-labelledby': 'memory-title' },
    h('h2', { class: 'section-title', id: 'memory-title' }, 'Your memory'),
    h(
      'p',
      { class: 'memory-note muted small' },
      measured
        ? `${pct} recalled over the last ${RECALL_WINDOW_DAYS} days: right on ${recent.reviews - recent.missed} of ${plural(recent.reviews, 'review')}.`
        : `Recall is estimated from your review schedule. Once you've done ${MIN_MEASURED_REVIEWS} reviews, it shows how often you actually remember.`,
    ),
    h(
      'div',
      { class: 'card strength-card' },
      h('h3', null, 'How your memory has grown'),
      growthChart(history, counts),
      h(
        'ul',
        { class: 'strength-legend' },
        STRENGTHS.map((s) =>
          h(
            'li',
            null,
            h('span', { class: `swatch s-${s.id}`, 'aria-hidden': 'true' }),
            h('span', { class: 'legend-label' }, h('strong', null, s.label), ' ', h('span', { class: 'muted' }, s.desc)),
            counts[s.id],
          ),
        ),
      ),
      coming.length > 0 && h('p', { class: 'coming muted small' }, `Coming up for review: ${coming.join(' · ')}`),
    ),
  );
}
