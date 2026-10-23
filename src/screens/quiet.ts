import type { App } from '../app';
import type { Settings } from '../store';
import { setMuted, setTapSounds } from '../speech';
import { h, iconButton, type IconName } from '../ui';

/**
 * Quiet mode, for the tube or anywhere a phone can't talk or be talked to. It's two switches side by side, because a
 * web app can't tell headphones from the phone speaker, or a busy room from an empty one:
 * - Mic off: nothing asks the learner to speak (Drills' Speak, saying a typed answer).
 * - Sound off: no audio plays, no play buttons show, and nothing asks to be heard (Listen, autoplay).
 * Any of the four ways works; with both off, every question is seen and answered by tapping or typing.
 * The toggle sits where studying starts, so it's a tap rather than a trip to Settings.
 */
export type Switch = 'mic' | 'sound';

const SWITCHES: Record<Switch, { on: IconName; off: IconName; label: string; whenOn: string; whenOff: string }> = {
  mic: {
    on: 'mic',
    off: 'micOff',
    label: 'Mic off',
    whenOn: 'Mic on: Drills may ask you to say things. Tap to turn it off.',
    whenOff: 'Mic off: nothing asks you to speak. Tap to turn it on.',
  },
  sound: {
    on: 'speaker',
    off: 'soundOff',
    label: 'Sound off',
    whenOn: 'Sound on: words play and Drills may ask you to listen. Tap to turn it off.',
    whenOff: 'Sound off: nothing plays and nothing asks you to listen. Tap to turn it on.',
  },
};

/** Mute or unmute card audio, and hide the play buttons when nothing can play. Also takes up the Tap sounds switch. */
export function applyAudioMode(settings: Settings): void {
  setMuted(!settings.sound);
  setTapSounds(settings.tapSounds);
  document.documentElement.classList.toggle('silent', !settings.sound);
}

/**
 * The mic and sound switches as one split button, the same on every screen: two header icon buttons sharing an
 * outline, each pressed (teal) while it's off, as quiet mode is something turned on. `onChange` is told which changed.
 * `mayOpenMicrophone` is for a screen whose onChange opens the microphone when the mic goes back on (Drills).
 */
export function quietToggle(app: App, onChange: (which: Switch) => void, { mayOpenMicrophone = false } = {}): HTMLElement {
  const half = (which: Switch) => {
    const s = SWITCHES[which];
    const on = app.progress.settings[which];
    const button = iconButton(
      on ? s.on : s.off,
      s.label,
      () => {
        // Another tab's save may have replaced the settings object since this was drawn. Set what the tap asked for,
        // the opposite of what showed, even if another tab got there first.
        const settings = app.progress.settings;
        settings[which] = !on;
        app.commit();
        applyAudioMode(settings);
        onChange(which);
      },
      { pressed: !on, title: on ? s.whenOn : s.whenOff },
    );
    button.classList.add('split-half');
    // The mic going on may then open the microphone, after which the tap sound would be held back. Only then:
    // otherwise it taps after the change, so sound going on is heard and going off is not.
    if (mayOpenMicrophone && which === 'mic' && !on) button.dataset.tap = 'before';
    return button;
  };
  return h('div', { class: 'split-toggle', role: 'group', 'aria-label': 'Quiet mode' }, half('mic'), half('sound'));
}
