// @vitest-environment happy-dom
// The Home Screen icon shows what Home's Study button counts as due, only once
// the learner turns it on, and only an installed app tries.

import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { allowBadge, showDueBadge } from './badge';
import { DAY_MS } from './srs';
import { fakeApp } from './test/screen';

let nav: { setAppBadge: Mock<(count?: number) => Promise<void>>; clearAppBadge: Mock<() => Promise<void>> };

beforeEach(() => {
  nav = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
});

afterEach(() => vi.unstubAllGlobals());

/** A learner with two cards due a day after they were met, and one not due for days. */
function learner(iconBadge: boolean) {
  const app = fakeApp(['kumusta', 'salamat', 'oo'], { iconBadge });
  const now = app.now() + 2 * DAY_MS;
  app.progress.cards.oo.due = now + 5 * DAY_MS;
  return { progress: app.progress, now };
}

it('shows the cards due now once turned on', () => {
  const { progress, now } = learner(true);
  showDueBadge(progress, now, nav);
  expect(nav.setAppBadge).toHaveBeenCalledWith(2);
});

it('clears the icon when nothing is due', () => {
  const { progress, now } = learner(true);
  for (const card of Object.values(progress.cards)) card.due = now + DAY_MS;
  showDueBadge(progress, now, nav);
  expect(nav.clearAppBadge).toHaveBeenCalled();
  expect(nav.setAppBadge).not.toHaveBeenCalled();
});

it('clears the icon while the setting is off', () => {
  const { progress, now } = learner(false);
  showDueBadge(progress, now, nav);
  expect(nav.clearAppBadge).toHaveBeenCalled();
  expect(nav.setAppBadge).not.toHaveBeenCalled();
});

it('leaves the icon alone in a browser tab', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const { progress, now } = learner(true);
  showDueBadge(progress, now, nav);
  expect(nav.setAppBadge).not.toHaveBeenCalled();
  expect(nav.clearAppBadge).not.toHaveBeenCalled();
});

it('asks for notifications only if the phone has not been asked', async () => {
  const requestPermission = vi.fn(async () => 'granted');
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  expect(await allowBadge()).toBe(true);
  expect(requestPermission).toHaveBeenCalledOnce();

  vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
  expect(await allowBadge()).toBe(false);
  expect(requestPermission).toHaveBeenCalledOnce();
});
