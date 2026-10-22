# Architecture

How Pinoy Prompt is put together, and the rules that keep it one app rather than a set of features that happen to share a page. The README says what the app does; REVIEW.md says what a change must not break. This says where things go.

Two rules come first:

- **Extend the system that already does the job.** Before adding a module, find the one below that owns that kind of work (audio, storage, navigation, layout, tests) and grow it. A second way of doing the same thing is a bug waiting for the two to disagree.
- **Rule of three.** Copy something once if you must; the third copy becomes a shared piece. Don't build a shared piece for one or two users.

## The systems

Each system has one owner module. Anything else that needs it calls that module.

| System | Owner | What it owns |
| --- | --- | --- |
| Navigation | `src/app.ts`, `src/main.ts`, `src/back-history.ts`, `src/fit.ts` | `Route`, the `App` every screen gets, drawing a screen, the system back gesture, whether the screen fits (for bounce). Screens only call `app.navigate`, `app.onBack` and `app.onKey`. |
| Screens | `src/screens/*.ts` | One file per screen, each a function from `App` to an element, plus the pieces several screens share that need screen context (`quiet.ts`, `auto-advance.ts`, `speak.ts`, `speak-result.ts`, `growth-chart.ts`). |
| Shared UI | `src/ui.ts` | `h`, `svg`, `icon`, and the plain pieces used on three or more screens. A shared piece with its own behaviour gets its own file in `src/screens/` (the quiet toggle in `quiet.ts`). |
| Look | `src/style.css` | Colour, outline, shadow and radius tokens on `:root`; one section per screen. |
| Saved progress | `src/store.ts`, `src/progress-schema.ts`, `src/progress-mirror.ts` | Everything in `localStorage` under `pinoy-prompt:progress`, and its IndexedDB mirror. Settings live inside progress. |
| Learning | `src/deck.ts`, `src/guides.ts`, `src/srs.ts`, `src/session.ts`, `src/memory.ts`, `src/meaning.ts` | Content, the schedule, what Study asks next, memory stats, judging a typed meaning. No DOM. |
| Audio out | `src/audio-engine.ts` | The one shared `AudioContext`, decoding and playing buffers. |
| Card audio | `src/speech.ts`, `src/spoken.ts`, `src/clips.json`, `scripts/generate-audio.mjs` | Playing a card's recorded clip (`play`, `stop`, `preload`), the built-in voice as fallback, the right-answer `chime` and the button `tick`, mute for quiet mode. |
| Microphone | `src/microphone.ts`, `src/recorder.ts` | The one shared mic stream; recording a take. |
| Haptics | `src/haptics.ts` | A light haptic tick: `navigator.vibrate` where there is one (Android), a hidden iOS 18 switch toggled from script on iPhones. Used by the chart's scrub ticks (`detents` in `speech.ts`). |
| iOS audio session | `src/audio-session.ts` | Called by the engine and card audio (`playback`) and the microphone (`play-and-record`) only. |
| Speaking | `src/fbank.ts`, `src/phone-model.ts`, `src/model-cache.ts`, `src/phonetics.ts`, `src/coach.ts`, `src/player.ts` | Recognising and judging a spoken attempt; playing slices and reference sounds through the engine. |
| Chat | `src/openai.ts`, `src/talk.ts`, `src/visualizer.ts`, `src/screens/talk.ts` | The OpenAI key and call, what the AI is told, the backdrop. `openai.ts` is the one place that talks to OpenAI, so Drills' meaning check (`checkMeaning`) lives there too, and so does the spend estimate Settings shows: each request adds what it cost (`addSpend`, priced from `PRICES` and `CENTS_PER_MINUTE`), kept like the key outside progress. A new request adds its cost the same way. |
| Offline | `public/sw.js`, `src/clip-cache.ts`, `src/model-cache.ts` | The app shell, word clips and the speech model in Cache Storage. Code loaded on demand is named by the build, and an installed app can stay open across a deploy that removes it, so it's loaded at start instead (`keepSpeakingReady`); a new dynamic import needs the same. |
| Tests and CI | `src/**/*.test.ts`, `src/test/`, `.github/workflows/ci.yml` | See below. |

### Navigation and page layout

Every screen is one of two kinds, and each kind has one layout:

- **A page** (Library, Settings): opened from Home, browsed, left. It starts with `pageHeader()` from `ui.ts`: the back arrow (`.back-bar`) at the top left, then its title with at most one control beside it (`.page-header`). System back goes Home.
- **A session** (Study, a drill round, Chat): something in progress. It has `.session-header` with the close button (×) at the left, then progress and any controls. Close, and system back, end the session the way the screen chooses (Study shows its summary, a drill round goes Home). Drills open straight into a round, so they are a session; only with too few words to drill do they show a page saying so.

Home is the hub and has its own header. A screen never shows both a back arrow and a close button. New screens pick one of the two kinds; a new kind of screen is a decision worth writing down here first.

**Header buttons.** Icons in a header are `iconButton` from `ui.ts`; a toggle passes `pressed`, and turns teal while it's on. Quiet mode (`quietToggle`) is the same icon toggle on Home, Study and Drills. Home's settings button is a toggle too: Settings passes it, on, to `pageHeader`, which draws it at the right of the back bar, where it sat on Home, so a second tap closes Settings. It goes Home like the back arrow beside it, on purpose, so the toggle reads as one. A page opened from another header toggle on Home would do the same.

**Height.** Every screen is at least as tall as the phone's screen (`.screen` in `style.css`, under "Layout"). A screen that fits passes its spare height down a column of containers (`.home`, `.practice`, `.talk`, `.session`, `.session-body`, `.panel`) to what can use it, so a taller phone gets bigger targets rather than an empty bottom:

- In a session's `.panel`, the prompt grows on phones taller than about 700px, answer choices share the rest (up to a size a thumb can't miss, leaving room below for the feedback an answer brings so a right answer doesn't move them), and otherwise the panel's last piece (its button, the answer and ratings, the microphone) sits at the bottom, under the thumb. A `.panel.center` card sits in the middle instead: it is the one look for a message with a way forward (a summary, a topic's introduction, waiting for the microphone, "learn some words first" on Drills and Chat). A wrapper between the screen's root and such a card takes `.fill` so the height reaches it.
- On Home the hub takes it; in a call, the transcript.
- Pages (Library, Settings) are as long as their content and scroll.
- A screen that fits doesn't bounce: `src/fit.ts` keeps `fits` on the page while there's nothing below the fold, and style.css turns off overscroll then. Once a screen runs long (a wrong answer's feedback, Library) it scrolls and bounces as iOS always does. Sizes that grow are worked out from `--fill`, the phone's height less the status bar and home bar, so a screen that fits on an installed iPhone doesn't scroll by the insets. `npm run screenshots` emulates those insets and reports any screen that scrolls, so one that should fit but is a few pixels over shows up.

A new screen or panel gets this by using those containers; a wrapper element between them breaks the column, which `src/screens/layout.test.ts` checks. Sizes that should grow with the phone use `dvh` in a `clamp()`, so on a short phone (375×667) nothing is taller than it was; only answer choices use what little room is left, until one is picked.

Spacing, gutters, tap targets and colours come from REVIEW.md and the `:root` tokens in `style.css`.

**Text you can copy.** The app has two kinds of text. Controls and chrome (buttons, chips and pills, toggles, Library's topic headings, page and session headers, Home's memory card with its chart and labels, other charts, the end-of-session stats) don't start iOS's text selection or its callout when a thumb rests on them. Content (Tagalog words, translations, examples, eyebrows, feedback, error messages, Home's greeting, the Chat transcript) stays selectable so it can be copied. One rule near the top of `style.css` lists the chrome by element (`button`, `label`, `summary`, `nav`, `svg`), by role (`radio`, `img`, `progressbar`, `meter`) and by a few classes that are only ever chrome; everything else is content by default. So a new button or chart is covered without doing anything; new chrome that is none of those joins that list rather than getting a `user-select` of its own, and content never needs marking. Don't add a styling class that content also uses (`.eyebrow`, `.muted`). The rule below it lets two things back in: text fields, because iOS won't let you type or paste into a field inside unselectable chrome, and the word buttons in a Chat message, which are part of the message. Other text on a control can't be copied, so a word the learner might want to copy belongs beside its button, not on it. `src/screens/layout.test.ts` checks both kinds on Home, Study, Drills, Library and Settings.

### Audio

Every recorded sound the app plays goes through `audio-engine.ts`'s shared context: card clips, the right-answer chime and the button tick (via `speech.ts`), reference sounds and slices of a recording (via `player.ts`). The chime lives beside card audio so it shares its mute, and so a word clip said back with it starts once it ends rather than over it. The tap sound (a thock for the big chunky buttons, a recording inlined as a data URL from `src/sounds/`; a lighter click made in code by `clickSamples` for chips, pills, section headings, links and checkboxes) is played for every press by one listener (`tickOnPress`, installed in `main.ts`), not by each screen: it stays quiet when the press already used the shared context (a word, the chime, a reference sound or slice: `audioBusy`), when Settings' Tap sounds is off, while the microphone is in use, and for buttons marked `data-no-tap` (ones that start recording). Buttons that start a Chat call are marked `data-tap="before"` and tap before their handler opens the microphone. A finger scrubbing across the memory chart ticks at each day, like a picker wheel (`detents`): a quieter click, at most every 45 ms, with a haptic tick where the phone allows. A drag can't start audio on iOS, so it only ticks once the app's audio is already going. Screens never make an `AudioContext` or an `Audio` element; they call `play`/`stop` for cards, or a `Player` for the results screen. `speech.ts` also owns one path outside the engine: the built-in voice (`speechSynthesis`), used only when a clip can't play. Other exceptions are deliberate:

- `recorder.ts` keeps its own context, made inside the tap, because iOS changes the hardware rate when the mic opens.
- Chat's AI voice is a WebRTC stream, played by an `<audio>` element from `openai.ts`, and `visualizer.ts` makes a context for its analysers. If Chat's audio is reworked, move the analysers onto the shared context or note here why they can't.

`app.navigate` stops card audio, recording and any call, and ends a screen's hold on the microphone, so a screen doesn't have to clean those up when it's left.

**Asking for the microphone.** The phone's permission question comes as a round starts, not over a speaking question. When a drill round that may ask to speak opens, and when Study's practice starts ("Keep practising"), and the browser would still ask (`microphoneAllowed` in `microphone.ts`, which follows what WebKit remembers), the screen calls `askForMicrophone` from `speak.ts` inside that tap and shows `micWaiting` while the phone asks. It holds the microphone until the screen is left, or Study shows its summary (`holdMicrophone`). A later tap that lets a round ask to speak again (the Speak chip, quiet mode going off) asks the same way. If it's refused, speaking is left out until the screen is left. Chat already opens the microphone from its own tap. If the Allow lapses mid-round (a long while in the background), the phone asks again at the next Tap and speak. A new screen that records asks the same way.

### Saved progress and settings

Progress is the one thing the app can't lose; the README's "Saved progress" section and REVIEW.md are the rules. In short: change its shape only with a `SCHEMA` bump, a migration and a fixture, or add an optional field with a default. Settings are part of progress. The OpenAI key is kept outside it, on purpose, so it never goes into a backup, and with it the estimate of what OpenAI has cost on this device (`pinoy-prompt:openai-spend`): it belongs to the key and this device, not to learning, so Reset leaves it and a backup restored elsewhere does not carry it.

### Tests and CI as one system

- **One pipeline.** `.github/workflows/ci.yml` tests and builds every pull request and every push to `main`, and publishes to GitHub Pages from `main` only after that has passed, using the build it tested.
- **One runner.** Vitest. Logic tests run in Node; screen tests opt into `happy-dom` with `// @vitest-environment happy-dom` on their first line.
- **Shared test pieces live in `src/test/`.** `screen.ts` has the stand-in `App` (`fakeApp`), `button`, `noMic` and `flush` for screen tests; `fake-speech.ts` stands in for the recogniser and player; `fake-audio.ts` for the shared AudioContext, counting chimes; `fake-storage.ts` for storage; `fixtures/` holds saved progress from every schema. When `App` or `Settings` changes, change `fakeApp` once.
- **Stand-ins go through deps, not module mocks,** where a screen offers them (`SpeakDeps`, `TalkDeps`, `CallDeps`, `Player`). Prefer adding a dep over `vi.mock` of a shared module, which can hide a change in that module from every screen test.
- **Files that can't import each other are checked by a test.** `public/sw.js` can't import from `src/`, so `src/sw.test.ts` checks the cache names and file path it shares with the app. `src/spoken.test.ts` checks every spoken text has its clip. Add a check like these whenever two systems agree on a name by hand.
- **Screenshots** for UI changes (CLAUDE.md) are taken with `npm run screenshots -- <out-dir> [screen ...]` (`scripts/screenshots.mjs`): Playwright on the dev server, at 360×640, 390×844, an iPhone SE (375×667) and a Pro Max (430×932), the iPhones with their installed safe-area insets, on a seeded learner so before and after match. It always includes Home, and prints Home's scroll height and any screen wider than the phone. It uses Playwright's Chromium (`npx playwright install chromium` once). Add a screen to its list when a change needs one it doesn't reach.

## Findings, October 2026

What a review of the whole app found, most important first, and what has been done.

1. **Two ways out of a drill round.** A drill round showed the page back arrow (to Home) above the session's close button (to the menu): two controls for one job, going to different places. Settings closed with × while Library and Drills used the back arrow. *Fixed: each screen draws its own top, pages with `pageHeader` from `ui.ts`; `src/screens/layout.test.ts` holds them to it.*
2. **Deploy didn't wait for tests.** CI and deploy were separate workflows, so a push to `main` was published even if its tests failed. *Fixed: one pipeline that deploys the build it tested.*
3. **Screen test setup copied eight times.** Each screen test had its own stand-in `App`, and most their own `button` finder, so a change to `App` (as `onBack` was) meant editing every file. *Fixed: `src/test/screen.ts`.*
4. **Service worker names kept in step by hand.** `public/sw.js` repeats two cache names and a source path from `src/`, with a comment pointing at the wrong file. A rename would have broken offline audio or speaking without a failing test. *Fixed: `src/sw.test.ts`.*
5. **Copied UI pieces.** The play / play slowly pair was written out six times across Study and Drills, and the numbered answer choices three times. *Fixed: `audioPair` and `choiceList` in `ui.ts`.*
6. **Study and Drills ask the same questions with separate code.** Read, listen and recall prompts and their feedback are built twice, and the words have drifted: Drills says "Tama!" / "Mali.", Study a rotating "Magaling!" / "Not quite.". Not worth merging yet; the next change to how either asks a question should move the prompts into one place and settle on one wording.
7. **Audio is now one system.** After the clip rewrite, card audio, reference sounds and slices all go through the shared engine, and the built-in voice is only a fallback. The remaining loose end is the visualizer's own context (see Audio).
8. **`screens/session.ts` is large** (about 900 lines: introductions, quizzes, flashcards, guide drills, tile building, speaking, the summary). Fine while it changes rarely; split the guide views into their own file the next time they grow.
9. **Screenshots are taken by a new script each time.** Worth a shared `npm run screenshots` (Playwright, Home plus a given screen at 360px and 390px, reporting Home's scroll height and any sideways scroll) the next time a UI change needs them, so REVIEW.md's layout checks are measured the same way every time. *Fixed: `npm run screenshots`, added with the full-height layout.*
