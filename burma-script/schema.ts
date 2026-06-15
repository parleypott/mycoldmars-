// Burma Script Tool — block schema (the single source of truth for the doc model)
// A script = an ordered list of typed blocks. Each block has a stable id so it can be
// rearranged, checked off, and synced without losing identity. Writing surface (VO/ONCAM)
// holds inline "spans" for {TK} research requests, [bracket] visual direction, and
// fact-check highlights — these are inline objects, NOT separate blocks (per JH).

export type ChapterGenre =
  | "coldopen" | "history" | "ground" | "inquiry" | "latm" /* look-at-the-map */ | "other";

export type BlockType =
  | "chapter" | "scene"
  | "vo" | "oncam" | "sot" | "broll"
  | "map-need" | "archive-req" | "note" | "jh-note"
  | "bin"; // holding bin: unplaced SOTs / "words words words"

// VO has a THREE-state status (JH's elegant tri-checkbox): not started → recorded → in the edit
export type VOStatus = "todo" | "recorded" | "in-edit";

// A timecode cue against one of the three day string-outs.
export interface Timecode {
  day: 1 | 2 | 3 | null;     // null = couldn't determine
  tc: string;                // "HH:MM:SS:FF"
  tcOut?: string;            // optional range end
  ambiguous: boolean;        // true => no DAY in context, needs JH to resolve (never guessed)
  raw: string;               // original text it came from
}

// Inline span inside writing-surface text (VO/ONCAM). Offsets index into block.text.
export type SpanKind = "tk" | "visual" | "factcheck";
export interface InlineSpan {
  id: string;
  kind: SpanKind;
  start: number;             // char offset into block.text
  end: number;
  raw: string;               // the original {TK ...} or [ ... ] content
  // workshop state (filled by the side-hub / Claude chat later):
  resolved?: boolean;
  options?: string[];        // 3–5 proposed lines
  chosen?: string;
  sources?: { label: string; url: string }[];
  chatLog?: { role: "jh" | "parley"; text: string }[];
}

export interface Block {
  id: string;
  type: BlockType;
  // structure
  genre?: ChapterGenre;      // chapters only
  title?: string;            // chapter/scene/service-box label
  depth?: number;            // chapter=0, scene=1 (for outline view)
  // writing surface
  text?: string;             // VO / ONCAM / note prose
  voStatus?: VOStatus;       // VO only
  spans?: InlineSpan[];      // inline {TK}/[visual]/factcheck objects within text
  // edit direction
  timecode?: Timecode;       // SOT / B-roll
  speaker?: string;          // SOT: "Jack" / "JH" / "Drew"
  // editor workflow
  done?: boolean;            // SOT/note "done → green"
  width?: "full" | "half";   // for the drag-to-A/V two-column pairing
  pairId?: string;           // links a VO/ONCAM (left) to a B-roll (right) when side-by-side
  // provenance
  rawSource?: string;        // the original script text this was parsed from
}

export interface ScriptDoc {
  version: number;
  title: string;
  sequences: { day: 1 | 2 | 3; name: string }[]; // the box at the top of the script
  blocks: Block[];
  // integrity invariant: every block.id is unique & non-empty; SOT/broll timecodes valid.
}

export const DAY_SEQUENCES: ScriptDoc["sequences"] = [
  { day: 1, name: "260331 DAY 1 - MULTICAM STRINGOUT" },
  { day: 2, name: "260401 DAY 2 - SYNCED STRINGOUT" },
  { day: 3, name: "260402 - DAY 3 - ALL FOOTAGE - Syncaila synced" },
];
