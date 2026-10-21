import type { App } from '../app';
import { getCard } from '../deck';
import { CENTS_PER_MINUTE, forgetApiKey, getApiKey, setApiKey } from '../openai';
import { play, voiceQuality } from '../speech';
import { backupFileName, exportBackup, importBackup, reset } from '../store';
import { h, icon } from '../ui';

const DAILY_OPTIONS = [5, 8, 12, 15];

export function settingsScreen(app: App): HTMLElement {
  const root = h('div', { class: 'settings' });
  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files?.[0];
    restoreInput.value = '';
    if (!file) return;
    const text = await file.text();
    const changed = importBackup(app.progress, text, app.now());
    if (changed === null) {
      alert("That file isn't a Pinoy Prompt backup.");
      return;
    }
    app.commit();
    alert(changed === 1 ? 'Restored 1 card.' : `Restored ${changed} cards.`);
    draw();
  });

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
        h('h2', null, 'New cards per day'),
        h('p', { class: 'muted small' }, 'Fewer means lighter reviews later. 8 is a good start.'),
        h(
          'div',
          { class: 'segmented', role: 'radiogroup', 'aria-label': 'New cards per day' },
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
      h('section', { class: 'card' }, h('h2', null, 'Chat'), keyForm(draw)),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Progress'),
        h(
          'p',
          { class: 'muted small' },
          'Your progress is saved on this device only. On iPhone, the Home Screen app and Safari keep separate progress. Back it up to move it or keep it safe; restoring adds to what is here and never removes anything.',
        ),
        h(
          'div',
          { class: 'backup-actions' },
          h('button', { class: 'btn secondary', onclick: () => void backUp(app) }, 'Back up progress'),
          h('button', { class: 'btn secondary', onclick: () => restoreInput.click() }, 'Restore from backup'),
          restoreInput,
        ),
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

/**
 * The OpenAI key Talk uses: a box to paste one in, or, once saved, a way to
 * forget it. Calls onChange after either.
 */
export function keyForm(onChange: () => void): HTMLElement {
  if (getApiKey()) {
    return h(
      'div',
      { class: 'key-form' },
      h('p', { class: 'muted small' }, 'Your OpenAI API key is saved on this device. Chat uses it to talk with you; OpenAI bills that account.'),
      h(
        'button',
        {
          class: 'btn secondary',
          onclick: () => {
            forgetApiKey();
            onChange();
          },
        },
        'Forget key',
      ),
    );
  }
  const input = h('input', {
    type: 'password',
    class: 'key-input',
    placeholder: 'sk-…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'OpenAI API key',
  });
  const problem = h('p', { class: 'key-problem', role: 'alert', hidden: true });
  return h(
    'form',
    {
      class: 'key-form',
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (setApiKey(input.value)) return onChange();
        problem.textContent = "That doesn't look like an OpenAI API key. It starts with sk-.";
        problem.hidden = false;
      },
    },
    h(
      'p',
      { class: 'muted small' },
      'Chat is a spoken conversation with an AI, using your own OpenAI API key. Create one at ',
      h('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener' }, 'platform.openai.com'),
      ` and paste it here. API use is billed by OpenAI separately from a ChatGPT subscription, at about ${CENTS_PER_MINUTE}¢ a minute of talking.`,
    ),
    h(
      'p',
      { class: 'muted small' },
      "The key stays on this device. It's sent only to OpenAI, and it isn't included in backups.",
    ),
    input,
    problem,
    h('button', { class: 'btn primary', type: 'submit' }, 'Save key'),
  );
}

/** Save a backup file: through the share sheet where there is one (iPhone), else as a download. */
async function backUp(app: App): Promise<void> {
  const name = backupFileName(app.now());
  const file = new File([exportBackup(app.progress)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Pinoy Prompt backup' });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
