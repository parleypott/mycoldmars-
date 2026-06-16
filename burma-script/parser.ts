// Burma Script Tool — the importer. Turns JH's messy script text into structured blocks.
// Goal (his words): "develop some context and flexibility with the goal of standardizing it."
// Never guesses a DAY it isn't sure of — flags it instead.

import { Block, Timecode, InlineSpan, ScriptDoc, ChapterGenre, DAY_SEQUENCES } from "./schema";

let _id = 0;
const uid = (p: string) => `${p}_${(++_id).toString(36)}_${(_id * 2654435761 % 100000).toString(36)}`;

// Timecode detector. The old /\b…\b/ word-boundary form MISSED any timecode glued to a
// backslash-escape or stray bracket (e.g. "\02:02:01:07", "[02:02:01:07", "]01:57:38:07")
// because the adjacent non-word char defeated \b. Johnny lost real timecodes to this.
// Two guards, each load-bearing and each tested against the real script's edge cases:
//   lookbehind (?<!\d)(?<!\d:) — reject a DIGIT, or a "digit:" pair, immediately before. This
//                            rejects a sub-field of a longer numeric run ("102:02:01:070",
//                            "1:02:02:01:07") WITHOUT rejecting a LABEL colon — so the common
//                            "ALT:03:19:40:07" / "DAY 2 SOT:01:08:54:15" forms still match.
//                            (Bug found: a blanket (?<![\d:]) also kills the label-colon form
//                            and silently dropped the leading TC of every "LABEL:tc" line.)
//   lookahead  (?!:?\d)    — reject only if what follows continues the run as ":<digit>" (a 5th
//                            HH:MM:SS:FF:FF field) or a bare digit. A trailing colon before a
//                            NON-digit ("04:36:46:01: long shot") is the "timecode: description"
//                            form and MUST be kept. (A blanket (?![\d:]) dropped every such line.)
// Net: catches HH:MM:SS:FF glued to a backslash, bracket, paren, quote, letter, em-dash, or a
// label-colon, while still rejecting genuine longer numeric runs.
//
// TWO regex instances on purpose. TC (global) is for matchAll/extraction; TC_HAS (non-global)
// is for .test() routing. A SINGLE /g regex shared between matchAll and .test() is THE bug that
// was losing timecodes: RegExp.prototype.test() on a /g regex advances .lastIndex, so
// consecutive .test() calls alternate true/false and silently SKIP every other timecode-bearing
// paragraph — dropping real SOTs into the holding bin. Never call .test() on the /g instance.
export const TC = /(?<!\d)(?<!\d:)(\d{2}:\d{2}:\d{2}:\d{2})(?!:?\d)/g;
export const TC_HAS = /(?<!\d)(?<!\d:)(\d{2}:\d{2}:\d{2}:\d{2})(?!:?\d)/; // non-global — safe for .test()
/** Find every HH:MM:SS:FF in a string, bracket/backslash/colon-adjacent included. */
export const findTimecodes = (s: string): string[] => [...s.matchAll(TC)].map((m) => m[1]);
const DAY_RE = /\bDAY\s*([123])\b/i;

// Chapter/scene titles must read as TITLES, not blown-up paragraphs. The raw CH:/SCENE:
// line often carries a whole sentence of JH's thinking ("COLD OPEN FROM JH: Still thinking
// what this should be. But let's cut in some footage…"). At 38px that becomes a wall of
// hero text on screen (punch-list note). Cut to the first heading CLAUSE: stop at the first
// sentence end, or the first label-colon's clause, and cap to a tight heading length. The
// full raw line still lives in rawSource, so nothing is lost.
function headingClause(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  // Prefer a leading ALL-CAPS / label clause before a colon used as a label
  // ("COLD OPEN FROM JH: …" → "COLD OPEN FROM JH"), but only if that clause is short.
  const colon = t.indexOf(":");
  if (colon > 0 && colon <= 42) {
    const head = t.slice(0, colon).trim();
    // Treat as a real label only if it's mostly uppercase / a short title (not prose).
    if (head.length >= 3 && head === head.toUpperCase().replace(/[^A-Z0-9 .'’/&-]/g, (c) => c)) {
      return head.slice(0, 60);
    }
  }
  // Otherwise stop at the first sentence end.
  const sent = t.search(/[.!?](\s|$)/);
  if (sent > 0 && sent <= 60) t = t.slice(0, sent);
  return t.slice(0, 60).trim();
}

function genreOf(label: string): ChapterGenre {
  const u = label.toUpperCase();
  if (u.includes("COLD OPEN")) return "coldopen";
  if (u.includes("HISTORY")) return "history";
  if (u.includes("GROUND")) return "ground";
  if (u.includes("INQUIRY")) return "inquiry";
  if (u.includes("LOOK AT THIS MAP") || u.includes("LATM") || u.includes("MAP ROOM") || u.includes("MAP ON CAM")) return "latm";
  return "other";
}

// Pull inline {TK ...} and [ ... ] spans out of a writing-surface string.
function extractSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const tk = /\{[^{}]*\}/g; let m: RegExpExecArray | null;
  while ((m = tk.exec(text))) {
    // {fc …}/{fact …} = a fact-check ask (verify a claim); everything else in braces is a
    // {tk …} writing ask. Distinct kinds drive distinct markers + Workshop behaviour.
    const isFc = /^\{\s*(?:fc|fact)\b/i.test(m[0]);
    spans.push({ id: uid(isFc ? "fc" : "tk"), kind: isFc ? "factcheck" : "tk", start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  const br = /\[[^\[\]]*\]/g;
  while ((m = br.exec(text))) spans.push({ id: uid("vis"), kind: "visual", start: m.index, end: m.index + m[0].length, raw: m[0] });
  return spans.sort((a, b) => a.start - b.start);
}

// Resolve a DAY for a timecode using nearest explicit DAY in the surrounding window.
function timecodeFrom(raw: string, contextDay: 1 | 2 | 3 | null): Timecode {
  // matchAll ignores/maintains lastIndex internally, but reset defensively anyway.
  TC.lastIndex = 0;
  const all = [...raw.matchAll(TC)].map((x) => x[1]);
  const localDay = raw.match(DAY_RE);
  const day = localDay ? (Number(localDay[1]) as 1 | 2 | 3) : contextDay;
  return {
    day,
    tc: all[0],
    tcOut: all[1],
    ambiguous: day === null,
    raw: raw.trim().slice(0, 200),
  };
}

export function parseScript(srcText: string): { doc: ScriptDoc; stats: any; ambiguous: Timecode[] } {
  _id = 0;
  // JH separates beats by blank lines; treat each non-empty paragraph as a unit.
  const paras = srcText.split(/\n{1,}/).map((s) => s.trim()).filter(Boolean);
  const blocks: Block[] = [];
  const ambiguous: Timecode[] = [];
  let contextDay: 1 | 2 | 3 | null = null;

  for (const p of paras) {
    const dm = p.match(DAY_RE);
    if (dm) contextDay = Number(dm[1]) as 1 | 2 | 3; // update running day context

    // --- structural ---
    if (/^CH:/i.test(p)) {
      const title = headingClause(p.replace(/^CH:\s*/i, "").split(/\n/)[0]);
      blocks.push({ id: uid("ch"), type: "chapter", genre: genreOf(p), title, depth: 0, rawSource: p });
      continue;
    }
    if (/^(✨|⁃?\s*SCENE:|SCENE:)/i.test(p) || /\bSCENE:/i.test(p.slice(0, 12))) {
      const title = headingClause(p.replace(/^[✨⁃\s]*SCENE:\s*/i, "").split(/\n/)[0]);
      blocks.push({ id: uid("sc"), type: "scene", title, depth: 1, rawSource: p });
      continue;
    }
    // --- service boxes ---
    // A bare [MAP] tag inside VO narration ("[MAP] + VO: ...") is a visual cue, NOT a
    // standalone mapping-needs service block — let it fall through to VO so it isn't
    // swept into the consolidated SERVICE NEEDS box.
    if (/\[Mapping data needs/i.test(p) || (/\[MAP\b/i.test(p) && !/\bVO:/i.test(p)) || /Map Data Need/i.test(p)) {
      blocks.push({ id: uid("map"), type: "map-need", title: "Mapping data needs", text: p, rawSource: p });
      continue;
    }
    if (/\[Archive request/i.test(p) || /\bARCHIVE:/i.test(p)) {
      blocks.push({ id: uid("arc"), type: "archive-req", title: "Archive request", text: p, rawSource: p });
      continue;
    }
    // --- editor note ---
    if (/!\s*NOTE/i.test(p) || /^\\?\[?!NOTE/i.test(p)) {
      blocks.push({ id: uid("note"), type: "note", text: p, done: false, rawSource: p });
      continue;
    }
    // --- SOT / timecode-bearing direction ---
    // Use the NON-global TC_HAS for routing — never the /g TC (its .lastIndex would advance
    // and make every other timecode paragraph fall through to the bin).
    if (TC_HAS.test(p)) {
      const tcode = timecodeFrom(p, contextDay);
      if (tcode.ambiguous) ambiguous.push(tcode);
      const speaker = /JACK|Jack/.test(p) ? "Jack" : /DREW|Drew/.test(p) ? "Drew" : /JH|Johnny/.test(p) ? "JH" : undefined;
      // Footage cue detector. "roll" MUST be word-bounded: the old /\[.*roll/ matched the
      // bare substring inside common prose words ("cont​rolled", "pat​rolled", "en​rolled",
      // "pay​roll"), so any bracketed-timecode SOT mentioning a "controlled"/"patrolled"
      // border (constant in this military/border story) was silently misfiled as B-ROLL —
      // a real soundbite vanishing from the producer's SOT list. \broll\b keeps the genuine
      // "[02:02:01:07] aerial roll" footage cue while rejecting the substring false positives.
      const isBroll = /b[\s-]?roll|\[.*\broll\b|establish|montage/i.test(p) && !/SOT|ONCAM|ON CAM|JH\s*[":]/i.test(p);
      blocks.push({
        id: uid(isBroll ? "broll" : "sot"),
        type: isBroll ? "broll" : "sot",
        timecode: tcode, speaker, done: false, width: "full",
        text: p.slice(0, 400), rawSource: p,
      });
      continue;
    }
    // --- VO / ONCAM writing surface ---
    // Catch VO lines that lead with a visual cue too, e.g. "-[MAP] + VO: our story…".
    if (/^-?\s*(\[[^\]]*\]\s*\+?\s*)?VO:/i.test(p) || /\bVO:/i.test(p.slice(0, 8))) {
      const text = p.replace(/^-?\s*/, "").replace(/^VO:\s*/i, "");
      blocks.push({ id: uid("vo"), type: "vo", text, voStatus: "todo", spans: extractSpans(text), rawSource: p });
      continue;
    }
    if (/ON\s?CAM|MONOLOGUE/i.test(p)) {
      blocks.push({ id: uid("oncam"), type: "oncam", text: p, spans: extractSpans(p), rawSource: p });
      continue;
    }
    if (/^Notes? from JH|^NOTES?:/i.test(p)) {
      blocks.push({ id: uid("jh"), type: "jh-note", text: p, rawSource: p });
      continue;
    }
    // --- fallback: prose with {TK}/[..] => treat as VO-ish writing; else holding bin ---
    if (/\{|\[/.test(p)) {
      blocks.push({ id: uid("vo"), type: "vo", text: p, voStatus: "todo", spans: extractSpans(p), rawSource: p });
    } else {
      blocks.push({ id: uid("bin"), type: "bin", text: p, rawSource: p });
    }
  }

  const by = (t: string) => blocks.filter((b) => b.type === t).length;
  const stats = {
    total: blocks.length,
    chapters: by("chapter"), scenes: by("scene"),
    vo: by("vo"), oncam: by("oncam"), sot: by("sot"), broll: by("broll"),
    mapNeeds: by("map-need"), archive: by("archive-req"), notes: by("note"), bin: by("bin"),
    tkSpans: blocks.reduce((n, b) => n + (b.spans?.filter((s) => s.kind === "tk").length || 0), 0),
    visualSpans: blocks.reduce((n, b) => n + (b.spans?.filter((s) => s.kind === "visual").length || 0), 0),
    ambiguousTimecodes: ambiguous.length,
  };

  const doc: ScriptDoc = { version: 1, title: "Burma — The Human Element", sequences: DAY_SEQUENCES, blocks };
  return { doc, stats, ambiguous };
}
