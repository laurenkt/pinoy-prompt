import type { App } from '../app';
import { VOCAB, getCard, isVocab, unitOf, type Card, type Drill } from '../deck';
import { KIND_INFO } from '../guides';
import {
  buildExtraSession,
  distractors,
  buildTiles,
  drillSentence,
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
import { play, speechSupported, stop } from '../speech';
import { recordAnswer, rollDay } from '../store';
import { audioButton, h, hookView, icon, progressBar } from '../ui';
import { quietToggle } from './quiet';
import { defaultDeps, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

type Phase = 'topic-intro' | 'intro' | 'quiz' | 'feedback' | 'build' | 'front' | 'back' | 'missed' | 'speak' | 'caught-up' | 'done';

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
  /** The picked choice: a card id for a word, the answer text for a guide. */
  let picked: string | null = null;
  let hookShown = false;
  /** For a guide: the question being asked, its choices, and for `build`, its shuffled tiles and the order they were placed in. */
  let drill: Drill | undefined;
  let drillChoices: string[] = [];
  let tiles: string[] = [];
  let placed: number[] = [];
  /** How many tiles the right sentence takes; the rest is a decoy. */
  let tilesNeeded = 0;
  const lastDrill = new Map<string, Drill>();
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

  /**
   * Play the card, except while the microphone is open: it would record the app's
   * voice. A guide plays the sentence it is asking about, if there is one,
   * but only once answered: the sentence is the answer.
   */
  const say = (slow = false) => {
    if (!card || speak?.recording()) return;
    if (isVocab(card)) void play(card, slow);
    else if (drill?.tl && (phase === 'feedback' || phase === 'back' || phase === 'missed')) void play({ tl: drillSentence(drill) }, slow);
  };
  const autoplay = () => app.progress.settings.autoplay && say();

  function take(): Step | undefined {
    if (!open) return queue.shift();
    // Study can run past midnight without leaving the screen, so start the new day's counts here.
    app.progress = rollDay(app.progress, app.now());
    // Quiet mode leaves speaking out; skipped speaking is extra practice, so the schedule doesn't notice.
    const canSpeak = speakReady && !app.progress.settings.quiet;
    return nextStudyStep(app.progress, app.now(), recent, { listen: canListen, speak: canSpeak }, misses) ?? undefined;
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
    drill = undefined;
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
        if (isVocab(card)) autoplay();
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
    format = s.format ?? pickFormat(state, { listen: canListen, speak: false }, Math.random, c.kind);
    // A speaking step picked before quiet mode was turned on (say, behind the caught-up note) is asked another way.
    if (format === 'speak' && app.progress.settings.quiet) format = 'read';
    if (!isVocab(c)) {
      askGuide(c);
      return;
    }
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
    } else if (format === 'remember' || format === 'hear' || format === 'produce') {
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
    if (open) return;
    // Open-ended study brings a missed card back by itself: it's still being learned.
    if (rating === 'again') queue = requeue(queue, step);
    else completed++;
  }

  /** Ask a guide one of its drills, in the current format. */
  function askGuide(c: Card): void {
    if (format !== 'build' && format !== 'think') format = 'gap';
    drill = pickDrill(c, app.progress, format, lastDrill.get(c.id));
    if (!drill && format === 'build') {
      format = 'think';
      drill = pickDrill(c, app.progress, format, lastDrill.get(c.id));
    }
    if (!drill) return next();
    lastDrill.set(c.id, drill);
    if (format === 'gap') {
      drillChoices = shuffle([drill.answer, ...drill.wrong]);
      phase = 'quiz';
    } else if (format === 'build') {
      const { words, decoy } = buildTiles(drill);
      tilesNeeded = words.length;
      // Never hand over the tiles already in order.
      do tiles = shuffle(decoy ? [...words, decoy] : words);
      while (tiles.slice(0, words.length).join(' ') === words.join(' '));
      placed = [];
      phase = 'build';
    } else {
      phase = 'front';
    }
    draw();
  }

  function pickAnswer(text: string): void {
    if (!drill || picked) return;
    picked = text;
    finish(text === drill.answer ? 'good' : 'again');
    phase = 'feedback';
    say();
    draw();
  }

  function place(i: number): void {
    if (phase !== 'build' || placed.includes(i)) return;
    placed = [...placed, i];
    draw();
  }

  function unplace(i: number): void {
    if (phase !== 'build') return;
    placed = placed.filter((p) => p !== i);
    draw();
  }

  function checkBuild(): void {
    if (!drill || phase !== 'build') return;
    picked = placed.map((i) => tiles[i]).join(' ');
    finish(picked === buildTiles(drill).words.join(' ') ? 'good' : 'again');
    phase = 'feedback';
    say();
    draw();
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
    finish(choice.id === card.id ? 'good' : 'again');
    phase = 'feedback';
    say();
    draw();
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

  /** Quiet mode on mid-step skips a speaking step: it's practice only, so nothing is recorded and the card stays as it was. */
  function quietChanged(): void {
    if (phase === 'speak' && app.progress.settings.quiet) next();
    else draw();
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
        quietToggle(app, quietChanged),
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
      quietToggle(app, quietChanged),
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
        return isVocab(card) ? introView(card) : guideIntroView(card);
      case 'quiz':
      case 'feedback':
        if (isVocab(card)) return quizView(card);
        return format === 'build' ? buildView(card) : guideQuizView(card);
      case 'build':
        return buildView(card);
      case 'front':
      case 'back':
        return isVocab(card) ? flashcardView(card) : guideFlashcardView(card);
      case 'missed':
        return isVocab(card) ? missedView(card) : guideMissedView(card);
      case 'speak':
        return speakView(card);
      case 'caught-up':
        return caughtUpView();
    }
  }

  function caughtUpView(): HTMLElement {
    const unmet = unmetCount(app.progress) > 0;
    return h(
      'div',
      { class: 'panel center' },
      h('p', { class: 'eyebrow' }, stats.answered ? 'Nice work' : 'Nothing due'),
      h('h2', null, "You're caught up"),
      h(
        'p',
        null,
        unmet ? "No reviews are due, and today's new cards are in." : "No reviews are due, and you've met every card.",
        ' You can keep going with practice on your weakest cards. It won\'t change when they come back.',
      ),
      h(
        'div',
        { class: 'stack' },
        h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: () => (step && card ? ask(card, step) : next()) }, 'Keep practising'),
        unmet &&
          h(
            'button',
            { class: 'btn secondary', onclick: () => app.navigate({ name: 'session', steps: buildExtraSession(app.progress), title: 'Something new' }) },
            'Learn something new',
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
      h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, KIND_INFO[c.kind].eyebrow), tagalog(c)),
      c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint),
      h('p', { class: 'meaning' }, c.en),
      c.note && h('p', { class: 'note' }, c.note),
      hookView(c),
      h('p', { class: 'muted small' }, app.progress.settings.quiet ? 'Listen, then say it in your head a couple of times.' : 'Listen, then say it out loud a couple of times.'),
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
      : format === 'hear'
        ? h(
            'div',
            { class: 'prompt center' },
            h('p', { class: 'eyebrow' }, 'Do you know what you heard?'),
            h('div', { class: 'audio-group big' }, audioButton(() => say(), 'Play again', 'huge'), audioButton(() => say(true), 'Play slowly', 'slow')),
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
      h('p', { class: 'muted' }, 'What you just learned will come back for review when you are about to forget it.'),
      h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: () => app.navigate({ name: 'home' }) }, 'Done'),
    );
  }

  /** A guide's explanation: its rule in plain words, and examples to hear. */
  function guideBody(c: Card): (HTMLElement | null)[] {
    return [
      c.hint ? h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint) : null,
      c.note ? h('p', { class: 'guide-note' }, c.note) : null,
      c.examples?.length
        ? h(
            'ul',
            { class: 'examples' },
            c.examples.map((ex) =>
              h(
                'li',
                null,
                audioButton(() => void play(ex), `Play ${ex.tl}`),
                h('span', { class: 'example-text' }, h('span', { class: 'example-tl', lang: 'fil' }, ex.tl), h('span', { class: 'example-en' }, ex.en)),
              ),
            ),
          )
        : null,
    ];
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

  /** A drill's Tagalog with its gap shown, or filled once answered. */
  function gapLine(d: Drill, filled: boolean): HTMLElement | null {
    if (!d.tl) return null;
    const [before, after] = d.tl.split('___');
    return h(
      'div',
      { class: 'tl-row' },
      h('p', { class: 'tl drill-tl', lang: 'fil' }, before, h('span', { class: `gap ${filled ? 'filled' : ''}` }, filled ? d.answer : '___'), after),
      filled && h('div', { class: 'audio-group' }, audioButton(() => say()), audioButton(() => say(true), 'Play slowly', 'slow')),
    );
  }

  /** The question, as asked: an English sentence to complete in Tagalog, or a plain question. */
  function drillPrompt(c: Card, d: Drill, filled: boolean, eyebrow: string, showTl = true): HTMLElement {
    return d.tl
      ? h('div', { class: `prompt kind-${c.kind}` }, h('p', { class: 'eyebrow' }, eyebrow), h('p', { class: 'drill-q' }, d.q), showTl && gapLine(d, filled))
      : h('div', { class: `prompt kind-${c.kind}` }, h('p', { class: 'eyebrow' }, c.en), h('p', { class: 'drill-q' }, d.q));
  }

  /** The right answer as a sentence, ending in a full stop if it has no punctuation of its own. */
  function answerText(): string {
    const text = drill ? drillSentence(drill) : '';
    return /[.!?"]$/.test(text) ? text : `${text}.`;
  }

  function drillFeedback(c: Card, right: boolean): HTMLElement {
    const extra = step?.kind === 'extra';
    return h(
      'div',
      { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
      h('strong', null, right ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : 'Not quite.'),
      ' ',
      right ? (step?.kind === 'new' ? 'That one is yours now.' : '') : `The answer is ${answerText()}${extra ? '' : ' It will come back shortly.'}`,
      !right && c.note && h('p', { class: 'feedback-note' }, c.note),
    );
  }

  function guideQuizView(c: Card): HTMLElement {
    const d = drill!;
    const answered = picked !== null;
    const right = picked === d.answer;
    return h(
      'div',
      { class: 'panel' },
      drillPrompt(c, d, answered, d.tl ? 'Fill the gap' : KIND_INFO[c.kind].label),
      h(
        'div',
        { class: 'choices' },
        drillChoices.map((choice, i) =>
          h(
            'button',
            {
              class: `choice ${answered && choice === d.answer ? 'correct' : ''} ${answered && choice === picked && !right ? 'wrong' : ''}`,
              disabled: answered,
              'data-autofocus': (!answered && i === 0) || undefined,
              lang: d.tl ? 'fil' : undefined,
              onclick: () => pickAnswer(choice),
            },
            h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
            choice,
          ),
        ),
      ),
      answered && drillFeedback(c, right),
      answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function buildView(c: Card): HTMLElement {
    const d = drill!;
    const answered = phase === 'feedback';
    const right = answered && picked === buildTiles(d).words.join(' ');
    return h(
      'div',
      { class: 'panel' },
      h('div', { class: `prompt kind-${c.kind}` }, h('p', { class: 'eyebrow' }, 'Put it in order'), h('p', { class: 'drill-q' }, d.q)),
      h(
        'div',
        { class: `build-line ${answered ? (right ? 'right' : 'wrong') : ''}`, lang: 'fil', 'aria-label': 'Your sentence' },
        placed.length === 0
          ? h('span', { class: 'muted small' }, 'Tap the words below in order.')
          : placed.map((i) => h('button', { class: 'build-tile placed', disabled: answered, onclick: () => unplace(i) }, tiles[i])),
      ),
      !answered &&
        h(
          'div',
          { class: 'tile-pool', lang: 'fil' },
          tiles.map((t, i) => h('button', { class: 'build-tile', disabled: placed.includes(i), onclick: () => place(i) }, t)),
        ),
      !answered &&
        h(
          'button',
          { class: 'btn primary big', disabled: placed.length < tilesNeeded, 'data-autofocus': placed.length === tilesNeeded || undefined, onclick: checkBuild },
          'Check',
        ),
      answered && gapLine(d, true),
      answered && drillFeedback(c, right),
      answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: next }, 'Continue'),
    );
  }

  function guideFlashcardView(c: Card): HTMLElement {
    const d = drill!;
    const state = app.progress.cards[c.id] ?? newCardState(app.now());
    const showBack = phase === 'back';
    return h(
      'div',
      { class: 'panel' },
      // Recalling a sentence means saying all of it, so the Tagalog only shows with the answer.
      drillPrompt(c, d, showBack, d.tl ? 'How do you say…' : KIND_INFO[c.kind].label, showBack),
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
      drill?.tl ? gapLine(drill, true) : drill && h('p', { class: 'meaning' }, drill.answer),
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
      h('div', { class: 'audio-group' }, audioButton(() => say()), audioButton(() => say(true), 'Play slowly', 'slow')),
    );
  }

  app.onKey((e) => {
    if (e.key === 'r' || e.key === 'R') return say();
    if (phase === 'speak') return;
    // Enter and Space activate the focused primary button natively.
    const n = Number(e.key);
    if (phase === 'quiz' && card && !isVocab(card)) {
      if (n >= 1 && n <= drillChoices.length) pickAnswer(drillChoices[n - 1]);
      return;
    }
    if (phase === 'quiz' && n >= 1 && n <= choices.length) return pick(choices[n - 1]);
    if (phase === 'back' && n >= 1 && n <= 4) return rate(RATINGS[n - 1].rating);
    if (phase === 'back' && !hookShown && (e.key === 'h' || e.key === 'H')) return showHook();
  });

  next();
  return root;
}
