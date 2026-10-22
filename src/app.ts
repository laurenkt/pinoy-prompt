import type { Step } from './session';
import type { Progress } from './store';

export type Route =
  | { name: 'home' }
  | { name: 'study' }
  | { name: 'session'; steps: Step[]; title?: string }
  | { name: 'practice' }
  /** `start` begins a call straight away, so Home's Chat button is one tap. */
  | { name: 'talk'; start?: boolean }
  | { name: 'words' }
  | { name: 'settings' };

/** What every screen gets: shared progress plus navigation. */
export interface App {
  progress: Progress;
  now(): number;
  /** Persist progress after a change. */
  commit(): void;
  /** Replace progress wholesale (used by reset). */
  replaceProgress(progress: Progress): void;
  navigate(route: Route): void;
  /** Screen-level keyboard shortcuts; cleared on every navigation. */
  onKey(handler: ((e: KeyboardEvent) => void) | null): void;
  /** What the system back gesture does on this screen, if not going Home; cleared on every navigation. */
  onBack(handler: (() => void) | null): void;
}

export type Screen = (app: App) => HTMLElement;

/** Whether a key press is typing into a box, where letters and numbers are words, not a screen's shortcuts. */
export function typingInBox(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(t.type);
  return t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}
