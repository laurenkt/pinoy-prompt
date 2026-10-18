import type { App } from '../app';
import { UNITS, getCard } from '../deck';
import {
  buildSession,
  buildUnitSession,
  dueCards,
  isUnlocked,
  newCardsLeftToday,
  unitProgress,
  upcomingNewCards,
} from '../session';
import { isMature } from '../srs';
import { h, icon, progressBar } from '../ui';

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
  // Only cards still in the deck count; saved progress may outlive removed cards.
  const states = Object.entries(progress.cards).filter(([id]) => getCard(id)).map(([, s]) => s);
  const learned = states.length;
  const known = states.filter(isMature).length;
  const isFirstRun = learned === 0;

  const steps = buildSession(progress, now);
  const reviewCount = dueCards(progress, now).length;
  const newCount = Math.min(newCardsLeftToday(progress), upcomingNewCards(progress, Infinity).length);

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

    todayCard(app, steps.length, reviewCount, newCount, isFirstRun, isFirstRun ? null : `${learned} learned · ${known} well known`),

    h('h2', { class: 'section-title' }, 'Your path'),
    h(
      'ol',
      { class: 'path' },
      UNITS.map((unit, i) => {
        const unlocked = isUnlocked(progress, i);
        const { introduced, total } = unitProgress(progress, unit);
        const complete = introduced === total;
        const state = !unlocked ? 'locked' : complete ? 'complete' : introduced > 0 ? 'started' : 'open';
        const onclick = !unlocked
          ? undefined
          : complete
            ? () => app.navigate({ name: 'words', unitId: unit.id })
            : () => app.navigate({ name: 'session', steps: buildUnitSession(progress, unit.id), title: unit.title });
        return h(
          'li',
          null,
          h(
            'button',
            {
              class: `unit ${state}`,
              disabled: !unlocked,
              onclick,
              'aria-label': `Unit ${i + 1}: ${unit.title}${unlocked ? `, ${introduced} of ${total} learned` : ' (locked)'}`,
            },
            h(
              'span',
              { class: 'unit-top', 'aria-hidden': 'true' },
              h('span', null, `Unit ${i + 1}`),
              !unlocked ? icon('lock') : complete ? icon('check') : h('span', null, `${introduced}/${total}`),
            ),
            h(
              'span',
              { class: 'unit-body', 'aria-hidden': 'true' },
              h('span', { class: 'unit-title' }, unit.title),
              h('span', { class: 'unit-tl', lang: 'fil' }, unit.tlTitle),
              unlocked && progressBar(introduced, total),
            ),
          ),
        );
      }),
    ),
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

function todayCard(app: App, total: number, reviews: number, fresh: number, isFirstRun: boolean, summary: string | null): HTMLElement {
  const meta = summary && h('p', { class: 'today-meta' }, summary);
  if (total === 0) {
    const nextUnit = UNITS.find((u, i) => isUnlocked(app.progress, i) && unitProgress(app.progress, u).introduced < u.cards.length);
    return h(
      'section',
      { class: 'card today done' },
      meta,
      h('h2', { lang: 'fil' }, 'Tapos na!'),
      h('p', null, 'All done for today. Come back tomorrow, or keep going:'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn secondary', onclick: () => app.navigate({ name: 'practice' }) }, 'Practice'),
        nextUnit &&
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () =>
                app.navigate({ name: 'session', steps: buildUnitSession(app.progress, nextUnit.id), title: nextUnit.title }),
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
    meta,
    h('h2', null, isFirstRun ? 'Your first lesson' : "Today's session"),
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
