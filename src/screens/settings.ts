import type { App } from '../app';
import { allowBadge, badgePermission, badgeSupported } from '../badge';
import { getCard } from '../deck';
import { CENTS_PER_MINUTE, forgetApiKey, getApiKey, getSpend, setApiKey } from '../openai';
import { lastStartDelay, play, voiceQuality } from '../speech';
import { applyAudioMode } from './quiet';
import { backupFileName, exportBackup, importBackup, reset } from '../store';
import { h, icon, pageHeader, settingsToggle } from '../ui';

const DAILY_OPTIONS = [5, 8, 12, 15];

/** Opt-in number on the Home Screen icon. iOS asks to allow notifications for it, so it asks only when switched on. */
function iconBadgeCard(app: App, draw: () => void): HTMLElement {
  const blocked = badgePermission() === 'denied';
  const on = app.progress.settings.iconBadge && !blocked;
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'App icon'),
    h(
      'label',
      { class: 'toggle' },
      h('input', {
        type: 'checkbox',
        checked: on,
        disabled: blocked,
        onchange: (e: Event) => {
          const box = e.target as HTMLInputElement;
          // Read at the time: another tab's save replaces the settings object (onExternalChange). Saving updates the icon.
          const set = (value: boolean) => {
            app.progress.settings.iconBadge = value;
            app.commit();
          };
          if (!box.checked) return set(false);
          // Asked inside the tap, as iOS needs.
          void allowBadge().then((allowed) => {
            // Switched off again while the phone was asking: that tap wins.
            if (!box.checked) return;
            set(allowed);
            draw();
          });
        },
      }),
      h('span', null, 'Show cards due on the icon'),
    ),
    h(
      'p',
      { class: 'muted small' },
      blocked
        ? 'Notifications are turned off for Pinoy Prompt, and the phone needs them on to show a number. You can turn them on in your phone\'s Settings, under Notifications.'
        : 'The number changes when you open or leave the app, not while it\'s closed. Your phone asks to allow notifications for this; Pinoy Prompt never sends any.',
    ),
  );
}

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
      recorded: 'Words are read by a recorded Filipino voice, the same on every device.',
      native: 'Using a Filipino voice on this device.',
      approximate:
        "This device has no Filipino voice, so a similar-sounding voice reads the words. It's close, but not perfect. If your phone offers a Filipino text-to-speech voice in its settings, installing it will make audio more natural.",
      none: "This browser can't play speech. You can still read the pronunciation guides.",
    }[quality];
    // How long the test word took to be heard, for checking audio lag on a phone.
    const lag = h('p', { class: 'muted small voice-lag', 'aria-live': 'polite', hidden: true });
    const testVoice = () => {
      void play(getCard('kumusta')!);
      void lastStartDelay().then((ms) => {
        if (ms === null) return;
        lag.textContent = `The word started ${(ms / 1000).toFixed(2)} seconds after your tap.`;
        lag.hidden = false;
      });
    };

    root.replaceChildren(
      ...pageHeader('Settings', () => app.navigate({ name: 'home' }), null, settingsToggle(app, true)),
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
        h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: settings.tapSounds,
            onchange: (e: Event) => {
              settings.tapSounds = (e.target as HTMLInputElement).checked;
              app.commit();
              applyAudioMode(settings);
            },
          }),
          h('span', null, 'Tap sounds'),
        ),
        h('p', { class: 'muted small' }, voiceText),
        !settings.sound
          ? h('p', { class: 'muted small' }, 'Sound is off, so nothing plays. Tap the sound button on Home to turn it on.')
          : h('button', { class: 'btn secondary', onclick: testVoice }, icon('speaker'), ' Test voice'),
        lag,
      ),
      ...(badgeSupported() ? [iconBadgeCard(app, draw)] : []),
      h('section', { class: 'card' }, h('h2', null, 'Chat'), keyForm(draw)),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Experimental'),
        h(
          'p',
          { class: 'muted small' },
          'Walk and talk: drills you hear and answer out loud, with headphones in. Two versions to try: recorded voices checked on this phone, or a live AI voice on your OpenAI key.',
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn secondary', onclick: () => app.navigate({ name: 'walk', engine: 'clips' }) }, 'Walk and talk'),
          h('button', { class: 'btn secondary', onclick: () => app.navigate({ name: 'walk', engine: 'live' }) }, 'Walk and talk live'),
        ),
      ),
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
      h(
        'p',
        { class: 'muted small credits' },
        'Pictures by ',
        h('a', { href: 'https://openmoji.org', target: '_blank', rel: 'noopener' }, 'OpenMoji'),
        ', under ',
        h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY-SA 4.0'),
        '.',
      ),
    );
  }

  draw();
  return root;
}

/** An amount in US dollars, to the cent; a little spent never shows as nothing. */
export function dollars(amount: number): string {
  if (amount > 0 && amount < 0.005) return 'under 1¢';
  return `$${amount.toFixed(2)}`;
}

/**
 * The OpenAI key Talk uses: a box to paste one in, or, once saved, what it
 * has cost and a way to forget it. Calls onChange after either.
 */
export function keyForm(onChange: () => void): HTMLElement {
  if (getApiKey()) {
    const spend = getSpend();
    return h(
      'div',
      { class: 'key-form' },
      h('p', { class: 'muted small' }, 'Your OpenAI API key is saved on this device. Chat uses it to talk with you, and Drills to check a meaning you type or say; OpenAI bills that account.'),
      h(
        'div',
        { class: 'stats key-spend' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, dollars(spend.month)), h('span', { class: 'stat-label' }, 'this month')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, dollars(spend.total)), h('span', { class: 'stat-label' }, 'all time')),
      ),
      h('p', { class: 'muted small' }, "An estimate of what this app has used on this device, from OpenAI's prices. Your OpenAI account shows the real bill."),
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
