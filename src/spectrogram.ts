// Draws the learner's recording as a glowing ribbon: time runs left to right,
// the ribbon swells with loudness, inside it low pitches sit along the middle
// and high ones toward the edges, and its outline takes the colour of how
// well each stretch came out. Uses WebGL where it can
// (so the part being played can shimmer), and a plain canvas otherwise.

import { NUM_MEL_BINS } from './fbank';

export interface Segment {
  /** Seconds. */
  start: number;
  end: number;
  /** CSS-style hex colour, e.g. #2ec4b6. */
  color: string;
}

export interface Spectrogram {
  el: HTMLCanvasElement;
  /** Show where playback is, in seconds; null hides it. */
  setPlayhead(seconds: number | null): void;
  /** Light up one stretch, e.g. the sound being looked at; null for none. */
  setFocus(range: { start: number; end: number } | null): void;
  dispose(): void;
}

/** Fiesta colours from ink to cream, for quiet to loud. */
const RAMP: [number, number, number][] = [
  [12, 9, 36],
  [74, 66, 144],
  [232, 63, 111],
  [255, 182, 39],
  [246, 239, 227],
];

function ramp(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((c) => RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f) as [number, number, number];
}

function hex(color: string): [number, number, number] {
  const n = parseInt(color.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Features scaled to 0–1 for this recording: the quietest 10% sit at 0, the loudest at 1. */
export function normalise(data: Float32Array): Uint8Array {
  const sorted = Float32Array.from(data).sort();
  const lo = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const hi = sorted[sorted.length - 1] ?? 1;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.round(255 * Math.min(1, Math.max(0, (data[i] - lo) / (hi - lo || 1))) ** 1.1);
  return out;
}

/** How loud each frame is, 0–1, smoothed over a few frames so the ribbon flows. */
export function loudness(levels: Uint8Array, frames: number): Uint8Array {
  const raw = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let b = 0; b < NUM_MEL_BINS; b++) sum += levels[f * NUM_MEL_BINS + b];
    raw[f] = sum / NUM_MEL_BINS;
  }
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let n = 0;
    for (let k = -4; k <= 4; k++) {
      if (f + k < 0 || f + k >= frames) continue;
      sum += raw[f + k];
      n++;
    }
    smooth[f] = sum / n;
  }
  const max = Math.max(1, ...smooth);
  const min = Math.min(...smooth);
  return Uint8Array.from(smooth, (v) => Math.round(255 * Math.max(0, (v - min) / (max - min || 1))));
}

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D level;   // frames x bins, one byte each
uniform sampler2D tint;    // frames x 1, the segment colour (alpha 0 between sounds)
uniform sampler2D energy;  // frames x 1, loudness
uniform sampler2D ramp;    // 5 x 1, quiet to loud
uniform float playhead;    // 0-1, or negative for none
uniform vec2 focus;        // 0-1 range, or negative
uniform float time;
uniform vec2 view;         // the part of the recording shown, as 0-1 of its length
void main() {
  float x = view.x + uv.x * (view.y - view.x);
  float e = texture2D(energy, vec2(x, 0.5)).r;
  float width = 0.06 + 0.86 * e;
  float d = abs(uv.y - 0.5) * 2.0;
  vec4 seg = texture2D(tint, vec2(x, 0.5));
  vec3 bg = vec3(0.047, 0.035, 0.141);
  // Inside the ribbon, pitch runs from the middle (low) to the edge (high).
  float pitch = clamp(d / width, 0.0, 1.0);
  float v = texture2D(level, vec2(x, pitch * 0.85)).r;
  vec3 body = texture2D(ramp, vec2(0.12 + 0.86 * v, 0.5)).rgb;
  float inside = 1.0 - smoothstep(width - 0.015, width, d);
  // A bold outline in the colour of how that sound came out.
  float rim = smoothstep(width - 0.09, width - 0.03, d) * inside;
  vec3 outline = mix(vec3(0.29, 0.26, 0.56), seg.rgb, seg.a);
  vec3 col = mix(bg, mix(body, outline, rim), inside);
  if (focus.x >= 0.0) {
    float on = step(focus.x, x) * step(x, focus.y);
    col = mix(col * 0.4, col, on);
  }
  if (playhead >= 0.0) {
    float dx = abs(x - playhead) / (view.y - view.x);
    float glow = exp(-dx * 90.0) * (0.8 + 0.2 * sin(time * 10.0 - d * 14.0));
    col += vec3(1.0, 0.8, 0.45) * glow * (0.35 + inside) + vec3(0.6) * step(dx, 0.0025);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSpectrogram(
  features: { data: Float32Array; frames: number },
  segments: Segment[],
  options: { height?: number; /** The stretch to show, in seconds; the whole recording if left out. */ view?: { start: number; end: number } } = {},
): Spectrogram {
  const canvas = document.createElement('canvas');
  canvas.className = 'spectrogram';
  canvas.setAttribute('aria-hidden', 'true');
  const frames = Math.max(1, features.frames);
  const seconds = frames / 100;
  const view = options.view ?? { start: 0, end: seconds };
  const cssHeight = options.height ?? 120;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.min(2048, Math.max(Math.round((view.end - view.start) * 200), 300)) * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.height = `${cssHeight}px`;

  const levels = normalise(features.data.subarray(0, frames * NUM_MEL_BINS));
  const loud = loudness(levels, frames);
  // The colour of the segment each frame belongs to (alpha 0 between segments).
  const tint = new Uint8Array(frames * 4);
  for (const s of segments) {
    const [r, g, b] = hex(s.color);
    for (let f = Math.max(0, Math.floor(s.start * 100)); f < Math.min(frames, Math.ceil(s.end * 100)); f++) tint.set([r, g, b, 255], f * 4);
  }

  let playhead: number | null = null;
  let focus: { start: number; end: number } | null = null;
  let frame = 0;
  let disposed = false;

  let el = canvas;
  const webgl = (canvas.getContext?.('webgl', { antialias: false, preserveDrawingBuffer: false }) ?? null) as WebGLRenderingContext | null;
  let draw: (() => void) | null = null;

  const setUpWebGl = (gl: WebGLRenderingContext) => {
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const texture = (unit: number, name: string, width: number, height: number, format: number, data: Uint8Array) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    };
    // Rows are frames in the feature data; the texture wants pitch as rows, so transpose.
    const byPitch = new Uint8Array(frames * NUM_MEL_BINS);
    for (let f = 0; f < frames; f++) for (let b = 0; b < NUM_MEL_BINS; b++) byPitch[b * frames + f] = levels[f * NUM_MEL_BINS + b];
    texture(0, 'level', frames, NUM_MEL_BINS, gl.LUMINANCE, byPitch);
    texture(1, 'tint', frames, 1, gl.RGBA, tint);
    texture(2, 'ramp', RAMP.length, 1, gl.RGB, Uint8Array.from(RAMP.flat()));
    texture(3, 'energy', frames, 1, gl.LUMINANCE, loud);
    const uPlayhead = gl.getUniformLocation(program, 'playhead');
    const uFocus = gl.getUniformLocation(program, 'focus');
    const uTime = gl.getUniformLocation(program, 'time');
    gl.uniform2f(gl.getUniformLocation(program, 'view'), view.start / seconds, view.end / seconds);
    const started = performance.now();

    draw = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uPlayhead, playhead === null ? -1 : playhead / seconds);
      gl.uniform2f(uFocus, focus ? focus.start / seconds : -1, focus ? focus.end / seconds : -1);
      gl.uniform1f(uTime, (performance.now() - started) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  };
  if (webgl) {
    try {
      setUpWebGl(webgl);
    } catch {
      // A shader that won't compile on this device: fall back to the plain canvas.
      draw = null;
    }
  }
  if (!draw) {
    // A canvas that had a WebGL context can't give a 2D one, so draw on a fresh canvas then.
    if (webgl) {
      const fresh = canvas.cloneNode() as HTMLCanvasElement;
      fresh.width = canvas.width;
      fresh.height = canvas.height;
      el = fresh;
    }
    const surface = el;
    const ctx = surface.getContext?.('2d') ?? null;
    let image: ImageData | null = null;
    draw = () => {
      if (!ctx) return;
      const { width, height } = surface;
      if (!image) {
        image = ctx.createImageData(width, height);
        for (let x = 0; x < width; x++) {
          const f = Math.min(frames - 1, Math.max(0, Math.floor((view.start + (x / width) * (view.end - view.start)) * 100)));
          const t = tint.subarray(f * 4, f * 4 + 4);
          const half = 0.06 + 0.86 * (loud[f] / 255);
          for (let y = 0; y < height; y++) {
            const d = Math.abs(y / height - 0.5) * 2;
            let c = [12, 9, 36];
            if (d < half) {
              const pitch = d / half;
              const v = levels[f * NUM_MEL_BINS + Math.min(NUM_MEL_BINS - 1, Math.floor(pitch * 0.85 * NUM_MEL_BINS))] / 255;
              c = d > half - 0.06 ? (t[3] ? [t[0], t[1], t[2]] : [74, 66, 144]) : ramp(0.12 + 0.86 * v);
            }
            image.data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      if (focus) {
        ctx.fillStyle = 'rgba(12, 9, 36, 0.55)';
        const at = (t: number) => ((t - view.start) / (view.end - view.start)) * width;
        ctx.fillRect(0, 0, at(focus.start), height);
        ctx.fillRect(at(focus.end), 0, width, height);
      }
      if (playhead !== null) {
        ctx.fillStyle = '#f6efe3';
        ctx.fillRect(((playhead - view.start) / (view.end - view.start)) * width - dpr, 0, 2 * dpr, height);
      }
    };
  }

  // Animate only while something is playing; otherwise draw once per change.
  const loop = () => {
    if (disposed) return;
    render();
    frame = playhead === null ? 0 : requestAnimationFrame(loop);
  };
  const redraw = () => {
    if (!frame) loop();
  };
  const render = draw;
  render();

  return {
    el,
    setPlayhead(t) {
      playhead = t;
      redraw();
    },
    setFocus(range) {
      focus = range;
      redraw();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      // Browsers cap live WebGL contexts, and each result screen makes one.
      webgl?.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
