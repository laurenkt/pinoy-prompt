# Pinoy Prompt

A small, phone-first web app for learning beginner Tagalog with spaced repetition. Install it to your home screen and it works offline.

## How it works

- **Learn**: each day introduces a handful of new words and phrases (8 by default). Every new card shows the Tagalog, audio, a pronunciation guide, the meaning and a usage tip, followed by a quick multiple-choice check.
- **Review**: cards come back on an SM-2 style schedule (1 day, 3 days, then growing by each card's ease). You rate each recall as Again, Hard, Good or Easy; missed cards come round again in the same session.
- **Practice**: unscored rounds of 10 (listen, read, recall, or mixed) using the words you know, weighted toward the ones you find hardest. Practice never changes the review schedule.
- **Words**: a phrasebook of every unit, tappable for audio.

Units unlock in order: Greetings, Yes/no & politeness, Meeting people, Numbers 1–10, Question words, Food & eating, Family & friends, Everyday phrases.

Progress is stored in `localStorage` on the device. Nothing is sent to a server.

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
| `src/store.ts` | Saved progress, streaks and settings. |
| `src/speech.ts` | Audio playback and voice selection. |
| `src/screens/` | One file per screen. |
| `public/sw.js` | Service worker for offline use. |

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`. Enable it once under **Settings › Pages › Source: GitHub Actions**. The build uses relative paths, so it also works from any static host.
