// The iPhone's silent switch mutes web audio unless the page says it's playing
// media on purpose. Safari's Audio Session API (iOS 17+) lets it say so:
// "playback" plays through the silent switch, like a music or video app, and
// "play-and-record" is what the microphone needs. Elsewhere this does nothing.

type SessionType = 'auto' | 'playback' | 'play-and-record';

interface AudioSession {
  type: string;
}

function session(): AudioSession | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as { audioSession?: AudioSession }).audioSession;
}

/** Whether this browser lets the page choose its audio session (Safari on iOS 17 and later). */
export function audioSessionSupported(): boolean {
  return session() !== undefined;
}

const changeListeners: (() => void)[] = [];

/** Called whenever the session type changes, as the audio hardware may be set up again then. */
export function onAudioSessionChange(listener: () => void): void {
  changeListeners.push(listener);
}

export function setAudioSession(type: SessionType): void {
  const s = session();
  if (!s || s.type === type) return;
  s.type = type;
  for (const listener of changeListeners) listener();
}
