import type { App } from '../app';
import { ALL_CARDS, getCard, unitOf, type Card } from '../deck';
import {
  buildExtraSession,
  distractors,
  isIntroduced,
  nextStudyStep,
  pickFormat,
  requeue,
  shuffle,
  upcomingNewCards,
  type Format,
  type Step,
} from '../session';
import { formatInterval, nextInterval, newCardState, type Rating } from '../srs';
import { play, speechSupported, stop } from '../speech';
import { recordAnswer } from '../store';
import { audioButton, h, hookView, icon, progressBar } from '../ui';
import { defaultDeps, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

type Phase = 'topic-intro' | 'intro' | 'quiz' | 'feedback' | 'front' | 'back' | 'missed' | 'speak' | 'caught-up' | 'done';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

const PRAISE = ['Magaling!', 'Galing!', 'Tama!', 'Ayos!'];

/**
 * A study session. With a list of steps it works through them and finishes;
 * without one it is open-ended study, picking each step as it goes (see
 * nextStudyStep) until the learner stops.
 */
export function sessionScreen(app: App, steps: Step[] | null, title?: string, deps: SpeakDeps = defaultDeps): HTMLElement {
  const root = h('div', { class: 'session' });
  const open = steps === null;
  let queue = [...(steps ?? [])];
  let step: Step | undefined;
  let card: Card | undefined;
  let phase: Phase = 'done';
  let format: Format = 'read';
  let choices: Card[] = [];
  let picked: string | null = null;
  let hookShown = false;
  let completed = 0;
  /** Set once the learner has seen the caught-up note, so it only shows once. */
  let caughtUpSeen = false;
  let speak: SpeakPanel | null = null;
  const recent: string[] = [];
  const misses = new Map<string, number>();
  const topicsIntroduced = new Set<string>();
  const stats = { learned: 0, reviewed: 0, practised: 0, correct: 0, answered: 0 };

  const canListen = speechSupported();
  // Speaking joins the mix only once the model is on the device, so study never stops for a download.
  let speakReady = false;
  if (deps.recordingSupported()) {
    deps.modelDownloaded().then(
      (ready) => (speakReady ||= ready),
      () => {},
    );
  }

  /** Play the card, except while the microphone is open: it would record the app's voice. */
  const say = (slow = false) => card && !speak?.recording() && void play(card, slow);
  const autoplay = () => app.progress.settings.autoplay && say();

  function take(): Step | undefined {
    if (!open) return queue.shift();
    return nextStudyStep(app.progress, app.now(), recent, { listen: canListen, speak: speakReady }, misses) ?? undefined;
  }

  function next(): void {
    speak?.dispose();
    speak = null;
    stop();
    do {
      step = take();
      card = step && getCard(step.cardId);
    } while (step && !card);
    picked = null;
    hookShown = false;
    format = 'read';
    if (card) recent.push(card.id);
    if (!step || !card) {
      phase = 'done';
    } else if (step.kind === 'extra' && !caughtUpSeen) {
      // Say why the session has moved on to practice before the first extra step.
      caughtUpSeen = true;
      phase = 'caught-up';
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
      ask(card, step);
      return;
    }
    draw();
  }

  /** Ask a review or practice step in its format. */
  function ask(c: Card, s: Step): void {
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    format = s.format ?? pickFormat(state, { listen: canListen, speak: false });
    if (format === 'speak') {
      phase = 'speak';
      speak = speakPanel(c, {
        say: (slow) => say(slow),
        silence: stop,
        onAttempt: (right) => {
          if (picked) return;
          picked = c.id;
          stats.practised++;
          if (!right) misses.set(c.id, (misses.get(c.id) ?? 0) + 1);
        },
        onNext: next,
        onReady: () => (speakReady = true),
        deps,
      });
    } else if (format === 'remember' || format === 'produce') {
      phase = 'front';
      if (format === 'remember') autoplay();
    } else {
      startQuiz();
      return;
    }
    draw();
  }

  function finish(rating: Rating): void {
    if (!card || !step) return;
    if (step.kind === 'extra') {
      // Practice beyond the schedule: noted for this session only.
      stats.practised++;
      if (rating === 'again') misses.set(card.id, (misses.get(card.id) ?? 0) + 1);
      return;
    }
    const wasNew = !isIntroduced(app.progress, card.id);
    recordAnswer(app.progress, card.id, rating, app.now());
    app.commit();
    stats.answered++;
    if (rating !== 'again') stats.correct++;
    if (wasNew) stats.learned++;
    else stats.reviewed++;
    // Open-ended study brings a missed card back by itself: it's still being learned.
    if (rating === 'again' && !open) queue = requeue(queue, step);
    else completed++;
  }

  function startQuiz(): void {
    if (!card) return;
    const known = Object.keys(app.progress.cards).map(getCard).filter((c): c is Card => !!c);
    choices = shuffle([card, ...distractors(card, format === 'recall' ? 'tl' : 'en', 3, known.length >= 6 ? known : ALL_CARDS)]);
    phase = 'quiz';
    if (format === 'listen' || (format === 'read' && app.progress.settings.autoplay)) say();
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
    if (format === 'produce') say();
    draw();
  }

  function rate(rating: Rating): void {
    finish(rating);
    // A miss is the moment a hook helps most, so give it a beat before moving on.
    if (rating === 'again' && !hookShown && step?.kind !== 'extra') {
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

  /** Stopping open-ended study shows what was done, if anything was. */
  function close(): void {
    if (open && stats.answered + stats.practised > 0 && phase !== 'done') {
      speak?.dispose();
      speak = null;
      stop();
      phase = 'done';
      draw();
    } else {
      app.navigate({ name: 'home' });
    }
  }

  function header(): HTMLElement {
    if (open) {
      const done = stats.answered + stats.practised;
      return h(
        'header',
        { class: 'session-header' },
        h('button', { class: 'icon-btn', 'aria-label': 'Stop studying', onclick: close }, icon('close')),
        h('span', { class: 'session-count' }, done === 1 ? '1 done' : `${done} done`),
        h('span', { class: 'session-title' }, step?.kind === 'extra' && phase !== 'done' ? 'Extra practice' : 'Study'),
      );
    }
    // On the missed screen the card is already back in the queue.
    const remaining = queue.length + (phase === 'done' || phase === 'missed' ? 0 : 1);
    return h(
      'header',
      { class: 'session-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close session', onclick: close }, icon('close')),
      progressBar(completed, completed + remaining, 'Session progress'),
      title ? h('span', { class: 'session-title' }, title) : null,
    );
  }

  function draw(): void {
    root.replaceChildren(
      header(),
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
      case 'speak':
        return speakView(card);
      case 'caught-up':
        return caughtUpView();
    }
  }

  function caughtUpView(): HTMLElement {
    const unmet = upcomingNewCards(app.progress, 1).length > 0;
    return h(
      'div',
      { class: 'panel center' },
      h('p', { class: 'eyebrow' }, stats.answered ? 'Nice work' : 'Nothing due'),
      h('h2', null, "You're caught up"),
      h(
        'p',
        null,
        unmet && app.progress.today.newCount < app.progress.settings.dailyNew
          ? 'No reviews are due. New words come in once the ones you are still learning have settled.'
          : unmet
            ? "No reviews are due, and today's new words are in."
            : 'No reviews are due.',
        ' You can keep going with practice on your weakest words. It won\'t change when they come back.',
      ),
      h(
        'div',
        { class: 'stack' },
        h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: () => (step && card ? ask(card, step) : next()) }, 'Keep practising'),
        unmet &&
          h(
            'button',
            { class: 'btn secondary', onclick: () => app.navigate({ name: 'session', steps: buildExtraSession(app.progress), title: 'New words' }) },
            'Learn new words',
          ),
        h('button', { class: 'btn secondary', onclick: close }, 'Stop'),
      ),
    );
  }

  function speakView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel speak-step' },
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'Say this out loud'), tagalog(c), h('p', { class: 'prompt-meaning' }, c.en)),
      speak?.el,
    );
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

  function quizPrompt(c: Card, answered: boolean): HTMLElement {
    if (format === 'recall') {
      return h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'How do you say…'), h('p', { class: 'prompt-en' }, c.en));
    }
    if (format === 'listen') {
      return h(
        'div',
        { class: 'prompt center' },
        h('p', { class: 'eyebrow' }, 'What did you hear?'),
        h('div', { class: 'audio-group big' }, audioButton(() => say(), 'Play again', 'huge'), audioButton(() => say(true), 'Play slowly', 'slow')),
        answered && h('p', { class: 'tl', lang: 'fil' }, c.tl),
      );
    }
    return h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'What does this mean?'), tagalog(c));
  }

  function quizView(c: Card): HTMLElement {
    const answered = picked !== null;
    const right = picked === c.id;
    const field = format === 'recall' ? 'tl' : 'en';
    const extra = step?.kind === 'extra';
    return h(
      'div',
      { class: 'panel' },
      quizPrompt(c, answered),
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
              lang: field === 'tl' ? 'fil' : undefined,
              onclick: () => pick(choice),
            },
            h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
            choice[field],
          ),
        ),
      ),
      answered &&
        h(
          'div',
          { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
          h('strong', null, right ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : 'Not quite.'),
          ' ',
          right
            ? step?.kind === 'new'
              ? 'That one is yours now.'
              : `${c.tl} = ${c.en}`
            : `"${c.tl}" means "${c.en}".${extra ? '' : ' It will come back shortly.'}`,
        ),
      answered && !right && hookView(c),
      answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function flashcardView(c: Card): HTMLElement {
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    const showBack = phase === 'back';
    const reverse = format === 'produce';
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
      h('h2', null, stats.answered + stats.practised ? 'Session finished' : 'Nothing to study right now'),
      stats.answered + stats.practised > 0 &&
        h(
          'div',
          { class: 'stats' },
          h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, stats.learned), h('span', { class: 'stat-label' }, 'new')),
          h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, stats.reviewed), h('span', { class: 'stat-label' }, 'reviewed')),
          stats.practised > 0
            ? h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, stats.practised), h('span', { class: 'stat-label' }, 'practised'))
            : h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, `${accuracy}%`), h('span', { class: 'stat-label' }, 'first try')),
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
    if (phase === 'speak') return;
    // Enter and Space activate the focused primary button natively.
    const n = Number(e.key);
    if (phase === 'quiz' && n >= 1 && n <= choices.length) return pick(choices[n - 1]);
    if (phase === 'back' && n >= 1 && n <= 4) return rate(RATINGS[n - 1].rating);
    if (phase === 'back' && !hookShown && (e.key === 'h' || e.key === 'H')) return showHook();
  });

  next();
  return root;
}
