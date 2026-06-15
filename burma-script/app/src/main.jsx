// Burma Script Tool — app scaffold (PLAN task 1).
// A Vite/Preact page served at /burma-script/app/. "Load sample script" runs the
// real parser.ts over the real script text and renders the blocks READ-ONLY,
// inside the locked WP-01 frame (Tufte page · Teenage Engineering instrument).
// Later tasks layer interaction onto these same components.

import { render } from "preact";
import { useMemo, useState } from "preact/hooks";
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

function Telem({ tel, loaded }) {
  return (
    <div class="telem">
      {loaded ? (
        <>
          <span class="t live">WORDS <b>{tel.words.toLocaleString()}</b></span>
          <span class="t">READ <b>{tel.mins}m</b></span>
          <span class="t">BLOCKS <b>{tel.blocks}</b></span>
          <span class="t">% DONE <b>0</b></span>
          <span class="t">MODE <b>READ-ONLY</b></span>
        </>
      ) : (
        <span class="t">STANDBY · NO SCRIPT LOADED</span>
      )}
    </div>
  );
}

function FnBay() {
  // Function-key bay — chrome shell. Wiring lands in later PLAN tasks.
  const keys = [
    ["F1", "SAVE"], ["F2", "OUTLINE"], ["F3", "COMMENT"],
    ["F4", "REFERENCE"], ["F5", "FOCUS"], ["F7", "EXPORT"],
  ];
  return (
    <div class="fnbay">
      {keys.map(([k, label]) => (
        <span class="fk ghost"><span class="key">{k}</span><b>{label}</b></span>
      ))}
    </div>
  );
}

function App() {
  const [parsed, setParsed] = useState(null);
  const tel = useMemo(
    () => (parsed ? telemetry(parsed.doc, parsed.stats) : null),
    [parsed]
  );

  function load() {
    setParsed(parseScript(sampleScript));
  }

  return (
    <>
      <div id="bar">
        <span class="model">MODEL <b>WP-01</b> · BURMA SCRIPT TOOL</span>
        <Telem tel={tel} loaded={!!parsed} />
      </div>
      <FnBay />

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
                  <BlockView key={b.id} block={b} />
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
