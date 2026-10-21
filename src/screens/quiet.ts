import type { App } from '../app';
import type { Settings } from '../store';
import { setMuted } from '../speech';
import { h, icon, type IconName } from '../ui';

/**
 * Quiet mode, for the tube or anywhere speaking out loud won't do. It has two
 * settings, because a web app can't tell headphones from the phone speaker:
 * - Quiet, no headphones: silent. No audio plays and nothing asks to be heard or said.
 * - Quiet, headphones in: listening is fine, but nothing asks the learner to speak.
 * The toggle sits where studying starts, so it's a tap or two rather than a trip to Settings.
 */
type Mode = 'off' | 'silent' | 'headphones';

const MODES: Record<Mode, { icon: IconName; label: string; title: string; next: Mode }> = {
  off: { icon: 'mic', label: 'Quiet', title: 'Quiet mode is off. Tap for silent: no sound and no speaking.', next: 'silent' },
  silent: { icon: 'quiet', label: 'Silent', title: 'Silent: no sound and no speaking. Tap if your headphones are in.', next: 'headphones' },
  headphones: { icon: 'headphones', label: 'Quiet', title: 'Quiet with headphones: listening, but no speaking. Tap to turn quiet mode off.', next: 'off' },
};

function mode(settings: Settings): Mode {
  if (!settings.quiet) return 'off';
  return settings.headphones ? 'headphones' : 'silent';
}

/** Quiet mode without headphones: nothing plays, and nothing that needs listening is asked. */
export function isSilent(settings: Settings): boolean {
  return mode(settings) === 'silent';
}

/** Mute or unmute card audio, and hide the play buttons when nothing can play. */
export function applyAudioMode(settings: Settings): void {
  const silent = isSilent(settings);
  setMuted(silent);
  document.documentElement.classList.toggle('silent', silent);
}

/** One button that steps through off, silent, and quiet with headphones. */
export function quietToggle(app: App, onChange: () => void, { iconOnly = false } = {}): HTMLButtonElement {
  const settings = app.progress.settings;
  const current = MODES[mode(settings)];
  return h(
    'button',
    {
      // Icon only, it matches the icon buttons beside it; otherwise it's a labelled pill.
      class: `${iconOnly ? 'icon-btn quiet-icon' : 'quiet-toggle'}${settings.quiet ? ' on' : ''}`,
      'aria-label': `Quiet mode: ${mode(settings) === 'off' ? 'off' : mode(settings) === 'silent' ? 'silent' : 'headphones in'}`,
      title: current.title,
      onclick: () => {
        const next = current.next;
        settings.quiet = next !== 'off';
        settings.headphones = next === 'headphones';
        app.commit();
        applyAudioMode(settings);
        onChange();
      },
    },
    icon(current.icon),
    !iconOnly && h('span', null, current.label),
  );
}
