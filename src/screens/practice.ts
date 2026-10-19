import type { App } from '../app';
import { ALL_CARDS, getCard, type Card } from '../deck';
import { listen, ListenError, recognitionSupported, type Listening, type ListenProblem } from '../listen';
import { judge, type Verdict } from '../pronounce';
import { distractors, shuffle } from '../session';
import type { CardState } from '../srs';
import { play, speechSupported, stop } from '../speech';
import { audioButton, h, icon, progressBar } from '../ui';

type Mode = 'listen' | 'read' | 'recall' | 'speak';
type MenuMode = Mode | 'mix';

const ROUND_SIZE = 10;
const MIN_CARDS = 4;

const MODES: { id: MenuMode; title: string; desc: string }[] = [
  { id: 'listen', title: 'Listen', desc: 'Hear Tagalog, pick the meaning' },
  { id: 'read', title: 'Read', desc: 'See Tagalog, pick the meaning' },
  { id: 'recall', title: 'Recall', desc: 'See English, pick the Tagalog' },
  { id: 'speak', title: 'Speak', desc: 'Say it out loud, we check it' },
  { id: 'mix', title: 'Mix it up', desc: 'A bit of everything' },
];

const PROBLEMS: Record<ListenProblem, string> = {
  unsupported: "This browser can't recognise Filipino speech, so speaking questions are off. Chrome on Android usually can.",
  denied: 'The microphone is blocked. Allow it for this site in your browser settings, then try again.',
  offline: "Couldn't reach the speech service. Speaking questions need a connection on this device.",
  failed: 'Something went wrong while listening. Try again.',
};

/** Where a speaking question is up to. */
type Speak =
  | { state: 'ready' }
  | { state: 'listening'; hearing: string }
  | { state: 'heard'; verdict: Verdict }
  | { state: 'problem'; problem: ListenProblem };

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
  const pool = Object.entries(app.progress.cards).map(([id, state]) => ({ card: getCard(id)!, w: weight(state) }))
    .filter((p) => p.card);
  const picked: Card[] = [];
  while (picked.length < size && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let r = Math.random() * total;
    const i = pool.findIndex((p) => (r -= p.w) <= 0);
    picked.push(pool.splice(i === -1 ? pool.length - 1 : i, 1)[0].card);
  }
  return picked;
}

export function practiceScreen(app: App): HTMLElement {
  const root = h('div', { class: 'practice' });
  const learned = Object.keys(app.progress.cards).filter((id) => getCard(id)).length;
  const canListen = speechSupported();

  let questions: Question[] = [];
  let index = 0;
  let picked: string | null = null;
  let score = 0;
  let lastMode: MenuMode = 'mix';
  let speak: Speak = { state: 'ready' };
  let listening: Listening | null = null;
  let passed = false;

  function start(menuMode: MenuMode): void {
    lastMode = menuMode;
    const known = Object.keys(app.progress.cards).map((id) => getCard(id)!).filter(Boolean);
    const distractorPool = known.length >= 6 ? known : ALL_CARDS;
    const modes: Mode[] = ['read', 'recall'];
    if (canListen) modes.push('listen');
    if (recognitionSupported()) modes.push('speak');
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
    // Once the recogniser has said it can't do Filipino, say so rather than offer the microphone.
    speak = recognitionSupported() ? { state: 'ready' } : { state: 'problem', problem: 'unsupported' };
    passed = false;
    draw();
    const q = questions[index];
    if (q && q.mode !== 'recall' && (q.mode === 'listen' || app.progress.settings.autoplay)) void play(q.card);
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
    listening?.cancel();
    index++;
    picked = null;
    ask();
  }

  async function startListening(): Promise<void> {
    const q = questions[index];
    if (!q || speak.state === 'listening') return;
    // Don't let the reference audio leak into the microphone.
    stop();
    speak = { state: 'listening', hearing: '' };
    draw();
    const current = listen((text) => {
      if (listening !== current || speak.state !== 'listening') return;
      speak = { state: 'listening', hearing: text };
      const live = root.querySelector('.hearing');
      if (live) live.textContent = text;
    });
    listening = current;
    try {
      const heard = await current.result;
      if (listening !== current || questions[index] !== q) return;
      const verdict = judge([q.card.tl, ...(q.card.accept ?? [])], heard);
      if (verdict.pass && !passed) {
        passed = true;
        score++;
      }
      speak = { state: 'heard', verdict };
    } catch (err) {
      if (listening !== current || questions[index] !== q) return;
      speak = { state: 'problem', problem: err instanceof ListenError ? err.problem : 'failed' };
    } finally {
      if (listening === current) listening = null;
    }
    draw();
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
        h('h1', null, 'Practice'),
        h(
          'section',
          { class: 'card center' },
          h('p', null, `Learn at least ${MIN_CARDS} words first, then come back here to play with them.`),
          h('button', { class: 'btn primary', onclick: () => app.navigate({ name: 'home' }) }, 'Go to lessons'),
        ),
      );
    }
    return h(
      'div',
      null,
      h('h1', null, 'Practice'),
      h('p', { class: 'muted' }, `Quick rounds of ${ROUND_SIZE} using the ${learned} words you know. Practice doesn't change your review schedule, so play as much as you like.`),
      h(
        'div',
        { class: 'modes' },
        MODES.map((m) => {
          const noVoice = m.id === 'listen' && !canListen;
          const noRecogniser = m.id === 'speak' && !recognitionSupported();
          return h(
            'button',
            { class: `mode mode-${m.id}`, disabled: noVoice || noRecogniser, onclick: () => start(m.id) },
            h('span', { class: 'mode-title' }, m.title),
            h('span', { class: 'mode-desc' }, noVoice ? 'No voice on this device' : noRecogniser ? "Speech checking isn't available in this browser" : m.desc),
          );
        }),
      ),
    );
  }

  function questionView(q: Question): HTMLElement {
    const answered = picked !== null;
    const right = picked === q.card.id;
    const field = q.mode === 'recall' ? 'tl' : 'en';
    const say = (slow = false) => void play(q.card, slow);

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
        h('button', { class: 'icon-btn', 'aria-label': 'End practice', onclick: () => app.navigate({ name: 'practice' }) }, icon('close')),
        progressBar(index, questions.length, 'Round progress'),
        h('span', { class: 'session-title' }, `${score} right`),
      ),
      h(
        'div',
        { class: 'panel' },
        prompt,
        q.mode === 'speak' ? speakView(q) : null,
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
        q.mode !== 'speak' && answered && h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: advance }, 'Next'),
      ),
    );
  }

  function speakView(q: Question): HTMLElement {
    const c = q.card;
    const hint = c.hint && h('p', { class: 'hint' }, h('span', { class: 'muted' }, 'Say it: '), c.hint);
    const mic = (label: string, autofocus = true) =>
      h(
        'button',
        { class: 'btn mic big', 'data-autofocus': autofocus || undefined, onclick: () => void startListening() },
        icon('mic'),
        ' ',
        label,
      );

    switch (speak.state) {
      case 'ready':
        return h(
          'div',
          { class: 'speak' },
          hint,
          mic('Tap and speak'),
          h('p', { class: 'muted small center' }, "Your browser's speech recogniser listens and we compare what it hears with the card."),
        );
      case 'listening':
        return h(
          'div',
          { class: 'speak' },
          hint,
          h(
            'button',
            { class: 'btn mic big listening', 'data-autofocus': true, onclick: () => listening?.stop() },
            h('span', { class: 'pulse', 'aria-hidden': 'true' }),
            ' Listening… tap when done',
          ),
          h('p', { class: 'hearing center', 'aria-live': 'polite', lang: 'fil' }, speak.hearing),
        );
      case 'problem':
        return h(
          'div',
          { class: 'speak' },
          h('div', { class: 'feedback bad', role: 'status' }, h('strong', null, 'Hmm.'), ' ', PROBLEMS[speak.problem]),
          h(
            'div',
            { class: 'row' },
            speak.problem !== 'unsupported' && h('button', { class: 'btn secondary', onclick: () => void startListening() }, 'Try again'),
            h('button', { class: 'btn primary', 'data-autofocus': true, onclick: advance }, 'Skip'),
          ),
        );
      case 'heard': {
        const v = speak.verdict;
        const title = v.pass ? 'Tama!' : v.close ? 'Almost.' : v.heard ? 'Not quite.' : "Didn't catch that.";
        const detail = v.pass
          ? 'That sounded right.'
          : v.heard
            ? 'Words in pink were missed. Listen again and have another go.'
            : 'Speak a little louder or closer to the phone.';
        return h(
          'div',
          { class: 'speak' },
          h(
            'div',
            { class: `feedback ${v.pass ? 'good' : 'bad'}`, role: 'status' },
            h('strong', null, title),
            ' ',
            detail,
            h('p', { class: 'marks', lang: 'fil' }, v.marks.map((m) => h('span', { class: `mark ${m.ok ? 'ok' : 'miss'}` }, m.text))),
            v.heard && h('p', { class: 'heard small' }, h('span', { class: 'muted' }, 'We heard: '), h('span', { lang: 'fil' }, `"${v.heard}"`)),
          ),
          !v.pass && hint,
          v.pass
            ? h('button', { class: 'btn primary big', 'data-autofocus': true, onclick: advance }, 'Next')
            : h(
                'div',
                { class: 'row' },
                h('button', { class: 'btn secondary', onclick: advance }, 'Skip'),
                h('button', { class: 'btn mic', 'data-autofocus': true, onclick: () => void startListening() }, icon('mic'), ' Try again'),
              ),
        );
      }
    }
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
    if (e.key === 'r' || e.key === 'R') return void play(q.card);
    if (q.mode === 'speak') return;
    const n = Number(e.key);
    if (!picked && n >= 1 && n <= q.choices.length) choose(q.choices[n - 1]);
  });

  draw();
  return root;
}
