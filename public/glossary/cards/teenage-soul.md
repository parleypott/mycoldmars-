# Teenage Soul — Taste Card

> **Invocation:** "build this in Teenage Soul" — or hand this file (+ `teenage-soul.tokens.css`) to any agent.
> **Profile:** #001 · The Human Element / Burma script · captured from the live WP-01 instrument · 2026-06-17
> **One line:** A warm tactile hardware instrument for documentary writing — Teenage Engineering / fig.01 soul applied to editorial.

---

## The feeling

It's the soul of a Teenage Engineering box and a `fig.01` technical drawing, in service of human storytelling. Warm cream paper, thin ink hairlines, registration-screw corner marks, monospace micro-labels, color-coded by *function* — every script block is a tactile hardware **cartridge** you could pop out of a rack. It's flat on purpose: no shadows, no bevels, no gloss. The warmth comes from the cream, the hand of the knurled grips, and a single hot orange that means "live." It feels like a beloved instrument, not an app. For *The Human Element* it makes the act of writing feel like operating a precise, warm machine built for one person.

Mood words: warm · tactile · precise · flat · instrument-like · analog · understated · function-coded · built-for-one.

---

## Palette (the real tokens)

| name | hex | role |
|------|-----|------|
| Ink | `#1f1d18` | the only near-black — lines & text |
| Frame | `#efeadd` | warm cream device body |
| Face | `#fbfaf5` | cartridge face (hover → `#f1ece0`) |
| Page | `#e7e1d3` | the surface behind the device |
| Ivory | `#efe9da` | LCD digits / chapter caps |
| LCD ground | `#23211b` | recessed readout window |
| **Orange** | `#ff5b1f` | **SOT / brand / "live" — the hero accent** |
| Blue | `#2f6fb0` | VO / narration |
| Yellow | `#f5c518` | NOTE |
| Burgundy | `#6e1f1a` | B-ROLL |

**Discipline:** the kind-colors are *function codes*, not theme — they stay put while neutral surfaces can re-skin (cream / cool / sepia / slate / graphite). One hot orange = "active." Never decorate with the accents.

---

## Type

- **Chrome / labels / timecode:** JetBrains Mono — micro-labels at 7–8px, letter-spacing .12–.16em, uppercase.
- **Prose:** Helvetica Neue / Arial — 15px, line-height 1.62, `#23211d`. The reading layer offers 9 swappable serif/sans faces (Newsreader, Source Serif 4, Literata, Lora, Spectral, Crimson Pro, IBM Plex Sans, Inter, system).
- Mono is the *instrument's voice*; the serif/sans is the *writer's voice*.

---

## Components (the ecosystem)

- **Device frame** — cream, `2px` ink border, `16px` radius, four registration-screw corner marks (slotted-screw glyph).
- **Cartridge** — flat outlined module, `1.5px` ink border, `11px` radius, **no shadow**; a `30px` knurled left spine with a numbered cap (in the kind-color) + `⠿` drag grip.
- **CHAPTER** inverts dark with an ivory cap. **VO** carries a 3-position REC pill (OFF→ARM→REC). **SOT** is the hero: a recessed `HH:MM:SS:FF` readout (ivory-on-charcoal, copy-on-click) + speaker quote + done toggle. **B-ROLL** shows a copyable timecode string. **NOTE** tints yellow.
- Inline markers: `{tk}` research cue (gold chip) and `[visual]` direction (burgundy chip).

---

## Texture & motion

Flat hairline ink. Knurled repeating-linear grips are the only "gradient." No glow on the LCD — flat ivory like a vintage tape-deck meter. Motion is editorial and understated: 120–220ms, `cubic-bezier(0.2,0.6,0.2,1)`, settles rather than springs. **No bounce, ever.**

---

## Do / Don't

**DO:** warm cream + ink hairlines · one hot orange for "live" · monospace micro-labels · registration marks · knurled grips · flat everything · function-coded color · understated settle-motion.

**DON'T:** drop shadows · bevels · gloss/gradients-as-depth · garish theme colors · decorative use of the accents · springy/bouncy motion · cold pure-white minimalism.

---

## Lineage (blended from the Glossary)

- **Teenage Engineering / Braun / Dieter Rams** — the tactile instrument, the restraint, "less but better."
- **`fig.01` technical drawing / Swiss** — hairlines, registration marks, monospace labels, the grid.
- **Vintage tape-deck & synth hardware** — the recessed LCD readout, the knurled grips, the function-coded caps.

---

## For the agent — when invoked

1. Load `teenage-soul.tokens.css` — use those exact hexes and the `--mono`/`--sans` stacks.
2. Everything is FLAT. If you reach for a `box-shadow`, stop — use a `1.5px` ink hairline instead.
3. One hot orange (`#ff5b1f`) means "active/live" — never decoration.
4. Monospace for chrome/labels/numbers; Helvetica/serif for prose. Micro-labels are tiny + tracked-out + uppercase.
5. Add registration-screw corner marks to the main frame; knurled spines to modules.
6. Motion settles, never springs. 120–220ms.
7. If it looks like a slick SaaS app, you've failed it. If it looks like a warm precise instrument built for one person, you've got it.
8. Never edit Johnny's copy; the design serves the words.
