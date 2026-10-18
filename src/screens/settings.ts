import type { App } from '../app';
import { getCard } from '../deck';
import { play, voiceQuality } from '../speech';
import { reset } from '../store';
import { h, icon } from '../ui';

const DAILY_OPTIONS = [5, 8, 12, 15];

export function settingsScreen(app: App): HTMLElement {
  const root = h('div', { class: 'settings' });

  function draw(): void {
    const { settings } = app.progress;
    const quality = voiceQuality();
    const voiceText = {
      native: 'Using a Filipino voice on this device.',
      approximate:
        "This device has no Filipino voice, so a similar-sounding voice reads the words. It's close, but not perfect. If your phone offers a Filipino text-to-speech voice in its settings, installing it will make audio more natural.",
      none: "This browser can't play speech. You can still read the pronunciation guides.",
    }[quality];

    root.replaceChildren(
      h(
        'header',
        { class: 'home-header' },
        h('h1', null, 'Settings'),
        h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => app.navigate({ name: 'home' }) }, icon('close')),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'New words per day'),
        h('p', { class: 'muted small' }, 'Fewer means lighter reviews later. 8 is a good start.'),
        h(
          'div',
          { class: 'segmented', role: 'radiogroup', 'aria-label': 'New words per day' },
          DAILY_OPTIONS.map((n) =>
            h(
              'button',
              {
                role: 'radio',
                'aria-checked': String(settings.dailyNew === n),
                class: settings.dailyNew === n ? 'selected' : '',
                onclick: () => {
                  settings.dailyNew = n;
                  app.commit();
                  draw();
                },
              },
              n,
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Audio'),
        h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: settings.autoplay,
            onchange: (e: Event) => {
              settings.autoplay = (e.target as HTMLInputElement).checked;
              app.commit();
            },
          }),
          h('span', null, 'Play words automatically'),
        ),
        h('p', { class: 'muted small' }, voiceText),
        h('button', { class: 'btn secondary', onclick: () => void play(getCard('kumusta')!) }, icon('speaker'), ' Test voice'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Progress'),
        h('p', { class: 'muted small' }, 'Your progress is saved on this device only.'),
        h(
          'button',
          {
            class: 'btn danger',
            onclick: () => {
              if (confirm('Erase all progress and start over? This cannot be undone.')) {
                app.replaceProgress(reset(app.now()));
                app.navigate({ name: 'home' });
              }
            },
          },
          'Reset progress',
        ),
      ),
    );
  }

  draw();
  return root;
}
