import type { App } from '../app';
import { UNITS, cardKey, studyWays, type Card, type CardKind } from '../deck';
import { GUIDES, KIND_INFO } from '../guides';
import { STRENGTHS, strengthCounts } from '../memory';
import { play } from '../speech';
import { audioButton, chip, h, icon, pageHeader, strengthBadge } from '../ui';

type Filter = 'all' | 'vocab' | Exclude<CardKind, 'word' | 'phrase'>;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vocab', label: 'Words & phrases' },
  { id: 'pattern', label: KIND_INFO.pattern.label },
  { id: 'sound', label: KIND_INFO.sound.label },
  { id: 'tune', label: KIND_INFO.tune.label },
  { id: 'knowhow', label: KIND_INFO.knowhow.label },
];

/** Kept across visits, so the Library opens where the learner left it. */
let filter: Filter = 'all';

/**
 * Everything there is to learn: words and phrases by topic, then the guides by kind. Tap any card to hear it, learned or not.
 * Opened from Settings, so its back arrow and the system back go there.
 */
export function wordsScreen(app: App): HTMLElement {
  const root = h('div', { class: 'words' });
  const back = () => app.navigate({ name: 'settings' });
  app.onBack(back);
  // The filters stay tucked away until asked for, so the list starts near the top.
  let filtersOpen = false;

  /** The cards of a word or guide met so far, one for each way Study asks it (see Way). */
  const studied = (card: Card) => studyWays(card).flatMap((way) => app.progress.cards[cardKey(card.id, way)] ?? []);
  /** A word is only as firm as its weakest way met: read well, but not yet recalled, shows how well it's recalled. */
  const badge = (card: Card) => strengthBadge(studied(card).sort((a, b) => a.interval - b.interval)[0]);

  function wordItem(card: Card): HTMLElement {
    return h(
      'li',
      { class: `word ${app.progress.cards[card.id] ? '' : 'unseen'}` },
      audioButton(() => void play(card), `Play ${card.tl}`),
      h(
        'div',
        { class: 'word-text' },
        h('span', { class: 'word-tl', lang: 'fil' }, card.tl, ' ', badge(card)),
        h('span', { class: 'word-en' }, card.en),
        card.hint && h('span', { class: 'word-hint' }, card.hint),
        h('span', { class: 'word-hook' }, card.hook),
      ),
    );
  }

  /** A guide shows its rule once met; before that, just its name, so it's still a surprise worth meeting. */
  function guideItem(card: Card): HTMLElement {
    const met = !!app.progress.cards[card.id];
    return h(
      'li',
      { class: `word guide ${met ? '' : 'unseen'}` },
      h(
        'div',
        { class: 'word-text' },
        h('span', { class: 'word-tl' }, card.en, ' ', badge(card)),
        met ? h('span', { class: 'word-en' }, card.note) : h('span', { class: 'word-hook' }, 'Not met yet. It comes once you know the words it builds on.'),
        met &&
          card.examples?.map((ex) =>
            h('span', { class: 'guide-example' }, audioButton(() => void play(ex), `Play ${ex.tl}`), h('span', { lang: 'fil' }, ex.tl), ' ', h('span', { class: 'muted' }, ex.en)),
          ),
      ),
    );
  }

  /**
   * A group's heading is its own memory bar: its cards by strength fill it from
   * the left in the colours of Home's memory chart, firmest first, and the rest,
   * cards not met yet, stay the plain card. The title is drawn again in dark
   * ink over the fill, so it reads on both.
   */
  function memoryFill(group: Card[], body: () => HTMLElement): HTMLElement[] {
    // Counted in cards like Home's chart: each way a word is studied is one.
    const met = group.flatMap(studied);
    const total = group.reduce((sum, card) => sum + studyWays(card).length, 0);
    const counts = strengthCounts(met);
    const firmest = [...STRENGTHS].reverse().filter((s) => counts[s.id]);
    const label = met.length
      ? `${met.length} of ${total} met: ${firmest.map((s) => `${s.label} ${counts[s.id]}`).join(', ')}`
      : `None of ${total} met yet`;
    const filled = (met.length / total) * 100;
    // The title comes first, so a screen reader names the topic before its count.
    return [
      body(),
      h(
        'span',
        { class: `memory-fill${met.length === total ? ' full' : ''}`, role: 'img', 'aria-label': label },
        firmest.map((s) => h('span', { class: `s-${s.id}`, style: { width: `${(counts[s.id] / total) * 100}%` } })),
      ),
      met.length ? h('span', { class: 'memory-ink', 'aria-hidden': 'true', style: { clipPath: `inset(0 ${100 - filled}% 0 0)` } }, body()) : null,
    ].filter((el): el is HTMLElement => !!el);
  }

  function group(title: string, sub: string | null, cards: Card[], item: (card: Card) => HTMLElement): HTMLElement {
    return h(
      'details',
      // Narrowed to one kind of guide, there is only one group, so it opens straight away.
      { class: 'card unit-list', open: filter !== 'all' && filter !== 'vocab' },
      h('summary', null, memoryFill(cards, () => h('span', { class: 'unit-body' }, h('span', { class: 'unit-title' }, title), sub && h('span', { class: 'unit-tl' }, sub)))),
      h('ul', { class: 'word-list' }, cards.map(item)),
    );
  }

  function draw(): void {
    const showVocab = filter === 'all' || filter === 'vocab';
    const kinds = (['pattern', 'sound', 'tune', 'knowhow'] as const).filter((k) => filter === 'all' || filter === k);
    const current = FILTERS.find((f) => f.id === filter)!;
    const chips = h(
      'div',
      { class: 'chips', id: 'library-filters', role: 'group', 'aria-label': 'Show', hidden: !filtersOpen },
      FILTERS.map((f) =>
        chip(f.label, filter === f.id, {
          onclick: () => {
            filter = f.id;
            filtersOpen = false;
            draw();
            root.querySelector<HTMLButtonElement>('.filter-toggle')!.focus();
          },
        }),
      ),
    );
    // Opening and closing only shows the chips, so open topics and the scroll position stay put.
    const toggle = h(
      'button',
      {
        class: 'chip filter-toggle',
        'aria-expanded': String(filtersOpen),
        'aria-controls': 'library-filters',
        onclick: () => {
          filtersOpen = !filtersOpen;
          chips.hidden = !filtersOpen;
          toggle.setAttribute('aria-expanded', String(filtersOpen));
        },
      },
      icon('filter'),
      current.label,
    );
    root.replaceChildren(
      ...pageHeader('Library', back, toggle, undefined, 'Back to Settings'),
      chips,
      h('p', { class: 'muted' }, 'Tap the speaker to hear any word.'),
      ...(showVocab ? UNITS.map((unit) => group(unit.title, unit.tlTitle, unit.cards, wordItem)) : []),
      ...kinds.map((k) => group(KIND_INFO[k].label, null, GUIDES.filter((g) => g.kind === k), guideItem)),
    );
  }

  draw();
  return root;
}
