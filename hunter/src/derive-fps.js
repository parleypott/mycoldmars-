// Canonical NTSC frame-rate derivation for FCP7/Premiere XML.
//
// Shared by BOTH FCP7 parsers so they can't drift:
//   • hunter/src/xml-parser.js      — the in-browser import path (querySelector DOM)
//   • hunter/worker/selects-parse-core.js — the selects-ingest worker (@xmldom)
//
// FCP7 XML never stores fractional rates directly: 59.94fps footage is written
// as <timebase>60</timebase><ntsc>TRUE</ntsc>, 29.97 as 30+TRUE, 23.976 as 24+TRUE.
// This maps each NTSC timebase back to the canonical fractional rate the Hunter's
// xml-writer (isNtscRate) emits — the two MUST agree so a write→read round-trip of
// an NTSC sequence preserves its rate, and so the worker and client read the same
// fps for the same export.
//
// History: the client gained the 60→59.94 case (a 59.94 import was being read as a
// flat 60fps, inflating every frame→seconds conversion ~0.1%), but the worker's
// inline copy was never updated and kept reading 60p footage as flat 60 — so the
// ingested corpus carried ~0.1%-inflated source timecodes for all 59.94p clips.
// Consolidating to this one module kills that divergent-weaker copy for good.
export function deriveFps(timebase, ntsc) {
  if (!ntsc) return timebase;
  switch (timebase) {
    case 24: return 23.976;
    case 30: return 29.97;
    case 60: return 59.94;
    default: return timebase;
  }
}
