// @vitest-environment happy-dom
// Memory hooks on the study session: shown on introduction, held back in
// review until the learner asks for one or misses the card.

import { describe, expect, it, vi } from 'vitest';
import { LEARN_ORDER, cardKey, getCard, studyWays } from '../deck';
import { DAY_MS } from '../srs';
import { sessionScreen } from './session';
import { button, fakeApp } from '../test/screen';

const hookText = (root: HTMLElement) => root.querySelector('.hook')?.textContent ?? null;

describe('memory hooks in a session', () => {
  it('shows the hook when a word is first introduced', () => {
    const root = sessionScreen(fakeApp(['kumusta']), [{ kind: 'new', cardId: 'salamat' }]);
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
  });

  it('keeps the hook hidden on a review until the answer is shown and asked for', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    expect(hookText(root)).toBeNull();
    button(root, 'Show the meaning').click();
    expect(hookText(root)).toBeNull();
    button(root, 'Show memory hook').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
  });

  it('shows the hook after a missed review before moving on', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Again').click();
    expect(hookText(root)).toContain(getCard('salamat')!.hook);
    button(root, 'Continue').click();
    // The missed card comes straight back, asked the easy way, hook hidden again.
    expect(root.textContent).toContain('What does this mean?');
    expect(hookText(root)).toBeNull();
  });

  it('skips the extra step on a miss when the hook was already open', () => {
    const root = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', format: 'remember' }]);
    button(root, 'Show the meaning').click();
    button(root, 'Show memory hook').click();
    button(root, 'Again').click();
    expect(root.textContent).toContain('What does this mean?');
  });
});

describe('open-ended study', () => {
  it('brings a missed word back after a short gap, without a fixed end', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 0;
    for (const id of Object.keys(app.progress.cards)) app.progress.cards[id].due = app.now() - 1;
    const root = sessionScreen(app, null);
    // Counting down what's left: missed words aren't done, so it stays put.
    expect(root.querySelector('.session-count')?.textContent).toBe('4 left');
    const shown: string[] = [];
    // Answer every question wrong: missed words keep coming round.
    for (let i = 0; i < 8; i++) {
      const prompt = root.querySelector('.prompt')?.textContent ?? '';
      const card = ['salamat', 'kumusta', 'oo', 'paalam'].map((id) => getCard(id)!).find((c) => prompt.includes(c.tl) || prompt.includes(c.en));
      shown.push(card?.id ?? '?');
      const choices = [...root.querySelectorAll<HTMLButtonElement>('.choice')];
      const wrong = choices.find((b) => card && !b.textContent!.includes(card.en) && !b.textContent!.includes(card.tl));
      if (choices.length) {
        expect(wrong).toBeDefined();
        wrong!.click();
        button(root, 'Continue').click();
      } else {
        button(root, 'Show').click();
        button(root, 'Again').click();
        if (root.textContent?.includes('Coming back shortly')) button(root, 'Continue').click();
      }
    }
    expect(root.querySelector('.session-count')?.textContent).toBe('4 left');
    // Never the same word twice running.
    expect(shown.some((id, i) => id === shown[i - 1])).toBe(false);
    expect(root.textContent).not.toContain('caught up');
  });

  it('counts down the cards left as each one is known', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 0;
    // Every other way already started and not due, so knowing a word's reading doesn't start one.
    for (const id of Object.keys(app.progress.cards)) {
      for (const way of studyWays(getCard(id)!)) {
        app.progress.cards[cardKey(id, way)] ??= { ...app.progress.cards[id], interval: 3, due: app.now() + DAY_MS };
      }
      app.progress.cards[id].due = app.now() - 1;
    }
    const root = sessionScreen(app, null);
    expect(root.querySelector('.session-count')?.textContent).toBe('4 left');
    const prompt = root.querySelector('.prompt')?.textContent ?? '';
    const card = ['salamat', 'kumusta', 'oo', 'paalam'].map((id) => getCard(id)!).find((c) => prompt.includes(c.tl) || prompt.includes(c.en))!;
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.choice')];
    if (choices.length) choices.find((b) => b.textContent!.includes(card.en) || b.textContent!.includes(card.tl))!.click();
    else {
      button(root, 'Show').click();
      button(root, 'Good').click();
    }
    expect(root.querySelector('.session-count')?.textContent).toBe('3 left');
  });

  it('says when it is caught up, and points to Drills for more practice, or new words', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 4;
    const navigate = vi.spyOn(app, 'navigate');
    const root = sessionScreen(app, null);
    expect(root.textContent).toContain("You're caught up");
    expect(root.textContent).toContain('Learn something new');
    expect(root.querySelector('.choice')).toBeNull();
    button(root, 'Keep practising in Drills').click();
    expect(navigate).toHaveBeenCalledWith({ name: 'practice' });
  });

  it("doesn't offer new cards when every one left is waiting for the words it is built from to settle", () => {
    const app = fakeApp(LEARN_ORDER.filter((id) => id !== 'kumain-na-ako'));
    const tomorrow = app.now() + DAY_MS;
    for (const state of Object.values(app.progress.cards)) Object.assign(state, { interval: 3, reps: 2, due: tomorrow });
    // Studied every way, so no way of a word is waiting to start.
    for (const id of Object.keys(app.progress.cards)) {
      for (const way of studyWays(getCard(id)!)) app.progress.cards[cardKey(id, way)] ??= { ...app.progress.cards[id] };
    }
    // "Kumain" was met yesterday and hasn't been seen again since.
    Object.assign(app.progress.cards['kumain'], { interval: 1, reps: 1 });
    const root = sessionScreen(app, null);
    expect(root.textContent).toContain("You're caught up");
    expect(root.textContent).not.toContain('Learn something new');
    expect(root.textContent).toContain('The next new cards build on ones you met recently');
  });

  it('offers new words instead of Drills while there are too few words to drill', () => {
    const app = fakeApp(['salamat', 'kumusta']);
    app.progress.settings.dailyNew = 2;
    const root = sessionScreen(app, null);
    expect(root.textContent).toContain("You're caught up");
    expect(root.textContent).not.toContain('Keep practising in Drills');
    expect(button(root, 'Learn something new').classList).toContain('primary');
  });

  it('is caught up once the last due card is answered, and still shows what was done on stopping', () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 4;
    app.progress.cards.salamat = { ...app.progress.cards.salamat, interval: 0, due: app.now() - 1 };
    const root = sessionScreen(app, null);
    [...root.querySelectorAll<HTMLButtonElement>('.choice')].find((b) => b.textContent?.includes(getCard('salamat')!.en))!.click();
    button(root, 'Continue').click();
    expect(root.textContent).toContain("You're caught up");
    expect(root.querySelector('.session-count')?.textContent).toBe('0 left');
    // Looking back from caught up leaves nothing to ask either.
    button(root, 'Previous card').click();
    expect(root.querySelector('.session-count')?.textContent).toBe('0 left');
    button(root, 'Back to the current card').click();
    button(root, 'Stop').click();
    expect(root.textContent).toContain('Session finished');
  });

  it('shows what was done when the learner stops', () => {
    const app = fakeApp();
    const root = sessionScreen(app, null);
    button(root, "Let's go").click();
    button(root, 'Got it, quiz me').click();
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Stop studying"]')!.click();
    expect(root.textContent).toContain('Session finished');
  });

  it('shows what was done on the back gesture too', () => {
    const app = fakeApp();
    let back = () => {};
    app.onBack = (handler) => (back = handler ?? (() => {}));
    const root = sessionScreen(app, null);
    button(root, "Let's go").click();
    button(root, 'Got it, quiz me').click();
    root.querySelector<HTMLButtonElement>('.choice')!.click();
    back();
    expect(root.textContent).toContain('Session finished');
  });

  it("starts the new day's counts when study runs past midnight", () => {
    const app = fakeApp(['salamat', 'kumusta', 'oo', 'paalam']);
    app.progress.settings.dailyNew = 4;
    // Today's new words are used up, but by yesterday's count.
    app.progress.today = { ...app.progress.today, day: '2000-01-01' };
    const root = sessionScreen(app, null);
    expect(root.textContent).not.toContain("You're caught up");
    expect(app.progress.today.newCount).toBe(0);
  });
});

describe('recall from a picture', () => {
  const kape = getCard('kape')!;

  it('asks a word with a picture from it some of the time, picked or self-rated, on the recall card', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const app = fakeApp(['kape', 'tubig', 'isda', 'bahay', 'salamat', 'oo']);
      const root = sessionScreen(app, [
        { kind: 'review', cardId: 'kape', way: 'recall', format: 'recall' },
        { kind: 'review', cardId: 'kape', way: 'recall', format: 'produce' },
      ]);
      expect(root.querySelector('.prompt-picture')?.getAttribute('aria-label')).toBe(kape.en);
      expect(root.querySelector('.prompt-en')).toBeNull();
      button(root, kape.tl).click();
      expect(app.progress.cards[cardKey('kape', 'recall')]?.reps).toBeGreaterThan(0);
      button(root, 'Continue').click();
      // Self-rated: turned over, the Tagalog and the English it pictures.
      expect(root.querySelector('.prompt-picture')).not.toBeNull();
      button(root, 'Show the Tagalog').click();
      expect(root.querySelector('.prompt .prompt-meaning')?.textContent).toBe(kape.en);
      expect(root.querySelector('.answer')?.textContent).toContain(kape.tl);
    } finally {
      random.mockRestore();
    }
  });

  it('asks from the English the rest of the time, and always for a word without a picture', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const root = sessionScreen(fakeApp(['kape']), [{ kind: 'review', cardId: 'kape', way: 'recall', format: 'produce' }]);
      expect(root.querySelector('.prompt-en')?.textContent).toBe(kape.en);
      random.mockReturnValue(0);
      const plain = sessionScreen(fakeApp(['salamat']), [{ kind: 'review', cardId: 'salamat', way: 'recall', format: 'produce' }]);
      expect(plain.querySelector('.prompt-picture')).toBeNull();
    } finally {
      random.mockRestore();
    }
  });
});
