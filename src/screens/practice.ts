import type { App } from '../app';
import { ALL_CARDS, getCard, type Card } from '../deck';
import { listen, ListenError, recognitionBlocker, recognitionSupported, type Listening, type ListenPhase, type ListenProblem } from '../listen';
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
  'home-screen': "Apps opened from an iPhone's home screen can't use speech recognition, so speaking questions are off here.",
  denied: 'The microphone is blocked. Allow it for this site in your browser settings, then try again.',
  'no-mic': "Couldn't use the microphone. Check that the device has one and no other app is using it.",
  'no-start': "The speech recogniser didn't start. If your browser asked for permission, allow it and try again. Otherwise this browser may not support it.",
  offline: "Couldn't reach the speech service. Speaking questions need a connection on this device.",
  failed: 'Something went wrong while listening. Try again.',
};

const PHASES: Record<ListenPhase, string> = {
  starting: 'Waiting for the microphone…',
  'mic-on': 'Mic on. Say it now.',
  sound: 'Hearing you…',
  finishing: 'Checking what we heard…',
};

/** What the Speak menu button says when it can't be used. */
function speakUnavailable(problem: ListenProblem): string {
  return problem === 'home-screen' ? 'Not available in iPhone home-screen apps' : "Speech checking isn't available in this browser";
}

/** Where a speaking question is up to. */
type Speak =
  | { state: 'ready' }
  | { state: 'listening'; phase: ListenPhase; hearing: string }
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
    const blocked = recognitionBlocker();
    speak = blocked ? { state: 'problem', problem: blocked } : { state: 'ready' };
    draw();
    const q = questions[index];
    if (q && q.mode !== 'recall' && (q.mode === 'listen' || app.progress.settings.autoplay)) void play(q.card);
  }

  /** Play a card, except while the microphone is open: the recogniser would hear the voice, not the learner. */
  function sayCard(card: Card, slow = false): void {
    if (speak.state === 'listening') return;
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
    speak = { state: 'listening', phase: 'starting', hearing: '' };
    draw();
    const current: Listening = listen({
      onPhase: (phase) => {
        if (listening !== current || speak.state !== 'listening') return;
        speak = { ...speak, phase };
        showListening();
      },
      onHearing: (hearing) => {
        if (listening !== current || speak.state !== 'listening') return;
        speak = { ...speak, hearing };
        showListening();
      },
    });
    listening = current;
    try {
      const heard = await current.result;
      if (listening !== current || questions[index] !== q) return;
      const verdict = judge([q.card.tl, ...(q.card.accept ?? [])], heard);
      if (verdict.pass) score++;
      speak = { state: 'heard', verdict };
    } catch (err) {
      if (listening !== current || questions[index] !== q) return;
      speak = { state: 'problem', problem: err instanceof ListenError ? err.problem : 'failed' };
    } finally {
      if (listening === current) listening = null;
    }
    draw();
  }

  /** Update the listening view in place, so it doesn't re-animate or lose focus on every event. */
  function showListening(): void {
    if (speak.state !== 'listening') return;
    const view = root.querySelector('.speak');
    if (!view) return;
    view.className = `speak listening phase-${speak.phase}`;
    view.querySelector('.listen-status')!.textContent = PHASES[speak.phase];
    view.querySelector('.hearing')!.textContent = speak.hearing;
    const done = view.querySelector<HTMLButtonElement>('.done')!;
    done.disabled = speak.phase === 'finishing';
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
    const speakBlocker = recognitionBlocker();
    return h(
      'div',
      null,
      h('h1', null, 'Practice'),
      h('p', { class: 'muted' }, `Quick rounds of ${ROUND_SIZE} using the ${learned} words you know. Practice doesn't change your review schedule, so play as much as you like.`),
      h(
        'div',
        { class: 'modes' },
        MODES.map((m) => {
          let unavailable: string | null = null;
          if (m.id === 'listen' && !canListen) unavailable = 'No voice on this device';
          if (m.id === 'speak' && speakBlocker) unavailable = speakUnavailable(speakBlocker);
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
    const mic = (label: string, className = 'btn mic big') =>
      h(
        'button',
        { class: className, 'data-autofocus': true, onclick: () => void startListening() },
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
          { class: `speak listening phase-${speak.phase}` },
          hint,
          // Five bars that sit still while the mic is open and dance while it picks up sound.
          h('div', { class: 'meter', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('span', null))),
          h('p', { class: 'listen-status center', role: 'status' }, PHASES[speak.phase]),
          h('p', { class: 'hearing center', 'aria-live': 'polite', lang: 'fil' }, speak.hearing),
          h(
            'button',
            { class: 'btn mic big done', 'data-autofocus': true, disabled: speak.phase === 'finishing', onclick: () => listening?.stop() },
            "I'm done",
          ),
        );
      case 'problem':
        return h(
          'div',
          { class: 'speak' },
          h('div', { class: 'feedback bad', role: 'status' }, h('strong', null, 'Hmm.'), ' ', PROBLEMS[speak.problem]),
          h(
            'div',
            { class: 'row' },
            speak.problem !== 'unsupported' && speak.problem !== 'home-screen' && h('button', { class: 'btn secondary', onclick: () => void startListening() }, 'Try again'),
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
                mic('Try again', 'btn mic'),
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
    if (e.key === 'r' || e.key === 'R') return sayCard(q.card);
    if (q.mode === 'speak') return;
    const n = Number(e.key);
    if (!picked && n >= 1 && n <= q.choices.length) choose(q.choices[n - 1]);
  });

  draw();
  return root;
}
