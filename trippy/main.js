import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.freq = null;
    this.time = null;
    this.source = null;
    this.htmlAudio = null;
    this.bands = { bass: 0, mid: 0, high: 0, level: 0 };
    this.smooth = { bass: 0, mid: 0, high: 0, level: 0 };
    this.flux = 0;
    this.fluxHistory = new Float32Array(60);
    this.fluxIdx = 0;
    this.lastSpectrum = null;
    this.beat = 0;
    this.beatDecay = 0;
    this.beatTimes = [];
    this.bpm = 0;
  }

  async _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.time = new Uint8Array(this.analyser.fftSize);
      this.lastSpectrum = new Float32Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  _attach(node) {
    this.disconnect();
    this.source = node;
    node.connect(this.analyser);
  }

  disconnect() {
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.htmlAudio) {
      this.htmlAudio.pause();
      this.htmlAudio.src = '';
      this.htmlAudio = null;
    }
  }

  async useMic() {
    await this._ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    this._attach(this.ctx.createMediaStreamSource(stream));
  }

  async useTab() {
    await this._ensureCtx();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false,
      systemAudio: 'include'
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio track shared. In the share dialog, check "Share tab audio".');
    }
    stream.getVideoTracks().forEach(t => t.stop());
    this._attach(this.ctx.createMediaStreamSource(stream));
  }

  async useFile(file) {
    await this._ensureCtx();
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.controls = false;
    await audio.play().catch(() => {});
    this.htmlAudio = audio;
    this._attach(this.ctx.createMediaElementSource(audio));
    this.analyser.connect(this.ctx.destination); // also play out loud
  }

  async useDemo() {
    await this._ensureCtx();
    const osc1 = this.ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 55;
    const osc2 = this.ctx.createOscillator(); osc2.type = 'square';   osc2.frequency.value = 220;
    const osc3 = this.ctx.createOscillator(); osc3.type = 'sine';     osc3.frequency.value = 880;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 2.0;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 60;
    lfo.connect(lfoGain); lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);

    const kick = this.ctx.createOscillator(); kick.type = 'sine'; kick.frequency.value = 60;
    const kickGain = this.ctx.createGain(); kickGain.gain.value = 0;
    kick.connect(kickGain);

    const mix = this.ctx.createGain(); mix.gain.value = 0.18;
    const g1 = this.ctx.createGain(); g1.gain.value = 0.4;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.15;
    osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
    g1.connect(mix); g2.connect(mix); g3.connect(mix); kickGain.connect(mix);

    osc1.start(); osc2.start(); osc3.start(); lfo.start(); kick.start();

    // Schedule kicks
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 1024; i++) {
      const t = t0 + i * 0.5;
      kickGain.gain.setValueAtTime(0, t);
      kickGain.gain.linearRampToValueAtTime(1.4, t + 0.005);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    }

    this._attach(mix);
    mix.connect(this.ctx.destination);
  }

  update(dt) {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    const f = this.freq;
    const N = f.length;
    // Frequency bands (rough, log-distributed)
    const bassEnd = Math.floor(N * 0.04);   // ~0–860Hz at 44.1k/2048
    const midEnd  = Math.floor(N * 0.22);   // ~860–4.7kHz
    let bass = 0, mid = 0, high = 0, total = 0;
    for (let i = 1; i < bassEnd; i++) bass += f[i];
    for (let i = bassEnd; i < midEnd; i++) mid += f[i];
    for (let i = midEnd; i < N; i++) high += f[i];
    for (let i = 0; i < N; i++) total += f[i];

    const norm = 1 / 255;
    this.bands.bass = (bass / Math.max(1, bassEnd - 1)) * norm;
    this.bands.mid  = (mid  / Math.max(1, midEnd - bassEnd)) * norm;
    this.bands.high = (high / Math.max(1, N - midEnd)) * norm;
    this.bands.level = (total / N) * norm;

    // Smooth (one-pole)
    const a = 1 - Math.exp(-dt * 12);
    this.smooth.bass  += (this.bands.bass  - this.smooth.bass)  * a;
    this.smooth.mid   += (this.bands.mid   - this.smooth.mid)   * a;
    this.smooth.high  += (this.bands.high  - this.smooth.high)  * a;
    this.smooth.level += (this.bands.level - this.smooth.level) * a;

    // Spectral flux (positive-only first-difference) for beat detection
    let flux = 0;
    for (let i = 1; i < bassEnd * 2; i++) {
      const d = f[i] * norm - this.lastSpectrum[i];
      if (d > 0) flux += d;
      this.lastSpectrum[i] = f[i] * norm;
    }
    this.flux = flux;
    this.fluxHistory[this.fluxIdx] = flux;
    this.fluxIdx = (this.fluxIdx + 1) % this.fluxHistory.length;
    let mean = 0;
    for (let i = 0; i < this.fluxHistory.length; i++) mean += this.fluxHistory[i];
    mean /= this.fluxHistory.length;
    let varv = 0;
    for (let i = 0; i < this.fluxHistory.length; i++) {
      const d = this.fluxHistory[i] - mean;
      varv += d * d;
    }
    const std = Math.sqrt(varv / this.fluxHistory.length);
    const threshold = mean + std * 1.6 + 0.05;

    const now = performance.now() / 1000;
    const lastBeat = this.beatTimes.length ? this.beatTimes[this.beatTimes.length - 1] : -1;
    if (flux > threshold && now - lastBeat > 0.18) {
      this.beat = 1;
      this.beatTimes.push(now);
      while (this.beatTimes.length > 16) this.beatTimes.shift();
      // Estimate BPM from intervals
      if (this.beatTimes.length >= 4) {
        const intervals = [];
        for (let i = 1; i < this.beatTimes.length; i++) {
          intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
        }
        intervals.sort((x, y) => x - y);
        const median = intervals[Math.floor(intervals.length / 2)];
        let bpm = 60 / median;
        while (bpm < 70)  bpm *= 2;
        while (bpm > 180) bpm /= 2;
        this.bpm = this.bpm * 0.6 + bpm * 0.4;
      }
    }
    this.beatDecay = Math.max(0, this.beatDecay - dt * 4.5);
    if (this.beat > 0) {
      this.beatDecay = 1;
      this.beat = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Shader — four reactive scenes selected by uMode
// ---------------------------------------------------------------------------
const vert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const frag = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform vec2  uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uBeat;
uniform float uMode;
uniform float uHue;

// ----- helpers -----
mat2 rot(float a){ float s=sin(a),c=cos(a); return mat2(c,-s,s,c); }

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p){
  p = fract(p*vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x*p.y);
}

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash(i);
  float b = hash(i + vec2(1,0));
  float c = hash(i + vec2(0,1));
  float d = hash(i + vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 6; i++){
    v += amp * noise(p);
    p = p*2.03 + 11.7;
    amp *= 0.5;
  }
  return v;
}

// kaleidoscope fold
vec2 kaleido(vec2 p, float n){
  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = 6.2831853 / n;
  a = mod(a, seg);
  a = abs(a - seg*0.5);
  return vec2(cos(a), sin(a)) * r;
}

// signed distance helpers
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }

// ---------- MODE 0: Kaleidoscopic plasma ----------
vec3 modeKaleido(vec2 uv){
  vec2 p = uv;
  p *= rot(uTime * 0.08 + uMid * 1.2);
  float arms = 6.0 + floor(uHigh * 6.0) * 2.0;
  p = kaleido(p, arms);
  p += vec2(uTime * 0.06, uTime * 0.04);

  float warp = fbm(p * (1.6 + uBass * 2.5) + uTime * 0.2);
  float band = fbm(p * 4.0 - vec2(0.0, uTime * 0.5) + warp * 2.0);

  float pulse = uBeat * 0.6;
  float v = sin((band * 8.0 + uTime * 1.5 + uBass * 6.0) * (1.0 + pulse));
  v = 0.5 + 0.5 * v;

  float hue = fract(uHue + warp * 0.4 + uTime * 0.04 + uHigh * 0.3);
  float sat = 0.85 - uHigh * 0.2;
  float val = pow(v, 1.5) * (1.0 + uLevel * 0.8 + uBeat * 0.5);
  vec3 col = hsv2rgb(vec3(hue, sat, val));

  // hot core
  float r = length(uv);
  col += vec3(1.0, 0.4, 0.9) * smoothstep(0.5, 0.0, r) * (uBass * 1.4 + uBeat * 0.8);
  return col;
}

// ---------- MODE 1: Twisted tunnel (raymarch the inside of a tube) ----------
float tunnelMap(vec3 p){
  float twist = sin(p.z * 0.4 + uTime * 0.6) * (0.6 + uBass * 1.2);
  p.xy *= rot(twist);
  float r = 1.4 - 0.25*sin(p.z*0.7 + uTime) - uBass * 0.3;
  // walls = distance from radius
  float d = r - length(p.xy);
  // ribs
  d -= 0.04 * sin(p.z * (8.0 + uHigh * 18.0) + uTime * 3.0);
  return d;
}

vec3 modeTunnel(vec2 uv){
  vec3 ro = vec3(0.0, 0.0, uTime * (1.2 + uMid * 2.5));
  vec3 rd = normalize(vec3(uv, 1.4));
  rd.xy *= rot(uTime * 0.2 + uBeat * 0.4);

  float t = 0.0;
  float glow = 0.0;
  for (int i = 0; i < 64; i++){
    vec3 p = ro + rd * t;
    float d = tunnelMap(p);
    glow += exp(-abs(d) * 8.0) * 0.04;
    if (d < 0.001 || t > 30.0) break;
    t += max(d * 0.7, 0.02);
  }
  vec3 hit = ro + rd * t;
  float a = atan(hit.y, hit.x);
  float hue = fract(uHue + a * 0.16 + hit.z * 0.04);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0)) * glow * 1.4;
  col += vec3(1.0, 0.6, 0.2) * uBeat * 0.6 * smoothstep(0.0, 0.4, glow);
  return col;
}

// ---------- MODE 2: Liquid plasma / domain warp ----------
vec3 modeLiquid(vec2 uv){
  vec2 p = uv * 1.6;
  vec2 q = vec2(fbm(p + uTime*0.15), fbm(p + vec2(5.2, 1.3) + uTime*0.12));
  vec2 r = vec2(
    fbm(p + 4.0*q + vec2(1.7, 9.2) + uTime*0.2 + uBass*2.0),
    fbm(p + 4.0*q + vec2(8.3, 2.8) + uTime*0.18 + uMid*1.5)
  );
  float v = fbm(p + 4.0*r);

  float hue = fract(uHue + v * 0.35 + r.x * 0.2);
  vec3 a = hsv2rgb(vec3(hue, 0.7, 1.0));
  vec3 b = hsv2rgb(vec3(fract(hue + 0.5), 0.9, 1.0));
  vec3 col = mix(a, b, smoothstep(0.2, 0.9, v));
  col *= 0.6 + 0.7 * v + uLevel * 0.6;
  col += vec3(1.0) * pow(v, 8.0) * (1.0 + uBeat * 2.0);
  return col;
}

// ---------- MODE 3: Crystalline lattice ----------
float latticeMap(vec3 p){
  p.xy *= rot(uTime * 0.2);
  p.xz *= rot(uTime * 0.15 + uMid * 0.6);
  // fold
  for (int i = 0; i < 4; i++){
    p = abs(p) - vec3(0.9, 0.9, 0.9);
    p.xy *= rot(0.6 + uBass * 0.4);
    p.yz *= rot(0.5);
  }
  return sdBox(p, vec3(0.6, 0.6, 0.6)) / pow(2.0, 4.0);
}

vec3 modeLattice(vec2 uv){
  vec3 ro = vec3(0.0, 0.0, -3.5 - uBeat * 0.4);
  vec3 rd = normalize(vec3(uv, 1.2));
  float t = 0.0; float glow = 0.0;
  for (int i = 0; i < 80; i++){
    vec3 p = ro + rd * t;
    float d = latticeMap(p);
    glow += exp(-abs(d) * 14.0) * 0.05;
    if (d < 0.001 || t > 12.0) break;
    t += max(d, 0.01);
  }
  float hue = fract(uHue + uTime * 0.05 + glow * 0.2);
  vec3 col = hsv2rgb(vec3(hue, 0.8, 1.0)) * glow * 1.2;
  col += vec3(0.8, 0.9, 1.0) * pow(glow, 1.8) * (uHigh * 1.8 + uBeat);
  return col;
}

void main(){
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  vec3 col;
  if      (uMode < 0.5) col = modeKaleido(uv);
  else if (uMode < 1.5) col = modeTunnel(uv);
  else if (uMode < 2.5) col = modeLiquid(uv);
  else                  col = modeLattice(uv);

  // vignette
  float vg = smoothstep(1.6, 0.4, length(uv));
  col *= 0.55 + 0.7 * vg;

  // grain
  float g = (hash(vUv * uRes + uTime) - 0.5) * 0.05;
  col += g;

  // tone map (Reinhard-ish)
  col = col / (1.0 + col);
  col = pow(col, vec3(0.85));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes:   { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uTime:  { value: 0 },
  uBass:  { value: 0 },
  uMid:   { value: 0 },
  uHigh:  { value: 0 },
  uLevel: { value: 0 },
  uBeat:  { value: 0 },
  uMode:  { value: 0 },
  uHue:   { value: 0 },
};

const mat = new THREE.ShaderMaterial({
  vertexShader: vert,
  fragmentShader: frag,
  uniforms,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
scene.add(quad);

// Postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.85, 0.05);
composer.addPass(bloom);

const afterimage = new AfterimagePass(0.86);
composer.addPass(afterimage);

const rgb = new ShaderPass(RGBShiftShader);
rgb.uniforms.amount.value = 0.0015;
composer.addPass(rgb);

composer.addPass(new OutputPass());

// Resize
function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  uniforms.uRes.value.set(w, h);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Audio + UI wiring
// ---------------------------------------------------------------------------
const audio = new AudioEngine();
const splash = document.getElementById('splash');
const fileInput = document.getElementById('file-input');
const modeLabel = document.getElementById('mode-label');
const bpmLabel = document.getElementById('bpm-label');
const mBass = document.getElementById('m-bass');
const mMid  = document.getElementById('m-mid');
const mHigh = document.getElementById('m-high');

const MODES = ['kaleido', 'tunnel', 'liquid', 'lattice'];
let mode = 0;
let hue = Math.random();

function setMode(i){
  mode = ((i % MODES.length) + MODES.length) % MODES.length;
  uniforms.uMode.value = mode;
  modeLabel.textContent = MODES[mode];
  // re-tune bloom per mode
  const bloomStrength = [0.9, 1.4, 0.7, 1.6][mode];
  bloom.strength = bloomStrength;
}
setMode(0);

function showError(msg){
  const el = document.createElement('div');
  el.className = 'err';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function pickSource(kind){
  try {
    if (kind === 'mic') await audio.useMic();
    else if (kind === 'tab') await audio.useTab();
    else if (kind === 'demo') await audio.useDemo();
    else if (kind === 'file') {
      fileInput.click();
      return; // wait for file event
    }
    splash.classList.add('hidden');
    setTimeout(() => splash.style.display = 'none', 700);
  } catch (e) {
    console.error(e);
    showError(e.message || 'Could not start audio');
  }
}

document.querySelectorAll('.src').forEach(btn => {
  btn.addEventListener('click', () => pickSource(btn.dataset.src));
});

fileInput.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    await audio.useFile(f);
    splash.classList.add('hidden');
    setTimeout(() => splash.style.display = 'none', 700);
  } catch (err) {
    console.error(err);
    showError('Could not play file');
  }
});

// Hotkeys
window.addEventListener('keydown', (e) => {
  if (e.key === '1') setMode(0);
  else if (e.key === '2') setMode(1);
  else if (e.key === '3') setMode(2);
  else if (e.key === '4') setMode(3);
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
  else if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  else if (e.key === 'r' || e.key === 'R') {
    hue = Math.random();
  }
  else if (e.key === 's' || e.key === 'S') {
    audio.disconnect();
    splash.style.display = '';
    splash.classList.remove('hidden');
  }
  else if (e.code === 'Space') {
    audio.beatDecay = 1;
  }
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  audio.update(dt);

  uniforms.uTime.value += dt;
  uniforms.uBass.value  = audio.smooth.bass;
  uniforms.uMid.value   = audio.smooth.mid;
  uniforms.uHigh.value  = audio.smooth.high;
  uniforms.uLevel.value = audio.smooth.level;
  uniforms.uBeat.value  = audio.beatDecay;

  // hue drifts; beats nudge it
  hue = (hue + dt * 0.02 + audio.beatDecay * 0.012) % 1;
  uniforms.uHue.value = hue;

  // Postprocess reactivity
  rgb.uniforms.amount.value = 0.0015 + audio.smooth.high * 0.012 + audio.beatDecay * 0.008;
  afterimage.uniforms.damp.value = 0.83 + audio.smooth.bass * 0.13;
  bloom.radius = 0.65 + audio.smooth.mid * 0.5;

  composer.render();

  // HUD meters
  mBass.style.width = Math.min(100, audio.smooth.bass * 140) + '%';
  mMid.style.width  = Math.min(100, audio.smooth.mid  * 180) + '%';
  mHigh.style.width = Math.min(100, audio.smooth.high * 220) + '%';
  bpmLabel.textContent = audio.bpm > 0 ? Math.round(audio.bpm) : '—';

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
resize();
