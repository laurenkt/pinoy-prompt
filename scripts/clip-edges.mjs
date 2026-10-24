// Where speech starts and ends in a take, for scripts/generate-audio.mjs: so a
// clip's silence is trimmed without cutting into the word, and a take the voice
// model itself cut short (it often starts a word that begins with a vowel
// already sounding) is made again.

/** Levels are measured 10 ms at a time. */
export const FRAME = 0.01;
/** Quieter than this, in dB below the take's loudest moment, is silence: the voice's own hiss and breath sit 40 to 50 dB down. */
export const QUIET_DB = 40;
/** A take whose first or last 10 ms is louder than this below its peak starts or ends mid-sound. */
export const CUT_DB = 35;
/** Silence kept before the first sound and after the last, so soft starts ("h") and fading ends ("-an") are heard whole, and the player's fades fall on silence. */
export const LEAD = 0.05;
export const TAIL = 0.15;

/** The level of each 10 ms of `samples`, in dB. */
export function levels(samples, rate) {
  const size = Math.round(rate * FRAME);
  const out = [];
  for (let at = 0; at + size <= samples.length; at += size) {
    let sum = 0;
    for (let i = at; i < at + size; i++) sum += samples[i] * samples[i];
    out.push(10 * Math.log10(sum / size + 1e-12));
  }
  return out;
}

/**
 * Where the sound in `samples` starts and ends, in seconds, and which end, if
 * either, is cut off mid-sound.
 */
export function edges(samples, rate) {
  const db = levels(samples, rate);
  const peak = Math.max(...db);
  const first = db.findIndex((d) => d > peak - QUIET_DB);
  const last = db.findLastIndex((d) => d > peak - QUIET_DB);
  const cut = [db[0] > peak - CUT_DB && 'start', db.at(-1) > peak - CUT_DB && 'end'].filter(Boolean);
  return { start: first * FRAME, end: (last + 1) * FRAME, duration: samples.length / rate, cut };
}

/**
 * How to trim a take to its sound: from `from` to `to` (seconds of the take), with `before` and `after`
 * seconds of silence added where the take has less than LEAD or TAIL of its own.
 */
export function trimPlan({ start, end, duration }) {
  // In whole milliseconds, as ffmpeg can't read a float's rounding error (8e-17) as a duration.
  const ms = (s) => Math.max(0, Math.round(s * 1000)) / 1000;
  const from = ms(start - LEAD);
  const to = Math.min(ms(duration), ms(end + TAIL));
  return { from, to, before: ms(LEAD - (start - from)), after: ms(TAIL - (to - end)) };
}

/**
 * Whether a finished clip has less silence before its sound than the trim leaves (one made before it, cut close).
 * Only the start is measured: evening out loudness lifts the breath after a word to about the level of QUIET_DB,
 * so a clip's measured end can land in its tail, and a clip trimmed right would be remade on every run.
 */
export function trimmedClose(samples, rate) {
  return edges(samples, rate).start < LEAD / 2;
}
