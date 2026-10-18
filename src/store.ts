// Progress lives in localStorage on the device. Nothing is sent anywhere.

import { newCardState, review, type CardState, type Rating } from './srs';

export interface Settings {
  /** New cards introduced per day. */
  dailyNew: number;
  /** Play audio automatically when a card is shown. */
  autoplay: boolean;
}

export interface Progress {
  cards: Record<string, CardState>;
  today: { day: string; newCount: number; reviewCount: number };
  settings: Settings;
}

const KEY = 'pinoy-prompt:v1';

export const DEFAULT_SETTINGS: Settings = { dailyNew: 8, autoplay: true };

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptyProgress(now: number): Progress {
  return {
    cards: {},
    today: { day: dayKey(now), newCount: 0, reviewCount: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function load(now: number): Progress {
  let progress = emptyProgress(now);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Progress>;
      // Older versions kept a day streak; drop it so it is not saved again.
      delete (saved as Record<string, unknown>).streak;
      progress = {
        ...progress,
        ...saved,
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      };
    }
  } catch {
    // Storage unavailable or corrupt: start fresh rather than fail to load.
  }
  return rollDay(progress, now);
}

export function save(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Private mode or full storage; progress just won't persist.
  }
}

export function reset(now: number): Progress {
  const fresh = emptyProgress(now);
  save(fresh);
  return fresh;
}

/** Start a new day's counters when the date has changed. */
export function rollDay(progress: Progress, now: number): Progress {
  const day = dayKey(now);
  if (progress.today.day === day) return progress;
  return { ...progress, today: { day, newCount: 0, reviewCount: 0 } };
}

/** Record a rating for a card, introducing it if it is new. Mutates and returns progress. */
export function recordAnswer(progress: Progress, cardId: string, rating: Rating, now: number): Progress {
  const existing = progress.cards[cardId];
  if (!existing) progress.today.newCount++;
  else progress.today.reviewCount++;
  progress.cards[cardId] = review(existing ?? newCardState(now), rating, now);
  return progress;
}
