// A light haptic tick, where a web app can make one.
//
// Android's browsers have navigator.vibrate. iOS has no haptics API for web
// pages, but since iOS 18 Safari gives a light tap when a switch checkbox
// (<input type="checkbox" switch>) is toggled, including by a click on its
// label from script. So on iOS a hidden switch is toggled for each tick.
// Anywhere else, nothing happens.

let toggle: HTMLLabelElement | null = null;

/** Whether this browser can make a haptic tick at all. */
export function hapticsSupported(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return true;
  return typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;
}

/** One light haptic tick. */
export function hapticTick(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(4);
    return;
  }
  if (!hapticsSupported()) return;
  if (!toggle?.isConnected) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-switch';
    // Not a control anyone presses, so it makes no tap sound (speech.ts).
    input.setAttribute('data-no-tap', '');
    toggle = document.createElement('label');
    toggle.htmlFor = input.id;
    toggle.setAttribute('aria-hidden', 'true');
    toggle.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;';
    toggle.append(input);
    document.body.append(toggle);
  }
  toggle.click();
}
