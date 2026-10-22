// @vitest-environment happy-dom
// Screen shortcuts stay out of the way of typing.

import { describe, expect, it } from 'vitest';
import { typingInBox } from './app';

function press(target: Element): KeyboardEvent {
  document.body.replaceChildren(target);
  let seen: KeyboardEvent | null = null;
  document.addEventListener('keydown', (e) => (seen = e), { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  return seen!;
}

describe('typing into a box', () => {
  it('is not a shortcut in a text box', () => {
    expect(typingInBox(press(document.createElement('input')))).toBe(true);
    expect(typingInBox(press(document.createElement('textarea')))).toBe(true);
  });

  it('is a shortcut anywhere else', () => {
    expect(typingInBox(press(document.createElement('button')))).toBe(false);
    expect(typingInBox(press(document.body.appendChild(document.createElement('div'))))).toBe(false);
  });
});
