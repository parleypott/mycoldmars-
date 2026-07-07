// Burma Script Tool — GIF → MP4 TRANSCODE (in-browser, drop-time, WebCodecs).
//
// Johnny's reference GIFs are screen captures of MapKeys/UI motion — a real one runs
// 78MB at 1304×653/12fps. A looping muted <video> is visually identical to a GIF,
// ~10-20× smaller, and decodes on the media pipeline instead of the main thread. So a
// big dropped GIF is transcoded HERE, at drop time, and the mp4 rides the existing
// upload road — the doc gets a ~100-byte .mp4 URL, same BYTES-NEVER-IN-THE-DOC law.
//
// LOADED LAZILY: image-drop.js dynamic-import()s this module only when a big GIF is
// actually dropped, so vite code-splits it (and mp4-muxer) out of the core chunk. Never
// import this statically from anything on the editor's startup path.
//
// FAILURE = THROW. The caller (image-drop.js) catches ANY failure and uploads the
// original GIF exactly as it does today — the transcode is an optimization, never a gate.
//
// WEBCODECS ONLY: ImageDecoder('image/gif') + VideoEncoder are desktop-Chrome APIs.
// Neither exists under bun, so the full transcode is untestable headless — the decision
// gate below is pure and tested; the encode itself needs the live-browser check
// (gif-transcode.test.mjs documents this and pins the gate).

// Below this, a GIF just isn't worth a transcode pass (the base64 road handles it fine
// and <img> loops it natively); above it, the decode-every-frame-forever cost and the
// 10-20× size win both start to matter.
export const GIF_TRANSCODE_MIN_BYTES = 2 * 1024 * 1024;

// Screen-capture content (crisp UI edges, mostly-static regions) compresses beautifully;
// ~3 Mbps at ~1300px wide is transparent for reference material.
export const MP4_BITRATE = 3_000_000;

// Pure: is this mime+size pair a transcode candidate? (Capability lives separately so
// the matrix is testable without WebCodecs.)
export function isGifTranscodeCandidate(mime, sizeBytes) {
  return String(mime || '').toLowerCase() === 'image/gif'
    && Number(sizeBytes) > GIF_TRANSCODE_MIN_BYTES;
}

// Capability gate — env injectable so tests can stub a Chrome-shaped global. All three
// are required: ImageDecoder (gif frame iteration), VideoEncoder (h264), OffscreenCanvas
// (the odd-dimension crop surface).
export function hasGifTranscodeSupport(env = globalThis) {
  return typeof env.ImageDecoder === 'function'
    && typeof env.VideoEncoder === 'function'
    && typeof env.OffscreenCanvas === 'function';
}

export function shouldTranscodeGif(file, env = globalThis) {
  return !!file && isGifTranscodeCandidate(file.type, file.size) && hasGifTranscodeSupport(env);
}

// H.264 4:2:0 requires EVEN width and height (the real MapKeys GIF is 1304×653 — an ODD
// height). We CROP to the floor-even box (1304×652: the bottom pixel row goes) rather
// than scale: scaling to fit an even box resamples EVERY pixel, which visibly softens
// the crisp UI text this content is made of; losing one edge row is invisible.
export function evenDims(width, height) {
  return { width: Math.max(2, Math.floor(width / 2) * 2), height: Math.max(2, Math.floor(height / 2) * 2) };
}

// Pick the smallest H.264 level whose frame-size (macroblocks) and macroblock-rate
// budgets fit — a too-small level makes VideoEncoder.configure throw, a needlessly
// huge one can trip picky decoders. Table: level → [maxFS in MBs, maxMBPS], from
// ITU-T H.264 Annex A. Returns the level_idc hex byte for the codec string.
const AVC_LEVELS = [
  ['1e', 1620, 40500],    // 3.0
  ['1f', 3600, 108000],   // 3.1 — 1304×652 (3362 MBs) lands here
  ['20', 5120, 216000],   // 3.2
  ['28', 8192, 245760],   // 4.0 — 1080p30
  ['2a', 8704, 522240],   // 4.2
  ['32', 22080, 589824],  // 5.0
  ['33', 36864, 983040],  // 5.1 — 4K
];
export function pickAvcLevelHex(width, height, fps) {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * Math.max(1, fps || 1);
  for (const [hex, maxFs, maxMbps] of AVC_LEVELS) {
    if (mbs <= maxFs && mbps <= maxMbps) return hex;
  }
  return '33';
}

// GIF frames with a 0/unset delay are conventionally rendered at ~100ms (browsers clamp
// tiny delays up); µs.
const DEFAULT_FRAME_US = 100_000;

// Decode every GIF frame with its REAL per-frame duration → encode H.264 → mux to a
// fast-start mp4. Returns a File of video/mp4. Throws on anything — caller falls back.
export async function transcodeGifToMp4(file, { onProgress } = {}) {
  // mp4-muxer is small and wasm-free; imported here (not top-level) purely so a unit
  // test importing this module's pure gates never touches it.
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  if (typeof ImageDecoder.isTypeSupported === 'function') {
    const okGif = await ImageDecoder.isTypeSupported('image/gif');
    if (!okGif) throw new Error('ImageDecoder lacks image/gif support');
  }

  const data = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data, type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount || 0;
    if (frameCount < 2) throw new Error('not an animated gif'); // a still: <img> is already optimal

    // First frame carries the dimensions + the fps estimate for the encoder hint.
    const { image: first } = await decoder.decode({ frameIndex: 0 });
    const srcW = first.displayWidth;
    const srcH = first.displayHeight;
    const { width, height } = evenDims(srcW, srcH);
    const frameUs = first.duration || DEFAULT_FRAME_US;
    // Cap at the SOURCE fps — never invent frames the GIF doesn't have (12fps stays 12fps).
    const fps = Math.min(60, Math.max(1, Math.round(1_000_000 / frameUs)));

    // Baseline first (constrained baseline plays anywhere), Main as fallback, then a
    // generous 4.0 pair in case the UA dislikes the computed level.
    const levelHex = pickAvcLevelHex(width, height, fps);
    const candidates = [`avc1.42c0${levelHex}`, `avc1.4d00${levelHex}`, 'avc1.42c028', 'avc1.4d0028'];
    let config = null;
    for (const codec of candidates) {
      const probe = { codec, width, height, bitrate: MP4_BITRATE, framerate: fps };
      const support = await VideoEncoder.isConfigSupported(probe).catch(() => null);
      if (support?.supported) { config = probe; break; }
    }
    if (!config) { first.close(); throw new Error('no supported h264 encoder config'); }

    const target = new ArrayBufferTarget();
    // fastStart in-memory: the moov lands up front so the <video> in the rack starts
    // painting off preload=metadata without a range-request dance against the CDN.
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' });

    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encodeError = e; },
    });
    encoder.configure(config);

    // Odd-dimension GIFs route through a crop canvas; even ones encode the decoded
    // VideoFrame directly (no pixel copy).
    const needsCrop = width !== srcW || height !== srcH;
    const canvas = needsCrop ? new OffscreenCanvas(width, height) : null;
    const ctx = canvas ? canvas.getContext('2d') : null;

    let ts = 0; // µs, accumulated from REAL per-frame durations (VFR-safe)
    const keyEvery = Math.max(1, Math.round(fps * 2)); // a keyframe ~every 2s keeps seeks/loops snappy
    for (let i = 0; i < frameCount; i++) {
      if (encodeError) throw encodeError;
      const { image } = i === 0 ? { image: first } : await decoder.decode({ frameIndex: i });
      const duration = image.duration || DEFAULT_FRAME_US;
      let frame;
      if (needsCrop) {
        ctx.drawImage(image, 0, 0); // draws at natural size; the canvas edge crops the odd row
        frame = new VideoFrame(canvas, { timestamp: ts, duration });
      } else {
        // Re-stamp with OUR accumulated timestamp — ImageDecoder's stamps are not
        // guaranteed cumulative-contiguous, and the muxer trusts what we hand it.
        frame = new VideoFrame(image, { timestamp: ts, duration });
      }
      image.close();
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      ts += duration;
      onProgress?.((i + 1) / frameCount);
      // Backpressure: never let a 78MB GIF race hundreds of decoded frames ahead of
      // the encoder — that's gigabytes of raw RGBA in flight.
      while (encoder.encodeQueueSize > 2) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();

    const name = String(file.name || 'reference').replace(/\.gif$/i, '') + '.mp4';
    const out = new File([target.buffer], name, { type: 'video/mp4' });
    if (!out.size) throw new Error('empty mp4 output');
    return out;
  } finally {
    try { decoder.close(); } catch {}
  }
}
