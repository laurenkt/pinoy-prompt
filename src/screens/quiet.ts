import type { App } from '../app';
import { h, icon } from '../ui';

/**
 * Quiet mode, for the tube or anywhere speaking out loud won't do: nothing asks
 * the learner to speak. Audio still plays, since headphones are likely in.
 * The toggle sits where studying starts, so it's one tap rather than a trip to Settings.
 */
export function quietToggle(app: App, onChange: () => void, { wide = false } = {}): HTMLButtonElement {
  const on = app.progress.settings.quiet;
  return h(
    'button',
    {
      class: `quiet-toggle${on ? ' on' : ''}${wide ? ' wide' : ''}`,
      'aria-pressed': String(on),
      title: on ? 'Quiet mode is on: no speaking cards or drills' : 'Quiet mode: no speaking cards or drills',
      onclick: () => {
        app.progress.settings.quiet = !on;
        app.commit();
        onChange();
      },
    },
    icon(on ? 'quiet' : 'mic'),
    wide
      ? h(
          'span',
          { class: 'quiet-text' },
          h('span', null, 'Quiet mode'),
          h('span', { class: 'quiet-desc' }, on ? 'On: no speaking cards or drills' : 'For the tube: no speaking'),
        )
      : h('span', null, 'Quiet'),
  );
}
