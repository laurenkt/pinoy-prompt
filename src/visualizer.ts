// The backdrop of a Talk call: a full-screen shader played by both voices, in
// the spirit of the demoscene. A kaleidoscope tunnel rushes forward when anyone
// speaks; two oscilloscope rings draw the raw waveforms, teal for the learner's
// microphone and saffron for the AI; and sharp sounds kick the colours apart.
// The rings follow the sound instantly; the brightness of the whole screen eases,
// so it never flashes.
//
// The signal is read raw, straight from the waveform, so the picture moves with
// the sound and not behind it. The analysers run on the audio thread already,
// so the main thread only copies the latest samples once a frame.
// Drawn with WebGL; where that or Web Audio is missing it quietly does nothing.

export type Voice = 'you' | 'ai';

export interface Visualizer {
  /** Start showing a voice. */
  listen(who: Voice, stream: MediaStream): void;
  /** Quieten the learner's part while the microphone is muted. */
  setMuted(muted: boolean): void;
  stop(): void;
}

/** Waveform samples per voice handed to the shader. */
export const SAMPLES = 256;
/** About 21 ms at 48 kHz: more than a frame, so at 60 fps no peak between two frames is missed. */
const FFT_SIZE = 1024;
/** The drawing buffer is kept small and scaled up, so a phone keeps 60 frames a second. */
const MAX_PIXELS = 420 * 900;

export interface Envelope {
  /** Loudness, 0 to 1, rising at once and falling away slowly: moves the rings with each sound. */
  level: number;
  /** Loudness eased in and out over a fraction of a second: sets the backdrop's brightness without flashing. */
  glow: number;
  /** A jump in loudness, such as the start of a word, decaying quickly. */
  kick: number;
  /** How often the wave crosses zero, 0 to 1: higher for hissing sounds, lower for vowels. */
  bright: number;
}

export const quiet = (): Envelope => ({ level: 0, glow: 0, kick: 0, bright: 0 });

/** Bytes either side of the centre a wave must swing past to count as crossing it, so hum and hiss don't. */
const HYSTERESIS = 3;

/**
 * Read a waveform (bytes centred on 128) into the shader's samples, and update
 * the voice's envelope. Level rises at once, so a sound shows in the very frame
 * it arrives; glow follows more gently, so the whole screen never flickers.
 */
export function follow(wave: Uint8Array, env: Envelope, out: Uint8Array, dt: number): void {
  let peak = 0;
  let sum = 0;
  let crossings = 0;
  let side = 0;
  for (let i = 0; i < wave.length; i++) {
    const v = (wave[i] - 128) / 128;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
    const now = wave[i] >= 128 + HYSTERESIS ? 1 : wave[i] <= 128 - HYSTERESIS ? -1 : side;
    if (side && now !== side) crossings++;
    side = now;
  }
  const step = wave.length / out.length;
  for (let i = 0; i < out.length; i++) out[i] = wave[Math.floor(i * step)] ?? 128;
  // Speech sits far below full scale; this brings normal talking near the top.
  const loud = Math.min(1, Math.sqrt(sum / Math.max(1, wave.length)) * 6 + peak * 0.5);
  if (loud - env.level > 0.12) env.kick = 1;
  else env.kick *= Math.exp(-dt * 9);
  env.level = Math.max(loud, env.level * Math.exp(-dt * 4));
  // About a third of a second to brighten and twice that to fade: well under three flashes a second.
  env.glow += (loud - env.glow) * (1 - Math.exp(-dt * (loud > env.glow ? 3 : 1.5)));
  if (loud > 0.1) env.bright += (Math.min(1, crossings / wave.length / 0.15) - env.bright) * (1 - Math.exp(-dt * 3));
}

const VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Waveforms sit in a 256 by 2 texture: the learner's in the first row, the AI's in the second.
// Every phase the shader is given is kept small on the CPU, so it stays precise through a long call.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_travel;
uniform float u_spin;
uniform vec2 u_turn;
uniform vec2 u_level;
uniform float u_glow;
uniform float u_kick;
uniform float u_bright;
uniform sampler2D u_wave;

const float TAU = 6.28318;
const float SLICE = TAU / 6.0;
const vec3 NIGHT = vec3(0.090, 0.071, 0.231);
const vec3 TEAL = vec3(0.180, 0.769, 0.714);
const vec3 SAFFRON = vec3(1.0, 0.714, 0.153);
const vec3 MAGENTA = vec3(0.910, 0.247, 0.435);

float wave(float row, float x) {
  return texture2D(u_wave, vec2(x, row)).r * 2.0 - 1.0;
}

// A ring whose radius is pushed in and out by a waveform wrapped around it.
float scope(float r, float turns, float row, float radius, float height, float turn) {
  // Mirrored, so the two ends of the waveform meet without a seam.
  float x = abs(fract(turns + turn) - 0.5) * 2.0;
  float d = abs(r - radius - wave(row, x) * height);
  return 0.006 / (d + 0.004);
}

// The tunnel at distance r from the middle, at angle a already folded into a kaleidoscope slice.
vec3 tunnel(float r, float a, float voice) {
  float z = 0.5 / (r + 0.06) + u_travel;
  // Hissing sounds ripple the slices finer.
  float fine = 9.0 + u_bright * 10.0;
  float plasma = sin(z * 3.0 + a * fine) + sin(z * 1.5 - a * 13.0 + u_time * 0.5) + sin((z + a * 4.0) * 2.5 + u_time);
  float bands = smoothstep(0.2, 0.9, sin(z * 6.0 + plasma * 1.5));
  vec3 hot = mix(MAGENTA, SAFFRON, 0.5 + 0.5 * sin(z + u_time * 0.25));
  vec3 col = mix(NIGHT * 1.4, mix(TEAL, hot, voice), bands * 0.85);
  // The middle is the far end of the tunnel, and fades into the night.
  return col * smoothstep(0.0, 0.6, r);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float r = length(p);
  // Nudged off zero, where atan has no answer.
  float angle = atan(p.y, p.x + 1e-4);
  float a = abs(mod(angle + u_spin, SLICE) - SLICE * 0.5);
  float voice = u_level.y / max(0.001, u_level.x + u_level.y);
  vec3 col = tunnel(r, a, voice);
  // A kick pulls the colour channels apart for a moment, along the tunnel.
  if (u_kick > 0.01) {
    float shift = u_kick * 0.025;
    col.r = tunnel(r + shift, a, voice).r;
    col.b = tunnel(max(0.0, r - shift), a, voice).b;
  }
  col *= 0.45 + 0.55 * u_glow;
  float turns = angle / TAU + 0.5;
  col += SAFFRON * scope(r, turns, 0.75, 0.42, 0.08 + u_level.y * 0.3, u_turn.y) * (0.25 + u_level.y);
  col += TEAL * scope(r, turns, 0.25, 0.3, 0.06 + u_level.x * 0.3, u_turn.x) * (0.25 + u_level.x);
  // Scanlines and a vignette, then dimmed so the transcript stays readable.
  col *= 0.88 + 0.12 * sin(gl_FragCoord.y * 3.14159);
  col *= 1.0 - 0.25 * dot(p, p);
  gl_FragColor = vec4(mix(NIGHT, col, 0.85) * 0.8, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

const NOTHING: Visualizer = { listen() {}, setMuted() {}, stop() {} };

/** Phases are wrapped at these, which every frequency using them repeats over, so wrapping never shows. */
const TIME_PERIOD = 8 * Math.PI;
const TRAVEL_PERIOD = 4 * Math.PI;
const TAU = 2 * Math.PI;

/** Must be called from the tap that starts the call, so the browser lets its audio run. */
export function createVisualizer(canvas: HTMLCanvasElement): Visualizer {
  const Context = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const gl = canvas.getContext?.('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' }) ?? null;
  if (!Context || !gl) return NOTHING;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const tex = gl.createTexture();
  function release(): void {
    gl!.deleteTexture(tex);
    gl!.deleteBuffer(buffer);
    gl!.deleteProgram(program);
    gl!.deleteShader(vertex);
    gl!.deleteShader(fragment);
  }
  if (vertex && fragment && program) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  if (!vertex || !fragment || !program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    release();
    // An undrawn canvas would be a black sheet over the page.
    canvas.hidden = true;
    return NOTHING;
  }
  canvas.hidden = false;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const texture = new Uint8Array(SAMPLES * 2).fill(128);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SAMPLES, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, texture);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u('u_res');
  const uTime = u('u_time');
  const uTravel = u('u_travel');
  const uSpin = u('u_spin');
  const uTurn = u('u_turn');
  const uLevel = u('u_level');
  const uGlow = u('u_glow');
  const uKick = u('u_kick');
  const uBright = u('u_bright');

  const audio = new Context();
  // Older WebKit has no promise-returning resume or close.
  const resume = () => void audio.resume?.()?.catch(() => {});
  resume();
  const analysers: Partial<Record<Voice, { node: AnalyserNode; source: MediaStreamAudioSourceNode }>> = {};
  const wave = new Uint8Array(FFT_SIZE);
  const env: Record<Voice, Envelope> = { you: quiet(), ai: quiet() };
  const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let muted = false;
  let frame = 0;
  let last = performance.now();
  let time = 0;
  let travel = 0;
  let spin = 0;
  let turnYou = 0;
  let turnAi = 0;

  // A phone can drop the GPU's state when the app goes to the background; then the backdrop just goes away.
  function lost(e: Event): void {
    e.preventDefault();
    cancelAnimationFrame(frame);
    canvas.hidden = true;
  }
  canvas.addEventListener('webglcontextlost', lost);

  function draw(now: number): void {
    frame = requestAnimationFrame(draw);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let w = canvas.clientWidth * ratio;
    let h = canvas.clientHeight * ratio;
    if (!w || !h) return;
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    (['you', 'ai'] as const).forEach((who, i) => {
      const a = who === 'you' && muted ? undefined : analysers[who];
      if (a) a.node.getByteTimeDomainData(wave);
      else wave.fill(128);
      const row = texture.subarray(i * SAMPLES, (i + 1) * SAMPLES);
      follow(wave, env[who], row, dt);
      // With reduced motion the rings stay round, and only swell and fade with each voice.
      if (still) row.fill(128);
    });
    const level = Math.max(env.you.level, env.ai.level);
    // With reduced motion the picture still answers each voice, but doesn't fly or spin.
    if (!still) {
      time = (time + dt) % TIME_PERIOD;
      travel = (travel + dt * (0.25 + level * 2.5)) % TRAVEL_PERIOD;
      spin = (spin + dt * (0.08 + env.ai.level * 0.6 - env.you.level * 0.4) + TAU) % TAU;
      turnAi = (turnAi + dt * 0.05) % 1;
      turnYou = (turnYou + 1 - dt * 0.07) % 1;
    }
    gl!.viewport(0, 0, w, h);
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, SAMPLES, 2, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, texture);
    gl!.uniform2f(uRes, w, h);
    gl!.uniform1f(uTime, time);
    gl!.uniform1f(uTravel, travel);
    gl!.uniform1f(uSpin, spin);
    gl!.uniform2f(uTurn, turnYou, turnAi);
    gl!.uniform2f(uLevel, still ? env.you.glow : env.you.level, still ? env.ai.glow : env.ai.level);
    gl!.uniform1f(uGlow, Math.max(env.you.glow, env.ai.glow));
    gl!.uniform1f(uKick, still ? 0 : Math.max(env.you.kick, env.ai.kick));
    gl!.uniform1f(uBright, Math.max(env.you.bright, env.ai.bright));
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }
  frame = requestAnimationFrame(draw);

  return {
    listen(who, stream) {
      if (audio.state === 'closed' || !stream.getAudioTracks().length) return;
      analysers[who]?.source.disconnect();
      const node = audio.createAnalyser();
      node.fftSize = FFT_SIZE;
      // Only measured, never played: the AI's voice already plays through the speaker element.
      const source = audio.createMediaStreamSource(stream);
      source.connect(node);
      analysers[who] = { node, source };
      // Starting the microphone can suspend audio on iOS.
      if (audio.state !== 'running') resume();
    },
    setMuted(m) {
      muted = m;
    },
    stop() {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', lost);
      for (const a of Object.values(analysers)) a?.source.disconnect();
      void audio.close?.()?.catch(() => {});
      // The canvas is reused by the next call, which sets up its own.
      release();
    },
  };
}
