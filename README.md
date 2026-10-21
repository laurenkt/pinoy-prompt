# Pinoy Prompt

A small, phone-first web app for learning beginner Tagalog with spaced repetition. Install it to your home screen and it works offline.

**Try it:** https://laurenkt.github.io/pinoy-prompt/ (open on your phone, then "Add to Home Screen").

## How it works

- **Study**: one button, and it keeps going until you stop. Each step is picked as you go: due reviews first, weakest first (lowest estimated recall), then a new card, but only once nothing is due, fewer than 3 cards are still being learned, and the daily new-card rate (8 by default) allows. When you're caught up it moves on to extra practice of your weakest words, which never changes the schedule.
- **Question types**: each word is one memory with one schedule, asked in different ways. Words still being learned get a multiple-choice check (see the Tagalog, pick the meaning). Learned words are self-rated, so a lucky guess can't push one weeks out: you read or hear the Tagalog and recall the meaning, and as a word holds for longer, you produce the Tagalog from the English. Extra practice mixes in multiple choice both ways, listening, and speaking once the pronunciation model is on the device.
- **New words**: every new card shows the Tagalog, audio, a pronunciation guide, the meaning, a usage tip and a memory hook, followed by a quick multiple-choice check. Once nothing is due, "Learn something new" at the end of a session adds 5 beyond the daily rate.
- **Beyond words**: cards aren't only vocabulary. Guides (`src/guides.ts`) teach sentence patterns ("Gusto ko ng ___"), sounds (the "ng" at the start of a word), how to say things (questions go up at the end) and everyday know-how (calling people Kuya and Ate). Each is introduced with a plain-English explanation and examples you can hear, then checked with a gap to fill. Once learned, a pattern comes back as a fresh sentence to build from tiles or to say from the English, so the rule is practised rather than one sentence; other guides are recalled and self-rated. Guides share the same schedule and daily allowance, and are eased in: none before 8 cards (patterns not before 20), only once the cards they build on have been remembered a day later, and at most one in every 6 new cards (one in 4 after 100). Explanations avoid grammar terms.
- **Schedule**: SM-2 style (1 day, 3 days, then growing by each card's ease). A missed word comes back after a short gap in the same session.
- **Drills**: unscored rounds of 10 in one skill (listen, read, recall, speak, or mixed), weighted toward the words you find hardest. Drills never change the review schedule.
- **Home**: the one hub, with no tab bar. Big Study (showing how many cards are due) and Chat buttons, smaller Drills and Library buttons, then a chart of your memory: how firmly each card is stored over time (just met, days, weeks, long-term, read from its review interval), with how often you recall them (measured from your reviews over the last 30 days, or estimated from the schedule until there are enough). There are no lessons to complete or streaks to keep.
- **Library**: everything there is to learn, filterable by kind: words and phrases by topic (tappable for audio), then patterns, sounds, how to say things and know-how. Each card you know shows how firmly it is stored.
- **Chat**: a spoken conversation with an AI in English, with the learner's Tagalog mixed in. See below.

New words come most useful first, whatever their topic, at the daily rate set in Settings: `LEARN_ORDER` in `src/deck.ts` ranks every card by how soon it helps in conversation (hello, thanks, yes/no and "I don't understand" first; "I'm on my way" and "now / later" early; "Traffic!" and the weekdays much later). The little words phrases are built from (`CORE_WORDS`: I, you, we, my, your, the, this, already, just, to, of, "ba", "po", "not") each get their own card and come before any phrase that uses them, so a new phrase is one new thing rather than several; rarer words in a phrase are learned in context (`src/deck.test.ts` checks the order). Topics only group words on the Words screen, and a topic's intro shows before the first of its words a learner meets. The deck is weighted towards getting by quickly: greetings and politeness, meeting people, numbers, questions, the building blocks (I, you, my, the, this, already, there is, I need, can I), telling time, when things happen, travelling, places and directions, making plans, food and eating out, money and shopping, family, everyday phrases, chat reactions, how you feel, and help in an emergency. Progress is kept by card id, so a card's id must never change once released (`src/deck.test.ts` checks this).

Progress is stored on the device. Nothing is sent to our server (there isn't one), and that includes your voice: speaking questions are checked on the device. The one exception is Chat, which is opt-in: it sends the conversation's audio to OpenAI with the learner's own key.

## Chat

Chat (called Talk in the code) is a spoken conversation in English with the Tagalog the learner knows mixed in, using OpenAI's GPT-Live (`gpt-live-1`) over WebRTC.

- **What gets mixed in** (`src/talk.ts`): every word the learner has met, grouped by how firmly it's stored, plus one word they haven't met yet (the next one in the chosen topic). The AI is asked to speak English, Taglish style, with only those words swapped in and no other Tagalog (unless the learner asks how to say something, which always gets a straight answer): about one per sentence for a beginner, two or three past 20 words, and as many as fit past 60. So as words are learned, more of each conversation turns Tagalog on its own. The instructions follow OpenAI's GPT-Live prompting guide, and the call opens with an English greeting sent as a developer message and then as commentary once the session starts.
- **On screen**: a full-screen WebGL backdrop played by both voices (`src/visualizer.ts`): a kaleidoscope tunnel that rushes forward with speech, oscilloscope rings drawing the raw waveforms (teal for the learner's microphone, saffron for the AI) and colour splits on sharp sounds. It reads the raw waveform from Web Audio analysers each frame, with an envelope that rises instantly, so it moves with the sound rather than after it. Over it, the live transcript of the call, which follows the newest words unless the learner scrolls back. The deck's Tagalog is underlined in its strength colour. Tapping one plays it and shows its meaning. The AI says the meaning of words met in the last day, and of the new word, aloud.
- **Practice, not a test**: no scores, and the review schedule is never touched. Mistakes aren't marked; the AI uses the right form in its reply instead.
- **The learner's own key** (`src/openai.ts`): Chat uses an OpenAI API key the learner pastes in. It's kept in `localStorage` apart from progress, so it never goes into a backup, and is sent only to `api.openai.com`. The browser sends its WebRTC offer straight to `POST /v1/live/sessions` with that key; there is no server of ours. Calls end after 10 minutes, and the call screen shows the running time and rough cost (GPT-Live is billed at about 5¢ a minute).

Why not "Sign in with ChatGPT": its self-serve route is for open-source apps running on the user's own computer, with a `127.0.0.1` callback, and its sign-in endpoints don't allow calls from web pages. The hosted-website route needs OpenAI's approval and a backend. Neither fits a static PWA, so Chat uses a pasted key instead.

## Saved progress

A learner's progress is the one thing the app can't afford to lose, so it is kept with some care:

- **Versioned.** Progress is saved in `localStorage` as `{ schema, rev, savedAt, progress }`. `src/progress-schema.ts` upgrades older copies one schema at a time, repairs damaged cards field by field instead of dropping them, and keeps fields it doesn't recognise, so an older build never strips data a newer one added. To change the schema, bump `SCHEMA`, add a migration and add a fixture under `src/test/fixtures/`; the tests fail until all three exist.
- **Two copies.** Every save is mirrored to IndexedDB. On start-up the newer copy wins, so a cleared or unreadable `localStorage`, or a write iOS lost by killing the app, is recovered from the mirror.
- **Saves never remove cards.** Each save re-reads what is stored and merges it in, keeping the more recently reviewed version of each card. Two open tabs can't overwrite each other, and a start-up that failed to read storage can't save an empty copy over real progress. Only Reset replaces progress, and it keeps the old copy under `pinoy-prompt:before-reset`. A copy that can't be read at all is set aside under `pinoy-prompt:unreadable`.
- **Kept from eviction.** Once there is progress, the app asks the browser for persistent storage (`navigator.storage.persist()`).
- **Backups.** Settings can save a backup file (through the share sheet on iPhone) and restore one. Restoring merges, so it never removes anything. On iPhone the Home Screen app and Safari keep separate storage, so a backup is how to move progress between them.

`src/store.test.ts` plays out the ways progress could be lost: unreadable or full storage, a wiped `localStorage`, a lost write, a hung IndexedDB, two tabs saving at once, upgrades from the first storage format, and resets. `src/progress-schema.test.ts` loads a fixture from every schema version and throws thousands of randomly damaged copies at the loader.

## Speaking questions

The **Speak** practice mode shows a word or phrase, records the learner saying it, and coaches them on each sound: the letters they said well, the ones that were nearly there, the ones that were off, and a short tip for the most important fix (for example "ng is one sound, like the end of *sing*" or "Filipino r is a quick tap, like the tt in American *butter*").

How it works:

1. **Recording** (`src/recorder.ts`): the microphone is read at its native rate, shown live on a level meter, downsampled to 16 kHz, and stopped automatically after a short silence (or by tapping "I'm done").
2. **Recognising sounds** (`src/fbank.ts`, `src/phone-model.ts`): the audio becomes 80-band log mel features, computed exactly as in training (checked against lhotse in `src/fbank.test.ts`), and goes through [ZIPA](https://github.com/lingjzhu/zipa) (Zhu et al., ACL 2025), a multilingual phone recogniser that outputs IPA sounds rather than words. We use the 64M-parameter `zipa-small-crctc` model, int8-quantised, run with onnxruntime-web in WebAssembly. Model © its authors, [CC BY 4.0](https://huggingface.co/anyspeech/zipa-small-crctc-500k).
3. **Expected sounds** (`src/phonetics.ts`): Tagalog spelling is close to phonemic, so a rule set turns each card into IPA (ng → ŋ, r → ɾ, mga → maŋa, ts → tʃ, siy+vowel → ʃ, borrowed letters, optional glottal stops).
4. **Comparing** (`src/phonetics.ts`): the two sound sequences are aligned with an edit distance weighted by phonetic features, so a near miss (aspirated p, o said as ou) costs less than a different sound. Tagalog allophones (o/ɔ, e/ɛ, r/ɾ) count as right, and added sounds count against the attempt (except a glottal catch or a released final consonant). A card can list other standard pronunciations with `accept: [...]` (Kumusta accepts Kamusta); the attempt is judged against the closest one.
5. **Coaching** (`src/coach.ts`): common English-speaker patterns get a specific tip; anything else gets "sounded like X".

**The results screen** breaks the attempt down sound by sound (`src/screens/speak-result.ts`), and fits on one phone screen:

- The card becomes the result: the word with each letter coloured by how its sound came out, and the whole word to play back, yours or the target.

- The recording is drawn as a ribbon (`src/spectrogram.ts`, WebGL with a 2D canvas fallback): it swells with loudness, holds the pitch spectrum inside, and is outlined in each sound's verdict colour. A glowing playhead follows whatever is playing.
- Each sound is marked along the ribbon: the sound aimed for above, what was heard below, in its verdict colour. A sound that wasn't said gets a dashed slot where it should have been. Tap a mark to open that sound and hear your slice of the recording.
- The open sound gets its tip, a closeness bar and a map of where it's made in the mouth (`src/sound-map.ts`): the vowel chart for vowels, a where × how grid for consonants. Your mark and the target sit on it with a path between them. Its buttons play yours, a native speaker saying the target, or both, while your mark travels to the target.

The recogniser's output gives each sound a time (from the CTC frames), which is how a tap finds its slice of the recording. The native reference clips in `public/sounds/` are short syllables (like "ŋa" and "aɾa") cut from the [FLEURS](https://huggingface.co/datasets/google/fleurs) Filipino recordings (CC BY 4.0), each checked by running the recogniser on the cut clip; `src/reference-sounds.json` lists the word each came from.

The model is a one-time download of about 71 MB, fetched from Hugging Face only after the learner agrees, then kept in the browser's Cache Storage so it works offline. A download that's cut short is never kept. Once the model is on the device, the service worker also keeps the model's runtime (about 11 MB, listed in the build's `asset-manifest.json`) across app updates; learners who never use speaking don't download it. Mixed rounds include speaking only once it's on the device.

Why this approach: the browser's speech recogniser can only say whether it understood the word, which isn't coaching, and it isn't available at all in apps opened from an iPhone's home screen ([WebKit bug 225298](https://bugs.webkit.org/show_bug.cgi?id=225298)). Comparing against reference audio would need recorded clips for every card. A phone recogniser hears what was actually said, works on any modern browser including iOS, and keeps the voice on the device.

Tuning: the scoring was checked against 73 sentences read by native speakers ([FLEURS](https://huggingface.co/datasets/google/fleurs) Filipino dev set), so that natural Tagalog isn't marked wrong: "ng" taking the sound after it (m before p/b, n before t/d/s/l), the particle "ng" said "nang", "ay" said "e", long vowels, and the recogniser writing k as q. In that fast, connected speech about 80% of words come through with nothing flagged; careful single words do better.

Limits: it doesn't judge stress or intonation yet, and a phone recogniser can mishear, so tips are guidance rather than a verdict. Practice is unscored, so attempts never touch the review schedule.

Tests: `src/screens/speak.test.ts` and `src/screens/practice.speak.test.ts` play the mode through in a simulated DOM with a scripted microphone and model, covering the download offer, recording feedback, "I'm done", results and tips, and microphone problems. `src/phonetics.test.ts` covers spelling to sounds, comparison and tips.

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
| `src/deck.ts` | All word content, grouped by topic, and the learning order. Add topics or cards here. |
| `src/guides.ts` | Cards beyond vocabulary: patterns, sounds, how to say it, know-how. |
| `src/srs.ts` | The scheduler. |
| `src/session.ts` | Building study sessions, new-word order, quiz distractors. |
| `src/memory.ts` | Memory stats for Home: strength bands, estimated and measured recall. |
| `src/store.ts` | Saving and loading progress, daily counters and backups. |
| `src/progress-schema.ts` | The saved progress format, its migrations and repair. |
| `src/progress-mirror.ts` | The IndexedDB copy of saved progress. |
| `src/speech.ts` | Audio playback and voice selection. |
| `src/recorder.ts` | Microphone recording for speaking questions. |
| `src/fbank.ts`, `src/phone-model.ts` | Audio features and the on-device phone recogniser. |
| `src/phonetics.ts`, `src/coach.ts` | Expected sounds, comparison and pronunciation tips. |
| `src/screens/speak-result.ts`, `src/spectrogram.ts`, `src/sound-map.ts`, `src/player.ts` | The sound-by-sound results screen. |
| `src/screens/` | One file per screen. |
| `public/sw.js` | Service worker for offline use. |

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main` (Pages is enabled with **Settings › Pages › Source: GitHub Actions**). The build uses relative paths, so it also works from any static host.
