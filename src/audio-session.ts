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

export function setAudioSession(type: SessionType): void {
  const s = session();
  if (s && s.type !== type) s.type = type;
}
