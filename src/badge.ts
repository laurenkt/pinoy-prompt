// The number on the Home Screen icon: how many cards Study would review now,
// the same count as Home's Study button. Opt-in from Settings.
//
// The icon can only change while the app's code runs (when it's opened, used
// or left), so a card that falls due while the app is closed shows next time
// it is opened. Changing it from a closed app needs a push from a server,
// and iOS shows a notification with every push, so the app doesn't.

import { installed } from './app';
import { abilities, studyQueue } from './session';
import { canPlay } from './speech';
import type { Progress } from './store';

interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Whether this device can show a number on the app's icon: only an installed app can. */
export function badgeSupported(nav: BadgeNavigator = navigator as BadgeNavigator): boolean {
  return typeof nav.setAppBadge === 'function' && typeof nav.clearAppBadge === 'function' && installed();
}

/** What each icon was last set to, so a save that doesn't change the number (most, with the setting off) costs nothing. */
const shown = new WeakMap<BadgeNavigator, number>();

/** Set the icon to the cards due now, or clear it when none are or the setting is off. */
export function showDueBadge(progress: Progress, now: number, nav: BadgeNavigator = navigator as BadgeNavigator): void {
  if (!badgeSupported(nav)) return;
  const due = progress.settings.iconBadge ? studyQueue(progress, now, abilities(progress, canPlay())).length : 0;
  if (shown.get(nav) === due) return;
  shown.set(nav, due);
  // A refused badge (notifications turned off) just doesn't show, and is tried again next time.
  void (due > 0 ? nav.setAppBadge!(due) : nav.clearAppBadge!()).catch(() => {
    if (shown.get(nav) === due) shown.delete(nav);
  });
}

/**
 * The number can only change while the app runs, so it's set again whenever
 * the app is opened or left, from what's due then.
 */
export function keepBadgeCurrent(progress: () => Progress, doc: Document = document, nav: BadgeNavigator = navigator as BadgeNavigator): void {
  doc.addEventListener('visibilitychange', () => showDueBadge(progress(), Date.now(), nav));
}

export type BadgePermission = 'granted' | 'denied' | 'default';

/** Where the phone stands on notifications, which iOS asks for before an icon can show a number. */
export function badgePermission(): BadgePermission {
  return typeof Notification === 'undefined' ? 'granted' : Notification.permission;
}

/**
 * Ask for notifications if the phone hasn't been asked. Call it straight from
 * the learner's tap: iOS only asks inside one. The app never sends any.
 */
export async function allowBadge(): Promise<boolean> {
  if (badgePermission() !== 'default') return badgePermission() === 'granted';
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
