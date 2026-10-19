import '@fontsource-variable/bricolage-grotesque';
import './style.css';
import type { App, Route, Tab } from './app';
import { homeScreen } from './screens/home';
import { practiceScreen } from './screens/practice';
import { sessionScreen } from './screens/session';
import { settingsScreen } from './screens/settings';
import { wordsScreen } from './screens/words';
import { cancelRecording } from './recorder';
import { initVoices, stop } from './speech';
import { replaceContents } from './progress-schema';
import { emptyProgress, load, loadDurable, onExternalChange, requestPersistence, rollDay, save, type Progress } from './store';
import { h } from './ui';

const root = document.getElementById('app')!;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

let warnedSaveFailed = false;

const app: App = {
  // Replaced by the saved progress before the first screen is drawn.
  progress: emptyProgress(Date.now()),
  now: () => Date.now(),
  commit() {
    saved(save(app.progress));
  },
  replaceProgress(progress: Progress) {
    app.progress = progress;
    saved(save(progress));
  },
  navigate(route: Route) {
    stop();
    cancelRecording();
    keyHandler = null;
    app.progress = rollDay(app.progress, Date.now());
    render(route);
    window.scrollTo(0, 0);
  },
  onKey(handler) {
    keyHandler = handler;
  },
};

function render(route: Route): void {
  let screen: HTMLElement;
  let tab: Tab | null = null;
  switch (route.name) {
    case 'home':
      screen = homeScreen(app);
      tab = 'home';
      break;
    case 'practice':
      screen = practiceScreen(app);
      tab = 'practice';
      break;
    case 'words':
      screen = wordsScreen(app, route.unitId);
      tab = 'words';
      break;
    case 'session':
      screen = sessionScreen(app, route.steps, route.title);
      break;
    case 'settings':
      screen = settingsScreen(app);
      break;
  }
  root.replaceChildren(h('main', { class: 'screen' }, screen), ...(tab ? [tabBar(tab)] : []));
}

function tabBar(active: Tab): HTMLElement {
  const tabs: { id: Tab; label: string; route: Route }[] = [
    { id: 'home', label: 'Learn', route: { name: 'home' } },
    { id: 'practice', label: 'Practice', route: { name: 'practice' } },
    { id: 'words', label: 'Words', route: { name: 'words' } },
  ];
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    tabs.map((t) =>
      h(
        'button',
        {
          class: `tab ${t.id === active ? 'active' : ''}`,
          'aria-current': t.id === active ? 'page' : undefined,
          onclick: () => app.navigate(t.route),
        },
        t.label,
      ),
    ),
  );
}

// A held Enter or Space would otherwise click through several screens at once.
document.addEventListener(
  'keydown',
  (e) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  },
  { capture: true },
);

// Installed, it should feel like an app, so turn off zoom. In a browser tab, zoom still works.
if (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) {
  document.documentElement.classList.add('standalone');
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  // iOS ignores user-scalable=no, so cancel its pinch gesture directly.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  keyHandler?.(e);
});

/** Tell the learner, once, if progress stops saving, so they can back it up. */
function saved(ok: boolean): void {
  if (ok) {
    askToPersist();
    return;
  }
  if (warnedSaveFailed) return;
  warnedSaveFailed = true;
  const banner = h(
    'div',
    { class: 'save-warning', role: 'alert' },
    h('p', null, "Progress couldn't be saved on this device. It may be full, or in private browsing. Back up your progress from Settings to keep it."),
    h('button', { class: 'btn secondary', onclick: () => banner.remove() }, 'OK'),
  );
  document.body.append(banner);
}

async function start(): Promise<void> {
  // Another tab saved: pick up its progress in place, so screens holding it see the change.
  onExternalChange((progress) => replaceContents(app.progress, progress));
  try {
    replaceContents(app.progress, await loadDurable(Date.now()));
  } catch {
    replaceContents(app.progress, load(Date.now()));
  }
  app.navigate({ name: 'home' });
  askToPersist();
}

let askedToPersist = false;

/** Once there is progress worth keeping, ask the browser not to evict it. */
function askToPersist(): void {
  if (askedToPersist || Object.keys(app.progress.cards).length === 0) return;
  askedToPersist = true;
  void requestPersistence();
}

void initVoices();
void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
