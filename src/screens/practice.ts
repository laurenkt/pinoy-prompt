import type { App } from '../app';
import { VOCAB, getCard, isVocab, type Card } from '../deck';
import { canTypeMeaning, judgeMeaning, type MeaningJudge } from '../meaning';
import { AiError, checkMeaning, errorText, getApiKey } from '../openai';
import { distractors, settled, shuffle } from '../session';
import type { CardState } from '../srs';
import { canPlay, chime, play, preload, stop } from '../speech';
import { audioButton, audioPair, choiceList, h, hookView, icon, iconButton, pageHeader } from '../ui';
import { continueButton, countdown, holdOnTap, previousButton, type Countdown } from './auto-advance';
import { isSilent, quietToggle } from './quiet';
import { askForMicrophone, defaultDeps, micWaiting, needsMicrophone, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

type Mode = 'listen' | 'read' | 'recall' | 'speak';

const MIN_CARDS = 4;
/** How many of the last questions' words are kept out of the next one, so nothing comes straight back. */
const RECENT = 3;

const MODES: { id: Mode; title: string }[] = [
  { id: 'listen', title: 'Listen' },
  { id: 'read', title: 'Read' },
  { id: 'recall', title: 'Recall' },
  { id: 'speak', title: 'Speak' },
];

/** The kinds of question a round may ask. Kept across visits, as the Library's filter is, and back to all of them when the app opens. */
let scope = new Set<Mode>(MODES.map((m) => m.id));

interface Question {
  card: Card;
  mode: Mode;
  choices: Card[];
  /** Listening to a word that has settled in Study: the meaning is typed (or dictated), not picked. */
  typed: boolean;
  /** What's typed so far, kept while the screen is redrawn. */
  draft?: string;
  /** What was typed, once it's sent. */
  answer?: string;
  /** Why OpenAI couldn't be asked about the answer, so it was only checked on the device. */
  failure?: unknown;
  /** The box has been offered, and taken focus, once: later redraws leave the keyboard alone. */
  offered?: boolean;
}

/** What `picked` holds for a typed meaning that wasn't right. */
const MISSED = '';

/** Asks OpenAI, when the learner has given a key for Chat. */
const askOpenAi: MeaningJudge = async (answer, card) => {
  const key = getApiKey();
  return key ? checkMeaning(key, { tl: card.tl, en: card.en, answer }) : null;
};

/** Weaker cards (missed often, low ease, short interval) come up more. */
function weight(state: CardState): number {
  return 1 + state.lapses * 2 + Math.max(0, 3 - state.ease) * 2 + (state.interval < 3 ? 2 : 0);
}

/**
 * The next word for a round that runs until the learner stops it. Weak and due words come up more,
 * a word missed this round comes back after a few others, and the last few words asked sit out.
 */
export function pickNext(app: App, recent: string[], missed: Map<string, number>, random = Math.random): Card | null {
  // Drills are for words and phrases; guides are practised in Study.
  const pool = Object.entries(app.progress.cards)
    .map(([id, state]) => ({ card: getCard(id)!, w: weight(state) + (state.due <= app.now() ? 2 : 0) + (missed.get(id) ?? 0) * 4 }))
    .filter((p) => p.card && isVocab(p.card));
  const keep = Math.min(RECENT, pool.length - 1);
  const skip = new Set(keep > 0 ? recent.slice(-keep) : []);
  const open = pool.filter((p) => !skip.has(p.card.id));
  if (open.length === 0) return null;
  let r = random() * open.reduce((sum, p) => sum + p.w, 0);
  return (open.find((p) => (r -= p.w) <= 0) ?? open[open.length - 1]).card;
}

export function practiceScreen(app: App, deps: SpeakDeps = defaultDeps, askMeaning: MeaningJudge | null = askOpenAi): HTMLElement {
  const root = h('div', { class: 'practice' });
  const learned = Object.keys(app.progress.cards).filter((id) => getCard(id) && isVocab(getCard(id)!)).length;
  const canListen = canPlay();
  const canSpeak = deps.recordingSupported();
  // Mixed rounds only include speaking once the model is on the device, so they never stop for a download.
  let speakReady = deps.modelKnownDownloaded?.() ?? false;
  if (canSpeak) {
    deps.modelDownloaded().then(
      (ready) => (speakReady ||= ready),
      () => {},
    );
  }

  /** The question being asked; null only when there are too few words to drill. */
  let current: Question | null = null;
  /** The question before, for looking back at. */
  let previous: Question | null = null;
  /** The question after, picked once this one is answered so its word can load. */
  let upcoming: Question | null = null;
  let picked: string | null = null;
  /** A typed meaning is being checked. */
  let checking = false;
  /** Questions moved past this round. */
  let done = 0;
  let distractorPool: Card[] = VOCAB;
  /** The last few words asked, oldest first. */
  let recent: string[] = [];
  /** Words missed this round and not yet got right since, with how many times. */
  let missed = new Map<string, number>();
  let speak: SpeakPanel | null = null;
  let spokenRight = false;
  /** Counting down to the next question after a right answer. */
  let auto: Countdown | null = null;
  /** What was picked on the question before, when it moved on by itself; null when there's nothing to look back at. */
  let previousPick: string | null = null;
  let lookingBack = false;
  /** Set as a question moves on by itself, so the next one doesn't take focus: an Enter meant for Next would answer it. */
  let autoMoved = false;
  /** The kinds of question are tucked away until asked for. */
  let scopeOpen = false;
  /** The phone is asking for the microphone, as the round starts (see askForMicrophone). */
  let waiting = false;
  /** The microphone was refused as the round started, so speaking is left out of this visit. */
  let speakSkipped = false;

  holdOnTap(root, hold);

  /** Why a kind of question can't be asked right now, if it can't: quiet or silent mode may have come on mid-round, here or in another tab. */
  function unavailable(mode: Mode): string | null {
    if (mode === 'listen' && !canListen) return 'Listen needs a voice, and this device has none.';
    if (mode === 'listen' && isSilent(app.progress.settings)) return 'Listen is off in silent mode.';
    if (mode === 'speak' && !canSpeak) return "Speak needs the microphone, and this browser can't record.";
    if (mode === 'speak' && app.progress.settings.quiet) return 'Speak is off in quiet mode.';
    if (mode === 'speak' && speakSkipped) return 'Speak needs the microphone. Allow it, then open Drills again.';
    return null;
  }

  /** The kinds in scope that can be asked right now, before the speaking model is taken into account. */
  function chosen(): Mode[] {
    return MODES.map((m) => m.id).filter((m) => scope.has(m) && unavailable(m) === null);
  }

  /**
   * The kinds of question the next one can be: those in scope that can be asked right now. Speaking waits for the model
   * to be on the device, so a round never stops for a download, unless Speak is all that's chosen: then it asks for it.
   * When nothing in scope can be asked (only Listen, then silent mode), it falls back to everything that can.
   */
  function modes(): Mode[] {
    const picks = chosen();
    if (picks.length === 1 && picks[0] === 'speak') return picks;
    const ready = (m: Mode) => m !== 'speak' || speakReady;
    const ways = picks.filter(ready);
    return ways.length ? ways : MODES.map((m) => m.id).filter((m) => unavailable(m) === null && ready(m));
  }

  /** A question on the next word, asked any way the scope allows right now. Null only with no words to ask. */
  function nextQuestion(): Question | null {
    const ways = modes();
    const mode = ways[Math.floor(Math.random() * ways.length)];
    const card = pickNext(app, recent, missed);
    if (!card) return null;
    recent = [...recent.slice(-RECENT), card.id];
    const field = mode === 'recall' ? 'tl' : 'en';
    const choices = mode === 'speak' ? [] : shuffle([card, ...distractors(card, field, 3, distractorPool)]);
    const typed = mode === 'listen' && settled(app.progress, card.id) && canTypeMeaning(card);
    return { card, mode, choices, typed };
  }

  /**
   * From a tap that may let the round ask to speak (opening Drills, the Speak chip, quiet mode going off): if the
   * browser would ask for the microphone, the phone asks now, over a holding screen, rather than over a speaking question.
   */
  function askForMicrophoneIfNeeded(): void {
    if (waiting || !canSpeak || !current || !modes().includes('speak') || !needsMicrophone(deps)) return;
    waiting = true;
    void askForMicrophone(deps).then((answer) => {
      if (answer === 'left') return;
      waiting = false;
      speakSkipped = answer === 'refused';
      if (current && !picked && !modes().includes(current.mode)) {
        current = nextQuestion();
        if (current) preload(current.card);
      }
      // An answered question (the chip tapped after answering) is shown again as it was.
      if (picked) draw();
      else ask();
    });
  }

  /** Note how the current question went, so a miss comes back soon, and pick the one after it. */
  function settle(right: boolean): void {
    if (!current || upcoming) return;
    tally(current.card.id, right);
    upcoming = nextQuestion();
    if (upcoming) preload(upcoming.card);
  }

  function tally(id: string, right: boolean): void {
    const misses = missed.get(id) ?? 0;
    if (!right) missed.set(id, misses + 1);
    else if (misses > 1) missed.set(id, misses - 1);
    else missed.delete(id);
  }

  function ask(): void {
    speak?.dispose();
    speak = null;
    spokenRight = false;
    const q = current;
    if (waiting) return draw();
    if (q?.mode === 'speak') {
      speak = speakPanel(q.card, {
        say: (slow) => sayCard(q.card, slow),
        silence: () => stop(),
        onAttempt: (right) => {
          if (!right || spokenRight) return;
          spokenRight = true;
          void chime();
          // Pick what's next now, so its word loads while the coaching is up.
          settle(true);
          auto = countdown(root, () => {
            autoMoved = true;
            advance();
          });
        },
        counting: () => auto !== null,
        onNext: () => advance(),
        onReady: () => (speakReady = true),
        autofocus: !autoMoved,
        deps,
      });
    }
    draw();
    if (q && (q.mode === 'listen' || (q.mode === 'read' && app.progress.settings.autoplay))) void play(q.card);
  }

  /** Play a card, except on a speaking question before an attempt or while the microphone is open (see `mayPlay`). */
  function sayCard(card: Card, slow = false): void {
    if (speak && !speak.mayPlay()) return;
    void play(card, slow);
  }

  function choose(choice: Card): void {
    const q = current;
    if (!q || picked !== null) return;
    answer(q, choice.id);
  }

  /** Check a typed meaning: on the device, then with OpenAI when there's a key. */
  function send(text: string): void {
    const q = current;
    // Nothing typed (an Enter meant for Next, say) isn't an answer; "Show choices" is there for not knowing.
    if (!q || picked !== null || checking || !text.trim()) return;
    q.answer = text.trim();
    checking = true;
    draw();
    void judgeMeaning(q.answer, q.card, askMeaning).then(({ right, failure }) => {
      // Left the question (or the drill), or went to the choices, while it was being checked.
      if (current !== q || !q.typed || !root.isConnected) return;
      checking = false;
      q.failure = failure;
      answer(q, right ? q.card.id : MISSED);
    });
  }

  function answer(q: Question, pick: string): void {
    picked = pick;
    const right = pick === q.card.id;
    // The chime first, so the word said back is heard after it.
    if (right) void chime();
    if (q.mode === 'recall' || q.mode === 'listen') void play(q.card);
    settle(right);
    if (right)
      auto = countdown(root, () => {
        autoMoved = true;
        advance(pick);
      });
    draw();
  }

  /** The learner says a typed meaning marked wrong was right after all: the check only goes by the card's wording. */
  function claim(): void {
    const q = current;
    if (!q || picked !== MISSED) return;
    picked = q.card.id;
    // Count it as the right answer it was: take back the miss, then tally it right.
    const misses = missed.get(q.card.id) ?? 0;
    if (misses > 1) missed.set(q.card.id, misses - 1);
    else missed.delete(q.card.id);
    tally(q.card.id, true);
    draw();
  }

  /** Not sure enough to type it, or tired of waiting for the check: pick from choices instead. */
  function showChoices(): void {
    const q = current;
    if (!q || picked !== null) return;
    q.typed = false;
    checking = false;
    draw();
  }

  /** Next question; `back` is this one's pick, when it moved on by itself, so it can be looked back at. */
  function advance(back: string | null = null): void {
    hold();
    settle(spokenRight);
    done++;
    previous = current;
    previousPick = back;
    // Picked before quiet or silent mode may have come on, or the scope changed.
    current = upcoming && modes().includes(upcoming.mode) ? upcoming : nextQuestion();
    upcoming = null;
    picked = null;
    checking = false;
    ask();
  }

  const home = () => app.navigate({ name: 'home' });

  /**
   * The scope or quiet mode changed: a question waiting to be asked that can't be any more is picked again, and so is
   * the one showing, while it's unanswered, so the change shows straight away.
   */
  function rescope(): void {
    askForMicrophoneIfNeeded();
    if (waiting) return draw();
    const ways = modes();
    if (upcoming && !ways.includes(upcoming.mode)) upcoming = null;
    if (current && picked === null && !checking && !lookingBack && !ways.includes(current.mode)) {
      hold();
      // Anything settled on the old question (a right spoken attempt picks what's next) goes with it.
      upcoming = null;
      current = nextQuestion();
      if (current) preload(current.card);
      return ask();
    }
    draw();
  }

  function toggleScope(mode: Mode): void {
    // The last kind left in that can be asked stays on, so the round asks what was chosen.
    const picks = chosen();
    if (picks.length === 1 && picks[0] === mode) return;
    if (!scope.delete(mode)) scope.add(mode);
    rescope();
    root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
  }

  /** Stop counting down: the learner wants another look. */
  function hold(): void {
    auto?.cancel();
    auto = null;
  }

  function setLookingBack(on: boolean): void {
    stop();
    lookingBack = on;
    // Quiet mode or the scope may have changed while looking back.
    if (!on) rescope();
    else draw();
  }

  function draw(): void {
    if (!current) root.replaceChildren(tooFew());
    else if (waiting) root.replaceChildren(h('div', { class: 'session' }, ...header(), micWaiting()));
    else if (lookingBack && previous && previousPick) root.replaceChildren(questionView(previous, previousPick));
    else root.replaceChildren(questionView(current, picked));
    if (!autoMoved) root.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    autoMoved = false;
  }

  /** Before there are words enough to drill, a page saying so. */
  function tooFew(): HTMLElement {
    return h(
      'div',
      null,
      ...pageHeader('Drills', home),
      h(
        'section',
        { class: 'card center' },
        h('p', null, `Learn at least ${MIN_CARDS} words first, then come back here to drill them.`),
        h('button', { class: 'btn primary', onclick: () => app.navigate({ name: 'study' }) }, 'Go to Study'),
      ),
    );
  }

  /** The control for which kinds of question a round asks, and its chips, shown when it's opened. */
  function scopeControls(): [HTMLElement, HTMLElement] {
    // Kinds that can't be asked right now don't count either way: with all the rest chosen, or none, it's the mix.
    const picks = chosen();
    const mix = picks.length === 0 || picks.length === MODES.filter((m) => unavailable(m.id) === null).length;
    const label = mix ? 'Mix' : picks.length === 1 ? MODES.find((m) => m.id === picks[0])!.title : `${picks.length} kinds`;
    const toggle = h(
      'button',
      {
        class: `chip filter-toggle ${mix ? '' : 'selected'}`,
        'aria-expanded': String(scopeOpen),
        'aria-controls': 'drill-scope',
        'aria-label': `Questions: ${label}`,
        onclick: () => {
          scopeOpen = !scopeOpen;
          draw();
          root.querySelector<HTMLButtonElement>('.filter-toggle')?.focus();
        },
      },
      icon('filter'),
      label,
    );
    const reasons = MODES.map((m) => unavailable(m.id)).filter(Boolean);
    const chips = h(
      'div',
      { id: 'drill-scope', hidden: !scopeOpen },
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': 'Ask' },
        MODES.map((m) => {
          const on = scope.has(m.id);
          return h(
            'button',
            {
              class: `chip ${on ? 'selected' : ''}`,
              'data-mode': m.id,
              'aria-pressed': String(on),
              // One that can't be asked right now keeps its place, for when quiet mode goes off.
              disabled: unavailable(m.id) !== null,
              // The last kind left in stays on (see toggleScope); say so, rather than look like it will toggle.
              'aria-disabled': String(on && picks.length === 1 && picks[0] === m.id),
              onclick: () => toggleScope(m.id),
            },
            m.title,
          );
        }),
      ),
      reasons.length > 0 && h('p', { class: 'muted scope-note' }, reasons.join(' ')),
    );
    return [toggle, chips];
  }

  function header(): HTMLElement[] {
    const [scopeToggle, scopeChips] = scopeControls();
    return [
      h(
        'header',
        { class: 'session-header' },
        iconButton('close', 'End drill', home),
        h('span', { class: 'session-count' }, `${done} done`),
        scopeToggle,
        quietToggle(app, rescope),
      ),
      scopeChips,
    ];
  }

  /** A question with what was picked on it; the one before, while looking back. */
  function questionView(q: Question, picked: string | null): HTMLElement {
    const reviewing = q !== current;
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
        // No audio until the learner has had a go: the word is played on the result.
        h('p', { class: 'tl', lang: 'fil' }, q.card.tl),
        h('p', { class: 'prompt-meaning' }, q.card.en),
      );
    } else if (q.mode === 'listen') {
      prompt = h(
        'div',
        { class: 'prompt center' },
        h('p', { class: 'eyebrow' }, q.typed ? 'What does it mean?' : 'What did you hear?'),
        audioPair(say, true),
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
      ...header(),
      previousPick && !answered && !checking && !reviewing && q.mode !== 'speak' && previousButton(() => setLookingBack(true)),
      h(
        'div',
        { class: 'panel' },
        prompt,
        q.mode === 'speak' ? speak?.el : null,
        q.typed && typedAnswer(q, picked),
        q.mode !== 'speak' && !q.typed &&
          choiceList(q.choices, {
            key: (c) => c.id,
            label: (c) => c[field],
            answer: q.card.id,
            picked,
            lang: field === 'tl' ? 'fil' : undefined,
            onPick: choose,
          }),
        q.mode !== 'speak' && answered &&
          h(
            'div',
            { class: `feedback ${right ? 'good' : 'bad'}`, role: 'status' },
            h('strong', null, right ? 'Tama!' : 'Mali.'),
            ' ',
            `${q.card.tl} = ${q.card.en}`,
            !right && q.failure !== undefined && h('p', { class: 'feedback-note' }, checkProblem(q.failure)),
          ),
        q.mode !== 'speak' && answered && (!right || reviewing) &&
          hookView(q.card),
        picked === MISSED && !reviewing && h('button', { class: 'btn secondary claim', onclick: claim }, 'I had it right'),
        q.mode !== 'speak' && answered &&
          (reviewing ? continueButton(() => setLookingBack(false), false, 'Back to the current card') : continueButton(() => advance(), auto !== null, 'Next')),
      ),
    );
  }

  /** A box to type the meaning in, or to say it with the keyboard's microphone; it keeps what was sent, marked right or wrong. */
  function typedAnswer(q: Question, picked: string | null): HTMLElement {
    const answered = picked !== null;
    const input = h('input', {
      class: `meaning-input ${answered ? (picked === q.card.id ? 'correct' : 'wrong') : ''}`,
      type: 'text',
      'aria-label': 'What it means, in English',
      placeholder: app.progress.settings.quiet ? 'Type it in English' : 'Type or say it in English',
      autocomplete: 'off',
      enterkeyhint: 'done',
      disabled: answered || checking,
      'data-autofocus': (!answered && !q.offered) || undefined,
      oninput: () => (q.draft = input.value),
    });
    input.value = q.answer ?? q.draft ?? '';
    q.offered = true;
    return h(
      'form',
      {
        class: 'meaning-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          send(input.value);
        },
      },
      input,
      !answered &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', type: 'button', onclick: showChoices }, 'Show choices'),
          h('button', { class: 'btn primary', type: 'submit', disabled: checking }, checking ? 'Checking…' : 'Check'),
        ),
    );
  }

  app.onKey((e) => {
    const q = lookingBack ? previous : current;
    if (!q || waiting) return;
    if (e.key === 'r' || e.key === 'R') {
      hold();
      return sayCard(q.card);
    }
    if (q.mode === 'speak' || lookingBack) return;
    const n = Number(e.key);
    if (picked === null && !q.typed && n >= 1 && n <= q.choices.length) choose(q.choices[n - 1]);
  });
  // Drills open straight into a round; closing it, or going back, goes Home.
  const known = Object.keys(app.progress.cards).map((id) => getCard(id)!).filter((c) => c && isVocab(c));
  distractorPool = known.length >= 6 ? known : VOCAB;
  if (learned >= MIN_CARDS) {
    current = nextQuestion();
    if (current) preload(current.card);
    // Still inside the tap that opened Drills.
    askForMicrophoneIfNeeded();
  }
  ask();
  return root;
}

/** Why a typed meaning was only checked on the device. A key or billing problem says what to fix; anything else, that OpenAI couldn't be reached. */
function checkProblem(failure: unknown): string {
  const fix = failure instanceof AiError && (failure.kind === 'key' || failure.kind === 'quota') ? `${errorText(failure)} ` : "Couldn't reach OpenAI to check other wordings. ";
  return `${fix}If you meant the same thing, tap I had it right.`;
}
