import type { Step } from './session';
import type { Progress } from './store';

export type Route =
  | { name: 'home' }
  | { name: 'study' }
  | { name: 'session'; steps: Step[]; title?: string }
  | { name: 'practice' }
  | { name: 'talk' }
  | { name: 'words' }
  | { name: 'settings' };

export type Tab = 'home' | 'practice' | 'words';

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
}

export type Screen = (app: App) => HTMLElement;
