// Talking to OpenAI with the learner's own API key. The key is kept in this
// browser only, apart from progress so it never ends up in a backup, and is
// sent only to api.openai.com. There is no server of ours in between.

const KEY_STORAGE = 'pinoy-prompt:openai-key';
const API = 'https://api.openai.com/v1';
/** Spoken conversations. Billed per second of the call. */
export const VOICE_MODEL = 'gpt-live-1';
/** Calls end on their own after this long, so a forgotten one can't run up a bill. */
export const MAX_CALL_SECONDS = 10 * 60;

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

/** Save a key. False if it doesn't look like an OpenAI key or can't be stored. */
export function setApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (!looksLikeKey(trimmed)) return false;
  try {
    localStorage.setItem(KEY_STORAGE, trimmed);
    return true;
  } catch {
    return false;
  }
}

export function forgetApiKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing stored, or nothing we can do.
  }
}

export function looksLikeKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
}

export type AiErrorKind = 'key' | 'quota' | 'access' | 'network' | 'other';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** What to tell the learner when a request fails. */
export function errorText(e: unknown): string {
  if (!(e instanceof AiError)) return 'Something went wrong. Try again.';
  switch (e.kind) {
    case 'key':
      return "OpenAI didn't accept the API key. Check it in Settings.";
    case 'quota':
      return "OpenAI says this key is out of credit or sending too much. Check billing on your OpenAI account, or wait a minute.";
    case 'access':
      return `This OpenAI key can't use the model Talk needs. ${e.message}`;
    case 'network':
      return "Couldn't reach OpenAI. Check your connection and try again.";
    default:
      return `OpenAI couldn't answer: ${e.message}`;
  }
}

async function failure(response: Response): Promise<AiError> {
  let message = `${response.status}`;
  let code = '';
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? text;
      code = body.error?.code ?? '';
    } catch {
      if (text) message = text;
    }
  } catch {
    // Keep the status alone.
  }
  if (response.status === 401) return new AiError('key', message);
  if (response.status === 429 || code === 'insufficient_quota') return new AiError('quota', message);
  if (response.status === 403 || response.status === 404 || code === 'model_not_found') return new AiError('access', message);
  return new AiError('other', message);
}

async function post(key: string, path: string, body: unknown, fetchFn: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AiError('network', e instanceof Error ? e.message : String(e));
  }
  if (!response.ok) throw await failure(response);
  return response;
}

export interface ChatTurn {
  who: 'you' | 'ai';
  text: string;
}

export interface CallEvents {
  /** A piece of what was said, by the learner or the AI, in the order spoken. */
  onTranscript(who: ChatTurn['who'], text: string): void;
  /** The call is connected and listening. */
  onStarted(): void;
  /** Seconds of the call so far, as OpenAI counts them for billing. */
  onUsage(seconds: number): void;
  /** The call ended, from either side; error is set if it broke. */
  onEnded(error?: AiError): void;
}

export interface Call {
  setMuted(muted: boolean): void;
  hangUp(): void;
}

export interface CallDeps {
  fetch: typeof fetch;
  getMicrophone(): Promise<MediaStream>;
  createPeer(): RTCPeerConnection;
  /** Plays the AI's voice. */
  createSpeaker(): HTMLAudioElement;
}

export const browserCallDeps: CallDeps = {
  fetch: (...args) => fetch(...args),
  getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  createPeer: () => new RTCPeerConnection(),
  createSpeaker: () => {
    const audio = new Audio();
    audio.autoplay = true;
    return audio;
  },
};

export function callSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Start a spoken conversation with GPT-Live over WebRTC. The browser sends its
 * offer straight to OpenAI with the learner's key, and audio then flows both
 * ways while transcripts arrive on the data channel.
 */
export async function startCall(key: string, instructions: string, events: CallEvents, deps: CallDeps = browserCallDeps): Promise<Call> {
  // Made inside the tap that started the call, so iOS lets it play.
  const speaker = deps.createSpeaker();
  let mic: MediaStream;
  try {
    mic = await deps.getMicrophone();
  } catch {
    throw new AiError('other', 'Talk needs the microphone. Allow it for this site and try again.');
  }
  const peer = deps.createPeer();
  let ended = false;
  let limit: ReturnType<typeof setTimeout> | undefined;

  function finish(error?: AiError): void {
    if (ended) return;
    ended = true;
    clearTimeout(limit);
    try {
      if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'session.close' }));
    } catch {
      // Closing the connection ends the session anyway.
    }
    mic.getTracks().forEach((t) => t.stop());
    peer.close();
    speaker.srcObject = null;
    events.onEnded(error);
  }

  peer.ontrack = (e) => {
    speaker.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    void speaker.play().catch(() => {});
  };
  for (const track of mic.getAudioTracks()) peer.addTrack(track, mic);
  // Listeners go on before the offer, so no early event is missed.
  const channel = peer.createDataChannel('oai-events');
  channel.onmessage = (e) => {
    let event: { type?: string; delta?: string; usage?: { seconds?: number }; error?: { message?: string } };
    try {
      event = JSON.parse(String(e.data));
    } catch {
      return;
    }
    switch (event.type) {
      case 'session.started':
        events.onStarted();
        break;
      case 'session.input_transcript.delta':
        if (event.delta) events.onTranscript('you', event.delta);
        break;
      case 'session.output_transcript.delta':
        if (event.delta) events.onTranscript('ai', event.delta);
        break;
      case 'session.usage.updated':
        if (typeof event.usage?.seconds === 'number') events.onUsage(event.usage.seconds);
        break;
      case 'session.closed':
        finish();
        break;
      case 'error':
        // A rejected command doesn't end the call; there are none we rely on.
        console.warn('Talk:', event.error?.message);
        break;
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed') finish(new AiError('network', 'The call dropped.'));
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await post(key, '/live/sessions', {
      session: {
        model: VOICE_MODEL,
        instructions,
        audio: { output: { voice: 'marin' } },
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '(The learner has joined the call.)' }] }],
      },
      transport: { type: 'webrtc', sdp: offer.sdp },
    }, deps.fetch);
    const body = (await response.json()) as { transport?: { sdp?: string } };
    if (!body.transport?.sdp) throw new AiError('other', 'OpenAI started the call without an answer.');
    await peer.setRemoteDescription({ type: 'answer', sdp: body.transport.sdp });
  } catch (e) {
    const error = e instanceof AiError ? e : new AiError('other', e instanceof Error ? e.message : String(e));
    ended = true;
    mic.getTracks().forEach((t) => t.stop());
    peer.close();
    throw error;
  }

  limit = setTimeout(() => finish(), MAX_CALL_SECONDS * 1000);
  return {
    setMuted(muted) {
      for (const track of mic.getAudioTracks()) track.enabled = !muted;
    },
    hangUp: () => finish(),
  };
}
