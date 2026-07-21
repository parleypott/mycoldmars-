// Burma Script Tool — SCRIPT MAP (ws key 'map') — the mission-control strip.
//
// Johnny: "a big rich page where you can see the entire script in one view,
// color-coded by what the dominant visual plan is for each section … a visual
// roadmap that allows you to see at a glance how the video is composed of
// different visual plans and what is still missing."
//
// A tall vertical spine — the film, top to bottom. Each chapter is a labeled band
// (ordinal + title in the chapter-frame serif); inside it the mapModel segments
// stack as full-width bars whose HEIGHT is proportional to timed words (screen
// time), with floors so nothing vanishes. Colors are the REAL chip palette;
// PENDING is the stage-1 alert red, loud; UNPLANNED is a hollow dashed hole in
// the plan; zero-word neutral rows are hairlines (chapter heads, spacers) while
// wordy neutral runs (unsplit narration) show as quiet gray mass. A right gutter
// carries cumulative minute ticks every 2 min @130wpm. Clicking a segment fires
// the stage-3 'wp-ws-jump' event — main.jsx exits the workspace and smooth-
// scrolls the master to the segment's first row (resolved by blockId at click
// time). This component renders from a precomputed model and NEVER touches the
// editor — pure paint, collab-safe by construction.

import {
  MAP_KIND_TINTS, MAP_KIND_LABELS,
  segmentTag, layoutChapter, TICK_EVERY_MIN,
} from './script-map.js';
import { WORDS_PER_MINUTE } from './workspaces.js';

function jumpTo(blockId) {
  if (!blockId) return;
  try { window.dispatchEvent(new CustomEvent('wp-ws-jump', { detail: { blockId } })); } catch {}
}

function Segment({ seg }) {
  const tag = segmentTag(seg);
  // A wordy neutral run is narration that never got a said|shown split — honest
  // gray mass, quietly labeled so the tail of an in-progress script explains itself.
  const mass = seg.kind === 'neutral' && seg.timedWords > 0;
  const kindLab = mass ? 'NO VISUAL LANE' : (MAP_KIND_LABELS[seg.kind] || '');
  const label = kindLab ? `${kindLab} · ${tag}` : tag;
  const showTag = seg.px >= 16;
  return (
    <button
      type="button"
      class="wp-map-seg"
      data-kind={seg.kind}
      data-mass={mass ? '1' : undefined}
      style={{ height: `${seg.px}px` }}
      title={`${label} — jump to this spot in the master script`}
      onClick={() => jumpTo(seg.firstBlockId)}
      disabled={!seg.firstBlockId}
    >
      {showTag && (
        <span class="wp-map-seg-line">
          {kindLab && <b class="wp-map-seg-kind">{kindLab}</b>}
          <span class="wp-map-seg-tag">{tag}</span>
        </span>
      )}
    </button>
  );
}

function ChapterBand({ chapter, startWords }) {
  const { segs, ticks, colPx } = layoutChapter(chapter, startWords);
  const front = chapter.ordinal === 0;
  const min = chapter.timedWords / WORDS_PER_MINUTE;
  return (
    <section class={`wp-map-ch${front ? ' is-front' : ''}`}>
      <header class="wp-map-ch-head">
        {!front && <span class="wp-map-ch-ord">CH {chapter.ord}</span>}
        <span class="wp-map-ch-title">{front ? 'FRONT MATTER' : chapter.title}</span>
        <span class="wp-map-ch-min">{min >= 0.05 ? `${min.toFixed(1)} MIN` : '—'}</span>
      </header>
      <div class="wp-map-ch-col" style={{ height: `${colPx}px` }}>
        {segs.map((seg) => <Segment key={`${seg.rowStart}`} seg={seg} />)}
        {ticks.map((t) => (
          <span key={`t${t.min}`} class="wp-map-tick" style={{ top: `${t.y}px` }} aria-hidden="true">
            <i /><em>{t.min} MIN</em>
          </span>
        ))}
      </div>
    </section>
  );
}

const LEGEND = ['broll', 'archive', 'mapdata', 'animation', '3d', 'pending', 'unplanned'];

export function ScriptMap({ model }) {
  if (!model) return null;
  const t = model.totals;
  // Chapter start offsets in cumulative timed words (drives the minute gutter).
  let acc = 0;
  const starts = model.chapters.map((ch) => { const s = acc; acc += ch.timedWords; return s; });
  return (
    <div class="wp-map" role="region" aria-label="script map">
      <header class="wp-map-stats">
        <span class="wp-map-stat"><b>{t.minutes.toFixed(1)}</b> TOTAL TIMED MIN</span>
        <span class="wp-map-dot" aria-hidden="true">·</span>
        <span class="wp-map-stat"><b>{t.plannedPct}%</b> PLANNED</span>
        <span class="wp-map-dot" aria-hidden="true">·</span>
        <span class={`wp-map-stat${t.pendingCount ? ' is-pending' : ''}`}><b>{t.pendingCount}</b> PENDING</span>
        <span class="wp-map-dot" aria-hidden="true">·</span>
        <span class={`wp-map-stat${t.unplannedCount ? ' is-unplanned' : ''}`}><b>{t.unplannedCount}</b> UNPLANNED</span>
        <span class="wp-map-legend">
          {LEGEND.map((k) => (
            <span key={k} class="wp-map-key">
              <i class="wp-map-swatch" data-kind={k} style={MAP_KIND_TINTS[k] && k !== 'unplanned' ? { background: MAP_KIND_TINTS[k] } : undefined} />
              {MAP_KIND_LABELS[k] === 'PENDING VISUAL PLAN' ? 'PENDING' : MAP_KIND_LABELS[k]}
            </span>
          ))}
        </span>
      </header>
      <div class="wp-map-spine">
        {model.chapters.map((ch, i) => {
          // An all-hairline FRONT MATTER band (author setup only — no clock, no
          // plan) is pure clutter on the roadmap; the film starts at CH 01.
          if (ch.ordinal === 0 && ch.segments.every((s) => s.kind === 'neutral' && !s.timedWords)) return null;
          return <ChapterBand key={`${ch.ordinal}:${ch.title}`} chapter={ch} startWords={starts[i]} />;
        })}
      </div>
      <footer class="wp-map-foot">HEIGHT = SCREEN TIME @{WORDS_PER_MINUTE} WPM · CLICK ANY BAR TO JUMP TO THAT ROW · TICKS EVERY {TICK_EVERY_MIN} MIN</footer>
    </div>
  );
}
