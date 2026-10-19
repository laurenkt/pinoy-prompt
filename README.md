# Pinoy Prompt

A small, phone-first web app for learning beginner Tagalog with spaced repetition. Install it to your home screen and it works offline.

**Try it:** https://laurenkt.github.io/pinoy-prompt/ (open on your phone, then "Add to Home Screen").

## How it works

- **Learn**: each day introduces a handful of new words and phrases (8 by default). Every new card shows the Tagalog, audio, a pronunciation guide, the meaning and a usage tip, followed by a quick multiple-choice check.
- **Review**: cards come back on an SM-2 style schedule (1 day, 3 days, then growing by each card's ease). You rate each recall as Again, Hard, Good or Easy; missed cards come round again in the same session.
- **Practice**: unscored rounds of 10 (listen, read, recall, speak, or mixed) using the words you know, weighted toward the ones you find hardest. Practice never changes the review schedule.
- **Words**: a phrasebook of every unit, tappable for audio.

Units unlock in order: Greetings, Yes/no & politeness, Meeting people, Numbers 1–10, Question words, Food & eating, Family & friends, Everyday phrases.

Progress is stored in `localStorage` on the device. Nothing is sent to our server (there isn't one). The one exception is speaking questions: the browser's speech recogniser may send your voice to its own speech service, as Chrome does.

## Speaking questions

The **Speak** practice mode shows a word or phrase, listens while the learner says it, and passes if it heard the right thing.

It uses the browser's [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechRecognition) in Filipino (`fil-PH`), asking for up to five guesses. `src/pronounce.ts` then compares those guesses with the card. Both sides are folded to a rough phonetic spelling first, because recognisers and Tagalog spelling both vary: o/u and e/i are merged, `siya`/`sya` and `c`/`k` are treated alike, digits become Tagalog numbers, and spaces are ignored. An attempt passes at 80% similarity, and each word of the card is marked as said or missed so the learner sees what to fix. Add other accepted spellings to a card with `accept: [...]`.

Why this approach: it works today on the phones most learners have (Chrome on Android handles Filipino), adds nothing to the download, and a recogniser that understands the word is a fair test of whether a listener would. Comparing the learner's audio with reference audio (MFCC features with dynamic time warping) needs recorded clips, and the app's audio is the device's speech voice, which a web page can't capture. On-device models like Whisper or wav2vec2 would work offline but cost tens to hundreds of megabytes, and small Whisper models are weak at Tagalog.

Limits: a recogniser checks that the words were understood, not fine details like stress. Browsers without a Filipino recogniser (Firefox, and possibly Safari) show the mode as unavailable, and it is left out of mixed rounds there. Practice is unscored, so a misheard attempt never touches the review schedule.

## Audio

Audio uses the browser's speech synthesis with a Filipino (`fil`/`tl`) voice when the device has one. Otherwise it falls back to a voice with similar spelling-to-sound rules (Indonesian, Malay, then Spanish), and Settings tells the learner which they're getting.

To use a recorded clip instead, put the file in `public/audio/` and set `audio: 'file.mp3'` on the card in `src/deck.ts`.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (scheduler, session building, deck checks)
npm run build    # type-check and build to dist/
```

No framework: TypeScript, Vite, and a tiny `h()` DOM helper in `src/ui.ts`.

| Path | What's there |
| --- | --- |
| `src/deck.ts` | All lesson content. Add units or cards here. |
| `src/srs.ts` | The scheduler. |
| `src/session.ts` | Building study sessions, unit unlocking, quiz distractors. |
| `src/store.ts` | Saved progress, daily counters and settings. |
| `src/speech.ts` | Audio playback and voice selection. |
| `src/listen.ts` | Speech recognition for speaking questions. |
| `src/pronounce.ts` | Judging what the recogniser heard against the card. |
| `src/screens/` | One file per screen. |
| `public/sw.js` | Service worker for offline use. |

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main` (Pages is enabled with **Settings › Pages › Source: GitHub Actions**). The build uses relative paths, so it also works from any static host.
