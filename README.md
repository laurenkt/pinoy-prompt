# Pinoy Prompt

A small, phone-first web app for learning beginner Tagalog with spaced repetition. Install it to your home screen and it works offline.

**Try it:** https://laurenkt.github.io/pinoy-prompt/ (open on your phone, then "Add to Home Screen").

## How it works

- **Learn**: each day introduces a handful of new words and phrases (8 by default). Every new card shows the Tagalog, audio, a pronunciation guide, the meaning and a usage tip, followed by a quick multiple-choice check.
- **Review**: cards come back on an SM-2 style schedule (1 day, 3 days, then growing by each card's ease). You rate each recall as Again, Hard, Good or Easy; missed cards come round again in the same session.
- **Practice**: unscored rounds of 10 (listen, read, recall, speak, or mixed) using the words you know, weighted toward the ones you find hardest. Practice never changes the review schedule.
- **Words**: a phrasebook of every unit, tappable for audio.

Units unlock in order: Greetings, Yes/no & politeness, Meeting people, Numbers 1–10, Question words, Food & eating, Family & friends, Everyday phrases.

Progress is stored on the device. Nothing is sent to our server (there isn't one). The one exception is speaking questions: the browser's speech recogniser may send your voice to its own speech service, as Chrome does.

## Saved progress

A learner's progress is the one thing the app can't afford to lose, so it is kept with some care:

- **Versioned.** Progress is saved in `localStorage` as `{ schema, rev, savedAt, progress }`. `src/progress-schema.ts` upgrades older copies one schema at a time, repairs damaged cards field by field instead of dropping them, and keeps fields it doesn't recognise, so an older build never strips data a newer one added. To change the schema, bump `SCHEMA`, add a migration and add a fixture under `src/test/fixtures/`; the tests fail until all three exist.
- **Two copies.** Every save is mirrored to IndexedDB. On start-up the newer copy wins, so a cleared or unreadable `localStorage`, or a write iOS lost by killing the app, is recovered from the mirror.
- **Saves never remove cards.** Each save re-reads what is stored and merges it in, keeping the more recently reviewed version of each card. Two open tabs can't overwrite each other, and a start-up that failed to read storage can't save an empty copy over real progress. Only Reset replaces progress, and it keeps the old copy under `pinoy-prompt:before-reset`. A copy that can't be read at all is set aside under `pinoy-prompt:unreadable`.
- **Kept from eviction.** Once there is progress, the app asks the browser for persistent storage (`navigator.storage.persist()`).
- **Backups.** Settings can save a backup file (through the share sheet on iPhone) and restore one. Restoring merges, so it never removes anything. On iPhone the Home Screen app and Safari keep separate storage, so a backup is how to move progress between them.

`src/store.test.ts` plays out the ways progress could be lost: unreadable or full storage, a wiped `localStorage`, a lost write, a hung IndexedDB, two tabs saving at once, upgrades from the first storage format, and resets. `src/progress-schema.test.ts` loads a fixture from every schema version and throws thousands of randomly damaged copies at the loader.

## Speaking questions

The **Speak** practice mode shows a word or phrase, listens while the learner says it, and passes if it heard the right thing.

It uses the browser's [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechRecognition) in Filipino (`fil-PH`), asking for up to five guesses. `src/pronounce.ts` then compares those guesses with the card. Both sides are folded to a rough phonetic spelling first, because recognisers and Tagalog spelling both vary: o/u and e/i are merged, `siya`/`sya` and `c`/`k` are treated alike, digits become Tagalog numbers, and spaces are ignored. An attempt passes at 80% similarity, and each word of the card is marked as said or missed so the learner sees what to fix. Add other accepted spellings to a card with `accept: [...]`.

Why this approach: it works today on the phones most learners have (Chrome on Android handles Filipino), adds nothing to the download, and a recogniser that understands the word is a fair test of whether a listener would. Comparing the learner's audio with reference audio (MFCC features with dynamic time warping) needs recorded clips, and the app's audio is the device's speech voice, which a web page can't capture. On-device models like Whisper or wav2vec2 would work offline but cost tens to hundreds of megabytes, and small Whisper models are weak at Tagalog.

While listening, the screen shows whether the microphone is open and whether it is picking up sound, based on the recogniser's own events. The app asks for the microphone itself before starting the recogniser, because some recognisers fail silently instead of prompting. Tapping "I'm done" always finishes within a second and a half, even on recognisers that never report that they stopped.

Limits: a recogniser checks that the words were understood, not fine details like stress. Browsers without a Filipino recogniser (Firefox, and possibly Safari) show the mode as unavailable, and it is left out of mixed rounds there. Apps opened from an iPhone's home screen can't use speech recognition at all ([WebKit bug 225298](https://bugs.webkit.org/show_bug.cgi?id=225298)), so the mode says so there.

`src/screens/practice.speak.test.ts` plays the mode through in a simulated DOM with a scripted recogniser (`src/test/fake-recognition.ts`). It covers the microphone prompt, the listening feedback, finishing on "I'm done" with recognisers that do and don't report the end, a recogniser that never starts, refused microphones, and the iPhone home-screen case. Practice is unscored, so a misheard attempt never touches the review schedule.

## Audio

Audio uses the browser's speech synthesis with a Filipino (`fil`/`tl`) voice when the device has one. Otherwise it falls back to a voice with similar spelling-to-sound rules (Indonesian, Malay, then Spanish), and Settings tells the learner which they're getting.

To use a recorded clip instead, put the file in `public/audio/` and set `audio: 'file.mp3'` on the card in `src/deck.ts`.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (scheduler, sessions, saved progress, deck checks)
npm run build    # type-check and build to dist/
```

No framework: TypeScript, Vite, and a tiny `h()` DOM helper in `src/ui.ts`.

| Path | What's there |
| --- | --- |
| `src/deck.ts` | All lesson content. Add units or cards here. |
| `src/srs.ts` | The scheduler. |
| `src/session.ts` | Building study sessions, unit unlocking, quiz distractors. |
| `src/store.ts` | Saving and loading progress, daily counters and backups. |
| `src/progress-schema.ts` | The saved progress format, its migrations and repair. |
| `src/progress-mirror.ts` | The IndexedDB copy of saved progress. |
| `src/speech.ts` | Audio playback and voice selection. |
| `src/listen.ts` | Speech recognition for speaking questions. |
| `src/pronounce.ts` | Judging what the recogniser heard against the card. |
| `src/screens/` | One file per screen. |
| `public/sw.js` | Service worker for offline use. |

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main` (Pages is enabled with **Settings › Pages › Source: GitHub Actions**). The build uses relative paths, so it also works from any static host.
