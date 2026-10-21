import type { App } from '../app';
import { h, icon } from '../ui';

/**
 * Quiet mode, for the tube or anywhere speaking out loud won't do: nothing asks
 * the learner to speak. Audio still plays, since headphones are likely in.
 * The toggle sits where studying starts, so it's one tap rather than a trip to Settings.
 */
export function quietToggle(app: App, onChange: () => void, { iconOnly = false } = {}): HTMLButtonElement {
  const on = app.progress.settings.quiet;
  return h(
    'button',
    {
      class: `quiet-toggle${on ? ' on' : ''}${iconOnly ? ' icon-only' : ''}`,
      'aria-pressed': String(on),
      'aria-label': iconOnly ? 'Quiet mode' : undefined,
      title: on ? 'Quiet mode is on: no speaking cards or drills' : 'Quiet mode: no speaking cards or drills',
      onclick: () => {
        app.progress.settings.quiet = !on;
        app.commit();
        onChange();
      },
    },
    // Always the crossed-out mic: it names the mode, and teal says it's on.
    icon('quiet'),
    !iconOnly && h('span', null, 'Quiet'),
  );
}
