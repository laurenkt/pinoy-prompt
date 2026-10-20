// The moving ribbons above a Talk call: teal for the learner's microphone,
// saffron and magenta for the AI's voice. Each ribbon swells with the loudness
// of its voice across the speech frequencies, so it's plain at a glance that
// the microphone is hearing you and that a reply is coming through.
// Drawn with WebGL; where that or Web Audio is missing it quietly does nothing.

export type Voice = 'you' | 'ai';

export interface Visualizer {
  /** Start showing a voice. */
  listen(who: Voice, stream: MediaStream): void;
  /** Flatten the learner's ribbon while the microphone is muted. */
  setMuted(muted: boolean): void;
  stop(): void;
}

/** Bands per voice, low frequencies first. */
export const BANDS = 16;
const FFT_SIZE = 512;
/** Analyser bins to cover: about 90 Hz to 3.8 kHz at 48 kHz, where speech is. */
const FIRST_BIN = 1;
const LAST_BIN = 40;

/**
 * Average an analyser's frequency bins (0 to 255) into bands from 0 to 1,
 * spaced evenly in pitch rather than in hertz, as voices are heard.
 */
export function bands(bins: Uint8Array, out: Uint8Array = new Uint8Array(BANDS), first = FIRST_BIN, last = LAST_BIN): Uint8Array {
  const n = out.length;
  for (let b = 0; b < n; b++) {
    const lo = Math.floor(first * (last / first) ** (b / n));
    const hi = Math.max(lo + 1, Math.floor(first * (last / first) ** ((b + 1) / n)));
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += bins[i] ?? 0;
    out[b] = Math.round(sum / (hi - lo));
  }
  return out;
}

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// The bands sit in a 16 by 2 texture, the learner's in the first row and the
// AI's in the second, so the GPU blends between bands for smooth ribbons.
const FRAGMENT = `
precision mediump float;
uniform float u_time;
uniform float u_muted;
uniform sampler2D u_bands;
varying vec2 v_uv;

const vec3 BG = vec3(0.137, 0.110, 0.322);
const vec3 TEAL = vec3(0.180, 0.769, 0.714);
const vec3 SAFFRON = vec3(1.0, 0.714, 0.153);
const vec3 MAGENTA = vec3(0.910, 0.247, 0.435);

// Loudness at x, mirrored so the low voice frequencies meet in the middle.
float spectrum(float row, float x) {
  float f = abs(x - 0.5) * 2.0;
  return texture2D(u_bands, vec2(f * ${(BANDS - 1) / BANDS} + ${0.5 / BANDS}, row)).r;
}

// A wave across the width, pinched at both ends, with a bright core and a soft glow.
float ribbon(vec2 p, float amp, float freq, float speed, float phase, float width) {
  float y = amp * sin(3.14159 * p.x) * sin(p.x * freq + u_time * speed + phase);
  float d = abs(p.y - y);
  return smoothstep(width, 0.0, d) + 0.3 * smoothstep(width * 7.0, 0.0, d);
}

void main() {
  vec2 p = vec2(v_uv.x, v_uv.y * 2.0 - 1.0);
  float you = spectrum(0.25, p.x) * (1.0 - u_muted);
  float ai = spectrum(0.75, p.x);
  // A slow breath keeps the line alive in silence.
  float rest = 0.05 + 0.025 * sin(u_time * 1.7);
  vec3 col = BG;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float r = ribbon(p, rest + ai * (0.9 - fi * 0.22), 8.0 + fi * 4.0, 2.4 + fi * 0.8, fi * 2.1, 0.02);
    col += mix(SAFFRON, MAGENTA, fi * 0.5) * r * 0.75;
  }
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float r = ribbon(p, rest * 0.7 + you * (0.85 - fi * 0.3), 6.0 + fi * 5.0, -1.9 - fi * 0.7, 1.0 + fi * 1.7, 0.018);
    col += TEAL * r * (0.8 - u_muted * 0.5);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

const NOTHING: Visualizer = { listen() {}, setMuted() {}, stop() {} };

/** Must be called from the tap that starts the call, so the browser lets its audio run. */
export function createVisualizer(canvas: HTMLCanvasElement): Visualizer {
  const Context = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const gl = canvas.getContext?.('webgl', { antialias: false, alpha: false }) ?? null;
  if (!Context || !gl) return NOTHING;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return NOTHING;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return NOTHING;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uMuted = gl.getUniformLocation(program, 'u_muted');

  const audio = new Context();
  void audio.resume().catch(() => {});
  const analysers: Partial<Record<Voice, { node: AnalyserNode; source: MediaStreamAudioSourceNode }>> = {};
  const bins = new Uint8Array(FFT_SIZE / 2);
  const texture = new Uint8Array(BANDS * 2);
  const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let muted = false;
  let frame = 0;
  const started = performance.now();

  function draw(now: number): void {
    frame = requestAnimationFrame(draw);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    (['you', 'ai'] as const).forEach((who, row) => {
      const a = analysers[who];
      if (a) a.node.getByteFrequencyData(bins);
      else bins.fill(0);
      texture.set(bands(bins), row * BANDS);
    });
    gl!.viewport(0, 0, w, h);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.LUMINANCE, BANDS, 2, 0, gl!.LUMINANCE, gl!.UNSIGNED_BYTE, texture);
    // With reduced motion the ribbons still rise and fall with each voice, but don't drift.
    gl!.uniform1f(uTime, still ? 0 : (now - started) / 1000);
    gl!.uniform1f(uMuted, muted ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }
  frame = requestAnimationFrame(draw);

  return {
    listen(who, stream) {
      if (audio.state === 'closed' || !stream.getAudioTracks().length) return;
      analysers[who]?.source.disconnect();
      const node = audio.createAnalyser();
      node.fftSize = FFT_SIZE;
      node.smoothingTimeConstant = 0.7;
      node.minDecibels = -85;
      node.maxDecibels = -25;
      // Only measured, never played: the AI's voice already plays through the speaker element.
      const source = audio.createMediaStreamSource(stream);
      source.connect(node);
      analysers[who] = { node, source };
    },
    setMuted(m) {
      muted = m;
    },
    stop() {
      cancelAnimationFrame(frame);
      for (const a of Object.values(analysers)) a?.source.disconnect();
      void audio.close().catch(() => {});
    },
  };
}
