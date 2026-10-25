// One microphone stream shared by speaking drills and Talk, open only while
// something is listening: a take, a warm-up for one, or a call.
//
// While a stream is open, even with its tracks switched off, iOS puts the
// whole page in a call (WebKit's PlayAndRecord category in VideoChat mode,
// see MediaSessionManagerCocoa): playback goes through voice processing,
// much quieter, on a volume of its own that the side buttons only reach
// while it's in a call. So the stream is closed as soon as nothing is using
// it, and every sound between takes plays as media, at the phone's volume.
//
// What WebKit remembers (UserMediaPermissionRequestManagerProxy): an "Allow"
// lasts for the page while a stream is open, and for 10 minutes after the
// last one closes if the next request comes from a tap (1 minute if not, on
// iPhone). Reloading forgets it, and so does a fresh launch of the home-screen
// app. Only Safari's own site setting (Microphone: Allow) keeps it for
// longer, and the home-screen app has none. So callers ask from a tap, and a
// screen that will keep asking (a drill round) asks as it opens
// (askMicrophone), which starts those 10 minutes; each take starts them again.

import { setAudioSession } from './audio-session';

// Auto gain is left at the browser's default, as both callers had it before.
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

let stream: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;
let users = 0;
/** Bumped as each screen that asked is left, so an answer that comes after isn't taken as the screen's. */
let asks = 0;
/** When the last stream closed, by Date.now(); WebKit keeps the learner's Allow for 10 minutes after. */
let closedAt = -Infinity;
/** Under WebKit's 10 minutes, so a request just inside it doesn't race the watchdog. */
export const ALLOW_KEPT_MS = 9 * 60 * 1000;
/** The site setting says Allow (a Safari tab set so), as read when the app opened. */
let allowedBySite = false;

/** Whether a microphone stream is open, or being opened. */
export function microphoneOpen(): boolean {
  return stream !== null || opening !== null;
}

/**
 * The stream open now, if it's live: not just being asked for, so the hardware has taken on the microphone's rate,
 * and not cut off, so switching it on won't open (or ask for) another.
 */
export function liveMicrophone(): MediaStream | null {
  return stream && live(stream) ? stream : null;
}

/** Whether something is recording, warming up or on a call now, rather than the stream just being asked for. */
export function microphoneInUse(): boolean {
  return users > 0 || opening !== null;
}

/**
 * Whether asking for the microphone now would go straight through, without the browser asking the learner:
 * a stream is open, one closed recently enough that WebKit still remembers the Allow, or the site is set to Allow.
 */
export function microphoneAllowed(): boolean {
  return microphoneOpen() || Date.now() - closedAt < ALLOW_KEPT_MS || allowedBySite;
}

/** WebKit asks again from outside a tap once the last stream closed more than a minute ago; a little under it. */
export const REOPEN_QUIETLY_MS = 50 * 1000;

/**
 * Whether getMicrophone() now would go straight through without the browser asking, for a caller that may not be
 * inside a tap (`fromTap` false): outside one, WebKit only remembers the Allow for a minute after the last stream closed.
 */
export function microphoneOpensQuietly(fromTap: boolean): boolean {
  return microphoneOpen() || allowedBySite || Date.now() - closedAt < (fromTap ? ALLOW_KEPT_MS : REOPEN_QUIETLY_MS);
}

// A track iOS muted (a phone call, Siri) can stay "live" but silent, so it doesn't count.
const live = (s: MediaStream) => s.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);

/** The microphone, switched on. Only asks for permission when no stream is open. Pair with releaseMicrophone(). */
export async function getMicrophone(): Promise<MediaStream> {
  if (stream && !live(stream)) closeMicrophone();
  if (!stream) {
    setAudioSession('play-and-record');
    opening ??= navigator.mediaDevices.getUserMedia(CONSTRAINTS).finally(() => (opening = null));
    try {
      stream = await opening;
    } catch (error) {
      // No microphone after all (refused, or none), so don't keep the session it needed.
      if (!microphoneOpen()) setAudioSession('auto');
      throw error;
    }
  }
  users++;
  for (const t of stream.getTracks()) t.enabled = true;
  return stream;
}

/** Done with the stream from getMicrophone(). Call once per getMicrophone(). It's closed once nothing else is using it. */
export function releaseMicrophone(released: MediaStream): void {
  if (released !== stream) {
    released.getTracks().forEach((t) => t.stop());
    return;
  }
  users = Math.max(0, users - 1);
  if (users === 0) closeMicrophone();
}

/**
 * Done with a stream from getMicrophone() that gave no sound at all (iOS can leave a track live but silent):
 * in place of releaseMicrophone(). It's closed unless something else is using it, as any stream is, so the
 * next getMicrophone() opens a fresh one.
 */
export function dropMicrophone(dead: MediaStream): void {
  releaseMicrophone(dead);
}

/**
 * Ask for the microphone now, and close it again straight away, so takes over the next few minutes open it without
 * the browser asking (microphoneAllowed). Call from a tap: it may ask the learner. False if the screen that asked was
 * left (endMicrophoneAsk) while the learner was being asked, whether or not they allowed it.
 */
export async function askMicrophone(): Promise<boolean> {
  const mine = asks;
  let s: MediaStream;
  try {
    s = await getMicrophone();
  } catch (error) {
    // Refused (or no microphone) after the screen went: nothing is waiting to hear it.
    if (mine !== asks) return false;
    throw error;
  }
  releaseMicrophone(s);
  return mine === asks;
}

/** The screen that asked has gone (app.navigate calls it), so an answer still to come isn't its. */
export function endMicrophoneAsk(): void {
  asks++;
}

/** Stop the stream now. The next getMicrophone() opens a new one. */
export function closeMicrophone(): void {
  // Only hand the session back if the microphone had it: this also runs on every trip to the background.
  const had = stream !== null;
  if (had) closedAt = Date.now();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  users = 0;
  if (had) setAudioSession('auto');
}

if (typeof document !== 'undefined') {
  // iOS cuts the microphone off in the background anyway; closing it here keeps the state honest.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && users === 0) closeMicrophone();
  });
}

// Only a fresh page is read: once something here has asked, WebKit also says "granted" for the
// Allow it remembers for a while, which closedAt already tracks.
if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
  navigator.permissions.query({ name: 'microphone' as PermissionName }).then(
    (status) => (allowedBySite = status.state === 'granted' && closedAt === -Infinity && !microphoneOpen()),
    () => {},
  );
}
