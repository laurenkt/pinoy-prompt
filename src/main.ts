import './style.css';
import type { App, Route, Tab } from './app';
import { homeScreen } from './screens/home';
import { practiceScreen } from './screens/practice';
import { sessionScreen } from './screens/session';
import { settingsScreen } from './screens/settings';
import { wordsScreen } from './screens/words';
import { initVoices, stop } from './speech';
import { load, rollDay, save, type Progress } from './store';
import { h } from './ui';

const root = document.getElementById('app')!;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

const app: App = {
  progress: load(Date.now()),
  now: () => Date.now(),
  commit() {
    save(app.progress);
  },
  replaceProgress(progress: Progress) {
    app.progress = progress;
    save(progress);
  },
  navigate(route: Route) {
    stop();
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
  const tabs: { id: Tab; label: string; icon: string; route: Route }[] = [
    { id: 'home', label: 'Learn', icon: '🌱', route: { name: 'home' } },
    { id: 'practice', label: 'Practice', icon: '🎯', route: { name: 'practice' } },
    { id: 'words', label: 'Words', icon: '📖', route: { name: 'words' } },
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
        h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon),
        h('span', null, t.label),
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

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  keyHandler?.(e);
});

void initVoices();
app.navigate({ name: 'home' });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
