import type { App } from '../app';
import { getCard, unitOf, type Card } from '../deck';
import { distractors, isIntroduced, requeue, shuffle, type Step } from '../session';
import { formatInterval, nextInterval, newCardState, type Rating } from '../srs';
import { play } from '../speech';
import { recordAnswer } from '../store';
import { audioButton, h, hookView, icon, progressBar } from '../ui';

type Phase = 'topic-intro' | 'intro' | 'quiz' | 'feedback' | 'front' | 'back' | 'missed' | 'done';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

const PRAISE = ['Magaling!', 'Galing!', 'Tama!', 'Ayos!'];

export function sessionScreen(app: App, steps: Step[], title?: string): HTMLElement {
  const root = h('div', { class: 'session' });
  let queue = [...steps];
  let step: Step | undefined;
  let card: Card | undefined;
  let phase: Phase = 'done';
  let choices: Card[] = [];
  let picked: string | null = null;
  let reverse = false;
  let hookShown = false;
  let completed = 0;
  const topicsIntroduced = new Set<string>();
  const stats = { learned: 0, reviewed: 0, correct: 0, answered: 0 };

  const say = (slow = false) => card && void play(card, slow);
  const autoplay = () => app.progress.settings.autoplay && say();

  function next(): void {
    do {
      step = queue.shift();
      card = step && getCard(step.cardId);
    } while (step && !card);
    picked = null;
    hookShown = false;
    if (!step || !card) {
      phase = 'done';
    } else if (step.kind === 'new' && !isIntroduced(app.progress, card.id)) {
      const unit = unitOf(card.id);
      const unitIsFresh = unit && !unit.cards.some((c) => isIntroduced(app.progress, c.id));
      if (unit && unitIsFresh && !topicsIntroduced.has(unit.id)) {
        topicsIntroduced.add(unit.id);
        phase = 'topic-intro';
      } else {
        phase = 'intro';
        autoplay();
      }
    } else {
      const state = app.progress.cards[card.id];
      reverse = (state?.reps ?? 0) >= 2 && Math.random() < 0.5;
      phase = 'front';
      if (!reverse) autoplay();
    }
    draw();
  }

  function finish(rating: Rating): void {
    if (!card || !step) return;
    const wasNew = !isIntroduced(app.progress, card.id);
    recordAnswer(app.progress, card.id, rating, app.now());
    app.commit();
    stats.answered++;
    if (rating !== 'again') stats.correct++;
    if (wasNew) stats.learned++;
    else stats.reviewed++;
    if (rating === 'again') queue = requeue(queue, step);
    else completed++;
  }

  function startQuiz(): void {
    if (!card) return;
    choices = shuffle([card, ...distractors(card, 'en', 3)]);
    phase = 'quiz';
    draw();
  }

  function pick(choice: Card): void {
    if (!card || picked) return;
    picked = choice.id;
    finish(choice.id === card.id ? 'good' : 'again');
    phase = 'feedback';
    say();
    draw();
  }

  function reveal(): void {
    phase = 'back';
    if (reverse) say();
    draw();
  }

  function rate(rating: Rating): void {
    finish(rating);
    // A miss is the moment a hook helps most, so give it a beat before moving on.
    if (rating === 'again' && !hookShown) {
      phase = 'missed';
      draw();
    } else {
      next();
    }
  }

  function showHook(): void {
    hookShown = true;
    draw();
  }

  function draw(): void {
    // On the missed screen the card is already back in the queue.
    const remaining = queue.length + (phase === 'done' || phase === 'missed' ? 0 : 1);
    root.replaceChildren(
      h(
        'header',
        { class: 'session-header' },
        h('button', { class: 'icon-btn', 'aria-label': 'Close session', onclick: () => app.navigate({ name: 'home' }) }, icon('close')),
        progressBar(completed, completed + remaining, 'Session progress'),
        title ? h('span', { class: 'session-title' }, title) : null,
      ),
      h('div', { class: 'session-body' }, body()),
    );
    root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  function body(): HTMLElement {
    if (phase === 'done' || !card) return doneView();
    switch (phase) {
      case 'topic-intro':
        return topicIntroView();
      case 'intro':
        return introView(card);
      case 'quiz':
      case 'feedback':
        return quizView(card);
      case 'front':
      case 'back':
        return flashcardView(card);
      case 'missed':
        return missedView(card);
    }
  }

  function topicIntroView(): HTMLElement {
    const unit = card && unitOf(card.id);
    return h(
      'div',
      { class: 'panel center' },
      h('p', { class: 'eyebrow' }, 'New topic'),
      h('h2', null, unit?.title),
      h('p', { class: 'tl-sub' }, unit?.tlTitle),
      h('p', null, unit?.intro),
      h(
        'button',
        {
          class: 'btn primary big',
          'data-autofocus': true,
          onclick: () => {
            phase = 'intro';
            autoplay();
            draw();
          },
        },
        "Let's go",
      ),
    );
  }

  function introView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, c.kind === 'phrase' ? 'New phrase' : 'New word'), tagalog(c)),
      c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint),
      h('p', { class: 'meaning' }, c.en),
      c.note && h('p', { class: 'note' }, c.note),
      hookView(c),
      h('p', { class: 'muted small' }, 'Listen, then say it out loud a couple of times.'),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: startQuiz }, 'Got it, quiz me'),
    );
  }

  function quizView(c: Card): HTMLElement {
    const answered = picked !== null;
    const right = picked === c.id;
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'What does this mean?'), tagalog(c)),
      h(
        'div',
        { class: 'choices' },
        choices.map((choice, i) =>
          h(
            'button',
            {
              class: `choice ${answered && choice.id === c.id ? 'correct' : ''} ${answered && choice.id === picked && !right ? 'wrong' : ''}`,
              disabled: answered,
              'data-autofocus': (!answered && i === 0) || undefined,
              onclick: () => pick(choice),
            },
            h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
            choice.en,
          ),
        ),
      ),
      answered &&
        h(
          'div',
          { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
          h('strong', null, right ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : 'Not quite.'),
          ' ',
          right ? 'That one is yours now.' : `"${c.tl}" means "${c.en}". It will come back shortly.`,
        ),
      answered && !right && hookView(c),
      answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function flashcardView(c: Card): HTMLElement {
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    const showBack = phase === 'back';
    const prompt = reverse
      ? h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'How do you say…'), h('p', { class: 'prompt-en' }, c.en))
      : h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'Do you remember?'), tagalog(c));

    return h(
      'div',
      { class: 'panel' },
      prompt,
      !showBack &&
        h(
          'button',
          { class: 'btn primary big', 'data-autofocus': true, onclick: reveal },
          reverse ? 'Show the Tagalog' : 'Show the meaning',
        ),
      showBack &&
        h(
          'div',
          { class: 'answer' },
          reverse ? tagalog(c) : h('p', { class: 'meaning' }, c.en),
          c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint),
          hookShown
            ? hookView(c)
            : h('button', { class: 'btn hook-btn', onclick: showHook }, 'Show memory hook', h('span', { class: 'key', 'aria-hidden': 'true' }, 'H')),
          h('p', { class: 'muted small center' }, 'How well did you remember?'),
          h(
            'div',
            { class: 'ratings' },
            RATINGS.map(({ rating, label }, i) =>
              h(
                'button',
                { class: `rate rate-${rating}`, onclick: () => rate(rating), 'data-autofocus': rating === 'good' || undefined },
                h('span', { class: 'rate-label' }, label),
                h('span', { class: 'rate-when' }, formatInterval(nextInterval(state, rating))),
                h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
              ),
            ),
          ),
        ),
    );
  }

  function missedView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'Coming back shortly'), tagalog(c)),
      h('p', { class: 'meaning' }, c.en),
      c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint),
      hookView(c),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function doneView(): HTMLElement {
    const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    return h(
      'div',
      { class: 'panel center' },
      h('h2', null, stats.answered ? 'Session finished' : 'Nothing to study right now'),
      stats.answered > 0 &&
        h(
          'div',
          { class: 'stats' },
          h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, stats.learned), h('span', { class: 'stat-label' }, 'new')),
          h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, stats.reviewed), h('span', { class: 'stat-label' }, 'reviewed')),
          h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, `${accuracy}%`), h('span', { class: 'stat-label' }, 'first try')),
        ),
      h('p', { class: 'muted' }, 'Words you just learned will come back for review when you are about to forget them.'),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: () => app.navigate({ name: 'home' }) }, 'Done'),
    );
  }

  function tagalog(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'tl-row' },
      h('p', { class: 'tl', lang: 'fil' }, c.tl),
      h('div', { class: 'audio-group' }, audioButton(() => say()), audioButton(() => say(true), 'Play slowly', 'slow')),
    );
  }

  app.onKey((e) => {
    if (e.key === 'r' || e.key === 'R') return say();
    // Enter and Space activate the focused primary button natively.
    const n = Number(e.key);
    if (phase === 'quiz' && n >= 1 && n <= choices.length) return pick(choices[n - 1]);
    if (phase === 'back' && n >= 1 && n <= 4) return rate(RATINGS[n - 1].rating);
    if (phase === 'back' && !hookShown && (e.key === 'h' || e.key === 'H')) return showHook();
  });

  next();
  return root;
}
