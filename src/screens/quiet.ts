import type { App } from '../app';
import type { Settings } from '../store';
import { setMuted, setTapSounds } from '../speech';
import { iconButton, type IconName } from '../ui';

/**
 * Quiet mode, for the tube or anywhere speaking out loud won't do. It has two
 * settings, because a web app can't tell headphones from the phone speaker:
 * - Quiet, no headphones: silent. No audio plays and nothing asks to be heard or said.
 * - Quiet, headphones in: listening is fine, but nothing asks the learner to speak.
 * The toggle sits where studying starts, so it's a tap or two rather than a trip to Settings.
 */
type Mode = 'off' | 'silent' | 'headphones';

const MODES: Record<Mode, { icon: IconName; label: string; title: string; next: Mode }> = {
  off: { icon: 'mic', label: 'Quiet mode: off', title: 'Quiet mode is off. Tap for silent: no sound and no speaking.', next: 'silent' },
  silent: { icon: 'quiet', label: 'Quiet mode: silent', title: 'Silent: no sound and no speaking. Tap if your headphones are in.', next: 'headphones' },
  headphones: { icon: 'headphones', label: 'Quiet mode: headphones in', title: 'Quiet with headphones: listening, but no speaking. Tap to turn quiet mode off.', next: 'off' },
};

function mode(settings: Settings): Mode {
  if (!settings.quiet) return 'off';
  return settings.headphones ? 'headphones' : 'silent';
}

/** Quiet mode without headphones: nothing plays, and nothing that needs listening is asked. */
export function isSilent(settings: Settings): boolean {
  return mode(settings) === 'silent';
}

/** Mute or unmute card audio, and hide the play buttons when nothing can play. Also takes up the Tap sounds switch. */
export function applyAudioMode(settings: Settings): void {
  const silent = isSilent(settings);
  setMuted(silent);
  setTapSounds(settings.tapSounds);
  document.documentElement.classList.toggle('silent', silent);
}

/**
 * One button that steps through off, silent, and quiet with headphones: the same icon toggle on every screen.
 * `mayOpenMicrophone` is for a screen whose onChange opens the microphone when quiet mode goes off (Drills).
 */
export function quietToggle(app: App, onChange: () => void, { mayOpenMicrophone = false } = {}): HTMLButtonElement {
  const settings = app.progress.settings;
  const current = MODES[mode(settings)];
  const button = iconButton(
    current.icon,
    current.label,
    () => {
      // Another tab's save may have replaced the settings object since this was drawn.
      const settings = app.progress.settings;
      const next = current.next;
      settings.quiet = next !== 'off';
      settings.headphones = next === 'headphones';
      app.commit();
      applyAudioMode(settings);
      onChange();
    },
    { pressed: settings.quiet, title: current.title },
  );
  // Quiet mode going off may then open the microphone, after which the tap sound would be held back. Only then: tapping
  // first reads the mute from before the press, and in Study it would sound over a word the change plays.
  if (mayOpenMicrophone && current.next === 'off') button.dataset.tap = 'before';
  return button;
}
