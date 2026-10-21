/** Marks the history entry that sits above Home while another screen shows. */
const AWAY = 'pinoy-prompt-away';

function isAway(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[AWAY] === true;
}

export interface BackHistoryOptions<R> {
  history: Pick<History, 'state' | 'pushState' | 'back'>;
  /** Where `popstate` arrives (the window). */
  events: Pick<EventTarget, 'addEventListener'>;
  isHome(route: R): boolean;
  draw(route: R): void;
  /** The system back gesture or button, used while away from Home. */
  back(): void;
}

/**
 * Ties screens to browser history, so the system back gesture (the iOS edge swipe, Android's
 * back button or gesture) goes back inside the app. Home sits on the base entry and any other
 * screen on one entry above it, so the history never grows and back from Home leaves the app.
 */
export function backHistory<R>(opts: BackHistoryOptions<R>): { go(route: R): void } {
  const { history } = opts;
  // A reload on another screen comes back on the entry above Home.
  let away = isAway(history.state);
  let current: R | null = null;
  // Going Home from above it steps history back first, then draws this once it has.
  let pending: R | null = null;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  function show(route: R): void {
    current = route;
    opts.draw(route);
    sync();
  }

  function sync(): void {
    if (current === null || opts.isHome(current) || away) return;
    history.pushState({ [AWAY]: true }, '');
    away = true;
  }

  function showPending(): void {
    clearTimeout(fallback);
    const route = pending!;
    pending = null;
    show(route);
  }

  opts.events.addEventListener('popstate', (e) => {
    away = isAway((e as PopStateEvent).state);
    if (pending !== null) return showPending();
    // Forward again (a desktop browser) just restores the entry; nothing to draw.
    if (!away && current !== null && !opts.isHome(current)) opts.back();
    // A screen that handled back in place (Study's summary, say) still needs its entry.
    sync();
  });

  return {
    go(route: R) {
      if (pending !== null) {
        pending = route;
      } else if (opts.isHome(route) && away) {
        pending = route;
        history.back();
        // If history can't step back after all, don't leave the old screen up.
        fallback = setTimeout(() => {
          away = isAway(history.state);
          showPending();
        }, 500);
      } else {
        show(route);
      }
    },
  };
}
