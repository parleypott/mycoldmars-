import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import butterchurnRaw from 'butterchurn';
import butterchurnPresetsRaw from 'butterchurn-presets/lib/butterchurnPresetsMinimal.min.js';

const butterchurn = butterchurnRaw.default || butterchurnRaw;
const butterchurnPresets = butterchurnPresetsRaw.default || butterchurnPresetsRaw;

// ===========================================================================
// Beat Bus
// ===========================================================================
class BeatBus {
  constructor() { this.listeners = []; }
  on(fn) { this.listeners.push(fn); }
  fire(intensity = 1) { this.listeners.forEach(fn => fn(intensity)); }
}

// ===========================================================================
// Audio Engine — bass-envelope kick detection
// Idea: maintain a fast-attack/slow-release envelope of the bass band, plus
// a long-term running average. A kick is when the fast envelope spikes well
// above the slow envelope. Polled every animation frame.
// ===========================================================================
class AudioEngine {
  constructor(beatBus) {
    this.beatBus = beatBus;
    this.ctx = null;
    this.source = null;
    this.htmlAudio = null;

    this.analyser = null;
    this.freq = null;

    this.bands = { bass: 0, mid: 0, high: 0, level: 0 };
    this.smooth = { bass: 0, mid: 0, high: 0, level: 0 };

    this.bassFast = 0;   // fast attack/release envelope
    this.bassSlow = 0;   // long-term average
    this.lastBeat = -1;
    this.beatTimes = [];
    this.bpm = 0;
    this.beatPulse = 0;  // decays after a kick

    this.sourceListeners = [];
  }

  onSourceChange(fn) { this.sourceListeners.push(fn); }

  async _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.4; // sharper transients than 0.78
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  _attach(node) {
    if (this.source) { try { this.source.disconnect(); } catch {} }
    if (this.htmlAudio) { this.htmlAudio.pause(); this.htmlAudio.src = ''; this.htmlAudio = null; }
    this.source = node;
    node.connect(this.analyser);
    this.sourceListeners.forEach(fn => fn(node));
  }

  disconnect() {
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.htmlAudio) { this.htmlAudio.pause(); this.htmlAudio.src = ''; this.htmlAudio = null; }
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
      throw new Error('No audio shared. Re-share and check "Share tab audio".');
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
    await audio.play().catch(() => {});
    this.htmlAudio = audio;
    const node = this.ctx.createMediaElementSource(audio);
    this._attach(node);
    this.analyser.connect(this.ctx.destination);
  }

  async useDemo() {
    await this._ensureCtx();
    const ctx = this.ctx;

    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator(); osc2.type = 'square';   osc2.frequency.value = 220;
    const osc3 = ctx.createOscillator(); osc3.type = 'sine';     osc3.frequency.value = 880;
    const lfo = ctx.createOscillator();  lfo.frequency.value = 2.0;
    const lfoGain = ctx.createGain();    lfoGain.gain.value = 60;
    lfo.connect(lfoGain); lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);

    const kick = ctx.createOscillator(); kick.type = 'sine'; kick.frequency.value = 60;
    const kickGain = ctx.createGain();   kickGain.gain.value = 0;
    kick.connect(kickGain);

    const mix = ctx.createGain(); mix.gain.value = 0.22;
    const g1 = ctx.createGain(); g1.gain.value = 0.32;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    const g3 = ctx.createGain(); g3.gain.value = 0.10;
    osc1.connect(g1); osc2.connect(g2); osc3.connect(g3);
    g1.connect(mix); g2.connect(mix); g3.connect(mix); kickGain.connect(mix);

    osc1.start(); osc2.start(); osc3.start(); lfo.start(); kick.start();

    const t0 = ctx.currentTime;
    for (let i = 0; i < 1024; i++) {
      const t = t0 + i * 0.5; // 120 BPM
      kickGain.gain.setValueAtTime(0, t);
      kickGain.gain.linearRampToValueAtTime(2.2, t + 0.005);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    }

    this._attach(mix);
    mix.connect(ctx.destination);
  }

  update(dt) {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq, N = f.length;
    const bassEnd = Math.floor(N * 0.04);   // ~ low end
    const midEnd  = Math.floor(N * 0.22);
    let bass = 0, mid = 0, high = 0, total = 0;
    for (let i = 1; i < bassEnd; i++) bass += f[i];
    for (let i = bassEnd; i < midEnd; i++) mid += f[i];
    for (let i = midEnd; i < N; i++) high += f[i];
    for (let i = 0; i < N; i++) total += f[i];
    const norm = 1 / 255;
    this.bands.bass  = (bass / Math.max(1, bassEnd - 1)) * norm;
    this.bands.mid   = (mid  / Math.max(1, midEnd - bassEnd)) * norm;
    this.bands.high  = (high / Math.max(1, N - midEnd)) * norm;
    this.bands.level = (total / N) * norm;

    // Smoothed values (for shader uniforms)
    const a = 1 - Math.exp(-dt * 12);
    this.smooth.bass  += (this.bands.bass  - this.smooth.bass)  * a;
    this.smooth.mid   += (this.bands.mid   - this.smooth.mid)   * a;
    this.smooth.high  += (this.bands.high  - this.smooth.high)  * a;
    this.smooth.level += (this.bands.level - this.smooth.level) * a;

    // Bass envelopes
    const attackA  = 1 - Math.exp(-dt * 35);  // very fast attack
    const releaseA = 1 - Math.exp(-dt * 5);
    if (this.bands.bass > this.bassFast) {
      this.bassFast += (this.bands.bass - this.bassFast) * attackA;
    } else {
      this.bassFast += (this.bands.bass - this.bassFast) * releaseA;
    }
    this.bassSlow += (this.bands.bass - this.bassSlow) * (1 - Math.exp(-dt * 0.6));

    // Kick = fastEnv jumps well above slowEnv with absolute floor
    const ratio = this.bassFast / Math.max(0.01, this.bassSlow);
    const now = performance.now() / 1000;
    if (
      ratio > 1.45 &&
      this.bassFast > 0.16 &&
      (now - this.lastBeat) > 0.18
    ) {
      this.lastBeat = now;
      this.beatPulse = 1.0;
      this.beatTimes.push(now);
      while (this.beatTimes.length > 16) this.beatTimes.shift();
      if (this.beatTimes.length >= 4) {
        const intervals = [];
        for (let i = 1; i < this.beatTimes.length; i++) intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
        intervals.sort((x, y) => x - y);
        const median = intervals[Math.floor(intervals.length / 2)];
        let bpm = 60 / median;
        while (bpm < 70)  bpm *= 2;
        while (bpm > 180) bpm /= 2;
        this.bpm = this.bpm * 0.6 + bpm * 0.4;
      }
      const intensity = Math.min(2.5, ratio - 1.0); // ~0.45..1.5 typical
      this.beatBus.fire(intensity);
    }

    this.beatPulse = Math.max(0, this.beatPulse - dt * 5.5);
  }
}

// ===========================================================================
// Beat FX
// ===========================================================================
class BeatFX {
  constructor(beatBus) {
    this.beatDot = document.getElementById('beat-dot');
    this.flash = document.getElementById('flash');
    this.rings = document.getElementById('rings');
    this.beatText = document.getElementById('beat-text');

    this.zoomKick = 0;
    this.bloomKick = 0;
    this.rgbKick = 0;
    this.glitchKick = 0;
    this.satKick = 0;
    this.brightKick = 0;
    this.hueJump = 0;

    beatBus.on((intensity) => this.onBeat(intensity));
  }

  spawnRing(intensity) {
    const r = document.createElement('div');
    r.className = 'ring';
    const w = 3 + Math.min(8, intensity * 4);
    r.style.borderWidth = w + 'px';
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue} 100% 65%)`;
    r.style.borderColor = color;
    r.style.color = color;
    this.rings.appendChild(r);
    requestAnimationFrame(() => r.classList.add('go'));
    setTimeout(() => r.remove(), 700);
  }

  onBeat(intensity) {
    // 1. HUD beat dot (always)
    this.beatDot.classList.remove('hit');
    void this.beatDot.offsetWidth;
    this.beatDot.classList.add('hit');
    setTimeout(() => this.beatDot.classList.remove('hit'), 110);

    // 2. Center "BEAT" text (always — primary detection proof)
    this.beatText.classList.remove('hit');
    void this.beatText.offsetWidth;
    this.beatText.classList.add('hit');
    setTimeout(() => this.beatText.classList.remove('hit'), 50);

    // 3. Full-screen flash (always)
    this.flash.classList.remove('hit');
    void this.flash.offsetWidth;
    this.flash.classList.add('hit');
    setTimeout(() => this.flash.classList.remove('hit'), 40);

    // 4. Ring shockwave — only on the bigger beats so the page isn't drowning
    if (intensity > 0.4) this.spawnRing(intensity);

    // 5. Render-loop kicks
    const I = Math.min(1.6, Math.max(0.5, intensity));
    this.zoomKick   = Math.max(this.zoomKick,   0.35 * I);
    this.bloomKick  = Math.max(this.bloomKick,  2.5 * I);
    this.rgbKick    = Math.max(this.rgbKick,    0.018 * I);
    this.glitchKick = Math.max(this.glitchKick, Math.min(1.0, 0.55 + I * 0.35));
    this.satKick    = Math.max(this.satKick,    0.55);
    this.brightKick = Math.max(this.brightKick, 0.6 * I);
    this.hueJump    += 0.022 * I;
  }

  update(dt) {
    const decay = (v, rate) => Math.max(0, v - rate * dt);
    this.zoomKick   = decay(this.zoomKick,   1.4);   // ~250ms
    this.bloomKick  = decay(this.bloomKick,  9.0);
    this.rgbKick    = decay(this.rgbKick,    0.09);
    this.glitchKick = decay(this.glitchKick, 6.5);
    this.satKick    = decay(this.satKick,    3.0);
    this.brightKick = decay(this.brightKick, 4.0);
  }
}

// ===========================================================================
// Custom shader (modes 1–4) — calm at silence, slams on beats
// All time-driven motion is gated by uLevel so silence ≈ near-still scene.
// ===========================================================================
const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
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
uniform float uZoomKick;
uniform float uSatBoost;
uniform float uBright;     // beat-driven brightness pump

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
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 6; i++){ v += amp*noise(p); p = p*2.03 + 11.7; amp *= 0.5; }
  return v;
}
vec2 kaleido(vec2 p, float n){
  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = 6.2831853 / n;
  a = mod(a, seg);
  a = abs(a - seg*0.5);
  return vec2(cos(a), sin(a)) * r;
}
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }

// motion gain — silence keeps the scene mostly still
// (small floor so it never literally freezes when source is mid-quiet)
float motion(){ return 0.12 + uLevel * 1.4 + uBeat * 1.5; }

vec3 modeKaleido(vec2 uv){
  float m = motion();
  vec2 p = uv;
  p *= rot(uTime * 0.08 * m + uMid * 1.2);
  float arms = 6.0 + floor(uHigh * 6.0) * 2.0 + floor(uBeat * 2.0);
  p = kaleido(p, arms);
  p += vec2(uTime * 0.06, uTime * 0.04) * m;
  float warp = fbm(p * (1.6 + uBass * 2.5 + uBeat * 1.8) + uTime * 0.2 * m);
  float band = fbm(p * 4.0 - vec2(0.0, uTime * 0.5 * m) + warp * 2.0);
  float v = sin((band * 8.0 + uTime * 1.5 * m + uBass * 6.0) * (1.0 + uBeat * 0.9));
  v = 0.5 + 0.5 * v;
  float hue = fract(uHue + warp * 0.4 + uHigh * 0.3);
  float sat = clamp(0.85 - uHigh * 0.2 + uSatBoost, 0.0, 1.0);
  float val = pow(v, 1.5) * (0.4 + uLevel * 0.8 + uBeat * 0.9);
  vec3 col = hsv2rgb(vec3(hue, sat, val));
  float r = length(uv);
  col += vec3(1.0, 0.4, 0.9) * smoothstep(0.5, 0.0, r) * (uBass * 1.4 + uBeat * 1.4);
  return col;
}

float tunnelMap(vec3 p){
  float twist = sin(p.z * 0.4 + uTime * 0.6) * (0.6 + uBass * 1.2);
  p.xy *= rot(twist);
  float r = 1.4 - 0.25*sin(p.z*0.7 + uTime) - uBass * 0.3 - uBeat * 0.25;
  float d = r - length(p.xy);
  d -= 0.04 * sin(p.z * (8.0 + uHigh * 18.0) + uTime * 3.0);
  return d;
}
vec3 modeTunnel(vec2 uv){
  float m = motion();
  vec3 ro = vec3(0.0, 0.0, uTime * (0.3 + uMid * 2.5 + uBeat * 1.0) * m);
  vec3 rd = normalize(vec3(uv, 1.4));
  rd.xy *= rot(uTime * 0.2 * m + uBeat * 0.5);
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
  float sat = clamp(0.85 + uSatBoost, 0.0, 1.0);
  vec3 col = hsv2rgb(vec3(hue, sat, 1.0)) * glow * 1.2;
  col += vec3(1.0, 0.6, 0.2) * uBeat * 1.2 * smoothstep(0.0, 0.4, glow);
  return col;
}

vec3 modeLiquid(vec2 uv){
  float m = motion();
  vec2 p = uv * 1.6;
  vec2 q = vec2(fbm(p + uTime*0.15*m), fbm(p + vec2(5.2, 1.3) + uTime*0.12*m));
  vec2 r = vec2(
    fbm(p + 4.0*q + vec2(1.7, 9.2) + uTime*0.2*m + uBass*2.0 + uBeat*1.2),
    fbm(p + 4.0*q + vec2(8.3, 2.8) + uTime*0.18*m + uMid*1.5 + uBeat*0.8)
  );
  float v = fbm(p + 4.0*r);
  float hue = fract(uHue + v * 0.35 + r.x * 0.2);
  float sat = clamp(0.7 + uSatBoost, 0.0, 1.0);
  vec3 a = hsv2rgb(vec3(hue, sat, 1.0));
  vec3 b = hsv2rgb(vec3(fract(hue + 0.5), clamp(0.9 + uSatBoost, 0.0, 1.0), 1.0));
  vec3 col = mix(a, b, smoothstep(0.2, 0.9, v));
  col *= 0.4 + 0.7 * v + uLevel * 0.6;
  col += vec3(1.0) * pow(v, 8.0) * (1.0 + uBeat * 3.0);
  return col;
}

float latticeMap(vec3 p){
  p.xy *= rot(uTime * 0.2);
  p.xz *= rot(uTime * 0.15 + uMid * 0.6);
  for (int i = 0; i < 4; i++){
    p = abs(p) - vec3(0.9, 0.9, 0.9);
    p.xy *= rot(0.6 + uBass * 0.4 + uBeat * 0.5);
    p.yz *= rot(0.5);
  }
  return sdBox(p, vec3(0.6, 0.6, 0.6)) / pow(2.0, 4.0);
}
vec3 modeLattice(vec2 uv){
  vec3 ro = vec3(0.0, 0.0, -3.5 - uBeat * 0.9);
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
  float sat = clamp(0.8 + uSatBoost, 0.0, 1.0);
  vec3 col = hsv2rgb(vec3(hue, sat, 1.0)) * glow * 1.0;
  col += vec3(0.8, 0.9, 1.0) * pow(glow, 1.8) * (uHigh * 1.8 + uBeat * 1.8);
  return col;
}

void main(){
  // camera-punch zoom
  float zoom = 1.0 - uZoomKick;
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0 * zoom;

  vec3 col;
  if      (uMode < 1.5) col = modeKaleido(uv);
  else if (uMode < 2.5) col = modeTunnel(uv);
  else if (uMode < 3.5) col = modeLiquid(uv);
  else                  col = modeLattice(uv);

  // beat brightness pump — whole image gets brighter on a kick
  col *= 1.0 + uBright;

  float vg = smoothstep(1.6, 0.4, length(uv));
  col *= 0.55 + 0.7 * vg;
  col += (hash(vUv * uRes + uTime) - 0.5) * 0.04;

  col = col / (1.0 + col);
  col = pow(col, vec3(0.85));
  gl_FragColor = vec4(col, 1.0);
}
`;

const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null },
    uGlitch: { value: 0 },
    uTime:   { value: 0 },
    uRes:    { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uGlitch;
    uniform float uTime;
    uniform vec2 uRes;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float g = uGlitch;
      float blocks = 28.0;
      float blockY = floor(uv.y * blocks);
      float t = floor(uTime * 30.0);
      float r = hash(vec2(blockY, t));
      float gate = step(0.78 - g * 0.4, hash(vec2(blockY * 1.7, t)));
      uv.x += (r - 0.5) * 0.14 * g * gate;
      float ca = 0.014 * g;
      vec4 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
      col.a = 1.0;
      float slice = step(0.985, hash(vec2(blockY * 3.1, t)));
      col.rgb += slice * g * 0.7;
      gl_FragColor = col;
    }
  `,
};

// ===========================================================================
// Three.js scene + post chain
// ===========================================================================
const milkdropCanvas = document.getElementById('milkdrop');
const threeCanvas = document.getElementById('three');

const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas, antialias: false, alpha: false, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes:      { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uTime:     { value: 0 },
  uBass:     { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uLevel: { value: 0 },
  uBeat:     { value: 0 },
  uMode:     { value: 1 },
  uHue:      { value: 0 },
  uZoomKick: { value: 0 },
  uSatBoost: { value: 0 },
  uBright:   { value: 0 },
};
const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.7, 0.05);
composer.addPass(bloom);
const afterimage = new AfterimagePass(0.78);
composer.addPass(afterimage);
const rgb = new ShaderPass(RGBShiftShader);
rgb.uniforms.amount.value = 0.0008;
composer.addPass(rgb);
const glitch = new ShaderPass(GlitchShader);
glitch.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
composer.addPass(glitch);
composer.addPass(new OutputPass());

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  uniforms.uRes.value.set(w, h);
  glitch.uniforms.uRes.value.set(w, h);
  if (visualizer) visualizer.setRendererSize(Math.floor(w * 0.85), Math.floor(h * 0.85));
}
window.addEventListener('resize', resize);

// ---- Butterchurn ----
let visualizer = null;
let presets = {};
let presetKeys = [];
let currentPresetIdx = 0;
let lastPresetSwitchAt = 0;
let beatsSinceSwitch = 0;

const beatBus = new BeatBus();
const audio = new AudioEngine(beatBus);
const fx = new BeatFX(beatBus);

function initButterchurnIfNeeded() {
  if (visualizer) return;
  if (!audio.ctx) return;
  try {
    const w = Math.floor(window.innerWidth * 0.85);
    const h = Math.floor(window.innerHeight * 0.85);
    visualizer = butterchurn.createVisualizer(audio.ctx, milkdropCanvas, {
      width: w, height: h,
      pixelRatio: window.devicePixelRatio || 1,
      textureRatio: 1,
    });
    presets = butterchurnPresets.getPresets();
    presetKeys = Object.keys(presets);
    for (let i = presetKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [presetKeys[i], presetKeys[j]] = [presetKeys[j], presetKeys[i]];
    }
    loadPresetByIndex(0, 0);
    if (audio.source) visualizer.connectAudio(audio.source);
  } catch (e) {
    console.error('Butterchurn init failed', e);
  }
}

function loadPresetByIndex(i, blendSec = 5.7) {
  if (!visualizer || presetKeys.length === 0) return;
  currentPresetIdx = ((i % presetKeys.length) + presetKeys.length) % presetKeys.length;
  const key = presetKeys[currentPresetIdx];
  visualizer.loadPreset(presets[key], blendSec);
  document.getElementById('preset-name').textContent = mode === 0 ? key : '';
  lastPresetSwitchAt = performance.now() / 1000;
  beatsSinceSwitch = 0;
}

audio.onSourceChange((node) => {
  if (visualizer) {
    try { visualizer.connectAudio(node); } catch (e) { console.error(e); }
  }
});

beatBus.on(() => {
  beatsSinceSwitch++;
  if (mode === 0 && visualizer) {
    const now = performance.now() / 1000;
    if (beatsSinceSwitch >= 64 || (now - lastPresetSwitchAt) > 45) {
      loadPresetByIndex(currentPresetIdx + 1, 5.7);
    }
  }
});

// ---- UI / mode switching ----
const MODES = ['milkdrop', 'kaleido', 'tunnel', 'liquid', 'lattice'];
let mode = 1; // start in kaleido — clearest beat reactivity
let hue = Math.random();

function setMode(i){
  mode = ((i % MODES.length) + MODES.length) % MODES.length;
  document.body.dataset.mode = String(mode);
  document.getElementById('mode-label').textContent = MODES[mode];
  document.getElementById('preset-name').textContent =
    mode === 0 && presetKeys.length ? presetKeys[currentPresetIdx] : '';
  if (mode === 0) initButterchurnIfNeeded();
  if (mode > 0) {
    uniforms.uMode.value = mode;
    bloom.strength = [0.4, 0.4, 0.5, 0.3, 0.7][mode]; // quiet baselines
  }
}
setMode(1); // default

const splash = document.getElementById('splash');
const fileInput = document.getElementById('file-input');
const bpmLabel = document.getElementById('bpm-label');
const mBass = document.getElementById('m-bass');
const mMid  = document.getElementById('m-mid');
const mHigh = document.getElementById('m-high');

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
    else if (kind === 'file') { fileInput.click(); return; }
    initButterchurnIfNeeded();
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
    initButterchurnIfNeeded();
    splash.classList.add('hidden');
    setTimeout(() => splash.style.display = 'none', 700);
  } catch (err) {
    console.error(err);
    showError('Could not play file');
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === '1') setMode(0);
  else if (e.key === '2') setMode(1);
  else if (e.key === '3') setMode(2);
  else if (e.key === '4') setMode(3);
  else if (e.key === '5') setMode(4);
  else if (e.key === 'n' || e.key === 'N') {
    if (mode === 0) loadPresetByIndex(currentPresetIdx + 1, 2.5);
  }
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
  else if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  else if (e.key === 's' || e.key === 'S') {
    audio.disconnect();
    splash.style.display = '';
    splash.classList.remove('hidden');
  }
  else if (e.code === 'Space') {
    beatBus.fire(1);
  }
});

// ---- Main loop ----
let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  audio.update(dt);
  fx.update(dt);

  hue = (hue + dt * 0.005 + fx.hueJump) % 1; // baseline drift cut to a crawl
  fx.hueJump = 0;

  if (mode === 0 && visualizer) {
    try { visualizer.render(); } catch {}
  } else if (mode > 0) {
    uniforms.uTime.value += dt;
    uniforms.uBass.value  = audio.smooth.bass;
    uniforms.uMid.value   = audio.smooth.mid;
    uniforms.uHigh.value  = audio.smooth.high;
    uniforms.uLevel.value = audio.smooth.level;
    uniforms.uBeat.value  = audio.beatPulse;
    uniforms.uHue.value   = hue;
    uniforms.uZoomKick.value = fx.zoomKick;
    uniforms.uSatBoost.value = fx.satKick;
    uniforms.uBright.value   = fx.brightKick;

    rgb.uniforms.amount.value = 0.0008 + audio.smooth.high * 0.006 + fx.rgbKick;
    afterimage.uniforms.damp.value = 0.78 + audio.smooth.bass * 0.10;
    bloom.strength = ([0.4, 0.4, 0.5, 0.3, 0.7][mode] || 0.4) + fx.bloomKick;
    bloom.radius = 0.55 + audio.smooth.mid * 0.4;
    glitch.uniforms.uGlitch.value = fx.glitchKick;
    glitch.uniforms.uTime.value = uniforms.uTime.value;

    composer.render();
  }

  mBass.style.width = Math.min(100, audio.smooth.bass * 140) + '%';
  mMid.style.width  = Math.min(100, audio.smooth.mid  * 180) + '%';
  mHigh.style.width = Math.min(100, audio.smooth.high * 220) + '%';
  bpmLabel.textContent = audio.bpm > 0 ? Math.round(audio.bpm) : '—';

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
resize();
