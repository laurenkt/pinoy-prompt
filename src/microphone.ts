// One microphone stream shared by speaking drills and Talk, kept open between
// uses so the learner's "Allow" lasts. Between uses the tracks are switched
// off, and the stream is closed for real after a few idle minutes or when the
// app goes into the background.
//
// What WebKit remembers (UserMediaPermissionRequestManagerProxy): an "Allow"
// lasts for the page while a stream is open (a switched-off track still
// counts), and for 10 minutes after the last one closes if the next request
// comes from a tap (1 minute if not, on iPhone). Reloading forgets it, and so
// does a fresh launch of the home-screen app. Only Safari's own site setting
// (Microphone: Allow) keeps it for longer, and the home-screen app has none. So
// callers ask from a tap. Holding the stream longer would stretch the window,
// but an open microphone puts playback through voice processing and keeps the
// orange dot on, so it's only held a few minutes, unless a screen that will
// keep asking (a drill round, Study's practice) holds it until it's left.

import { setAudioSession } from './audio-session';

/** Close the stream after this long unused, so the microphone isn't held forever. */
export const IDLE_CLOSE_MS = 3 * 60 * 1000;

// Auto gain is left at the browser's default, as both callers had it before.
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

let stream: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;
let users = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
/** Whether a screen wants the stream kept until it's left (holdMicrophone). */
let held = false;
/** Bumped as each hold ends, so a hold asked for by a screen already left isn't taken up. */
let holds = 0;
/** When the last stream closed, by Date.now(); WebKit keeps the learner's Allow for 10 minutes after. */
let closedAt = -Infinity;
/** Under WebKit's 10 minutes, so a request just inside it doesn't race the watchdog. */
export const ALLOW_KEPT_MS = 9 * 60 * 1000;
/** The site setting says Allow (a Safari tab set so), as read when the app opened. */
let allowedBySite = false;

/** Whether a microphone stream is open, even if switched off between uses. */
export function microphoneOpen(): boolean {
  return stream !== null || opening !== null;
}

/** Whether something is recording or on a call now, rather than the stream waiting switched off. */
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

// A track iOS muted (a phone call, Siri) can stay "live" but silent, so it doesn't count.
const live = (s: MediaStream) => s.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted);

/** The microphone, switched on. Only asks for permission when no stream is open. Pair with releaseMicrophone(). */
export async function getMicrophone(): Promise<MediaStream> {
  clearTimeout(idle);
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

/** Done with the stream from getMicrophone(). Call once per getMicrophone(). It's switched off now and closed later if nothing else wants it. */
export function releaseMicrophone(released: MediaStream): void {
  if (released !== stream) {
    released.getTracks().forEach((t) => t.stop());
    return;
  }
  users = Math.max(0, users - 1);
  if (users > 0) return;
  for (const t of released.getTracks()) t.enabled = false;
  closeWhenIdle();
}

function closeWhenIdle(): void {
  clearTimeout(idle);
  if (!held && stream && users === 0) idle = setTimeout(closeMicrophone, IDLE_CLOSE_MS);
}

/**
 * Open the microphone and keep it, switched off, until endMicrophoneHold() (app.navigate calls it), so a
 * screen that asks for it up front isn't asked again partway through. Call from a tap: it may ask the learner.
 */
export async function holdMicrophone(): Promise<void> {
  const mine = holds;
  const s = await getMicrophone();
  held = mine === holds;
  releaseMicrophone(s);
}

/** Let the stream close once it's been idle a while, as usual. */
export function endMicrophoneHold(): void {
  holds++;
  if (!held) return;
  held = false;
  closeWhenIdle();
}

/** Stop the stream now. The next getMicrophone() opens a new one. */
export function closeMicrophone(): void {
  clearTimeout(idle);
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
