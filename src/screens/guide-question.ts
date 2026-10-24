// Asking a guide one of its questions, the same way in Study and Drills: a gap
// in a sentence to fill from choices, or a sentence to build from tiles. Each
// screen keeps its own feedback and way on, passed in.

import type { Card, Drill } from '../deck';
import { KIND_INFO } from '../guides';
import { buildTiles, canBuild, drillSentence, pickDrill, shuffle } from '../session';
import { play } from '../speech';
import type { Progress } from '../store';
import { audioButton, audioPair, choiceList, h } from '../ui';

export type GuideFormat = 'gap' | 'build';

/** A guide's question as it's being asked. */
export interface GuideQuestion {
  drill: Drill;
  format: GuideFormat;
  /** For a gap: the answer and the wrong ones, shuffled. */
  choices: string[];
  /** For a build: the shuffled tiles, how many the sentence takes (the rest is a decoy), and those placed so far, in order. */
  tiles: string[];
  needed: number;
  placed: number[];
}

/** The ways a guide can be asked: a gap if it has any drill, and for a pattern with a sentence long enough, a build too (as Study asks them). */
export function guideFormats(card: Card): GuideFormat[] {
  const drills = card.drills ?? [];
  if (drills.length === 0) return [];
  return card.kind === 'pattern' && drills.some(canBuild) ? ['gap', 'build'] : ['gap'];
}

/** A drill's whole sentence, to load and, once answered, play; null for a question without one. */
export function sentenceClip(d: Drill): { tl: string } | null {
  return d.tl ? { tl: drillSentence(d) } : null;
}

/** One of the guide's drills, asked as `format`; null when it has none that can be. `last` is kept out, if there's another. */
export function guideQuestion(card: Card, progress: Progress, format: GuideFormat, last?: Drill): GuideQuestion | null {
  const drill = pickDrill(card, progress, format, last);
  if (!drill) return null;
  if (format === 'gap') return { drill, format, choices: shuffle([drill.answer, ...drill.wrong]), tiles: [], needed: 0, placed: [] };
  const { words, decoy } = buildTiles(drill);
  let tiles: string[];
  // Never hand over the tiles already in order.
  do tiles = shuffle(decoy ? [...words, decoy] : words);
  while (tiles.slice(0, words.length).join(' ') === words.join(' '));
  return { drill, format, choices: [], tiles, needed: words.length, placed: [] };
}

/** What a right pick is: the gap's answer, or the built sentence's words in order. */
export function guideAnswer(q: GuideQuestion): string {
  return q.format === 'gap' ? q.drill.answer : buildTiles(q.drill).words.join(' ');
}

/** The tiles placed so far, as the pick to check against guideAnswer. */
export function builtSentence(q: GuideQuestion): string {
  return q.placed.map((i) => q.tiles[i]).join(' ');
}

/** The right answer as a sentence, ending in a full stop if it has no punctuation of its own. */
export function answerText(d: Drill): string {
  const text = drillSentence(d);
  return /[.!?"]$/.test(text) ? text : `${text}.`;
}

/** A drill's Tagalog with its gap shown, or filled once answered, when it can be heard. */
export function gapLine(d: Drill, filled: boolean, say: (slow: boolean) => void): HTMLElement | null {
  if (!d.tl) return null;
  const [before, after] = d.tl.split('___');
  return h(
    'div',
    { class: 'tl-row' },
    h('p', { class: 'tl drill-tl', lang: 'fil' }, before, h('span', { class: `gap ${filled ? 'filled' : ''}` }, filled ? d.answer : '___'), after),
    filled && audioPair(say),
  );
}

/** The back of a card that turns over when tapped (Drills: how well it's known), whether it's turned now, and what to tell when it turns. */
export interface CardBack {
  back: HTMLElement;
  turned: boolean;
  onTurn: (turned: boolean) => void;
}

/** What a tap on the card presses instead of turning it: its own controls. */
const PRESSABLE = 'button, a[href], input, textarea, select, [role="button"], [role="slider"]';

/**
 * A prompt: its eyebrow, then the rest. Given a back, a tap anywhere on the card that isn't on one of its controls
 * (or picking out its text) turns it over, and again turns it back. A screen reader or keyboard has a hidden button
 * for the same.
 */
export function promptBlock(cls: string, eyebrow: string, back: CardBack | null | undefined, ...rest: (HTMLElement | null | false)[]): HTMLElement {
  const face = [h('p', { class: 'eyebrow' }, eyebrow), ...rest];
  if (!back) return h('div', { class: cls }, ...face);
  let turned = back.turned;
  const front = h('div', { class: 'card-front' }, ...face);
  const button = h('button', { class: 'sr-only', type: 'button' }, 'How well you know it');
  const card = h('div', { class: cls, 'data-turnable': '' }, front, back.back, button);
  const show = () => {
    card.classList.toggle('turned', turned);
    front.hidden = turned;
    back.back.hidden = !turned;
    button.setAttribute('aria-expanded', String(turned));
  };
  card.addEventListener('click', (e) => {
    const pressed = (e.target as Element).closest(PRESSABLE);
    if (pressed && pressed !== button) return;
    if (!pressed && String(window.getSelection?.() ?? '')) return;
    turned = !turned;
    show();
    // Played again from the start on every turn.
    card.classList.remove('turning');
    void card.offsetWidth;
    card.classList.add('turning');
    back.onTurn(turned);
  });
  show();
  return card;
}

/** The question, as asked: an English sentence to complete in Tagalog, or a plain question. */
export function drillPrompt(
  c: Card,
  d: Drill,
  filled: boolean,
  eyebrow: string,
  say: (slow: boolean) => void,
  { showTl = true, back = null }: { showTl?: boolean; back?: CardBack | null } = {},
): HTMLElement {
  return d.tl
    ? promptBlock(`prompt kind-${c.kind}`, eyebrow, back, h('p', { class: 'drill-q' }, d.q), showTl && gapLine(d, filled, say))
    : promptBlock(`prompt kind-${c.kind}`, c.en, back, h('p', { class: 'drill-q' }, d.q));
}

/** A guide's explanation: its rule in plain words, and examples to hear. */
export function guideBody(c: Card): (HTMLElement | null)[] {
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

/**
 * How a guide's question went: `praise` or `miss` in bold, then on a miss the answer, `after` it (say, that it comes
 * back), and the guide's rule; on a right answer, `right` if anything.
 */
export function guideFeedback(c: Card, d: Drill, ok: boolean, words: { praise: string; miss: string; right?: string; after?: string }): HTMLElement {
  return h(
    'div',
    { class: `feedback ${ok ? 'good' : 'bad'}`, role: 'status' },
    h('strong', null, ok ? words.praise : words.miss),
    ' ',
    ok ? (words.right ?? '') : `The answer is ${answerText(d)}${words.after ? ` ${words.after}` : ''}`,
    !ok && c.note && h('p', { class: 'feedback-note' }, c.note),
  );
}

export interface GuideViewOptions {
  /** Plays the whole sentence; offered only once it's answered, since the sentence is the answer. */
  say: (slow: boolean) => void;
  /** A gap's choice was picked, or a build was checked: the pick to check against guideAnswer. */
  onPick: (pick: string) => void;
  /** A tile was placed or taken back. */
  onChange: () => void;
  /** How the answer went, shown once it's answered. */
  feedback: (right: boolean) => HTMLElement;
  /** Anything else to show once it's answered: a hook, the way on. */
  after: (HTMLElement | null | false)[];
  /** How well the card is known, on the card's back (Drills). */
  back?: CardBack | null;
}

/** The panel asking a guide's question, with `picked` as the pick so far (null before it's answered). */
export function guideQuestionView(c: Card, q: GuideQuestion, picked: string | null, opts: GuideViewOptions): HTMLElement {
  const answered = picked !== null;
  const right = picked === guideAnswer(q);
  const d = q.drill;
  if (q.format === 'gap') {
    return h(
      'div',
      { class: 'panel' },
      drillPrompt(c, d, answered, d.tl ? 'Fill the gap' : KIND_INFO[c.kind].label, opts.say, { back: opts.back }),
      choiceList(q.choices, { key: (o) => o, label: (o) => o, answer: d.answer, picked, lang: d.tl ? 'fil' : undefined, onPick: opts.onPick }),
      answered && opts.feedback(right),
      ...(answered ? opts.after : []),
    );
  }
  const place = (i: number) => {
    if (answered || q.placed.includes(i)) return;
    q.placed = [...q.placed, i];
    opts.onChange();
  };
  const unplace = (i: number) => {
    if (answered) return;
    q.placed = q.placed.filter((p) => p !== i);
    opts.onChange();
  };
  return h(
    'div',
    { class: 'panel' },
    promptBlock(`prompt kind-${c.kind}`, 'Put it in order', opts.back, h('p', { class: 'drill-q' }, d.q)),
    h(
      'div',
      { class: `build-line ${answered ? (right ? 'right' : 'wrong') : ''}`, lang: 'fil', 'aria-label': 'Your sentence' },
      q.placed.length === 0
        ? h('span', { class: 'muted small' }, 'Tap the words below in order.')
        : q.placed.map((i) => h('button', { class: 'build-tile placed', disabled: answered, onclick: () => unplace(i) }, q.tiles[i])),
    ),
    !answered &&
      h(
        'div',
        { class: 'tile-pool', lang: 'fil' },
        q.tiles.map((t, i) => h('button', { class: 'build-tile', disabled: q.placed.includes(i), onclick: () => place(i) }, t)),
      ),
    !answered &&
      h(
        'button',
        {
          class: 'btn primary big',
          disabled: q.placed.length < q.needed,
          'data-autofocus': q.placed.length === q.needed || undefined,
          onclick: () => opts.onPick(builtSentence(q)),
        },
        'Check',
      ),
    answered && gapLine(d, true, opts.say),
    answered && opts.feedback(right),
    ...(answered ? opts.after : []),
  );
}
