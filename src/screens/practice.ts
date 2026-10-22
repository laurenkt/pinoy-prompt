import type { App } from '../app';
import { VOCAB, getCard, isVocab, type Card } from '../deck';
import { distractors, shuffle } from '../session';
import type { CardState } from '../srs';
import { canPlay, chime, play, preload, stop } from '../speech';
import { audioButton, audioPair, choiceList, h, hookView, icon, pageHeader } from '../ui';
import { continueButton, countdown, holdOnTap, previousButton, type Countdown } from './auto-advance';
import { isSilent, quietToggle } from './quiet';
import { defaultDeps, speakPanel, type SpeakDeps, type SpeakPanel } from './speak';

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
}

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

export function practiceScreen(app: App, deps: SpeakDeps = defaultDeps): HTMLElement {
  const root = h('div', { class: 'practice' });
  const learned = Object.keys(app.progress.cards).filter((id) => getCard(id) && isVocab(getCard(id)!)).length;
  const canListen = canPlay();
  const canSpeak = deps.recordingSupported();
  // Mixed rounds only include speaking once the model is on the device, so they never stop for a download.
  let speakReady = false;
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

  holdOnTap(root, hold);

  /** Why a kind of question can't be asked right now, if it can't: quiet or silent mode may have come on mid-round, here or in another tab. */
  function unavailable(mode: Mode): string | null {
    if (mode === 'listen' && !canListen) return 'Listen needs a voice, and this device has none.';
    if (mode === 'listen' && isSilent(app.progress.settings)) return 'Listen is off in silent mode.';
    if (mode === 'speak' && !canSpeak) return "Speak needs the microphone, and this browser can't record.";
    if (mode === 'speak' && app.progress.settings.quiet) return 'Speak is off in quiet mode.';
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
    return { card, mode, choices };
  }

  /** Note how the current question went, so a miss comes back soon, and pick the one after it. */
  function settle(right: boolean): void {
    if (!current || upcoming) return;
    const id = current.card.id;
    const misses = missed.get(id) ?? 0;
    if (!right) missed.set(id, misses + 1);
    else if (misses > 1) missed.set(id, misses - 1);
    else missed.delete(id);
    upcoming = nextQuestion();
    if (upcoming) preload(upcoming.card);
  }

  function ask(): void {
    speak?.dispose();
    speak = null;
    spokenRight = false;
    const q = current;
    if (q?.mode === 'speak') {
      speak = speakPanel(q.card, {
        say: (slow) => sayCard(q.card, slow),
        silence: () => stop(),
        onAttempt: (right) => {
          if (!right || spokenRight) return;
          spokenRight = true;
          chime();
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
    if (q && q.mode !== 'recall' && (q.mode === 'listen' || app.progress.settings.autoplay)) void play(q.card);
  }

  /** Play a card, except while the microphone is open: it would record the app's voice, not the learner's. */
  function sayCard(card: Card, slow = false): void {
    if (speak?.recording()) return;
    void play(card, slow);
  }

  function choose(choice: Card): void {
    const q = current;
    if (!q || picked) return;
    picked = choice.id;
    const right = choice.id === q.card.id;
    // The chime first, so the word said back is heard after it.
    if (right) chime();
    if (q.mode === 'recall' || q.mode === 'listen') void play(q.card);
    settle(right);
    if (right)
      auto = countdown(root, () => {
        autoMoved = true;
        advance(choice.id);
      });
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
    ask();
  }

  const home = () => app.navigate({ name: 'home' });

  /**
   * The scope or quiet mode changed: a question waiting to be asked that can't be any more is picked again, and so is
   * the one showing, while it's unanswered, so the change shows straight away.
   */
  function rescope(): void {
    const ways = modes();
    if (upcoming && !ways.includes(upcoming.mode)) upcoming = null;
    if (current && !picked && !lookingBack && !ways.includes(current.mode)) {
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
        h('div', { class: 'tl-row' }, h('p', { class: 'tl', lang: 'fil' }, q.card.tl), audioPair(say)),
        h('p', { class: 'prompt-meaning' }, q.card.en),
      );
    } else if (q.mode === 'listen') {
      prompt = h(
        'div',
        { class: 'prompt center' },
        h('p', { class: 'eyebrow' }, 'What did you hear?'),
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

    const [scopeToggle, scopeChips] = scopeControls();
    return h(
      'div',
      { class: 'session' },
      h(
        'header',
        { class: 'session-header' },
        h('button', { class: 'icon-btn', 'aria-label': 'End drill', onclick: home }, icon('close')),
        h('span', { class: 'session-count' }, `${done} done`),
        scopeToggle,
        // Icon only, as on Home: the header also holds the count and the filter, and must fit at 360px.
        quietToggle(app, rescope, { iconOnly: true }),
      ),
      scopeChips,
      previousPick && !answered && !reviewing && q.mode !== 'speak' && previousButton(() => setLookingBack(true)),
      h(
        'div',
        { class: 'panel' },
        prompt,
        q.mode === 'speak' ? speak?.el : null,
        q.mode !== 'speak' &&
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
          ),
        q.mode !== 'speak' && answered && (!right || reviewing) &&
          hookView(q.card),
        q.mode !== 'speak' && answered &&
          (reviewing ? continueButton(() => setLookingBack(false), false, 'Back to the current card') : continueButton(() => advance(), auto !== null, 'Next')),
      ),
    );
  }

  app.onKey((e) => {
    const q = lookingBack ? previous : current;
    if (!q) return;
    if (e.key === 'r' || e.key === 'R') {
      hold();
      return sayCard(q.card);
    }
    if (q.mode === 'speak' || lookingBack) return;
    const n = Number(e.key);
    if (!picked && n >= 1 && n <= q.choices.length) choose(q.choices[n - 1]);
  });
  // Drills open straight into a round; closing it, or going back, goes Home.
  const known = Object.keys(app.progress.cards).map((id) => getCard(id)!).filter((c) => c && isVocab(c));
  distractorPool = known.length >= 6 ? known : VOCAB;
  if (learned >= MIN_CARDS) {
    current = nextQuestion();
    if (current) preload(current.card);
  }
  ask();
  return root;
}
