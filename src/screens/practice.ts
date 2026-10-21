import type { App } from '../app';
import { VOCAB, getCard, isVocab, type Card } from '../deck';
import { distractors, shuffle } from '../session';
import type { CardState } from '../srs';
import { play, speechSupported, stop } from '../speech';
import { audioButton, h, hookView, icon, progressBar } from '../ui';
import { isSilent, quietToggle } from './quiet';
import { defaultDeps, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

type Mode = 'listen' | 'read' | 'recall' | 'speak';
type MenuMode = Mode | 'mix';

const ROUND_SIZE = 10;
const MIN_CARDS = 4;

const MODES: { id: MenuMode; title: string; desc: string }[] = [
  { id: 'listen', title: 'Listen', desc: 'Hear Tagalog, pick the meaning' },
  { id: 'read', title: 'Read', desc: 'See Tagalog, pick the meaning' },
  { id: 'recall', title: 'Recall', desc: 'See English, pick the Tagalog' },
  { id: 'speak', title: 'Speak', desc: 'Say it out loud, get coaching on each sound' },
  { id: 'mix', title: 'Mix it up', desc: 'A bit of everything' },
];

interface Question {
  card: Card;
  mode: Mode;
  choices: Card[];
}

/** Weaker cards (missed often, low ease, short interval) come up more. */
function weight(state: CardState): number {
  return 1 + state.lapses * 2 + Math.max(0, 3 - state.ease) * 2 + (state.interval < 3 ? 2 : 0);
}

function pickRound(app: App, size: number): Card[] {
  // Drills are for words and phrases; guides are practised in Study.
  const pool = Object.entries(app.progress.cards).map(([id, state]) => ({ card: getCard(id)!, w: weight(state) }))
    .filter((p) => p.card && isVocab(p.card));
  const picked: Card[] = [];
  while (picked.length < size && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let r = Math.random() * total;
    const i = pool.findIndex((p) => (r -= p.w) <= 0);
    picked.push(pool.splice(i === -1 ? pool.length - 1 : i, 1)[0].card);
  }
  return picked;
}

export function practiceScreen(app: App, deps: SpeakDeps = defaultDeps): HTMLElement {
  const root = h('div', { class: 'practice' });
  const learned = Object.keys(app.progress.cards).filter((id) => getCard(id) && isVocab(getCard(id)!)).length;
  const canListen = speechSupported();
  const canSpeak = deps.recordingSupported();
  // Mixed rounds only include speaking once the model is on the device, so they never stop for a download.
  let speakReady = false;
  if (canSpeak) {
    deps.modelDownloaded().then(
      (ready) => (speakReady ||= ready),
      () => {},
    );
  }

  let questions: Question[] = [];
  let index = 0;
  let picked: string | null = null;
  let score = 0;
  let lastMode: MenuMode = 'mix';
  let speak: SpeakPanel | null = null;
  let spokenRight = false;

  function start(menuMode: MenuMode): void {
    lastMode = menuMode;
    const known = Object.keys(app.progress.cards).map((id) => getCard(id)!).filter((c) => c && isVocab(c));
    const distractorPool = known.length >= 6 ? known : VOCAB;
    const modes: Mode[] = ['read', 'recall'];
    if (canListen && !isSilent(app.progress.settings)) modes.push('listen');
    if (canSpeak && speakReady && !app.progress.settings.quiet) modes.push('speak');
    questions = pickRound(app, ROUND_SIZE).map((card) => {
      const mode = menuMode === 'mix' ? modes[Math.floor(Math.random() * modes.length)] : menuMode;
      const field = mode === 'recall' ? 'tl' : 'en';
      const choices = mode === 'speak' ? [] : shuffle([card, ...distractors(card, field, 3, distractorPool)]);
      return { card, mode, choices };
    });
    index = 0;
    score = 0;
    picked = null;
    ask();
  }

  function ask(): void {
    speak?.dispose();
    speak = null;
    spokenRight = false;
    const current = questions[index];
    if (current?.mode === 'speak') {
      speak = speakPanel(current.card, {
        say: (slow) => sayCard(current.card, slow),
        silence: stop,
        onAttempt: (right) => {
          if (!right || spokenRight) return;
          spokenRight = true;
          score++;
          const title = root.querySelector('.session-title');
          if (title) title.textContent = `${score} right`;
        },
        onNext: advance,
        onReady: () => (speakReady = true),
        deps,
      });
    }
    draw();
    const q = questions[index];
    if (q && q.mode !== 'recall' && (q.mode === 'listen' || app.progress.settings.autoplay)) void play(q.card);
  }

  /** Play a card, except while the microphone is open: it would record the app's voice, not the learner's. */
  function sayCard(card: Card, slow = false): void {
    if (speak?.recording()) return;
    void play(card, slow);
  }

  function choose(choice: Card): void {
    const q = questions[index];
    if (!q || picked) return;
    picked = choice.id;
    if (choice.id === q.card.id) score++;
    if (q.mode === 'recall' || q.mode === 'listen') void play(q.card);
    draw();
  }

  function advance(): void {
    index++;
    picked = null;
    ask();
  }

  function draw(): void {
    if (questions.length === 0) root.replaceChildren(menu());
    else if (index >= questions.length) root.replaceChildren(results());
    else root.replaceChildren(questionView(questions[index]));
    root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  function menu(): HTMLElement {
    if (learned < MIN_CARDS) {
      return h(
        'div',
        null,
        h('h1', null, 'Drills'),
        h(
          'section',
          { class: 'card center' },
          h('p', null, `Learn at least ${MIN_CARDS} words first, then come back here to drill them.`),
          h('button', { class: 'btn primary', onclick: () => app.navigate({ name: 'study' }) }, 'Go to Study'),
        ),
      );
    }
    return h(
      'div',
      null,
      h('div', { class: 'title-row' }, h('h1', null, 'Drills'), quietToggle(app, draw)),
      h('p', { class: 'muted' }, `Pick one skill and drill it: quick rounds of ${ROUND_SIZE} using the ${learned} words you know. Study already mixes these in; drills are for working on one on purpose. They don't change your review schedule.`),
      h(
        'div',
        { class: 'modes' },
        MODES.map((m) => {
          let unavailable: string | null = null;
          if (m.id === 'listen' && !canListen) unavailable = 'No voice on this device';
          else if (m.id === 'listen' && isSilent(app.progress.settings)) unavailable = 'Silent mode: needs headphones';
          if (m.id === 'speak' && !canSpeak) unavailable = "This browser can't record from the microphone";
          else if (m.id === 'speak' && app.progress.settings.quiet) unavailable = 'Off in quiet mode';
          return h(
            'button',
            { class: `mode mode-${m.id}`, disabled: unavailable !== null, onclick: () => start(m.id) },
            h('span', { class: 'mode-title' }, m.title),
            h('span', { class: 'mode-desc' }, unavailable ?? m.desc),
          );
        }),
      ),
    );
  }

  function questionView(q: Question): HTMLElement {
    const answered = picked !== null;
    const right = picked === q.card.id;
    const field = q.mode === 'recall' ? 'tl' : 'en';
    const say = (slow = false) => sayCard(q.card, slow);

    let prompt: HTMLElement;
    if (q.mode === 'speak') {
      prompt = h(
        'div',
        { class: 'prompt' },
        h('p', { class: 'eyebrow' }, 'Say this out loud'),
        h('div', { class: 'tl-row' }, h('p', { class: 'tl', lang: 'fil' }, q.card.tl), h('div', { class: 'audio-group' }, audioButton(() => say()), audioButton(() => say(true), 'Play slowly', 'slow'))),
        h('p', { class: 'prompt-meaning' }, q.card.en),
      );
    } else if (q.mode === 'listen') {
      prompt = h(
        'div',
        { class: 'prompt center' },
        h('p', { class: 'eyebrow' }, 'What did you hear?'),
        h('div', { class: 'audio-group big' }, audioButton(() => say(), 'Play again', 'huge'), audioButton(() => say(true), 'Play slowly', 'slow')),
        answered && h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
      );
    } else if (q.mode === 'read') {
      prompt = h(
        'div',
        { class: 'prompt' },
        h('p', { class: 'eyebrow' }, 'What does this mean?'),
        h('div', { class: 'tl-row' }, h('p', { class: 'tl', lang: 'fil' }, q.card.tl), audioButton(() => say())),
      );
    } else {
      prompt = h('div', { class: 'prompt' }, h('p', { class: 'eyebrow' }, 'How do you say…'), h('p', { class: 'prompt-en' }, q.card.en));
    }

    return h(
      'div',
      { class: 'session' },
      h(
        'header',
        { class: 'session-header' },
        h('button', { class: 'icon-btn', 'aria-label': 'End drill', onclick: () => app.navigate({ name: 'practice' }) }, icon('close')),
        progressBar(index, questions.length, 'Round progress'),
        h('span', { class: 'session-title' }, `${score} right`),
      ),
      h(
        'div',
        { class: 'panel' },
        prompt,
        q.mode === 'speak' ? speak?.el : null,
        q.mode !== 'speak' && h(
          'div',
          { class: 'choices' },
          q.choices.map((choice, i) =>
            h(
              'button',
              {
                class: `choice ${answered && choice.id === q.card.id ? 'correct' : ''} ${answered && choice.id === picked && !right ? 'wrong' : ''}`,
                disabled: answered,
                'data-autofocus': (!answered && i === 0) || undefined,
                lang: field === 'tl' ? 'fil' : undefined,
                onclick: () => choose(choice),
              },
              h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1),
              choice[field],
            ),
          ),
        ),
        q.mode !== 'speak' && answered &&
          h(
            'div',
            { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
            h('strong', null, right ? 'Tama!' : 'Mali.'),
            ' ',
            `${q.card.tl} = ${q.card.en}`,
          ),
        q.mode !== 'speak' && answered && !right &&
          hookView(q.card),
        q.mode !== 'speak' && answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: advance }, 'Next'),
      ),
    );
  }

  function results(): HTMLElement {
    const perfect = score === questions.length;
    return h(
      'div',
      { class: 'panel center' },
      h('h2', null, `${score} / ${questions.length}`),
      h('p', null, perfect ? 'Perpekto! Perfect round.' : score >= questions.length / 2 ? 'Magaling! Nice work.' : 'Kaya mo yan! You can do it.'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn secondary', onclick: () => { questions = []; draw(); } }, 'Change mode'),
        h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => start(lastMode) }, 'Play again'),
      ),
    );
  }

  app.onKey((e) => {
    const q = questions[index];
    if (!q) return;
    if (e.key === 'r' || e.key === 'R') return sayCard(q.card);
    if (q.mode === 'speak') return;
    const n = Number(e.key);
    if (!picked && n >= 1 && n <= q.choices.length) choose(q.choices[n - 1]);
  });

  draw();
  return root;
}
