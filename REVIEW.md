# Reviewing Pinoy Prompt

What a review of a change to this app should check, beyond "does the code work". Each point comes from something the owner has asked for. Flag a change that breaks one as a bug, not a nit.

## Layout on a phone

- **Home fits one phone screen.** Home is the hub: greeting, Study, Chat, Drills, Library and the memory chart should all be visible without scrolling on a typical phone (390×844, and no worse than before at 375×667). A change that adds anything to Home has to make room for it, not push the chart below the fold. Compare `document.documentElement.scrollHeight` on Home before and after the change.
- **No sideways scroll, ever.** Nothing may make the page wider than the viewport at 360px wide (long words, tile rows, pickers, charts).
- **The same screen, the same spacing.** New elements use the existing gutters (18px sides), gaps (10–14px), 44px tap targets, 14–20px radii and header patterns (`.home-header`, `.session-header`, `.back-bar`). Things that sit side by side line up on their edges and centres. Check the change on screenshots at 360px and 390px wide.
- **Works installed.** The app runs as a home-screen PWA: no zoom, safe-area insets respected, nothing that only works with a mouse or keyboard.

## Look and feel

- **Fiesta style.** Bold 3px ink outlines, hard offset shadows (`--shadow`), solid blocks of indigo, saffron, magenta and teal from the `:root` tokens. No smooth gradients (the hard-edged stripes on cards are part of the style), soft blurred shadows, thin hairline UI or new colours outside the tokens.
- **No duplicated UI.** One control per job on a screen. Don't add a second button, label or heading that repeats one already there, and reuse the shared pieces (`h`, `icon`, `audioButton`, `quietToggle`, `progressBar`) instead of copying them.
- **Plain words.** Copy is short, friendly and free of jargon; grammar is explained without grammar terms.

## Product

- **Practical, not gamified.** No streaks, points, badges, levels, lesson chapters to complete, or nudges to come back. Praise stays small (a "Tama!"), and nothing should push the learner by guilt or reward loops.
- **The schedule is honest.** Only answers to scheduled reviews and new cards change a card's schedule. Extra practice, drills, speaking and Chat never do. A step that is skipped (for example by quiet mode) leaves the card exactly as it was.
- **Quiet mode holds.** With `settings.quiet` on, nothing in Study or Drills asks the learner to speak, including steps chosen before it was turned on.

## Saved progress

Progress is the one thing the app can't lose (see "Saved progress" in the README).

- A change to the saved shape needs a `SCHEMA` bump, a migration and a fixture, or must be optional with a default when read back (as settings are).
- Nothing may save an empty or partial copy over real progress, drop cards it doesn't recognise, or strip unknown fields.
- Tests cover any change to how progress is read, merged or saved.

## Tests

- `npm test` and `npm run build` pass.
- Behaviour changes come with a test that fails without the change.
