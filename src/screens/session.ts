import type { App } from '../app';
import { VOCAB, getCard, isVocab, unitOf, type Card, type Drill } from '../deck';
import { KIND_INFO } from '../guides';
import {
  DRILL_MIN_WORDS,
  buildExtraSession,
  canDrill,
  distractors,
  isIntroduced,
  nextStudyStep,
  pickDrill,
  pickFormat,
  requeue,
  shuffle,
  unmetCount,
  type Format,
  type Step,
} from '../session';
import { formatInterval, nextInterval, newCardState, type Rating } from '../srs';
import { canPlay, play, preload, stop } from '../speech';
import { recordAnswer, rollDay } from '../store';
import { audioPair, choiceList, h, hookView, iconButton, progressBar } from '../ui';
import { continueButton, countdown, holdOnTap, previousButton, type Countdown } from './auto-advance';
import { drillPrompt, gapLine, guideAnswer, guideBody, guideFeedback, guideQuestion, guideQuestionView, sentenceClip, type GuideQuestion } from './guide-question';
import { isSilent, quietToggle } from './quiet';

type Phase = 'topic-intro' | 'intro' | 'quiz' | 'feedback' | 'front' | 'back' | 'missed' | 'caught-up' | 'done';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

const PRAISE = ['Magaling!', 'Galing!', 'Tama!', 'Ayos!'];

/** Phases where the current card hasn't been answered yet, so the one before it can still be looked back at. */
const UNANSWERED: Phase[] = ['topic-intro', 'intro', 'quiz', 'front', 'caught-up', 'done'];

/**
 * A study session. With a list of steps it works through them and finishes;
 * without one it is open-ended study, picking each step as it goes (see
 * nextStudyStep) until the learner is caught up, then pointing to Drills.
 */
export function sessionScreen(app: App, steps: Step[] | null, title?: string): HTMLElement {
  const root = h('div', { class: 'session' });
  const open = steps === null;
  let queue = [...(steps ?? [])];
  let step: Step | undefined;
  let card: Card | undefined;
  let phase: Phase = 'done';
  let format: Format = 'read';
  let choices: Card[] = [];
  /** The picked choice: a card id for a word, the answer text for a guide. */
  let picked: string | null = null;
  let hookShown = false;
  /** For a guide: the drill being asked, and while it's a gap or a build, the question as it's asked. */
  let drill: Drill | undefined;
  let guide: GuideQuestion | null = null;
  const lastDrill = new Map<string, Drill>();
  let completed = 0;
  const recent: string[] = [];
  const topicsIntroduced = new Set<string>();
  const stats = { learned: 0, reviewed: 0, correct: 0, answered: 0 };
  /** Cards missed at least once this session: getting one right later keeps its hook up instead of moving on. */
  const struggled = new Set<string>();
  let praise = PRAISE[0];
  /** Counting down to the next card after a right answer. */
  let auto: Countdown | null = null;
  /** The card that moved on by itself, as it was left, so the learner can look back at it. */
  let previous: Shown | null = null;
  /** Set as a card moves on by itself, so the next one doesn't take focus: an Enter meant for Continue would answer it. */
  let autoMoved = false;
  /** While looking back, the card to return to. */
  let reviewing: Shown | null = null;

  /** Everything that makes up the card on screen. */
  type Shown = ReturnType<typeof snapshot>;
  function snapshot() {
    return { step, card, phase, format, choices, picked, hookShown, drill, guide, praise };
  }
  function restore(s: Shown): void {
    ({ step, card, phase, format, choices, picked, hookShown, drill, guide, praise } = s);
  }

  holdOnTap(root, hold);

  /** Listening needs a voice, and quiet mode with headphones in, if it's on. */
  const canListen = () => canPlay() && !isSilent(app.progress.settings);

  /** Play the card. A guide plays the sentence it is asking about, if there is one, but only once answered: the sentence is the answer. */
  const say = (slow = false) => {
    if (!card) return;
    if (isVocab(card)) void play(card, slow);
    else if (drill && (phase === 'feedback' || phase === 'back' || phase === 'missed')) {
      const clip = sentenceClip(drill);
      if (clip) void play(clip, slow);
    }
  };
  const autoplay = () => app.progress.settings.autoplay && say();

  function take(): Step | undefined {
    if (!open) return queue.shift();
    // Study can run past midnight without leaving the screen, so start the new day's counts here.
    app.progress = rollDay(app.progress, app.now());
    return nextStudyStep(app.progress, app.now(), recent, { listen: canListen() }) ?? undefined;
  }

  function next(): void {
    moveOn(null);
  }

  /** Go to the next step, keeping `back` as the card to look back at, if it moved on by itself. */
  function moveOn(back: Shown | null): void {
    hold();
    previous = back;
    stop();
    do {
      step = take();
      card = step && getCard(step.cardId);
    } while (step && !card);
    picked = null;
    hookShown = false;
    format = 'read';
    drill = undefined;
    guide = null;
    if (card) recent.push(card.id);
    if (card && isVocab(card)) preload(card);
    if (!step || !card) {
      // Open-ended study runs until it's caught up, then points on to Drills.
      phase = open ? 'caught-up' : 'done';
    } else if (step.kind === 'new' && !isIntroduced(app.progress, card.id)) {
      const unit = unitOf(card.id);
      const unitIsFresh = unit && !unit.cards.some((c) => isIntroduced(app.progress, c.id));
      if (unit && unitIsFresh && !topicsIntroduced.has(unit.id)) {
        topicsIntroduced.add(unit.id);
        phase = 'topic-intro';
      } else {
        phase = 'intro';
        if (isVocab(card)) autoplay();
      }
    } else {
      ask(card, step);
      return;
    }
    draw();
  }

  /** Ask a review step in its format. */
  function ask(c: Card, s: Step): void {
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    format = s.format ?? pickFormat(state, { listen: canListen() }, Math.random, c.kind);
    // A step picked before silent mode was turned on is asked another way: the same check, by reading instead of hearing.
    if (format === 'listen' && !canListen()) format = 'read';
    if (format === 'hear' && !canListen()) format = 'remember';
    if (!isVocab(c)) {
      askGuide(c);
      return;
    }
    if (format === 'remember' || format === 'hear' || format === 'produce') {
      phase = 'front';
      if (format === 'hear') say();
      else if (format === 'remember') autoplay();
    } else {
      startQuiz();
      return;
    }
    draw();
  }

  function finish(rating: Rating): void {
    if (!card || !step) return;
    if (rating === 'again') struggled.add(card.id);
    const wasNew = !isIntroduced(app.progress, card.id);
    recordAnswer(app.progress, card.id, rating, app.now());
    app.commit();
    stats.answered++;
    if (rating !== 'again') stats.correct++;
    if (wasNew) stats.learned++;
    else stats.reviewed++;
    if (open) return;
    // Open-ended study brings a missed card back by itself: it's still being learned.
    if (rating === 'again') queue = requeue(queue, step);
    else completed++;
  }

  /** Ask a guide one of its drills, in the current format. */
  function askGuide(c: Card): void {
    if (format !== 'build' && format !== 'think') format = 'gap';
    const last = lastDrill.get(c.id);
    guide = format === 'think' ? null : guideQuestion(c, app.progress, format, last);
    drill = guide?.drill;
    if (!guide && format === 'build') format = 'think';
    if (format === 'think') drill = pickDrill(c, app.progress, format, last);
    // Skip a guide with nothing to ask, still offering the card that moved on before it.
    if (!drill) return moveOn(previous);
    lastDrill.set(c.id, drill);
    const clip = sentenceClip(drill);
    if (clip) preload(clip);
    phase = guide ? 'quiz' : 'front';
    draw();
  }

  function pickAnswer(text: string): void {
    if (!guide || picked) return;
    picked = text;
    answered(text === guideAnswer(guide));
  }

  function startQuiz(): void {
    if (!card) return;
    if (!isVocab(card)) {
      format = 'gap';
      askGuide(card);
      return;
    }
    const known = Object.keys(app.progress.cards).map(getCard).filter((c): c is Card => !!c);
    choices = shuffle([card, ...distractors(card, format === 'recall' ? 'tl' : 'en', 3, known.filter(isVocab).length >= 6 ? known : VOCAB)]);
    phase = 'quiz';
    if (format === 'listen' || (format === 'read' && app.progress.settings.autoplay)) say();
    draw();
  }

  function pick(choice: Card): void {
    if (!card || picked) return;
    picked = choice.id;
    answered(choice.id === card.id);
  }

  /** Show how a multiple-choice or build answer went. A right one moves on by itself, unless the card has been missed this session. */
  function answered(right: boolean): void {
    if (!card) return;
    const firstGo = !struggled.has(card.id);
    finish(right ? 'good' : 'again');
    phase = 'feedback';
    praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
    say();
    if (right && firstGo)
      auto = countdown(root, () => {
        autoMoved = true;
        moveOn(snapshot());
      });
    draw();
  }

  /** Stop counting down: the learner wants another look. */
  function hold(): void {
    auto?.cancel();
    auto = null;
  }

  /** Whether the card on screen gets its hook even though it was answered right. */
  function lookAgain(c: Card): boolean {
    return reviewing !== null || struggled.has(c.id);
  }

  function lookBack(): void {
    if (!previous) return;
    stop();
    reviewing = snapshot();
    restore(previous);
    draw();
  }

  function returnToCurrent(): void {
    if (!reviewing) return;
    stop();
    restore(reviewing);
    reviewing = null;
    draw();
  }

  /** Continue, or while looking back, the way back to the card being asked. */
  function proceed(): HTMLElement {
    return reviewing ? continueButton(returnToCurrent, false, 'Back to the current card') : continueButton(next, auto !== null);
  }

  function reveal(): void {
    phase = 'back';
    if (format === 'produce' || format === 'think') say();
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

  /** Going silent mid-step asks an unanswered listening step again by reading, so the card's review still counts. */
  function quietChanged(): void {
    const listening = format === 'listen' || format === 'hear';
    if (listening && !canListen() && card && step && (phase === 'front' || (phase === 'quiz' && !picked))) ask(card, step);
    else draw();
  }

  /** Stopping open-ended study shows what was done, if anything was. */
  function close(): void {
    hold();
    if (reviewing) returnToCurrent();
    previous = null;
    if (open && stats.answered > 0 && phase !== 'done') {
      stop();
      phase = 'done';
      draw();
    } else {
      app.navigate({ name: 'home' });
    }
  }

  function header(): HTMLElement {
    if (open) {
      const done = stats.answered;
      return h(
        'header',
        { class: 'session-header' },
        iconButton('close', 'Stop studying', close),
        h('span', { class: 'session-count' }, done === 1 ? '1 done' : `${done} done`),
        h('span', { class: 'session-title' }, 'Study'),
        quietToggle(app, quietChanged),
      );
    }
    // On the missed screen the card is already back in the queue.
    const remaining = queue.length + (phase === 'done' || phase === 'missed' ? 0 : 1);
    return h(
      'header',
      { class: 'session-header' },
      iconButton('close', 'Close session', close),
      progressBar(completed, completed + remaining, 'Session progress'),
      title ? h('span', { class: 'session-title' }, title) : null,
      quietToggle(app, quietChanged),
    );
  }

  function draw(): void {
    root.replaceChildren(
      header(),
      h('div', { class: 'session-body' }, previous && !reviewing && UNANSWERED.includes(phase) && previousButton(lookBack), body()),
    );
    if (!autoMoved) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    autoMoved = false;
  }

  function body(): HTMLElement {
    if (phase === 'caught-up') return caughtUpView();
    if (phase === 'done' || !card) return doneView();
    switch (phase) {
      case 'topic-intro':
        return topicIntroView();
      case 'intro':
        return isVocab(card) ? introView(card) : guideIntroView(card);
      case 'quiz':
      case 'feedback':
        return isVocab(card) ? quizView(card) : guideQuizView(card);
      case 'front':
      case 'back':
        return isVocab(card) ? flashcardView(card) : guideFlashcardView(card);
      case 'missed':
        return isVocab(card) ? missedView(card) : guideMissedView(card);
    }
  }

  function caughtUpView(): HTMLElement {
    const unmet = unmetCount(app.progress) > 0;
    // Drills wait for a few words; until then, learning more is the way on.
    const drills = canDrill(app.progress);
    return h(
      'div',
      { class: 'panel center' },
      h('p', { class: 'eyebrow' }, stats.answered ? 'Nice work' : 'Nothing due'),
      h('h2', null, "You're caught up"),
      h(
        'p',
        null,
        unmet ? "No reviews are due, and today's new cards are in." : "No reviews are due, and you've met every card.",
        drills
          ? ' You can keep practising in Drills, which leans on your weakest cards. It won\'t change when they come back.'
          : ` Drills open once you know ${DRILL_MIN_WORDS} words.`,
      ),
      h(
        'div',
        { class: 'stack' },
        drills &&
          h('button', { class: 'btn primary big', 'data-autofocus': true, 'data-tap': 'before', onclick: () => app.navigate({ name: 'practice' }) }, 'Keep practising in Drills'),
        unmet &&
          h(
            'button',
            {
              class: drills ? 'btn secondary' : 'btn primary big',
              'data-autofocus': !drills || undefined,
              onclick: () => app.navigate({ name: 'session', steps: buildExtraSession(app.progress), title: 'Something new' }),
            },
            'Learn something new',
          ),
        h('button', { class: 'btn secondary', onclick: close }, 'Stop'),
      ),
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

  function introAdvice(): string {
    if (isSilent(app.progress.settings)) return 'Say it in your head a couple of times.';
    return app.progress.settings.quiet ? 'Listen, then say it in your head a couple of times.' : 'Listen, then say it out loud a couple of times.';
  }

  function introView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, KIND_INFO[c.kind].eyebrow), tagalog(c)),
      c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint),
      h('p', { class: 'meaning' }, c.en),
      c.note && h('p', { class: 'note' }, c.note),
      hookView(c),
      h('p', { class: 'muted small' }, introAdvice()),
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
        audioPair(say, true),
        answered && h('p', { class: 'tl', lang: 'fil' }, c.tl),
      );
    }
    return h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'What does this mean?'), tagalog(c));
  }

  function quizView(c: Card): HTMLElement {
    const answered = picked !== null;
    const right = picked === c.id;
    const field = format === 'recall' ? 'tl' : 'en';
    return h(
      'div',
      { class: 'panel' },
      quizPrompt(c, answered),
      choiceList(choices, { key: (o) => o.id, label: (o) => o[field], answer: c.id, picked, lang: field === 'tl' ? 'fil' : undefined, onPick: pick }),
      answered &&
        h(
          'div',
          { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
          h('strong', null, right ? praise : 'Not quite.'),
          ' ',
          right
            ? step?.kind === 'new'
              ? 'That one is yours now.'
              : `${c.tl} = ${c.en}`
            : `"${c.tl}" means "${c.en}". It will come back shortly.`,
        ),
      answered && (!right || lookAgain(c)) && hookView(c),
      answered && proceed(),
    );
  }

  function flashcardView(c: Card): HTMLElement {
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    const showBack = phase === 'back';
    const reverse = format === 'produce';
    const prompt = reverse
      ? h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'How do you say…'), h('p', { class: 'prompt-en' }, c.en))
      : format === 'hear'
        ? h(
            'div',
            { class: 'prompt center' },
            h('p', { class: 'eyebrow' }, 'Do you know what you heard?'),
            audioPair(say, true),
            showBack && h('p', { class: 'tl', lang: 'fil' }, c.tl),
          )
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
      h('p', { class: 'muted' }, 'What you just learned will come back for review when you are about to forget it.'),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: () => app.navigate({ name: 'home' }) }, 'Done'),
    );
  }

  function guideHeading(c: Card, eyebrow = KIND_INFO[c.kind].eyebrow): HTMLElement {
    return h('div', { class: `prompt kind-${c.kind}` }, h('p', { class: 'eyebrow' }, eyebrow), h('p', { class: 'guide-title' }, c.en));
  }

  function guideIntroView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      guideHeading(c),
      guideBody(c),
      hookView(c),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: startQuiz }, 'Got it, try one'),
    );
  }

  /** A gap to fill or a sentence to build. */
  function guideQuizView(c: Card): HTMLElement {
    const q = guide!;
    const right = picked === guideAnswer(q);
    return guideQuestionView(c, q, picked, {
      say,
      onPick: pickAnswer,
      onChange: draw,
      feedback: (right) =>
        guideFeedback(c, q.drill, right, { praise, miss: 'Not quite.', right: step?.kind === 'new' ? 'That one is yours now.' : undefined, after: 'It will come back shortly.' }),
      after: [right && lookAgain(c) && hookView(c), proceed()],
    });
  }

  function guideFlashcardView(c: Card): HTMLElement {
    const d = drill!;
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    const showBack = phase === 'back';
    return h(
      'div',
      { class: 'panel' },
      // Recalling a sentence means saying all of it, so the Tagalog only shows with the answer.
      drillPrompt(c, d, showBack, d.tl ? 'How do you say…' : KIND_INFO[c.kind].label, say, showBack),
      !showBack && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: reveal }, 'Show the answer'),
      showBack &&
        h(
          'div',
          { class: 'answer' },
          !d.tl && h('p', { class: 'meaning' }, d.answer),
          hookShown
            ? h('div', null, guideBody(c), hookView(c))
            : h('button', { class: 'btn hook-btn', onclick: showHook }, 'Show the explanation', h('span', { class: 'key', 'aria-hidden': 'true' }, 'H')),
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

  function guideMissedView(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      guideHeading(c, 'Coming back shortly'),
      drill?.tl ? gapLine(drill, true, say) : drill && h('p', { class: 'meaning' }, drill.answer),
      guideBody(c),
      hookView(c),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function tagalog(c: Card): HTMLElement {
    return h(
      'div',
      { class: 'tl-row' },
      h('p', { class: 'tl', lang: 'fil' }, c.tl),
      audioPair(say),
    );
  }

  app.onKey((e) => {
    if (e.key === 'r' || e.key === 'R') {
      hold();
      return say();
    }
    // Enter and Space activate the focused primary button natively.
    const n = Number(e.key);
    if (phase === 'quiz' && card && !isVocab(card)) {
      if (guide && n >= 1 && n <= guide.choices.length) pickAnswer(guide.choices[n - 1]);
      return;
    }
    if (phase === 'quiz' && n >= 1 && n <= choices.length) return pick(choices[n - 1]);
    if (phase === 'back' && n >= 1 && n <= 4) return rate(RATINGS[n - 1].rating);
    if (phase === 'back' && !hookShown && (e.key === 'h' || e.key === 'H')) return showHook();
  });
  app.onBack(close);

  next();
  return root;
}
