// reef-render.ts — stitch Google satellite tiles into clean 16:9 reef frames.
// Bake once, commit the JPEGs, play them as a flicker loop. No runtime API.
//
//   bun tools/reef-render.ts test            # render a few probe frames to /tmp/reefprobe
//   bun tools/reef-render.ts all             # render the full catalog → public/reef/frames
//
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const TILE = 256;
const OUT_W = 2560, OUT_H = 1440;              // 16:9 — wider FOV: room to zoom out + pan in the player
const SERVERS = [0, 1, 2, 3];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// ---- web mercator -----------------------------------------------------------
function lonToGlobalPx(lon: number, z: number) {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}
function latToGlobalPx(lat: number, z: number) {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

async function fetchTile(x: number, y: number, z: number, tries = 4): Promise<Buffer | null> {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xx = ((x % n) + n) % n;
  for (let t = 0; t < tries; t++) {
    const s = SERVERS[(xx + y + t) % SERVERS.length];
    try {
      const r = await fetch(`https://mt${s}.google.com/vt/lyrs=s&x=${xx}&y=${y}&z=${z}`, {
        headers: { "User-Agent": UA, Referer: "https://www.google.com/maps" },
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {}
    await new Promise((f) => setTimeout(f, 200 * (t + 1)));
  }
  return null;
}

async function renderFrame(lat: number, lon: number, z: number): Promise<Buffer> {
  const cx = lonToGlobalPx(lon, z), cy = latToGlobalPx(lat, z);
  const left = Math.round(cx - OUT_W / 2), top = Math.round(cy - OUT_H / 2);
  const tL = Math.floor(left / TILE), tR = Math.floor((left + OUT_W - 1) / TILE);
  const tT = Math.floor(top / TILE), tB = Math.floor((top + OUT_H - 1) / TILE);

  const jobs: Promise<{ x: number; y: number; buf: Buffer | null }>[] = [];
  for (let tx = tL; tx <= tR; tx++)
    for (let ty = tT; ty <= tB; ty++)
      jobs.push(fetchTile(tx, ty, z).then((buf) => ({ x: tx, y: ty, buf })));
  const tiles = await Promise.all(jobs);

  const canvasW = (tR - tL + 1) * TILE, canvasH = (tB - tT + 1) * TILE;
  const layers = tiles
    .filter((t) => t.buf)
    .map((t) => ({ input: t.buf!, left: (t.x - tL) * TILE, top: (t.y - tT) * TILE }));

  const stitched = sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: { r: 12, g: 22, b: 30 } },
  }).composite(layers);

  return await stitched
    .extract({ left: left - tL * TILE, top: top - tT * TILE, width: OUT_W, height: OUT_H })
    .modulate({ saturation: 1.06 })           // a touch more life in the turquoise
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

// ---- catalog ----------------------------------------------------------------
// Tuned to Johnny's references: bright reef demarcation + Google bathymetry
// water, a mix of pure atolls, fringing reefs, reef-coasts, and bommie fields.
// [name, lat, lon, zoom]  — zoom = google tile zoom (higher = tighter)
type Reef = [string, number, number, number];
const CATALOG: Reef[] = [
  // — clean atoll rings against open water (ref1 vibe) —
  ["Rangiroa W",        -15.02, -147.88, 12],
  ["Fakarava",          -16.30, -145.62, 11],
  ["Tikehau",           -15.00, -148.18, 12],
  ["Toau",              -15.93, -145.90, 12],
  ["Kauehi",            -15.83, -145.13, 12],
  ["Tahanea",           -16.85, -144.70, 11],
  ["Raroia",            -16.05, -142.45, 12],
  ["Aratika",           -15.50, -145.50, 12],
  ["Kaukura",           -15.78, -146.73, 12],
  ["Arutua",            -15.27, -146.78, 12],
  ["Apataki",           -15.55, -146.40, 12],
  ["Manihi",            -14.40, -146.03, 12],
  ["Ahe",               -14.48, -146.33, 12],
  ["Takapoto",          -14.63, -145.20, 12],
  ["Takaroa",           -14.45, -145.03, 12],
  // — Maldives: bright shallow turquoise (ref vibe, brighter water) —
  ["North Male",          4.40,   73.45, 12],
  ["Baa Atoll",           5.20,   73.05, 11],
  ["Rasdhoo",             4.27,   72.99, 13],
  ["Goidhoo",             4.95,   72.90, 12],
  ["Vaavu",               3.40,   73.50, 12],
  ["Felidhoo",            3.45,   73.55, 13],
  // — fringing / reef-coast with LAND (ref2/3/4/5/7 vibe) —
  ["Bora Bora",         -16.50, -151.74, 13],
  ["Maupiti",           -16.45, -152.26, 13],
  ["Tahaa-Raiatea",     -16.68, -151.45, 12],
  ["Huahine",           -16.74, -150.97, 13],
  ["Moorea",            -17.53, -149.83, 13],
  ["Aitutaki",          -18.86, -159.78, 13],
  ["Mayotte",           -12.84,   45.13, 12],
  ["Mauritius NW",      -20.05,   57.52, 13],
  ["New Caledonia SW",  -22.30,  166.35, 12],
  ["Ouvea",             -20.58,  166.48, 12],
  ["Lifou",             -20.90,  167.25, 12],
  ["Grande Terre Reef", -20.10,  164.20, 12],
  ["Aldabra",            -9.41,   46.36, 12],
  ["Astove",            -10.08,   47.74, 13],
  ["Cosmoledo",          -9.71,   47.55, 12],
  ["Farquhar",          -10.10,   51.17, 12],
  ["St Joseph",          -5.43,   53.34, 13],
  ["Desroches",          -5.69,   53.66, 13],
  // — Caribbean / Atlantic —
  ["Lighthouse Reef",    17.31,  -87.53, 12],
  ["Glover's Reef",      16.83,  -87.80, 12],
  ["Turneffe",           17.33,  -87.84, 12],
  ["Banco Chinchorro",   18.60,  -87.33, 12],
  ["Alacranes",          22.45,  -89.68, 12],
  ["Exuma Cays",         24.30,  -76.55, 11],
  ["Andros",             24.70,  -77.80, 11],
  ["Los Roques",         11.85,  -66.75, 12],
  // — Pacific atolls + bommie fields (ref6 vibe) —
  ["Palau Rock Is.",      7.27,  134.40, 13],
  ["Chuuk Lagoon",        7.40,  151.78, 11],
  ["Bikini Atoll",       11.60,  165.38, 12],
  ["Rongelap",           11.35,  166.85, 12],
  ["Majuro",              7.11,  171.10, 12],
  ["Ailinginae",         11.15,  166.45, 12],
  ["Ulithi",              9.96,  139.65, 12],
  ["Palmyra",             5.88, -162.08, 13],
  ["Caroline Atoll",     -9.93, -150.21, 13],
  ["Raja Ampat",         -0.55,  130.65, 12],
  ["Wakatobi",           -5.55,  123.75, 12],
  ["Great Astrolabe",   -18.75,  178.55, 12],
  ["Beqa Lagoon",       -18.40,  178.13, 12],
];

// ---- run --------------------------------------------------------------------
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function run() {
  const mode = process.argv[2] || "test";
  if (mode === "test") {
    await mkdir("/tmp/reefprobe", { recursive: true });
    const probes = CATALOG.slice(0, 6);
    for (const [name, lat, lon, z] of probes) {
      const buf = await renderFrame(lat, lon, z);
      const p = `/tmp/reefprobe/${slug(name)}.jpg`;
      await writeFile(p, buf);
      console.log("probe", p, (buf.length / 1024 | 0) + "kb");
    }
    return;
  }
  // all — two variants per reef (wide @ z, tight @ z+1) for density + rhythm
  const dir = "public/reef/frames";
  await mkdir(dir, { recursive: true });
  const manifest: { file: string; name: string; z: number; w: number; h: number }[] = [];
  // build the full job list first
  const jobs: { name: string; lat: number; lon: number; z: number; tag: string }[] = [];
  for (const [name, lat, lon, z] of CATALOG) {
    jobs.push({ name, lat, lon, z, tag: "w" });          // wide
    jobs.push({ name, lat, lon, z: z + 1, tag: "t" });   // tight on the reef edge
  }
  let i = 0;
  for (const j of jobs) {
    i++;
    const file = `${String(i).padStart(3, "0")}-${slug(j.name)}-${j.tag}.jpg`;
    try {
      const buf = await renderFrame(j.lat, j.lon, j.z);
      // skip near-empty frames (open water / imagery gaps) — under ~70kb = dud
      // (30000 was tuned for 1600x900; 2560x1440 is ~2.56x the pixels, so scale the floor)
      if (buf.length < 70000) { console.log(`[${i}/${jobs.length}] SKIP dud ${file} ${(buf.length/1024|0)}kb`); continue; }
      await writeFile(`${dir}/${file}`, buf);
      manifest.push({ file, name: j.name, z: j.z, w: OUT_W, h: OUT_H });
      console.log(`[${i}/${jobs.length}] ${file} ${(buf.length / 1024 | 0)}kb`);
    } catch (e) {
      console.log(`[${i}/${jobs.length}] FAIL ${j.name}:`, (e as Error).message);
    }
  }
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 0));
  console.log(`\ndone — ${manifest.length} frames → ${dir}`);
}

run();
