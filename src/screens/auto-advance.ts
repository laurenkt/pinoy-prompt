// After a right answer the next question comes up by itself, so the learner
// doesn't have to tap through cards they already know.

import { speaking } from '../speech';
import { h, icon } from '../ui';

/** How long a right answer stays up before the next question. */
export const ADVANCE_MS = 2000;
/** The longest to wait beyond that for the answer's audio to finish. */
const AUDIO_WAIT_MS = 4000;
const POLL_MS = 200;

export interface Countdown {
  cancel(): void;
}

/**
 * Call `onDone` once a right answer has been up for ADVANCE_MS and heard out.
 * Nothing happens if the screen has been left in the meantime.
 */
export function countdown(root: HTMLElement, onDone: () => void): Countdown {
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    // The bar goes without a redraw, which would swallow a tap on the screen.
    root.querySelector('.counting')?.classList.remove('counting');
  };
  const tick = () => {
    timer = undefined;
    if (!root.isConnected) return;
    if (speaking() && waited < AUDIO_WAIT_MS) {
      waited += POLL_MS;
      timer = setTimeout(tick, POLL_MS);
      return;
    }
    onDone();
  };
  timer = setTimeout(tick, ADVANCE_MS);
  return { cancel };
}

/**
 * Pressing anything on the screen other than Continue, by tap or key, means
 * the learner wants another look (to replay the audio, say), so the countdown
 * stops there.
 */
export function holdOnTap(root: HTMLElement, hold: () => void): void {
  root.addEventListener(
    'click',
    (e) => {
      if (!(e.target as Element).closest?.('.counting')) hold();
    },
    true,
  );
}

/** Continue, with a bar filling across it while the next question is on its way. */
export function continueButton(onclick: () => void, counting: boolean, label = 'Continue'): HTMLButtonElement {
  return h(
    'button',
    { class: `btn primary big continue ${counting ? 'counting' : ''}`, style: `--advance: ${ADVANCE_MS}ms`, 'data-autofocus': true, onclick },
    h('span', null, label),
  );
}

/** A way back to the card that moved on by itself, shown above the next one. */
export function previousButton(onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'prev-btn', onclick }, icon('back'), 'Previous card');
}
