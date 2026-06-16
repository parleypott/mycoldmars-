# Handoff: WP-01 — "Cartridges" Script Editor Surface

## Overview
**WP-01** is a screenwriting + edit-direction tool for a cinematic documentary (working title *The Human Element*, subject Myanmar/Burma). A writer drafts the film script in it; an editor works directly off the same document, copying sequence timecodes into Premiere.

This handoff covers **one chosen visual direction — "Cartridges"** — for the **main script/editor surface**. In this direction every script block is its own **tactile hardware "cartridge"**: a flat, outlined module with a knurled drag-spine, a numbered tab, a colour-coded kind cap, and (for soundbites) a small recessed timecode readout. The aesthetic is **Teenage Engineering / `fig.01` technical-drawing**: warm cream paper, thin ink hairlines, registration-screw corner marks, monospace micro-labels — deliberately flat (no gradients, no drop shadows, no bevels).

The block engine is assumed to be **TipTap / ProseMirror** (blocks are editable in place and reorderable). This handoff is **purely the visual/UX layer** — the editor engine is out of scope.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that show the intended look and behaviour. They are **not production code to ship directly**.

Two of them (`*.dc.html`) are authored in a streaming "Design Component" prototyping format and reference a runtime (`support.js`) that is **not** included — so they will not render on their own. Treat them as **readable source references**: clean, fully inline-styled markup plus a small logic class that defines the data model and interactions. The exact rendered result is captured in `cartridges-reference.png`.

Your task is to **recreate this design in the target codebase's existing environment** (React, Vue, Svelte, SwiftUI, native, etc.) using its established component patterns, not to port the HTML verbatim. If no front-end environment exists yet, choose the most appropriate framework for the project and implement it there.

## Fidelity
**High-fidelity (hifi).** Colours, typography, spacing, radii, borders, and interaction states are final and intentional. Recreate the UI to match — exact hex values, sizes, and the flat (shadow-free) treatment are given below. The only deliberately *loose* part is the script content itself (dummy documentary copy) and the drag-to-reorder behaviour (described as intent; not fully wired in the prototype).

---

## Screen: Cartridge Rack (main script surface)

### Purpose
Read and edit a long documentary script (the real document is ~225 blocks). Each block is a discrete, reorderable module. Soundbite (SOT) and B-roll blocks surface a **sequence timecode** that the editor copies into an NLE — the timecode is the editor's hero element.

### Layout
- **Outer frame** (`device`): centered column, `max-width: 1040px`, `background: #efeadd`, `border: 2px solid #1f1d18`, `border-radius: 16px`, `padding: 22px`, `position: relative`. The page behind it is `#e7e1d3`.
- **Registration screws**: four decorative marks, one per corner of the outer frame, inset `9px`. Each is a `14px` circle, `1.5px solid #1f1d18`, containing an `8px × 1.5px` ink bar rotated `-45deg` (a slotted-screw glyph).
- **Header row** (`flex`, space-between, `padding: 0 2px 14px`):
  - Left: wordmark `WP·01` (18px, weight 800; the "01" is `#ff5b1f`) + caption `fig.03 — CARTRIDGE RACK` (7px, `#7d7768`, letter-spacing .14em).
  - Right: telemetry line `2,305 WORDS · 225 BLOCKS · 07/79 SOT · DRAFT` (8px, `#6b6658`, letter-spacing .16em; the `07/79 SOT` segment is `#6e1f1a`).
- **Block stack**: vertical list of cartridges, each `margin: 0 0 11px`. Chapter cartridges add extra top margin (`margin: 18px 0 11px`) to open a new section.
- **Footer affordance**: an "insert block" row — a `26px` dashed-outline square with a `+`, followed by `INSERT BLOCK — CHAPTER · VO · SOT · B-ROLL · NOTE` (8px, `#8a857a`, letter-spacing .16em).

### Cartridge anatomy (shared by all block types)
A cartridge is a horizontal `flex` row, `border: 1.5px solid #1f1d18`, `border-radius: 11px`, `overflow: hidden`, **no shadow**. On hover the face tints (see states). It has two parts:

1. **Spine** (left rail, `width: 30px`, `flex: none`, `border-right: 1.5px solid #1f1d18`):
   - **Knurled texture** via a repeating gradient: `repeating-linear-gradient(0deg, #ddd7c8, #ddd7c8 2px, #ece7da 2px, #ece7da 4px)` (lighter pair `#f0e2a8/#f6ecbf` on NOTE; dark pair `#2a2a26/#36352f` on CHAPTER).
   - **Numbered cap** at top: full-width, `padding: 3px 0`, `font-size: 8px`, letter-spacing .04em, `border-bottom: 1.5px solid #1f1d18`. Background = the block's **kind colour** (below); text is white (or `#5a4a00` on yellow, `#10130f`→`#231f1b` dark on the ivory chapter cap). Shows the block's two-digit index (`01`…`10`).
   - **Drag grip** centered below: the glyph `⠿` (Braille pattern, U+2837), `#9a958a`, `font-size: 12px`, `cursor: grab`. This is the reorder handle.
2. **Body** (`flex: 1`, `padding: 11px 14px`): block-type-specific content (below).

### Block types

**CHAPTER** (section divider — the script alternates HISTORY ↔ GROUND acts)
- Whole cartridge inverts: `background: #1a1a18`, text `#f3f1ea`, dark knurled spine, **ivory** numbered cap (`background: #efe9da`, dark text).
- Body: top row (space-between) = kind label `CH · ACT` (8px, `rgba(243,241,234,.53)`) + act tag `GROUND` / `HISTORY` (8px, `#efe9da`, letter-spacing .16em). Below: title (18px, weight 800, letter-spacing .02em), e.g. `COLD OPEN — THE EMPTY CAPITAL`.

**VO** (narration — carries a record-status control)
- Cap colour `#2f6fb0` (blue). Body top row: kind `VO · NARRATION` (8px, `#5c584e`) + a **REC control** (right).
- **REC control**: the word `REC`, then a 3-position pill toggle, then a state label. Pill: `background: #e7e1d3`, `border-radius: 20px`, `padding: 2px`, `border: 1.5px solid #1f1d18`, holding three `15×12px` rounded pips. The active position's pip is `#ff5b1f`; inactive pips are `#e7e1d3`. State label (min-width 24px, weight 700): `OFF` (`#9b968c`) / `ARM` (`#c2491a`) / `REC` (`#e8412b`). Clicking the control cycles OFF → ARM → REC.
- Prose body: `font-family: "Helvetica Neue", Arial, sans-serif`, `15px`, `line-height: 1.62`, `#23211d`. Inline within the prose are two inline-span types:
  - **`{TK}` research marker** (a "go research & propose lines" cue): mono `0.8em`, `background: #fff2cf`, `border: 1.5px solid #1f1d18`, `border-radius: 5px`, `padding: 1px 6px`, `color: #8a6d00`, `white-space: nowrap`. Text like `tk fractured-shape`.
  - **`[visual]` direction marker**: mono `0.8em`, `background: #f1e3e1`, `border: 1.5px solid #1f1d18`, `border-radius: 5px`, `padding: 1px 6px`, `color: #6e1f1a`, rendered wrapped in literal square brackets, e.g. `[map: river basin vs British shape]`.

**SOT** (soundbite — timecode + speaker + quote; the hero block for the editor)
- Cap colour `#ff5b1f` (orange). Body is a 3-column grid `auto 1fr auto`, gap 13px, items centered.
  - **Timecode readout** (left, clickable to copy): a recessed window — `background: #23211b`, `border: 1.5px solid #1f1d18`, `border-radius: 6px`, `padding: 6px 10px`, `cursor: pointer`. Inside: day label (6px, `#9a917e`, letter-spacing .14em) over the timecode in **warm ivory** (`16px`, `#efe9da`, letter-spacing .06em), format `HH:MM:SS:FF` e.g. `02:32:21:22`. **No glow** — flat ivory-on-charcoal, like a vintage tape-deck meter.
  - **Quote** (center): speaker label (8px, `#ff5b1f`, letter-spacing .12em) e.g. `JH · ON CAM`, over the quote in sans (`15px`, `line-height 1.5`, `#23211d`).
  - **Done toggle** (right): a `34×30px` button, `border-radius: 7px`, `border: 1.5px solid #1f1d18`. **Unchecked**: `background: #f1ede2`, mark `#1f1d18`. **Checked**: `background: #1f1d18`, white `✓`. Toggles on click.

**B-ROLL** (footage cue — timecode + visual)
- Cap colour `#6e1f1a` (burgundy). Body top row: kind `B-ROLL` (8px, `#5c584e`) + a clickable timecode string `DAY 2 · 04:45:48:08 ⧉` (8px, `#6e1f1a`, letter-spacing .1em) that copies on click. Below: description in mono (`12px`, `#4a463d`, `line-height 1.5`) followed by a `[visual]` chip (same burgundy chip style as in VO), e.g. `[hero shot]`.

**NOTE** (editor note)
- Cap colour `#f5c518` (yellow); whole cartridge tinted `background: #fff8e0`, yellow knurled spine. Body: kind `EDITOR NOTE` (8px, `#8a6d00`) over an italic sans note (`14px`, `line-height 1.5`, `#5a4a00`).

---

## Interactions & Behavior
- **Copy timecode** — clicking a SOT readout window, the SOT speaker area, or a B-roll timecode string copies the `HH:MM:SS:FF` value to the clipboard (`navigator.clipboard.writeText`) and shows a brief confirmation toast (dark `#23211b` pill, ivory digits) for ~1.3s, then auto-dismisses. This is the editor's primary action — make it forgiving and obvious (cursor pointer + hover affordance).
- **Cycle REC state** — clicking a VO record control advances OFF → ARM → REC → OFF, updating the active pip and the state label/colour.
- **Toggle done** — clicking a SOT done button flips checked/unchecked (fills the button ink with a white check).
- **Hover** — cartridge faces transition `background` over `0.16s` from `#fbfaf5` to `#f1ece0`. No lift/shadow — the tint is the only hover signal. The drag grip uses `cursor: grab`.
- **Reorder (intent)** — cartridges are meant to be drag-reorderable by the spine grip (`⠿`), Notion-style. The prototype shows the affordance but does not implement the drag; wire it to the block engine's move operation.
- **Insert block (intent)** — the footer `+ INSERT BLOCK` row opens a block-type picker (CHAPTER · VO · SOT · B-ROLL · NOTE).

### Motion
Editorial and understated. Transitions 120–220ms, easing `cubic-bezier(0.2, 0.6, 0.2, 1)`. No spring/bounce. Toast fades/translates up ~8px on entry.

## State Management
Per the prototype's logic class (`WP-01 Directions.dc.html`):
- `voPos: { [blockId]: 0 | 1 | 2 }` — record-toggle position per VO block (0 OFF, 1 ARM, 2 REC).
- `done: { [blockId]: boolean }` — done flag per SOT block.
- `toast: string | null` — the timecode currently shown in the copy-confirmation toast (set on copy, cleared after ~1300ms).
- Block content itself is owned by the editor engine (TipTap/ProseMirror). The above is **UI state layered on top of blocks**, keyed by stable block id.

## Data Model
Each block (see `buildBlocks()` in `WP-01 Directions.dc.html`):
```js
// common
{ type: 'chapter'|'vo'|'sot'|'broll'|'note', num: '01', kind: 'CH · ACT' }
// chapter:  + tag: 'GROUND'|'HISTORY', title: string
// vo:       + segs: [ {t:'text', v}, {t:'tk', v}, {t:'vis', v}, ... ]   // inline run
// sot:      + day: 'DAY 1', tc: '02:32:21:22', spk: 'JH · ON CAM', quote: string
// broll:    + day: 'DAY 2', tc: '04:45:48:08', body: string, vis: string
// note:     + body: string
```
VO prose is an ordered array of inline segments so `{tk}` and `[visual]` markers can be interleaved with text. Kind colour mapping: `vo → #2f6fb0`, `sot → #ff5b1f`, `broll → #6e1f1a`, `note → #f5c518`, `chapter → ivory cap on ink`.

## Design Tokens

### Colour
| Role | Hex |
|---|---|
| Page behind frame | `#e7e1d3` |
| Frame / paper | `#efeadd` |
| Panel fill | `#f4f1e8` / `#f1ede2` |
| Cartridge face | `#fbfaf5` |
| Cartridge face (hover) | `#f1ece0` |
| Ink — lines & text | `#1f1d18` |
| Chapter block fill | `#1a1a18` (text `#f3f1ea`) |
| Readout window | `#23211b` (digits `#efe9da`) |
| Muted labels | `#6b6658` · `#7d7768` · `#8a857a` · `#9a917e` · `#9b968c` |
| Body prose | `#23211d` |
| Mono body | `#4a463d` |
| Orange (SOT / brand / active) | `#ff5b1f` |
| Blue (VO) | `#2f6fb0` |
| Yellow (NOTE) | `#f5c518` (fill `#fff8e0`, text `#8a6d00`/`#5a4a00`) |
| Burgundy (B-ROLL / worklists) | `#6e1f1a` |
| Red (reset/destructive) | `#e8412b` |
| TK chip | bg `#fff2cf`, text `#8a6d00` |
| Visual chip | bg `#f1e3e1`, text `#6e1f1a` |
| REC label ARM / REC | `#c2491a` / `#e8412b` |

> Colour discipline: the document is mostly ink-on-cream. Colour is reserved for **kind caps**, the **active control**, and the **research/visual markers**. Avoid introducing new hues — there is intentionally **no teal** and **no neon**.

### Typography
- **Mono (chrome, labels, timecode, mono body):** `JetBrains Mono` (a stand-in for *GT Pressura Mono*). Weights 400/500/700/800. Used for all uppercase micro-labels (7–9px, letter-spacing .1–.16em), the wordmark, and timecodes.
- **Prose (VO narration, SOT quotes, notes):** `"Helvetica Neue", Arial, sans-serif`. 14–15px, line-height 1.5–1.62. Substitute the target codebase's body sans if preferred.
- Hierarchy is driven by **size + case**, not heavy weight. Titles are weight 800; most labels are tiny uppercase mono.

### Spacing
4px base scale: `2 · 3 · 6 · 9 · 11 · 13 · 14 · 18 · 22`. Cartridge gap `11px`; chapter top margin `18px`; frame padding `22px`; body padding `11px 14px`.

### Radius
Frame `16px` · cartridge `11px` · readout window `6px` · buttons/caps `7px` · chips `5px` · toggle pill `20px`. (Nothing is fully sharp here, but nothing exceeds 16px.)

### Borders & shadows
- **Hairline ink rules are load-bearing.** `1.5px solid #1f1d18` is the default border for every panel, cartridge, chip, and control. `2px` on the outer frame.
- **No shadows.** No drop shadows, no insets, no bevels, no gradients (except the flat repeating-linear knurl texture on spines). This flatness is a hard requirement of the direction.

## Assets
- **Fonts:** JetBrains Mono (Google Fonts). If pixel-parity with the brand is required, the real faces are *GT Pressura Mono* (mono) and the prose can use the platform sans. No DSEG/segment font is used in this direction.
- **Icons / glyphs:** all Unicode — drag grip `⠿` (U+2837), copy `⧉` (U+29C9), check `✓`, insert `+`, arrow `→`. No icon library required; substitute the codebase's icon set if preferred (1.5px stroke, square caps to match).
- **Images:** none. The design is type-and-rule only.

## Files
- `cartridges-reference.png` — rendered screenshot of the exact target look (visual source of truth).
- `DirCartridge.dc.html` — the Cartridges view source (clean, fully inline-styled markup; the structure/styles to recreate).
- `WP-01 Directions.dc.html` — the parent prototype: holds the **block data model** (`buildBlocks()`), the **interaction handlers** (`copy`, `cycleVo`, `toggleDone`), and the UI **state** shape. Read this for behaviour and data; ignore the 5-direction switcher chrome around it.
