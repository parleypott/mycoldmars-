// Burma Script Tool — app scaffold (PLAN task 1).
// A Vite/Preact page served at /burma-script/app/. "Load sample script" runs the
// real parser.ts over the real script text and renders the blocks READ-ONLY,
// inside the locked WP-01 frame (Tufte page · Teenage Engineering instrument).
// Later tasks layer interaction onto these same components.

import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { parseScript } from "../../parser.ts";
import sampleScript from "../../sample-script.txt?raw";

const WPM = 160; // JH reads ~160 wpm for VO timing

// ---- derived telemetry off the parsed doc ----
function telemetry(doc, stats) {
  const words = doc.blocks.reduce((n, b) => {
    if ((b.type === "vo" || b.type === "oncam") && b.text) {
      return n + b.text.trim().split(/\s+/).filter(Boolean).length;
    }
    return n;
  }, 0);
  const mins = Math.max(1, Math.round(words / WPM));
  return { words, mins, blocks: stats.total };
}

// ---- read-only block renderers, one per type ----
const GENRE = {
  coldopen: { c: "var(--g-coldopen)", label: "COLD OPEN" },
  history: { c: "var(--g-history)", label: "HISTORY" },
  ground: { c: "var(--g-ground)", label: "GROUND" },
  inquiry: { c: "var(--g-inquiry)", label: "INQUIRY" },
  latm: { c: "var(--g-latm)", label: "LOOK AT THE MAP" },
  other: { c: "var(--g-other)", label: "SECTION" },
};

// VO/ONCAM text with {TK} and [visual] spans tinted (read-only; clickable = later task)
function Prose({ text, spans }) {
  if (!spans || !spans.length) return <>{text}</>;
  const out = [];
  let cur = 0;
  for (const s of spans) {
    if (s.start > cur) out.push(text.slice(cur, s.start));
    const cls = s.kind === "tk" ? "span-tk" : s.kind === "visual" ? "span-visual" : "";
    out.push(<span class={cls}>{text.slice(s.start, s.end)}</span>);
    cur = s.end;
  }
  if (cur < text.length) out.push(text.slice(cur));
  return <>{out}</>;
}

function TimecodeMeta({ block }) {
  const tc = block.timecode;
  return (
    <div class="meta mono">
      {block.speaker && <span class="role">{block.speaker}</span>}
      {tc?.tc && <span class="tc">{tc.tc}{tc.tcOut ? `–${tc.tcOut}` : ""}</span>}
      <span class={"day" + (tc?.ambiguous ? " tc-amb" : "")}>
        {tc?.ambiguous ? "DAY ?" : `DAY ${tc?.day ?? "?"}`}
      </span>
    </div>
  );
}

function BlockView({ block }) {
  switch (block.type) {
    case "chapter": {
      const g = GENRE[block.genre] || GENRE.other;
      return (
        <div class="block b-chapter" style={{ color: g.c }}>
          <span class="tag" style={{ background: g.c }}>{g.label}</span>
          <h2 style={{ color: "var(--ink)" }}>{block.title}</h2>
          <div class="rule" />
        </div>
      );
    }
    case "scene":
      return (
        <div class="block b-scene">
          <span class="lab">Scene</span>
          <h3>{block.title}</h3>
        </div>
      );
    case "vo":
      return (
        <div class="block b-vo">
          <span class="kind">VO</span>
          <Prose text={block.text} spans={block.spans} />
        </div>
      );
    case "oncam":
      return (
        <div class="block b-oncam">
          <span class="kind">On Camera</span>
          <Prose text={block.text} spans={block.spans} />
        </div>
      );
    case "sot":
      return (
        <div class="block b-sot">
          <TimecodeMeta block={block} />
          <div class="body">{block.text}</div>
        </div>
      );
    case "broll":
      return (
        <div class="block b-broll">
          <TimecodeMeta block={block} />
          <div class="body">{block.text}</div>
        </div>
      );
    case "map-need":
      return (
        <div class="block b-map-need">
          <span class="lab">Mapping data needs</span>
          {block.text}
        </div>
      );
    case "archive-req":
      return (
        <div class="block b-archive-req">
          <span class="lab">Archive request</span>
          {block.text}
        </div>
      );
    case "note":
      return <div class="block b-note">{block.text}</div>;
    case "jh-note":
      return <div class="block b-jh-note">{block.text}</div>;
    case "bin":
      return <div class="block b-bin">{block.text}</div>;
    default:
      return <div class="block b-bin">{block.text}</div>;
  }
}

// ---- OUTLINE VIEW (PLAN task 2) ----
// Collapse the document to its CH:/SCENE: spine: genre-colored chapters, indented
// scenes, and a per-section block tally. Chapter counts roll up their scenes.
function emptyCounts() {
  return { total: 0, vo: 0, oncam: 0, sot: 0, broll: 0, service: 0 };
}
function tallyBlock(counts, b) {
  counts.total++;
  if (b.type === "vo") counts.vo++;
  else if (b.type === "oncam") counts.oncam++;
  else if (b.type === "sot") counts.sot++;
  else if (b.type === "broll") counts.broll++;
  else counts.service++; // map-need / archive-req / note / jh-note / bin
}

function buildOutline(blocks) {
  const chapters = [];
  let curCh = null;
  let curScene = null;
  const openChapter = (block, id, genre, title) => {
    curCh = { block, id, genre, title, scenes: [], counts: emptyCounts() };
    curScene = null;
    chapters.push(curCh);
  };
  for (const b of blocks) {
    if (b.type === "chapter") {
      openChapter(b, b.id, b.genre || "other", b.title);
      continue;
    }
    if (b.type === "scene") {
      if (!curCh) openChapter(null, "pre", "other", "Front matter");
      curScene = { block: b, id: b.id, title: b.title, counts: emptyCounts() };
      curCh.scenes.push(curScene);
      continue;
    }
    if (!curCh) openChapter(null, "pre", "other", "Front matter");
    tallyBlock(curCh.counts, b);           // chapter total = rollup incl. scenes
    if (curScene) tallyBlock(curScene.counts, b);
  }
  return chapters;
}

const COUNT_LABELS = [
  ["vo", "VO"], ["oncam", "OC"], ["sot", "SOT"], ["broll", "B"], ["service", "SVC"],
];
function CountChips({ counts }) {
  return (
    <span class="ol-counts mono">
      <b class="ol-total">{counts.total}</b>
      {COUNT_LABELS.filter(([k]) => counts[k] > 0).map(([k, lab]) => (
        <span class="ol-chip">{counts[k]}<i>{lab}</i></span>
      ))}
    </span>
  );
}

function Outline({ blocks, onJump }) {
  const tree = useMemo(() => buildOutline(blocks), [blocks]);
  return (
    <div id="outline">
      <div class="ol-head mono">Outline · spine</div>
      {tree.map((ch) => {
        const g = GENRE[ch.genre] || GENRE.other;
        return (
          <div class="ol-chapter" key={ch.id}>
            <button class="ol-row ol-ch" onClick={() => onJump(ch.id)} disabled={ch.id === "pre"}>
              <span class="ol-bar" style={{ background: g.c }} />
              <span class="ol-tag mono" style={{ color: g.c }}>{g.label}</span>
              <span class="ol-title">{ch.title}</span>
              <CountChips counts={ch.counts} />
            </button>
            {ch.scenes.map((sc) => (
              <button class="ol-row ol-sc" key={sc.id} onClick={() => onJump(sc.id)}>
                <span class="ol-bar ghost" style={{ background: g.c }} />
                <span class="ol-sclab mono">SCENE</span>
                <span class="ol-title">{sc.title}</span>
                <CountChips counts={sc.counts} />
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Telem({ tel, loaded, view }) {
  return (
    <div class="telem">
      {loaded ? (
        <>
          <span class="t live">WORDS <b>{tel.words.toLocaleString()}</b></span>
          <span class="t">READ <b>{tel.mins}m</b></span>
          <span class="t">BLOCKS <b>{tel.blocks}</b></span>
          <span class="t">% DONE <b>0</b></span>
          <span class="t">VIEW <b>{view === "outline" ? "OUTLINE" : "DOCUMENT"}</b></span>
        </>
      ) : (
        <span class="t">STANDBY · NO SCRIPT LOADED</span>
      )}
    </div>
  );
}

function FnBay({ view, onOutline, enabled }) {
  // Function-key bay — chrome shell. F2 OUTLINE is live; the rest wire in later tasks.
  const keys = [
    ["F1", "SAVE", null], ["F2", "OUTLINE", "outline"], ["F3", "COMMENT", null],
    ["F4", "REFERENCE", null], ["F5", "FOCUS", null], ["F7", "EXPORT", null],
  ];
  return (
    <div class="fnbay">
      {keys.map(([k, label, fn]) => {
        const live = fn === "outline" && enabled;
        const active = fn === "outline" && view === "outline";
        return (
          <button
            class={"fk" + (live ? "" : " ghost") + (active ? " active" : "")}
            disabled={!live}
            onClick={live ? onOutline : undefined}
          >
            <span class="key">{k}</span><b>{label}</b>
          </button>
        );
      })}
    </div>
  );
}

function App() {
  const [parsed, setParsed] = useState(null);
  const [view, setView] = useState("doc"); // "doc" | "outline"
  const tel = useMemo(
    () => (parsed ? telemetry(parsed.doc, parsed.stats) : null),
    [parsed]
  );

  function load() {
    setParsed(parseScript(sampleScript));
  }

  function toggleOutline() {
    setView((v) => (v === "outline" ? "doc" : "outline"));
  }

  // jump from an outline row to the block in document view
  function jump(blockId) {
    setView("doc");
    requestAnimationFrame(() => {
      const el = document.getElementById("blk-" + blockId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("blk-flash");
        setTimeout(() => el.classList.remove("blk-flash"), 900);
      }
    });
  }

  // F2 = OUTLINE (hardware-key feel: the actual key works once a script is loaded)
  useEffect(() => {
    function onKey(e) {
      if (e.key === "F2" && parsed) {
        e.preventDefault();
        toggleOutline();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed]);

  return (
    <>
      <div id="bar">
        <span class="model">MODEL <b>WP-01</b> · BURMA SCRIPT TOOL</span>
        <Telem tel={tel} loaded={!!parsed} view={view} />
      </div>
      <FnBay view={view} onOutline={toggleOutline} enabled={!!parsed} />

      <div id="stage">
        <div id="page">
          {!parsed ? (
            <div class="empty">
              <div class="eyebrow">fig.01 · the human element</div>
              <h2>Burma — script instrument</h2>
              <p>
                Load the real Burma script. The parser standardizes JH's text into
                typed blocks — chapters, VO, on-camera, SOTs with day + timecode,
                B-roll, service boxes — and renders them on a calm page.
              </p>
              <button class="load-btn" onClick={load}>
                <span class="num">01/</span> Load sample script
              </button>
            </div>
          ) : view === "outline" ? (
            <Outline blocks={parsed.doc.blocks} onJump={jump} />
          ) : (
            <>
              <div id="doc">
                <div class="doc-head">
                  <div class="eyebrow">fig.01 · the human element</div>
                  <h1>{parsed.doc.title}</h1>
                  <div class="seq">
                    {parsed.doc.sequences.map((s) => s.name).join("  ·  ")}
                  </div>
                </div>
                {parsed.doc.blocks.map((b) => (
                  <div id={"blk-" + b.id} key={b.id}>
                    <BlockView block={b} />
                  </div>
                ))}
              </div>
              <div id="hublane">
                <div class="hub-hint">
                  Select a {"{TK}"} or [visual] span — its workshop hub opens here.
                  <br /><br />— coming in a later cycle —
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

render(<App />, document.getElementById("app"));
