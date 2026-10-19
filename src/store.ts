// Progress lives on the device. Nothing is sent anywhere.
//
// The main copy is a versioned envelope in localStorage (see progress-schema.ts
// for how it is read and upgraded), mirrored to IndexedDB on every save. The
// rules that keep a learner's work safe:
// - A save never removes a card. It re-reads the stored copy first and folds in
//   anything it doesn't have (another tab's answers, or data this page failed
//   to read at start-up). Only reset() replaces progress wholesale.
// - If the stored copy can't be read at all, nothing is written over it.
// - A copy that can be read but not understood is set aside under
//   UNREADABLE_KEY before anything replaces it.
// - On start-up the newer of the localStorage and IndexedDB copies wins, so
//   losing either one alone loses nothing.

import { readMirror, writeMirror } from './progress-mirror';
import { SCHEMA, dayKey, decode, emptyProgress, encode, mergeInto, type Envelope, type Progress } from './progress-schema';
import { newCardState, review, type Rating } from './srs';

export { DEFAULT_SETTINGS, dayKey, emptyProgress, type Progress, type Settings } from './progress-schema';

export const STORAGE_KEY = 'pinoy-prompt:progress';
/** Where schema 1 kept progress. Read once to upgrade, then left alone. */
export const LEGACY_KEY = 'pinoy-prompt:v1';
/** A stored copy that couldn't be understood, kept for recovery by hand. */
export const UNREADABLE_KEY = 'pinoy-prompt:unreadable';
/** The progress that was there before the last reset. */
export const BEFORE_RESET_KEY = 'pinoy-prompt:before-reset';

/** The revision of the copy this page last read or wrote. */
let rev = 0;
/** The schema to write: this build's, or a newer one whose data was loaded. */
let schema = SCHEMA;

type Stored = { kind: 'missing' } | { kind: 'ok'; envelope: Envelope };

/** Read the stored copy. Throws only if storage itself can't be read. */
function readStored(now: number): Stored {
  let text = localStorage.getItem(STORAGE_KEY);
  if (text === null) text = localStorage.getItem(LEGACY_KEY);
  if (text === null) return { kind: 'missing' };
  const decoded = decode(text, now);
  if (decoded.kind === 'ok') return decoded;
  setAside(text);
  return { kind: 'missing' };
}

function setAside(text: string): void {
  try {
    if (localStorage.getItem(UNREADABLE_KEY) !== text) localStorage.setItem(UNREADABLE_KEY, text);
  } catch {
    // Nowhere to put it; the copy stays where it is until the next save.
  }
}

function adopt(envelope: Envelope): Progress {
  rev = envelope.rev;
  schema = Math.max(schema, envelope.schema);
  return envelope.progress;
}

/** Read progress from localStorage. Never throws; starts fresh if there is nothing to read. */
export function load(now: number): Progress {
  let progress = emptyProgress(now);
  try {
    const stored = readStored(now);
    if (stored.kind === 'ok') progress = adopt(stored.envelope);
  } catch {
    // Storage unavailable. save() re-reads before writing, so nothing is lost if it comes back.
  }
  return rollDay(progress, now);
}

/**
 * Read progress, checking the IndexedDB mirror too. Use at start-up: if the
 * mirror is newer than localStorage (a lost write, a cleared key), the mirror
 * wins and localStorage is brought back up to date.
 */
export async function loadDurable(now: number): Promise<Progress> {
  const progress = load(now);
  const text = await readMirror();
  if (text === null) return progress;
  const mirrored = decode(text, now);
  if (mirrored.kind !== 'ok' || mirrored.envelope.rev < rev) return progress;
  if (mirrored.envelope.rev === rev) {
    // Same revision, but a save that only reached the mirror may share it.
    if (mergeInto(progress, mirrored.envelope.progress) > 0) save(progress);
    return progress;
  }
  const restored = adopt(mirrored.envelope);
  mergeInto(restored, progress);
  save(restored);
  return rollDay(restored, now);
}

/**
 * Save progress. Anything newer in storage is folded into `progress` first,
 * so it may gain cards. Returns false if the main copy couldn't be written.
 */
export function save(progress: Progress, { replace = false } = {}): boolean {
  const now = Date.now();
  let stored: Stored | null;
  try {
    stored = readStored(now);
  } catch {
    stored = null;
  }
  let storedRev = 0;
  if (stored?.kind === 'ok') {
    storedRev = stored.envelope.rev;
    schema = Math.max(schema, stored.envelope.schema);
    // Merging is safe even when nothing changed elsewhere: it only adds cards or newer reviews.
    if (!replace) mergeInto(progress, stored.envelope.progress);
  }

  rev = Math.max(rev, storedRev) + 1;
  const text = encode({ schema, rev, savedAt: now, progress });
  writeMirror(text);
  // If storage couldn't even be read, writing blind could overwrite progress we never saw.
  if (stored === null) return false;
  try {
    localStorage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    // Full storage or private mode; the mirror may still have it.
    return false;
  }
}

/** Erase all progress. The old copy is kept under BEFORE_RESET_KEY. */
export function reset(now: number): Progress {
  try {
    const old = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (old !== null) localStorage.setItem(BEFORE_RESET_KEY, old);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Carry on; the reset itself matters more than the safety copy.
  }
  const fresh = emptyProgress(now);
  save(fresh, { replace: true });
  return fresh;
}

/** Call `listener` with the new progress whenever another tab saves. */
export function onExternalChange(listener: (progress: Progress) => void): void {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || e.newValue === null) return;
    const now = Date.now();
    const decoded = decode(e.newValue, now);
    if (decoded.kind !== 'ok' || decoded.envelope.rev <= rev) return;
    listener(rollDay(adopt(decoded.envelope), now));
  });
}

/** Ask the browser not to evict saved progress when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** A backup file's contents: the same envelope that is stored. */
export function exportBackup(progress: Progress): string {
  return encode({ schema, rev, savedAt: Date.now(), progress });
}

export function backupFileName(now: number): string {
  return `pinoy-prompt-backup-${dayKey(now)}.json`;
}

/**
 * Fold a backup into `progress`. Cards only ever get added or brought up to
 * date, never removed. Returns how many changed, or null if the text isn't a backup.
 */
export function importBackup(progress: Progress, text: string, now: number): number | null {
  const decoded = decode(text, now);
  if (decoded.kind !== 'ok') return null;
  return mergeInto(progress, decoded.envelope.progress);
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

/** Forget what this page has read, as on a fresh start. For tests. */
export function resetStoreForTests(): void {
  rev = 0;
  schema = SCHEMA;
}
