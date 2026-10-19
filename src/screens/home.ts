import type { App } from '../app';
import { MIN_MEASURED_REVIEWS, RECALL_WINDOW_DAYS, STRENGTHS, memorySummary, type MemorySummary } from '../memory';
import { buildExtraSession, buildSession, dueCards, newCardsLeftToday, upcomingNewCards } from '../session';
import { h, icon } from '../ui';

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
    todayCard(app, isFirstRun),
    isFirstRun ? null : memorySection(memory),
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
      h('li', null, h('strong', null, 'Meet new words.'), ' Hear them, read them, and see how to say them.'),
      h('li', null, h('strong', null, 'Quick check.'), ' Pick the right meaning so it sticks.'),
      h('li', null, h('strong', null, 'Review just in time.'), ' Words come back right before you would forget them.'),
    ),
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function todayCard(app: App, isFirstRun: boolean): HTMLElement {
  const { progress } = app;
  const now = app.now();
  const steps = buildSession(progress, now);
  const reviews = dueCards(progress, now).length;
  const unmet = upcomingNewCards(progress, Infinity).length;
  const fresh = Math.min(newCardsLeftToday(progress), unmet);
  const rate = progress.settings.dailyNew;

  const rateLine = h(
    'p',
    { class: 'today-meta' },
    unmet === 0 ? "You've met every word in the deck." : `${plural(rate, 'new word')} a day`,
    unmet > 0 && h('button', { class: 'link-btn', onclick: () => app.navigate({ name: 'settings' }) }, 'Change'),
  );

  if (steps.length === 0) {
    return h(
      'section',
      { class: 'card today done' },
      rateLine,
      h('h2', null, 'Nothing due'),
      h('p', null, "Your reviews are done for now. Words come back as they're about to fade."),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn secondary', onclick: () => app.navigate({ name: 'practice' }) }, 'Practice'),
        unmet > 0 &&
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => app.navigate({ name: 'session', steps: buildExtraSession(app.progress), title: 'New words' }),
            },
            'Learn 5 more',
          ),
      ),
    );
  }

  const parts: string[] = [];
  if (reviews > 0) parts.push(`${reviews} to review`);
  if (fresh > 0) parts.push(`${fresh} new`);
  const minutes = Math.max(1, Math.round((reviews * 8 + fresh * 25) / 60));

  return h(
    'section',
    { class: 'card today' },
    rateLine,
    h('h2', null, isFirstRun ? 'Your first words' : 'Today'),
    h('p', null, `${parts.join(' · ')} · about ${minutes} min`),
    h(
      'button',
      {
        class: 'btn primary big',
        onclick: () => app.navigate({ name: 'session', steps: buildSession(app.progress, app.now()) }),
      },
      isFirstRun ? 'Start learning' : 'Start',
    ),
  );
}

function memorySection(memory: MemorySummary): HTMLElement {
  const { total, strengths, recent, due } = memory;
  const measured = recent.reviews >= MIN_MEASURED_REVIEWS;
  const recall = measured ? 1 - recent.missed / recent.reviews : (memory.estimatedRecall ?? 0);
  const pct = `${Math.round(recall * 100)}%`;

  const coming: string[] = [];
  if (due.tomorrow > 0) coming.push(`${due.tomorrow} by tomorrow`);
  if (due.week > 0) coming.push(`${due.week} ${due.tomorrow > 0 ? 'more ' : ''}this week`);

  return h(
    'section',
    { class: 'memory', 'aria-labelledby': 'memory-title' },
    h('h2', { class: 'section-title', id: 'memory-title' }, 'Your memory'),
    h(
      'div',
      { class: 'tiles' },
      h(
        'div',
        { class: 'tile words-tile' },
        h('span', { class: 'tile-value' }, total),
        h('span', { class: 'tile-label' }, total === 1 ? 'word or phrase' : 'words & phrases'),
      ),
      h(
        'div',
        { class: 'tile recall-tile' },
        h('span', { class: 'tile-value' }, measured ? pct : `≈${pct}`),
        h('span', { class: 'tile-label' }, measured ? `recalled, last ${RECALL_WINDOW_DAYS} days` : 'recall, estimated'),
      ),
    ),
    h(
      'p',
      { class: 'memory-note muted small' },
      measured
        ? `Right on ${recent.reviews - recent.missed} of ${plural(recent.reviews, 'review')}.`
        : `Estimated from your review schedule. Once you've done ${MIN_MEASURED_REVIEWS} reviews, this shows how often you actually remember.`,
    ),

    h(
      'div',
      { class: 'card strength-card' },
      h('h3', null, "How firmly they're stored"),
      strengthBar(memory),
      h(
        'ul',
        { class: 'strength-legend' },
        STRENGTHS.map((s) =>
          h(
            'li',
            null,
            h('span', { class: `swatch s-${s.id}`, 'aria-hidden': 'true' }),
            h('span', { class: 'legend-label' }, h('strong', null, s.label), ' ', h('span', { class: 'muted' }, s.desc)),
            h('span', { class: 'legend-count' }, strengths[s.id]),
          ),
        ),
      ),
      coming.length > 0 && h('p', { class: 'coming muted small' }, `Coming up for review: ${coming.join(' · ')}`),
    ),
  );
}

function strengthBar({ total, strengths }: MemorySummary): HTMLElement {
  const label = STRENGTHS.map((s) => `${strengths[s.id]} ${s.label.toLowerCase()}`).join(', ');
  return h(
    'div',
    { class: 'strength-bar', role: 'img', 'aria-label': label },
    STRENGTHS.filter((s) => strengths[s.id] > 0).map((s) =>
      h('span', { class: `seg s-${s.id}`, style: { flexGrow: String(strengths[s.id] / total) } }),
    ),
  );
}
