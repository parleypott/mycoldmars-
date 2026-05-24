# Burgundy World — v2 (Painterly Dev Terminal)

> Scoped under `body[data-world="burgundy"]`. This is a **diff against v1**, not a rewrite. v1 keeps the page background, hero imagery, CRT corner fragments, motto bar, RICO_MK1 mascot, scrim, grain, topbar treatment. v2 surgically rebuilds the parts that still feel like QSS in disguise.

---

## WHAT CHANGED (read this first)

1. **Chat composer goes minimal-enterprise.** One horizontal row — mic | textarea | send — with hairline separators, amber caret, no rounded sticker pills, no rotation, no offset shadows. The CRT phosphor look from v1 is *gone* on the composer (it was too costumey). The chat now feels like a clean dev terminal cut into the wall of an Iron Giant workshop. Personality comes from (a) painterly hero faint behind, (b) one amber accent on focused/active, (c) the existing scanline grain. That's it.
2. **Mode pills become inline terminal tabs.** `[ ask wordy ] | [ my words ]` rendered as monospace tabs with a single amber underline on the active one. No background pill, no border-radius, no color swatches.
3. **Mic button stops being a red sticker.** Heavy machined square (4px radius), gunmetal face, recessed inset, red LED dot on the antenna. Listening state pulses the LED, not the whole button.
4. **Send button becomes a heavy-machined lever.** Sienna/burgundy bronze face, beveled top highlight, pressed-in active state. Reads "EXECUTE" tone, not "tap me".
5. **Story blocks shed the sticker-paper look.** Aged-cream block faces with subtle ink-wash edge wear, no rotation, single warm rim light on hover. Number badges become iron-cast bronze medallions — the rainbow QSS palette (sky/bubblegum/grass/yolk per nth-child) is overridden to a single bronze tone with a hairline cream stamp ring.
6. **The b-summary serif comes in.** Block summaries shift from QSS handwriting display to Cambo italic 17/24. Full block text (`.b-text`) becomes book-serif 16/26. Painterly title-card feel.
7. **Pane-control toolbar buttons become heavy machined toggles.** `touch base` (the `.pane-ctrl-primary`) is a step heavier than its siblings with an amber underline glow. Others read as utility tabs, not pills.
8. **Welcome hero gets booted-terminal chrome.** Eyebrow `RICO_MK1 // INIT —` in amber wide-tracking mono. Headline shifts off QSS display and onto Cambo italic on cream. Henry's name (`.wh-name`) loses the red-sticker treatment and gains an amber underline. The CTA button (`.wh-cta`) becomes a heavy-machined lever stamped with mono caps. **Copy strings unchanged.**
9. **Dual-light rim recipe codified.** One mixin (`.world-burgundy .machined`) and one rule across `.btn`, `.story-block`, `.composer`, `.story-card`, `.ccard`: cold-bottom + warm-top inner shadows so every chrome edge catches the same Iron Giant lamp from above-right.
10. **One pattern interrupt:** the *active/playing* story block's number badge becomes a tiny live RICO eye — single green phosphor pixel that blinks every 4.5s, same cadence as the mascot. The whole world is being watched by the same machine.

Everything below is the new/replacement CSS. v1 rules it touches are explicitly called out.

---

## Reference paintings — what the chrome must match

After looking at `burgundy-portrait.jpg`, `msdos-terminal-closeup.jpg`, `peasant-miners.jpg`, `palace-exterior.jpg`, the world has four undeniable visual laws:

- **DUAL LIGHT.** Every form is a cold slate base (deep teal-blue, near-black recesses) lit on the upper-right by a single warm sodium-amber lamp. Bottom-left always falls into cold shadow. The chrome MUST do this on every machined surface or it will look 2D against the source paintings.
- **WATERCOLOR EDGES + HARD INK LINE.** Forms have soft painterly fills but their silhouettes are crisp. Translation: never use blurry borders. Use a hairline 1px ink-faint stroke + a soft inner glow. Sharp outside, soft inside.
- **IRON, BRONZE, AGED CREAM.** No saturated playful colors anywhere. The only chroma is (a) sienna-burgundy red on the cloak/LEDs, (b) sodium amber on lamps, (c) phosphor green on screens. Everything else is teal-slate or aged-cream.
- **RIVETS + STAMPED LABELS, NOT BUTTONS.** Things look fabricated, not designed. Counterintuitive but: when in doubt, make the chrome look like it was *built*, not styled.

---

## A — The Dual-Light Mixin (apply everywhere)

This is the formula. All chrome on `body[data-world="burgundy"]` uses it. Drop this near the top of the v2 stylesheet and reference it from every machined surface.

```css
/* ──────────────────────────────────────────────────────────────
   DUAL-LIGHT RIM — the world's universal lighting recipe.
   Cold slate base + warm sodium-amber rim from upper-right.
   Apply to .btn, .story-block, .composer, .story-card, .ccard,
   .pane-ctrl-btn, .mic-btn, #btn-ask, .wh-cta.
   ────────────────────────────────────────────────────────────── */
body[data-world="burgundy"] .machined,
body[data-world="burgundy"] .btn,
body[data-world="burgundy"] .composer,
body[data-world="burgundy"] .story-block,
body[data-world="burgundy"] .story-card,
body[data-world="burgundy"] .ccard,
body[data-world="burgundy"] .pane-ctrl-btn,
body[data-world="burgundy"] .mic-btn,
body[data-world="burgundy"] #btn-ask,
body[data-world="burgundy"] .welcome-hero .wh-cta {
  box-shadow:
    /* warm rim — upper-right amber catch */
    inset  1px  1px 0 rgba(232, 162, 72, 0.18),
    inset  2px  2px 0 rgba(232, 162, 72, 0.06),
    /* cold trough — lower-left shadow */
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    inset -2px -2px 0 rgba(0, 0, 0, 0.28),
    /* outside drop — anchors the form to the dark canvas */
    0 2px 6px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(232, 217, 184, 0.14);
  background: linear-gradient(155deg,
    rgba(36, 56, 68, 0.92) 0%,
    rgba(20, 36, 46, 0.96) 60%,
    rgba(8, 18, 24, 0.98) 100%);
}

/* Press / hover variants — keep the formula, just shift it */
body[data-world="burgundy"] .machined:hover,
body[data-world="burgundy"] .btn:hover,
body[data-world="burgundy"] .pane-ctrl-btn:hover {
  border-color: rgba(232, 162, 72, 0.40);
  box-shadow:
    inset  1px  1px 0 rgba(232, 162, 72, 0.28),
    inset  2px  2px 0 rgba(232, 162, 72, 0.10),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    inset -2px -2px 0 rgba(0, 0, 0, 0.28),
    0 3px 10px rgba(0, 0, 0, 0.55),
    0 0 18px rgba(232, 162, 72, 0.14);   /* faint amber halo on hover */
}

body[data-world="burgundy"] .machined:active,
body[data-world="burgundy"] .btn:active,
body[data-world="burgundy"] .pane-ctrl-btn:active {
  box-shadow:
    inset  2px  2px 4px rgba(0, 0, 0, 0.55),
    inset -1px -1px 0 rgba(232, 162, 72, 0.10),
    0 1px 2px rgba(0, 0, 0, 0.35);
  transform: translateY(1px);
}
```

**Why this works.** Every chrome element now reads as a single physical material under one consistent lamp. Match a screenshot of any of the chrome to any of the source paintings, the lighting agrees. That's the whole game.

---

## B — Chat Composer (the big one)

### B.0 — Reset every QSS-flavored declaration first

v1 inherited too much of the QSS sticker logic. Nuke it explicitly.

```css
/* HARD RESET of the QSS sticker physics on the composer chain */
body[data-world="burgundy"] .composer,
body[data-world="burgundy"] .composer.with-mic,
body[data-world="burgundy"] .chat-composer {
  transform: none !important;
  border-radius: 4px !important;
  /* kill any box-shadow inherited from QSS — dual-light rim takes over */
  box-shadow: none;
}

body[data-world="burgundy"] .composer textarea,
body[data-world="burgundy"] .composer textarea:focus,
body[data-world="burgundy"] .chat-composer textarea,
body[data-world="burgundy"] .chat-composer textarea:focus,
body[data-world="burgundy"] #kid-input {
  transform: none !important;
  box-shadow: none !important;
  border-radius: 2px !important;
}

body[data-world="burgundy"] .composer-modes .mode-btn,
body[data-world="burgundy"] #btn-mic,
body[data-world="burgundy"] .mic-btn,
body[data-world="burgundy"] #btn-ask {
  transform: none !important;
  border-radius: 3px !important;
  box-shadow: none;
}
```

### B.1 — Composer shell (single row: mic | textarea | send)

v1's composer was treated as a CRT screen. **Drop that.** The composer is now a hairline-framed panel, almost flush with the page. Phosphor lives inside RICO_MK1's face and the scanline grain on the canvas — not on the composer itself.

```css
/* Replace v1 section 7 composer treatment for this surface */
body[data-world="burgundy"] .composer.with-mic {
  display: grid;
  grid-template-columns: 44px 1fr auto;       /* mic | textarea | send */
  grid-template-rows: 1fr auto;
  column-gap: 0;
  row-gap: 0;
  align-items: stretch;
  padding: 0;
  background: linear-gradient(180deg,
    rgba(15, 30, 38, 0.78) 0%,
    rgba(8, 18, 24, 0.86) 100%);
  border: 1px solid rgba(232, 217, 184, 0.14);
  border-radius: 4px;
  /* dual-light rim already applied via mixin selector list */
  backdrop-filter: blur(10px) saturate(1.08);
  /* faint amber hairline on the bottom edge — desk lamp under-rail */
  position: relative;
}

body[data-world="burgundy"] .composer.with-mic::after {
  content: '';
  position: absolute;
  left: 8px; right: 8px; bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(232, 162, 72, 0.10) 25%,
    rgba(232, 162, 72, 0.32) 50%,
    rgba(232, 162, 72, 0.10) 75%,
    transparent 100%);
  pointer-events: none;
}

/* The textarea fills the middle column */
body[data-world="burgundy"] .composer.with-mic textarea,
body[data-world="burgundy"] .composer.with-mic #kid-input {
  grid-column: 2;
  grid-row: 1;
  margin: 0;
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-left: 1px solid rgba(232, 217, 184, 0.10);
  border-right: 1px solid rgba(232, 217, 184, 0.10);
  color: var(--ink-bright);
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: 0.005em;
  caret-color: var(--yolk);              /* amber caret — the one accent */
  text-shadow: none;                     /* no green phosphor glow */
  resize: none;
  min-height: 56px;
}

body[data-world="burgundy"] .composer.with-mic textarea::placeholder,
body[data-world="burgundy"] .composer.with-mic #kid-input::placeholder {
  color: rgba(232, 217, 184, 0.36);
  font-style: normal;
}

body[data-world="burgundy"] .composer.with-mic textarea:focus,
body[data-world="burgundy"] .composer.with-mic #kid-input:focus {
  outline: none;
  /* focus state: amber under-rail brightens, no border ring */
}

body[data-world="burgundy"] .composer.with-mic:focus-within::after {
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(232, 162, 72, 0.22) 20%,
    rgba(232, 162, 72, 0.55) 50%,
    rgba(232, 162, 72, 0.22) 80%,
    transparent 100%);
  box-shadow: 0 0 12px rgba(232, 162, 72, 0.25);
}
```

### B.2 — Mic button (left cell)

Drop the QSS red sticker mic. Build a machined panel housing a small red LED.

```css
body[data-world="burgundy"] .composer.with-mic .mic-btn,
body[data-world="burgundy"] #btn-mic {
  grid-column: 1;
  grid-row: 1;
  width: 44px;
  height: 100%;
  min-height: 56px;
  margin: 0;
  padding: 0;
  background: linear-gradient(155deg,
    rgba(36, 56, 68, 0.92) 0%,
    rgba(20, 36, 46, 0.96) 60%,
    rgba(8, 18, 24, 0.98) 100%);
  border: none;
  border-right: 1px solid rgba(232, 217, 184, 0.08);
  border-radius: 4px 0 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* dual-light rim handled by mixin */
  transition: background 140ms ease-out;
}

body[data-world="burgundy"] .mic-btn:hover {
  background: linear-gradient(155deg,
    rgba(48, 68, 80, 0.94) 0%,
    rgba(28, 44, 54, 0.96) 60%,
    rgba(12, 22, 28, 0.98) 100%);
  transform: none !important;
}

/* Replace the QSS red capsule SVG with a small LED dot */
body[data-world="burgundy"] .mic-btn svg {
  width: 22px;
  height: 22px;
}

body[data-world="burgundy"] .mic-btn svg .mic-capsule {
  fill: #1A0F0C;                        /* dead-bulb dark */
  stroke: rgba(232, 217, 184, 0.28);
  stroke-width: 1.5;
}

body[data-world="burgundy"] .mic-btn svg .mic-stripe {
  stroke: rgba(232, 217, 184, 0.22);
  stroke-width: 1.5;
}

/* LISTENING — the LED comes alive */
body[data-world="burgundy"] .mic-btn.listening {
  background: linear-gradient(155deg,
    rgba(48, 68, 80, 0.94) 0%,
    rgba(28, 44, 54, 0.96) 100%);
  animation: none;                      /* kill QSS micPulse on the body */
}

body[data-world="burgundy"] .mic-btn.listening svg .mic-capsule {
  fill: #E84545;
  stroke: #7A2A23;
  filter: drop-shadow(0 0 6px rgba(232, 69, 69, 0.65))
          drop-shadow(0 0 14px rgba(232, 69, 69, 0.32));
  animation: bg-led-pulse 1.1s ease-in-out infinite;
}

@keyframes bg-led-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.65; }
}

/* Hide the QSS "talk!" label — the LED is the signal */
body[data-world="burgundy"] .mic-btn .mic-label,
body[data-world="burgundy"] .mic-btn .listening-pip {
  display: none !important;
}
```

### B.3 — Send button (#btn-ask) — heavy machined lever

Drop the red sticker pill. Becomes a sienna-bronze stamped lever.

```css
body[data-world="burgundy"] .composer.with-mic #btn-ask,
body[data-world="burgundy"] #btn-ask {
  grid-column: 3;
  grid-row: 1;
  align-self: stretch;
  margin: 0;
  padding: 0 22px;
  min-height: 56px;
  border: none;
  border-left: 1px solid rgba(232, 217, 184, 0.08);
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg,
    #B8443A 0%,
    #9A382F 45%,
    #6E2820 100%);
  color: #F4E6C4;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
  cursor: pointer;
  position: relative;
  transition: filter 140ms ease-out, background 140ms ease-out;
  /* override mixin shadow with a sienna-tinted version */
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.22),
    inset 1px 1px 0 rgba(244, 196, 142, 0.10),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    inset -1px -1px 0 rgba(0, 0, 0, 0.32),
    0 0 18px rgba(184, 68, 58, 0.22) !important;
}

body[data-world="burgundy"] #btn-ask:hover {
  background: linear-gradient(180deg,
    #C84A3F 0%,
    #A93C32 45%,
    #7A2A23 100%);
  filter: brightness(1.06);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.28),
    inset 1px 1px 0 rgba(244, 196, 142, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    inset -1px -1px 0 rgba(0, 0, 0, 0.32),
    0 0 28px rgba(184, 68, 58, 0.32) !important;
}

body[data-world="burgundy"] #btn-ask:active {
  background: linear-gradient(180deg,
    #8A3329 0%,
    #6E2820 100%);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(232, 162, 72, 0.18) !important;
  transform: translateY(1px);
}

/* The send button's label should always read EXECUTE-tone caps.
   If the visible text is "Send" / "ask" in QSS, we don't rewrite copy here —
   the casing + tracking + font shifts the perceived register. */
```

### B.4 — Mode pills → terminal tabs

`.composer-modes .mode-btn` becomes inline mono tabs with a single amber underline on the active one. No backgrounds, no borders, no color swatches.

```css
body[data-world="burgundy"] .composer-modes {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  margin: 0;
  background: rgba(8, 18, 24, 0.55);
  border: none;
  border-top: 1px solid rgba(232, 217, 184, 0.10);
  border-radius: 0 0 4px 4px;
}

body[data-world="burgundy"] .composer-modes .mode-btn {
  flex: 0 0 auto;
  padding: 8px 16px;
  background: transparent !important;
  border: none !important;
  border-right: 1px solid rgba(232, 217, 184, 0.06) !important;
  border-radius: 0 !important;
  color: rgba(232, 217, 184, 0.55);
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  transition: color 120ms ease-out;
  box-shadow: none !important;
}

body[data-world="burgundy"] .composer-modes .mode-btn:last-child {
  border-right: none !important;
}

body[data-world="burgundy"] .composer-modes .mode-btn:hover:not(.active) {
  color: var(--ink);
  background: rgba(232, 162, 72, 0.04) !important;
}

body[data-world="burgundy"] .composer-modes .mode-btn.active {
  color: var(--ink-bright);
  background: transparent !important;
}

/* The one amber accent — under-rail on the active tab */
body[data-world="burgundy"] .composer-modes .mode-btn.active::after {
  content: '';
  position: absolute;
  left: 12px; right: 12px;
  bottom: 0;
  height: 2px;
  background: var(--yolk);
  box-shadow: 0 0 10px rgba(232, 162, 72, 0.55);
}

/* Prepend a tiny `>` glyph to whichever tab is active — makes the row read
   as a terminal prompt, not as toggles. */
body[data-world="burgundy"] .composer-modes .mode-btn.active::before {
  content: '> ';
  color: var(--yolk);
  margin-right: 4px;
  opacity: 0.85;
}
```

---

## C — Story Blocks (worn-page treatment)

### C.0 — Reset the QSS sticker physics

```css
body[data-world="burgundy"] .story-block,
body[data-world="burgundy"] .story-block:nth-child(odd),
body[data-world="burgundy"] .story-block:nth-child(even) {
  transform: none !important;
  box-shadow: none !important;             /* dual-light mixin re-applies */
  border-radius: 4px !important;
}

body[data-world="burgundy"] .story-block:hover {
  transform: none !important;
}

/* Kill the rainbow b-num palette */
body[data-world="burgundy"] .story-block:nth-child(4n+1) .b-num,
body[data-world="burgundy"] .story-block:nth-child(4n+2) .b-num,
body[data-world="burgundy"] .story-block:nth-child(4n+3) .b-num,
body[data-world="burgundy"] .story-block:nth-child(4n+4) .b-num {
  background: none !important;
}
```

### C.1 — Aged-cream block face

```css
body[data-world="burgundy"] .story-block {
  background:
    /* faint paper-noise wash on top */
    radial-gradient(ellipse at 30% 20%,
      rgba(232, 217, 184, 0.04) 0%,
      transparent 60%),
    /* aged-cream base, very dark — these are pages lit by lamp from above */
    linear-gradient(155deg,
      rgba(58, 50, 38, 0.88) 0%,
      rgba(40, 34, 26, 0.92) 50%,
      rgba(26, 22, 18, 0.96) 100%);
  border: 1px solid rgba(232, 217, 184, 0.14);
  padding: 14px 16px 14px 64px;             /* room for the bronze medallion */
  position: relative;
  /* dual-light mixin applies */
  transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
}

/* watercolor edge wear — ink-wash darkening on bottom + right edges */
body[data-world="burgundy"] .story-block::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    linear-gradient(180deg, transparent 70%, rgba(0,0,0,0.20) 100%),
    linear-gradient(90deg, transparent 80%, rgba(0,0,0,0.18) 100%);
  mix-blend-mode: multiply;
  opacity: 0.85;
}

body[data-world="burgundy"] .story-block:hover {
  border-color: rgba(232, 162, 72, 0.42);
  box-shadow:
    inset  1px  1px 0 rgba(232, 162, 72, 0.28),
    inset  2px  2px 0 rgba(232, 162, 72, 0.10),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    0 6px 24px rgba(0, 0, 0, 0.55),
    0 0 36px rgba(232, 162, 72, 0.10);
}
```

### C.2 — Bronze medallion block numbers

```css
body[data-world="burgundy"] .story-block .b-num {
  position: absolute;
  left: 14px;
  top: 14px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%,
      #D89A4A 0%,
      #A86E26 35%,
      #5C3712 100%);
  color: #1A0F0C;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2E1A08;
  box-shadow:
    inset 0 1px 1px rgba(255, 220, 160, 0.45),
    inset 0 -2px 3px rgba(0, 0, 0, 0.55),
    0 2px 4px rgba(0, 0, 0, 0.55),
    0 0 0 2px rgba(232, 217, 184, 0.10);    /* hairline cream stamp ring */
  text-shadow: 0 1px 0 rgba(255, 220, 160, 0.32);
}
```

### C.3 — Typography on block content (serif, Cambo italic for summaries)

```css
/* The summary line — Cambo italic, painterly title-card */
body[data-world="burgundy"] .story-block .b-summary {
  font-family: 'Cambo', var(--serif), Georgia, serif;
  font-style: italic;
  font-size: 17px;
  line-height: 1.45;
  color: var(--ink-bright);
  letter-spacing: 0;
}

body[data-world="burgundy"] .story-block .b-summary:hover {
  color: #FFF6E0;
}

/* Full text — heavier book serif */
body[data-world="burgundy"] .story-block .b-text {
  font-family: 'Cambo', var(--serif), Georgia, serif;
  font-style: normal;
  font-size: 16px;
  line-height: 1.7;
  color: var(--ink);
}

/* Chevron — small amber tick instead of QSS */
body[data-world="burgundy"] .story-block .b-summary .chev {
  color: var(--yolk);
  opacity: 0.55;
}
body[data-world="burgundy"] .story-block.expanded .b-summary .chev {
  opacity: 0.85;
}
```

### C.4 — Karaoke / playing / editing states harmonized

```css
/* Active read-along — pulls the painterly amber lamp closer */
body[data-world="burgundy"] .story-block.karaoke {
  background:
    linear-gradient(155deg,
      rgba(72, 60, 42, 0.92) 0%,
      rgba(50, 42, 30, 0.95) 100%);
  border-color: rgba(232, 162, 72, 0.55);
  box-shadow:
    inset  1px  1px 0 rgba(232, 162, 72, 0.38),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    0 6px 28px rgba(0, 0, 0, 0.55),
    0 0 32px rgba(232, 162, 72, 0.22);
}

body[data-world="burgundy"] .story-block.karaoke .b-num {
  background:
    radial-gradient(circle at 35% 30%,
      #F4C66A 0%,
      #C8852E 35%,
      #6E430E 100%);
}

/* Active word highlight inside read-along — amber wash, not red */
body[data-world="burgundy"] .story-block .b-text .b-word.active {
  background: rgba(232, 162, 72, 0.28);
  color: #FFF6E0;
  text-shadow: 0 0 10px rgba(232, 162, 72, 0.45);
}

/* Editing mode — terminal-input dashed border, phosphor green */
body[data-world="burgundy"] .story-block.editing .b-text {
  background: rgba(8, 24, 16, 0.55);
  border: 1px dashed rgba(91, 214, 138, 0.55);
  color: #D4F5DE;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 14px;
  caret-color: var(--sky);
}
```

---

## D — Pane-control toolbar (story toolbar)

`touch base` (`.pane-ctrl-primary`) stands out. Siblings read as utility tabs.

```css
/* Utility tabs — the row of small toggles */
body[data-world="burgundy"] .pane-ctrl-btn {
  padding: 7px 13px;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink);
  background: linear-gradient(180deg,
    rgba(36, 56, 68, 0.88) 0%,
    rgba(20, 36, 46, 0.94) 100%);
  border: 1px solid rgba(232, 217, 184, 0.14);
  border-radius: 3px !important;
  /* dual-light mixin applies */
  transform: none !important;
  transition: border-color 140ms ease-out, color 140ms ease-out;
}

body[data-world="burgundy"] .pane-ctrl-btn:hover {
  background: linear-gradient(180deg,
    rgba(48, 68, 80, 0.92) 0%,
    rgba(28, 44, 54, 0.96) 100%);
  border-color: rgba(232, 162, 72, 0.32);
  color: var(--ink-bright);
  transform: none !important;
}

body[data-world="burgundy"] .pane-ctrl-btn.ghost {
  background: rgba(15, 30, 38, 0.45);
  border-style: dashed;
  border-color: rgba(232, 217, 184, 0.18);
  box-shadow: none !important;
}

/* PLAYING state — was QSS red sticker pulse. Now: amber LED ring + steady */
body[data-world="burgundy"] .pane-ctrl-btn.playing {
  background: linear-gradient(180deg,
    rgba(72, 60, 42, 0.95) 0%,
    rgba(50, 42, 30, 0.98) 100%);
  border-color: rgba(232, 162, 72, 0.65);
  color: #FFF6E0;
  animation: bg-pane-playing 1.4s ease-in-out infinite;
}

@keyframes bg-pane-playing {
  0%, 100% { box-shadow:
    inset  1px  1px 0 rgba(232, 162, 72, 0.38),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.45),
    0 0 16px rgba(232, 162, 72, 0.22); }
  50%      { box-shadow:
    inset  1px  1px 0 rgba(232, 162, 72, 0.55),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.45),
    0 0 28px rgba(232, 162, 72, 0.42); }
}

/* The PRIMARY action — touch base — heavy machined lever, slightly bigger,
   amber underline. This is the deliberate action; the others are utility. */
body[data-world="burgundy"] .pane-ctrl-btn.pane-ctrl-primary {
  padding: 8px 18px;
  font-size: 12px;
  color: #FFF6E0;
  background: linear-gradient(180deg,
    #2C4858 0%,
    #1F3644 50%,
    #102230 100%);
  border-color: rgba(232, 162, 72, 0.32);
  position: relative;
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.18),
    inset 1px 1px 0 rgba(232, 162, 72, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    0 3px 10px rgba(0, 0, 0, 0.50),
    0 0 20px rgba(232, 162, 72, 0.12) !important;
}

body[data-world="burgundy"] .pane-ctrl-btn.pane-ctrl-primary::after {
  content: '';
  position: absolute;
  left: 10px; right: 10px;
  bottom: -1px;
  height: 1.5px;
  background: var(--yolk);
  box-shadow: 0 0 10px rgba(232, 162, 72, 0.55);
  pointer-events: none;
}

body[data-world="burgundy"] .pane-ctrl-btn.pane-ctrl-primary:hover {
  background: linear-gradient(180deg,
    #355368 0%,
    #284052 50%,
    #142A38 100%);
  border-color: rgba(232, 162, 72, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.24),
    inset 1px 1px 0 rgba(232, 162, 72, 0.24),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    0 4px 14px rgba(0, 0, 0, 0.55),
    0 0 32px rgba(232, 162, 72, 0.22) !important;
}
```

---

## E — Welcome Hero (CSS only — copy strings untouched)

The shell around "what story will you write today, Henry?" — boots like a terminal.

```css
/* Reset v1 hero physics */
body[data-world="burgundy"] .welcome-hero {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 36px 0 28px;
  position: relative;
  text-align: left;
}

/* The eyebrow — small all-caps mono in amber.
   The page header should inject this once above .wh-title:
     <div class="wh-eyebrow">RICO_MK1 // INIT —</div>
   If unavailable to inject markup, the ::before below stands in. */
body[data-world="burgundy"] .welcome-hero::before {
  content: 'RICO_MK1 // INIT —';
  display: block;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--yolk);
  text-shadow: 0 0 10px rgba(232, 162, 72, 0.35);
  margin-bottom: 14px;
  opacity: 0.95;
}

/* The welcome line itself — copy unchanged, chrome changes */
body[data-world="burgundy"] .welcome-hero .wh-title {
  font-family: 'Cambo', var(--serif), Georgia, serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(28px, 3.4vw, 44px);
  line-height: 1.15;
  letter-spacing: 0;
  color: var(--ink-bright);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
  margin: 0 0 22px 0;
  transform: none !important;
}

/* Henry's name — was QSS red sticker. Now: cream text with amber underline. */
body[data-world="burgundy"] .welcome-hero .wh-title .wh-name {
  color: #FFF6E0 !important;
  font-style: italic;
  font-weight: 600;
  background: none !important;
  padding: 0 !important;
  border: none !important;
  box-shadow: none !important;
  transform: none !important;
  position: relative;
  display: inline-block;
  text-decoration: none;
  border-bottom: 2px solid var(--yolk);
  padding-bottom: 1px !important;
  text-shadow:
    0 2px 8px rgba(0, 0, 0, 0.65),
    0 0 18px rgba(232, 162, 72, 0.22);
}

/* CTA button — heavy machined lever. Copy stays whatever it is. */
body[data-world="burgundy"] .welcome-hero .wh-cta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 22px;
  background: linear-gradient(180deg,
    #2C4858 0%,
    #1F3644 50%,
    #102230 100%);
  color: #FFF6E0;
  border: 1px solid rgba(232, 162, 72, 0.32);
  border-radius: 3px;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  cursor: pointer;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
  position: relative;
  transform: none !important;
  /* dual-light mixin applied via selector list */
  transition: border-color 140ms ease-out, filter 140ms ease-out;
}

body[data-world="burgundy"] .welcome-hero .wh-cta::before {
  content: '> ';
  color: var(--yolk);
  font-weight: 700;
  opacity: 0.95;
}

body[data-world="burgundy"] .welcome-hero .wh-cta:hover {
  border-color: rgba(232, 162, 72, 0.65);
  filter: brightness(1.10);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.22),
    inset 1px 1px 0 rgba(232, 162, 72, 0.20),
    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
    0 4px 16px rgba(0, 0, 0, 0.55),
    0 0 26px rgba(232, 162, 72, 0.25) !important;
  transform: none !important;
}

body[data-world="burgundy"] .welcome-hero .wh-cta:active {
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(232, 162, 72, 0.18) !important;
  transform: translateY(1px) !important;
}
```

**One small markup note (optional).** If the page can inject a `<div class="wh-eyebrow">RICO_MK1 // INIT —</div>` directly above `.wh-title`, the `::before` rule above can be removed and the eyebrow gets cleaner accessibility semantics. Either path works visually.

---

## F — The Pattern Interrupt: RICO eye on the active block

When a block is `.playing` (the TTS read-along is on it), its bronze number medallion morphs into a single live RICO_MK1 phosphor eye that blinks on the same 4.5s cadence as the mascot. The whole world is being read by the same machine.

```css
/* When a block is actively being read, the medallion becomes RICO's eye */
body[data-world="burgundy"] .story-block.playing .b-num {
  background: #0A1A10 !important;          /* dead-CRT dark glass */
  border: 1px solid #2E1A08;
  color: transparent !important;            /* hide the number digit */
  position: absolute;                       /* re-state from C.2 */
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.75),
    inset 0 0 12px rgba(91, 214, 138, 0.32),
    0 0 18px rgba(91, 214, 138, 0.28),
    0 0 0 2px rgba(232, 217, 184, 0.10);
  overflow: hidden;
}

/* The pupil — a single phosphor pixel that blinks */
body[data-world="burgundy"] .story-block.playing .b-num::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  background: var(--sky);                   /* CRT phosphor green */
  border-radius: 1px;
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 6px rgba(91, 214, 138, 0.85),
    0 0 14px rgba(91, 214, 138, 0.45);
  animation: bg-rico-eye-blink 4.5s ease-in-out infinite;
}

/* Faint scanlines inside the eye */
body[data-world="burgundy"] .story-block.playing .b-num::before {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: 50%;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.25) 0px,
    rgba(0, 0, 0, 0.25) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
}

@keyframes bg-rico-eye-blink {
  0%, 55%, 65%, 100% { height: 8px; opacity: 1; }
  60%                { height: 1px; opacity: 0.7; }
}
```

**Why this is the right pattern interrupt.** It's diegetic — the mascot is literally inside the work. It only fires on the active block, so the cost is one screen element at a time. It costs zero markup changes (the `.playing` class already exists and toggles per block in QSS). And it lands the world's thesis in one frame: *the machine you built is now reading what you wrote.*

---

## G — Implementation Diff Checklist

Drop this v2 file into the same stylesheet or `<style>` block after v1. Then verify:

1. Open `/queen-scarlet-school/` (library) in Burgundy world. The welcome hero should boot like a terminal, not greet like a friend.
2. Open the cast page composer. Confirm single-row mic | textarea | send layout, amber caret, mode tabs as underlined mono pills.
3. Confirm the mic button is a dark machined panel with a dead-LED look; toggle listening — LED only pulses red, body stays still.
4. Confirm the send button is a sienna-bronze lever, press it, confirm pressed-in physics.
5. Confirm story blocks have no rotation, no rainbow numbers, all medallions are bronze, summaries are Cambo italic.
6. Toggle a block to `.playing` (start TTS on it). Confirm its medallion becomes a phosphor green eye that blinks on the same cadence as RICO_MK1.
7. Hover the `touch base` button — amber underline glows, dual-light shifts.
8. Sanity: nothing on the page should still feel like a sticker. If anything does, it's an inline `style=""` or a QSS rule whose specificity needs to lose. Inspect, find, override.

---

## H — Gotchas Specific to v2

- **The QSS `micPulse` keyframe still animates the whole mic button.** v1 inherited this. The override `animation: none` on `.mic-btn.listening` above is mandatory or the button will rock.
- **The `:nth-child` rainbow number rules are high-specificity.** The `:nth-child(4n+1) .b-num { background: none !important }` block in C.0 is the safe kill.
- **The `transform` overrides on hover/active need `!important`** because QSS uses non-default specificity on its sticker physics. Don't try to win the cascade without it on these specific selectors — confirmed by inspecting `index.html`.
- **The `#kid-input` ID may need its own override** if it has inline styles. The selector chain `body[data-world="burgundy"] .composer.with-mic #kid-input` is intentionally specific to overpower inline.
- **`wh-name` overrides are aggressive (`!important` everywhere)** because the QSS version applies multiple sticker properties via the parent welcome-hero. We're surgically un-stickering one nested element.
- **The amber under-rail under the composer (`.composer.with-mic::after`)** sits at `bottom: -1px` — confirm the parent panel isn't `overflow: hidden`. If it is, change to `bottom: 0`.
- **Mascot stays from v1.** RICO_MK1 SVG and `.burgundy-decor` corner fragments are unchanged. The eye-on-playing-block in section F intentionally rhymes with the mascot's eye SVG cadence — keep both at 4.5s or they fall out of sync visually.

---

## I — Single line of intent

The chrome is the workshop. The story is the cloak. RICO is the eye. One lamp, one machine, one voice — and Henry's words across all of it.

*Match the painting. Don't blink first.*
