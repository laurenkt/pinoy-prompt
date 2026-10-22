import '@fontsource-variable/bricolage-grotesque';
import './style.css';
import type { App, Route } from './app';
import { backHistory } from './back-history';
import { homeScreen } from './screens/home';
import { practiceScreen } from './screens/practice';
import { sessionScreen } from './screens/session';
import { settingsScreen } from './screens/settings';
import { hangUpTalk, talkScreen } from './screens/talk';
import { wordsScreen } from './screens/words';
import { forgetRetiredVoiceChoice } from './openai';
import { applyAudioMode } from './screens/quiet';
import { cancelRecording } from './recorder';
import { endMicrophoneHold } from './microphone';
import { keepClipsOffline } from './clip-cache';
import { keepSpeakingReady, modelDownloaded } from './model-cache';
import { watchFit } from './fit';
import { allClipUrls, initVoices, stop, tickOnPress } from './speech';
import { replaceContents } from './progress-schema';
import { emptyProgress, load, loadDurable, onExternalChange, requestPersistence, rollDay, save, type Progress } from './store';
import { h } from './ui';

const root = document.getElementById('app')!;
// A screen that fits doesn't bounce; a long one scrolls as usual (style.css).
watchFit(root);
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let backHandler: (() => void) | null = null;

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
    // Done at once: going Home waits a moment for history, and the old screen mustn't act meanwhile.
    stop();
    cancelRecording();
    hangUpTalk();
    endMicrophoneHold();
    keyHandler = null;
    backHandler = null;
    screens.go(route);
  },
  onKey(handler) {
    keyHandler = handler;
  },
  onBack(handler) {
    backHandler = handler;
  },
};

// Each screen starts at the top, including when back draws it.
history.scrollRestoration = 'manual';
const screens = backHistory<Route>({
  history: window.history,
  events: window,
  isHome: (route) => route.name === 'home',
  draw(route) {
    app.progress = rollDay(app.progress, Date.now());
    // Another tab may have changed quiet mode.
    applyAudioMode(app.progress.settings);
    render(route);
    window.scrollTo(0, 0);
  },
  // Back does what the screen's own back or close button does; most just go Home.
  back: () => (backHandler ?? (() => app.navigate({ name: 'home' })))(),
});

function render(route: Route): void {
  let screen: HTMLElement;
  switch (route.name) {
    case 'home':
      screen = homeScreen(app);
      break;
    case 'practice':
      screen = practiceScreen(app);
      break;
    case 'words':
      screen = wordsScreen(app);
      break;
    case 'study':
      screen = sessionScreen(app, null);
      break;
    case 'session':
      screen = sessionScreen(app, route.steps, route.title);
      break;
    case 'talk':
      screen = talkScreen(app, undefined, route.start);
      break;
    case 'settings':
      screen = settingsScreen(app);
      break;
  }
  // Each screen draws its own top: a page its back arrow, a session its close button (docs/ARCHITECTURE.md).
  root.replaceChildren(h('main', { class: 'screen' }, screen));
}

// A soft tick for every button press, quiet in silent mode (speech.ts).
tickOnPress(document);

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
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1, user-scalable=no`);
  // iOS ignores user-scalable=no, so cancel its pinch gesture directly.
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());
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
  onExternalChange((progress) => {
    replaceContents(app.progress, progress);
    applyAudioMode(app.progress.settings);
  });
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
// Known before Drills or Study is opened, so they can ask for the microphone up front (micGate).
void modelDownloaded();
forgetRetiredVoiceChoice();
void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
    // A few seconds in, so the first screen isn't waiting behind 4 MB of clips.
    setTimeout(() => {
      void keepClipsOffline(allClipUrls()).catch(() => {});
      void keepSpeakingReady().catch(() => {});
    }, 5000);
  });
}
