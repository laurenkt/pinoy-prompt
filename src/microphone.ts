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
// orange dot on, so it's only held a few minutes.

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

/** Whether a microphone stream is open, even if switched off between uses. */
export function microphoneOpen(): boolean {
  return stream !== null || opening !== null;
}

/** Whether something is recording or on a call now, rather than the stream waiting switched off. */
export function microphoneInUse(): boolean {
  return users > 0 || opening !== null;
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
  clearTimeout(idle);
  idle = setTimeout(closeMicrophone, IDLE_CLOSE_MS);
}

/** Stop the stream now. The next getMicrophone() opens a new one. */
export function closeMicrophone(): void {
  clearTimeout(idle);
  // Only hand the session back if the microphone had it: this also runs on every trip to the background.
  const had = stream !== null;
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
