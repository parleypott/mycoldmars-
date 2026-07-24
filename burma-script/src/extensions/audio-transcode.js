// Burma Script Tool — AUDIO → MP3 TRANSCODE (in-browser, drop-time).
//
// Johnny drops audio into the script: clean wav/mp3 (already web-playable) OR weird voice-memo
// containers — most sharply a QuickTime ".qta" (AAC-in-mp4) that <audio> won't universally play.
// The rule (image-drop.js audioTranscodeDecision): wav/mp3 upload AS-IS (no needless re-encode);
// everything else is transcoded HERE to a portable 128kbps mp3 before upload, so the doc gets a
// ~100-byte mp3 URL and the waveform strip plays everywhere. Same BYTES-NEVER-IN-THE-DOC law.
//
// MECHANISM — Web Audio decodeAudioData → PCM → lamejs mp3 (PRIMARY), ffmpeg.wasm (FALLBACK).
//   • decodeAudioData is the browser's OWN demuxer/decoder: it already understands wav, mp3, m4a,
//     aac, and — the case that matters — AAC-in-mp4 (the .qta), returning float PCM. That PCM is
//     re-encoded to mp3 by @breezystack/lamejs, a tiny pure-JS MPEG encoder (no wasm, no worker,
//     no network — CSP-clean and bundleable). This path covers every format Johnny will realistically
//     drop, so it is the default and the fast one.
//   • ffmpeg.wasm is the HEAVY fallback, attempted ONLY when decodeAudioData itself cannot decode the
//     bytes (a codec the browser lacks). It is dynamic-imported so its ~25MB wasm never touches the
//     core chunk, and if the package isn't installed the import simply fails and we surface an HONEST
//     error — a transcode failure is NEVER a silent drop (image-drop.js marks the block uploadError).
//
// LOADED LAZILY: image-drop.js dynamic-import()s this module only when a NON-passthrough audio file
// is actually dropped/pasted, so vite code-splits it (and lamejs) out of the editor's startup chunk.
// Never import this statically from anything on the editor's startup path.
//
// HEADLESS NOTE: AudioContext.decodeAudioData is a browser API (absent under bun), so the ENCODE
// itself is a live-browser path — the PURE decision (which formats convert vs pass through) lives in
// image-drop.js audioTranscodeDecision and is unit-tested there. This module's job is the encode.

const MP3_KBPS = 128;              // transparent for voice/reference; ~1MB/min
const LAME_BLOCK = 1152;           // one MPEG frame's worth of samples per encodeBuffer call

// Clamp a float sample to [-1,1] and scale to signed 16-bit (lamejs wants Int16 PCM).
function floatToInt16(x) {
  const s = Math.max(-1, Math.min(1, x || 0));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

// decodeAudioData with both the modern promise form and the legacy callback form (Safari), on a
// throwaway AudioContext we close immediately. The ArrayBuffer may be DETACHED by decode, so callers
// hand us a private copy. Throws when the browser genuinely cannot decode the bytes → ffmpeg fallback.
async function decodeToPcm(arrayBuffer) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AC !== 'function') throw new Error('no AudioContext');
  const ctx = new AC();
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
      const no = (e) => { if (!settled) { settled = true; reject(e || new Error('decode failed')); } };
      let ret;
      try { ret = ctx.decodeAudioData(arrayBuffer, ok, no); } catch (e) { no(e); return; }
      if (ret && typeof ret.then === 'function') ret.then(ok, no);
    });
  } finally {
    try { ctx.close(); } catch {}
  }
}

// AudioBuffer (float PCM) → mp3 File via lamejs. Mono or stereo (down to ≤2 channels — mp3 is
// stereo max; extra channels are dropped, which is correct for a voice memo/reference). Returns a
// File(audio/mpeg) carrying its measured duration on __durationSec so the caller can persist it.
async function encodePcmToMp3(audioBuf, name) {
  const mod = await import('@breezystack/lamejs');
  const Mp3Encoder = (mod.default || mod).Mp3Encoder;
  if (typeof Mp3Encoder !== 'function') throw new Error('mp3 encoder unavailable');

  const channels = Math.min(2, Math.max(1, audioBuf.numberOfChannels || 1));
  const sampleRate = audioBuf.sampleRate || 44100;
  const enc = new Mp3Encoder(channels, sampleRate, MP3_KBPS);

  const left = audioBuf.getChannelData(0);
  const right = channels > 1 ? audioBuf.getChannelData(1) : null;
  const len = left.length;
  const l16 = new Int16Array(LAME_BLOCK);
  const r16 = right ? new Int16Array(LAME_BLOCK) : null;
  const chunks = [];
  for (let i = 0; i < len; i += LAME_BLOCK) {
    const n = Math.min(LAME_BLOCK, len - i);
    for (let j = 0; j < n; j++) {
      l16[j] = floatToInt16(left[i + j]);
      if (r16) r16[j] = floatToInt16(right[i + j]);
    }
    const enc16L = l16.subarray(0, n);
    const buf = r16 ? enc.encodeBuffer(enc16L, r16.subarray(0, n)) : enc.encodeBuffer(enc16L);
    if (buf && buf.length) chunks.push(new Uint8Array(buf));
  }
  const tail = enc.flush();
  if (tail && tail.length) chunks.push(new Uint8Array(tail));

  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  if (!blob.size) throw new Error('empty mp3 output');
  const base = String(name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
  const out = new File([blob], base, { type: 'audio/mpeg' });
  try { out.__durationSec = audioBuf.duration; } catch {}
  return out;
}

// HEAVY FALLBACK — ffmpeg.wasm. Attempted ONLY when decodeAudioData cannot decode the bytes. The
// package is intentionally NOT a hard dependency (its wasm is huge and this path is rare); if it
// isn't installed the dynamic import throws and the caller surfaces an honest "couldn't convert"
// error rather than a silent drop. Kept in its own function so the primary path never touches it.
async function transcodeViaFfmpeg(file) {
  // Runtime-computed specifier + @vite-ignore so the bundler does NOT try to resolve @ffmpeg/ffmpeg at
  // build time (it is intentionally not a hard dependency). If it isn't installed this import throws
  // and the caller surfaces an honest error — never a silent drop.
  const ffmpegSpecifier = '@ffmpeg/ffmpeg';
  const { FFmpeg } = await import(/* @vite-ignore */ ffmpegSpecifier);
  const ff = new FFmpeg();
  await ff.load();
  const inName = 'in' + (String(file.name || '').match(/\.[^.]+$/) || ['.dat'])[0];
  await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  await ff.exec(['-i', inName, '-b:a', `${MP3_KBPS}k`, '-f', 'mp3', 'out.mp3']);
  const data = await ff.readFile('out.mp3');
  const base = String(file.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
  const out = new File([data], base, { type: 'audio/mpeg' });
  if (!out.size) throw new Error('empty ffmpeg mp3 output');
  return out;
}

// Transcode any browser-undecodable-or-non-web audio File to a 128kbps mp3 File. decodeAudioData →
// lamejs is the default; ffmpeg.wasm is the last resort when the browser can't decode at all. THROWS
// on total failure — the caller (image-drop.js) turns that into a visible uploadError, never a silent
// vanish. onProgress(0..1) is optional (encode is fast enough that we don't wire it today).
export async function transcodeToMp3(file /*, { onProgress } = {} */) {
  const bytes = await file.arrayBuffer();
  let audioBuf = null;
  try {
    // Hand decode a PRIVATE copy — decodeAudioData may detach the buffer, and we still need the
    // original bytes for the ffmpeg fallback if decode throws.
    audioBuf = await decodeToPcm(bytes.slice(0));
  } catch (decodeErr) {
    // The browser could not decode this codec — try the heavy ffmpeg.wasm path if it's available.
    try {
      return await transcodeViaFfmpeg(file);
    } catch (_ffErr) {
      throw new Error('this audio format could not be converted to mp3');
    }
  }
  return encodePcmToMp3(audioBuf, file.name);
}
