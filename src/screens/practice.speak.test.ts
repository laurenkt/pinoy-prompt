// @vitest-environment happy-dom
// Speak mode inside a practice round, with a stand-in microphone and model.

import { beforeEach, describe, expect, it } from 'vitest';
import { getCard } from '../deck';
import { toPhones } from '../phonetics';
import type { Take } from '../recorder';
import { practiceScreen } from './practice';
import type { SpeakDeps } from './speak';
import { FakePlayer, fakeRecognition } from '../test/fake-speech';
import { drillScope, fakeApp, flush } from '../test/screen';

const KNOWN = ['salamat', 'kumusta', 'tatlo', 'paalam', 'oo', 'kape'];

/** A model that hears whatever the card should sound like, so every attempt is right. */
function deps(overrides: Partial<SpeakDeps> = {}): SpeakDeps {
  let card = '';
  return {
    recordingSupported: () => true,
    modelDownloaded: async () => true,
    record: (() => {
      card = document.querySelector('.prompt .tl')?.textContent ?? '';
      let finish: (t: Take) => void = () => {};
      const audio = new Promise<Take>((r) => (finish = r));
      return { audio, stop: () => finish({ samples: new Float32Array(1), speech: true }), cancel: () => {} };
    }) as SpeakDeps['record'],
    loadPhoneModel: async () => ({
      recognise: async () => {
        const id = KNOWN.find((k) => getCard(k)!.tl === card)!;
        return fakeRecognition(toPhones(getCard(id)!.tl).filter((p) => !p.optional).map((p) => p.ipa));
      },
    }),
    player: () => new FakePlayer(),
    ...overrides,
  };
}

function button(name: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(name) || b.textContent?.trim().endsWith(name));
  if (!match) throw new Error(`No button "${name}" in: ${document.body.textContent}`);
  return match;
}

beforeEach(() => document.body.replaceChildren());

describe('Speak mode', () => {
  it('runs a round of spoken questions', async () => {
    const root = practiceScreen(fakeApp(KNOWN), deps());
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    button('Tap and speak').click();
    button("I'm done").click();
    await flush();
    expect(document.querySelector('.feedback strong')?.textContent).toBe('Tama!');
    button('Next').click();
    await flush();
    expect(button('Tap and speak')).toBeTruthy();
  });

  it('asks another way when quiet mode comes on mid-round', async () => {
    const app = fakeApp(KNOWN);
    const root = practiceScreen(app, deps());
    document.body.append(root);
    await flush();
    drillScope(root, ['speak']);
    await flush();
    button('Tap and speak').click();
    button("I'm done").click();
    await flush();
    app.progress.settings.quiet = true;
    button('Next').click();
    expect(document.querySelector('.session-header')).not.toBeNull();
    expect(document.querySelector('.choice')).not.toBeNull();
    expect(document.body.textContent).toContain('Speak is off in quiet mode.');
  });

  it('is offered but explained when the browser cannot record', async () => {
    document.body.append(practiceScreen(fakeApp(KNOWN), deps({ recordingSupported: () => false })));
    expect(document.querySelector<HTMLButtonElement>('#drill-scope [data-mode="speak"]')!.disabled).toBe(true);
    expect(document.body.textContent).toContain("this browser can't record");
  });
});
