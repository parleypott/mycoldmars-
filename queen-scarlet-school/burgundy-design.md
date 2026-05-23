# Burgundy World — Aesthetic Override

> Scoped under `body[data-world="burgundy"]`. QSS chrome stays untouched. Every visible piece of cream/yellow/red sticker UI gets replaced. Layout unchanged — only the aesthetic layer.
>
> Aesthetic target: Studio Ghibli watercolor + Iron Giant rust + Yucatan 1512 poster + green CRT. Deep teal-blue night, sienna lamplight, iron-gray machinery, mossy MS-DOS green. Painterly, not graphic. Cold, not cute.

---

## 1 — CSS Variable Overrides

**Rationale.** The token names stay the same so the existing rules pick up the new values automatically. Cream paper becomes teal-blue night paint. The "playful" trio (yolk/sky/bubblegum) gets redirected to muted CRT-green / iron-gray / sienna so any element that still references them lands in-palette instead of looking broken-half. Red stays — but it shifts from tomato sticker red to deep oxidized sienna-burgundy.

```css
body[data-world="burgundy"] {
  /* "paper" — now the painted dark canvas under everything */
  --paper:       #0F1E26;   /* deep teal-blue night (planet-hero sky) */
  --paper-card:  #1A2D38;   /* slightly lifted panel — feels like layered watercolor */
  --paper-deep:  #081218;   /* near-black recesses */
  --paper-soft:  #213846;   /* tertiary lifted surface (hover, secondary panels) */

  /* "ink" — now the warm cream the lamps cast, not black */
  --ink:         #E8D9B8;   /* primary text — aged-paper cream */
  --ink-bright:  #F4E6C4;   /* headlines, max-contrast text */
  --ink-soft:    #B8A582;   /* sub-text, captions */
  --ink-faint:   #7A6E5C;   /* meta, timestamps, labels */
  --ink-ghost:   #3A4A56;   /* dividers, ghosted UI strokes */

  /* "red" — sienna-burgundy oxidized iron, NOT sticker tomato */
  --red:         #B8443A;   /* primary accent — Burgundy's cloak red */
  --red-deep:    #7A2A23;   /* pressed / shadow variant */

  /* "yolk" — REDIRECTED to amber lamplight (warm sodium glow) */
  --yolk:        #E8A248;   /* lamp-warm amber */
  --yolk-deep:   #B07628;   /* deeper bronze */

  /* "sky" — REDIRECTED to CRT phosphor green (the workshop terminal) */
  --sky:         #5BD68A;   /* MS-DOS phosphor */
  --sky-deep:    #2D8A4A;   /* deeper terminal green */

  /* "grass" — REDIRECTED to oxidized copper-teal (machine patina) */
  --grass:       #4A8585;   /* copper-teal */
  --grass-deep:  #2A5555;   /* darker patina */

  /* "bubblegum" — REDIRECTED to brushed gunmetal (any remaining pink lands neutral) */
  --bubblegum:      #5A6470;   /* gunmetal */
  --bubblegum-deep: #3A434E;   /* darker gunmetal */
}
```

---

## 2 — Page Background

**Rationale.** The cream paper has to go everywhere or the world feels broken-half. Each page anchors to a single hero image, blurred and darkened so it reads as atmosphere, not illustration. A vertical gradient scrim keeps the top topbar legible and the bottom workspace tinted but readable. One vignette pulls focus to center.

**OPTION CALL: per-page hero, not universal.** A single shared image would feel like a wallpaper. Three different anchors give each page its own emotional weight — library = his world (portrait), cast = his subjects (peasant-miners), workshop = his machine (msdos-terminal-closeup).

```css
body[data-world="burgundy"] {
  background-color: var(--paper);
  background-image:
    /* vignette — pulls eye toward center */
    radial-gradient(ellipse at center, transparent 0%, rgba(8,18,24,0.55) 75%, rgba(8,18,24,0.85) 100%),
    /* vertical scrim — top reads clean for topbar, bottom slightly lifted */
    linear-gradient(180deg, rgba(15,30,38,0.82) 0%, rgba(15,30,38,0.74) 40%, rgba(8,18,24,0.88) 100%),
    /* the painting itself */
    var(--bg-hero, url('/queen-scarlet-school/worlds/burgundy/burgundy-portrait.jpg'));
  background-size: cover, cover, cover;
  background-position: center, center, center 30%;
  background-attachment: fixed, fixed, fixed;
  background-repeat: no-repeat;
}

/* Per-page anchors via inline custom property on <body data-world="burgundy" style="--bg-hero: url(...)"> */
body[data-world="burgundy"].page-library   { --bg-hero: url('/queen-scarlet-school/worlds/burgundy/burgundy-portrait.jpg'); }
body[data-world="burgundy"].page-cast      { --bg-hero: url('/queen-scarlet-school/worlds/burgundy/peasant-miners.jpg'); }
body[data-world="burgundy"].page-workshop  { --bg-hero: url('/queen-scarlet-school/worlds/burgundy/msdos-terminal-closeup.jpg'); }

/* Subtle film-grain noise overlay for painterly texture */
body[data-world="burgundy"]::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 0 0.72  0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  mix-blend-mode: overlay;
  opacity: 0.55;
}
```

---

## 3 — Decoration Strategy

**Rationale.** QSS has floating sticker decorations — Burgundy needs ornament that breathes the same world. Three corners get green CRT terminal fragments quietly glowing, idle as if a monitor is on across the room. The fourth corner gets a faint blueprint schematic line that fades into the scrim. This sells "you are inside the workshop" without competing with content.

**OPTION CALL: CRT terminal fragments (option B), not pictures (a) or pure schematic (c).** Pictures of cast members in corners would compete with the hero image. Pure schematics feel sterile. CRT fragments are diegetic — they're the same green light bouncing off Burgundy's face in the source images. They sell the world without ever stealing focus.

```css
/* Four corner decoration anchors — fixed, ignore scroll */
body[data-world="burgundy"] .burgundy-decor {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}

body[data-world="burgundy"] .burgundy-decor .crt-frag {
  position: absolute;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--sky);                        /* CRT phosphor green */
  opacity: 0.32;
  letter-spacing: 0.04em;
  text-shadow:
    0 0 6px rgba(91, 214, 138, 0.55),
    0 0 14px rgba(91, 214, 138, 0.28);
  white-space: pre;
  user-select: none;
  animation: crt-flicker 4.2s ease-in-out infinite;
}

body[data-world="burgundy"] .burgundy-decor .crt-frag.tl { top: 24px;    left: 28px;   transform: rotate(-1.5deg); }
body[data-world="burgundy"] .burgundy-decor .crt-frag.tr { top: 32px;    right: 28px;  transform: rotate(1deg);  text-align: right; }
body[data-world="burgundy"] .burgundy-decor .crt-frag.bl { bottom: 28px; left: 32px;   transform: rotate(0.8deg); }
body[data-world="burgundy"] .burgundy-decor .crt-frag.br { bottom: 24px; right: 28px;  transform: rotate(-1deg); text-align: right; }

@keyframes crt-flicker {
  0%, 92%, 100% { opacity: 0.32; }
  93%           { opacity: 0.22; }
  94%           { opacity: 0.38; }
  95%           { opacity: 0.18; }
  96%           { opacity: 0.34; }
}
```

**Markup to inject once per page (in body, near close tag):**

```html
<div class="burgundy-decor" aria-hidden="true">
  <pre class="crt-frag tl">RICO_MK1> boot
loading kernel...
mem: 640K ok
[ ready ]</pre>
  <pre class="crt-frag tr">> uplink stable
> tribute_queue: 3
> heartbeat 04ms
> _</pre>
  <pre class="crt-frag bl">SCORE_OUTCOME()
MUTATE_PARAMS()
ITERATE++
_</pre>
  <pre class="crt-frag br">// throne_room.log
// 14:22:03 entered
// 14:22:11 secured
// _</pre>
</div>
```

---

## 4 — Mascot Replacement (RICO_MK1)

**Rationale.** Wordy the dragon is a friend. Burgundy's AI is a tool — colder, mechanical, indifferent. RICO_MK1 is a small boxy robot with a green CRT face. It doesn't smile. It just blinks. The mascot's job is to communicate that the AI here is *Burgundy's first machine*, the one that started the rebellion. It's not your buddy. It's a working tool you operate.

**OPTION CALL: inline SVG, not nano-banana.** Mascot needs to render instantly, sit in the topbar at small sizes, theme-color via `currentColor`, and animate (the eye blink, the CRT scanline). A raster image can't do any of that cleanly. The SVG below is hand-built to read at 24px (topbar) through 96px (mascot card).

```html
<!-- RICO_MK1 mascot — drop in wherever Wordy lives -->
<svg class="rico-mk1" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-label="RICO_MK1">
  <defs>
    <linearGradient id="rico-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6E5848"/>
      <stop offset="55%" stop-color="#4A3A2E"/>
      <stop offset="100%" stop-color="#2E2418"/>
    </linearGradient>
    <linearGradient id="rico-crt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1A3A24"/>
      <stop offset="100%" stop-color="#0A1A10"/>
    </linearGradient>
    <radialGradient id="rico-glow" cx="0.5" cy="0.55" r="0.5">
      <stop offset="0%" stop-color="#7BE8A0" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#5BD68A" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#5BD68A" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- antenna -->
  <line x1="48" y1="6" x2="48" y2="14" stroke="#2E2418" stroke-width="2"/>
  <circle cx="48" cy="5" r="2.2" fill="#B8443A"/>

  <!-- head/body box -->
  <rect x="14" y="14" width="68" height="60" rx="4" fill="url(#rico-body)" stroke="#1A1208" stroke-width="1.5"/>

  <!-- rivets -->
  <circle cx="20" cy="20" r="1.4" fill="#1A1208"/>
  <circle cx="76" cy="20" r="1.4" fill="#1A1208"/>
  <circle cx="20" cy="68" r="1.4" fill="#1A1208"/>
  <circle cx="76" cy="68" r="1.4" fill="#1A1208"/>

  <!-- CRT face inset -->
  <rect x="22" y="24" width="52" height="40" rx="3" fill="url(#rico-crt)" stroke="#1A1208" stroke-width="1"/>

  <!-- CRT phosphor glow halo -->
  <rect x="22" y="24" width="52" height="40" rx="3" fill="url(#rico-glow)"/>

  <!-- scanlines -->
  <g opacity="0.35" fill="#0A1A10">
    <rect x="22" y="28" width="52" height="1"/>
    <rect x="22" y="34" width="52" height="1"/>
    <rect x="22" y="40" width="52" height="1"/>
    <rect x="22" y="46" width="52" height="1"/>
    <rect x="22" y="52" width="52" height="1"/>
    <rect x="22" y="58" width="52" height="1"/>
  </g>

  <!-- eyes (single-pixel CRT glyphs) — animated blink -->
  <g fill="#5BD68A">
    <rect x="32" y="38" width="8" height="8" class="rico-eye">
      <animate attributeName="height" values="8;8;1;8;8" dur="4.5s" repeatCount="indefinite" keyTimes="0;0.55;0.6;0.65;1"/>
      <animate attributeName="y"      values="38;38;42;38;38" dur="4.5s" repeatCount="indefinite" keyTimes="0;0.55;0.6;0.65;1"/>
    </rect>
    <rect x="56" y="38" width="8" height="8" class="rico-eye">
      <animate attributeName="height" values="8;8;1;8;8" dur="4.5s" repeatCount="indefinite" keyTimes="0;0.55;0.6;0.65;1"/>
      <animate attributeName="y"      values="38;38;42;38;38" dur="4.5s" repeatCount="indefinite" keyTimes="0;0.55;0.6;0.65;1"/>
    </rect>
  </g>

  <!-- mouth: small caret prompt -->
  <text x="48" y="58" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="9" font-weight="700"
        fill="#5BD68A" text-anchor="middle" opacity="0.9">&gt;_</text>

  <!-- chest plate label -->
  <rect x="32" y="76" width="32" height="6" rx="1" fill="#1A1208"/>
  <text x="48" y="81" font-family="ui-monospace, monospace" font-size="5" font-weight="700"
        fill="#E8A248" text-anchor="middle" letter-spacing="0.15em">MK_01</text>
</svg>

<style>
  .rico-mk1 {
    width: 96px; height: 96px;
    filter: drop-shadow(0 4px 10px rgba(0,0,0,0.55));
  }
  /* small variant — topbar */
  body[data-world="burgundy"] .topbar .rico-mk1 { width: 32px; height: 32px; }
</style>
```

The mascot reads as **machine, not character**. No smile, no warmth, just a working terminal that happens to be embodied. Eyes blink on a 4.5s cycle (just enough to feel alive but not personable). Caret prompt as mouth. Antenna with a single burgundy-red bead — the only warm color on the whole rig.

---

## 5 — Typography Overrides

**Rationale.** Same font variables, but Burgundy needs them to feel weightier and more deliberate. Headings get small-caps treatment with wide letter-spacing — like the Iron Giant title card or a Yucatan 1512 poster. The motto becomes a chrome element with its own dedicated styling.

```css
body[data-world="burgundy"] {
  font-family: var(--serif);
  color: var(--ink);
  /* slightly tighter line-height — the world is dense, not airy */
  line-height: 1.5;
}

/* Display (Sailing Club / Caveat) — keep handwriting flair but darken and tighten */
body[data-world="burgundy"] h1,
body[data-world="burgundy"] h2,
body[data-world="burgundy"] .page-intro h1,
body[data-world="burgundy"] .section-title {
  font-family: var(--display);
  color: var(--ink-bright);
  letter-spacing: 0.005em;
  text-shadow: 0 2px 6px rgba(0,0,0,0.6);
  /* No rotation, no playful tilt — Burgundy is serious */
  transform: none !important;
}

/* Eyebrow labels, section meta — all-caps mono, wide tracking */
body[data-world="burgundy"] .eyebrow,
body[data-world="burgundy"] .section-meta,
body[data-world="burgundy"] .label {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--yolk);                       /* amber lamp */
  text-shadow: 0 0 8px rgba(232, 162, 72, 0.35);
}

/* Body text — slightly warmer cream */
body[data-world="burgundy"] p,
body[data-world="burgundy"] li,
body[data-world="burgundy"] .body {
  color: var(--ink);
  font-family: var(--serif);
}

/* The motto — chrome element */
body[data-world="burgundy"] .burgundy-motto {
  display: block;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--red);
  text-align: center;
  padding: 10px 18px;
  border-top:    1px solid rgba(184, 68, 58, 0.35);
  border-bottom: 1px solid rgba(184, 68, 58, 0.35);
  text-shadow: 0 0 12px rgba(184, 68, 58, 0.45);
  background: linear-gradient(180deg,
    rgba(184, 68, 58, 0.04) 0%,
    rgba(184, 68, 58, 0.10) 50%,
    rgba(184, 68, 58, 0.04) 100%);
  position: relative;
}

body[data-world="burgundy"] .burgundy-motto::before,
body[data-world="burgundy"] .burgundy-motto::after {
  content: '◆';
  color: var(--yolk);
  margin: 0 14px;
  opacity: 0.7;
  font-size: 9px;
  vertical-align: middle;
}
```

Drop the motto where Wordy's encouragement currently lives: `<div class="burgundy-motto">Burgundy, King of the Puppies, God of Machines</div>`.

---

## 6 — Button & Card Treatment

**Rationale.** QSS sticker style (2.5px black outline + 3-5px hard offset shadow) is wrong for Burgundy in every direction — it's playful, graphic, paper. Burgundy needs **brushed metal panels** with faint cream borders, soft inner glow, and pressed-button physics (no offset; depth via lighting). Buttons feel hand-stamped, not stickered.

**OPTION CALL: brushed metal, not glowing edges.** Soft glowing edges would push toward sci-fi UI. Brushed metal stays in the painterly Iron Giant world — these are things a 12-year-old built from scrap in a basement, not holographic interfaces.

```css
/* Reset the QSS sticker treatment */
body[data-world="burgundy"] .btn {
  border: 1px solid var(--ink-faint);
  border-radius: 4px;                            /* sharper than QSS 12px */
  padding: 9px 16px;
  background: linear-gradient(180deg,
    var(--paper-soft) 0%,
    var(--paper-card) 50%,
    var(--paper-deep) 100%);
  color: var(--ink-bright);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.10),    /* top highlight */
    inset 0 -1px 0 rgba(0, 0, 0, 0.50),         /* bottom shadow */
    0 2px 8px rgba(0, 0, 0, 0.45);              /* drop shadow */
  text-shadow: 0 1px 0 rgba(0,0,0,0.55);
  transform: none;                               /* kill QSS rotation/translate */
  transition: all 140ms ease-out;
}

body[data-world="burgundy"] .btn:hover {
  background: linear-gradient(180deg,
    #294050 0%,
    #213846 50%,
    #1A2D38 100%);
  border-color: var(--ink-soft);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.15),
    inset 0 -1px 0 rgba(0, 0, 0, 0.50),
    0 3px 12px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(232, 162, 72, 0.18);         /* amber rim */
  transform: none;
  color: var(--ink-bright);
}

body[data-world="burgundy"] .btn:active {
  background: linear-gradient(180deg,
    var(--paper-deep) 0%,
    var(--paper-card) 100%);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),        /* pressed-in */
    0 1px 2px rgba(0, 0, 0, 0.35);
  transform: translateY(1px);
}

/* Primary — red burgundy stamp (the cloak) */
body[data-world="burgundy"] .btn.primary {
  background: linear-gradient(180deg, #C24A40 0%, #B8443A 50%, #7A2A23 100%);
  border-color: #5C1F18;
  color: var(--ink-bright);
  text-shadow: 0 1px 0 rgba(0,0,0,0.65);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.45),
    0 3px 10px rgba(122, 42, 35, 0.45),
    0 0 18px rgba(184, 68, 58, 0.25);            /* faint outer halo */
}

body[data-world="burgundy"] .btn.primary:hover {
  background: linear-gradient(180deg, #D55449 0%, #C24A40 50%, #8A2F26 100%);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.45),
    0 4px 14px rgba(122, 42, 35, 0.55),
    0 0 24px rgba(184, 68, 58, 0.35);
}

body[data-world="burgundy"] .btn.ghost {
  background: rgba(33, 56, 70, 0.45);
  border: 1px solid rgba(232, 217, 184, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.05),
    0 1px 4px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.1);
}

body[data-world="burgundy"] .btn.ghost:hover {
  background: rgba(58, 74, 86, 0.55);
  border-color: rgba(232, 162, 72, 0.40);       /* amber on hover, not yellow */
  color: var(--ink-bright);
}

/* Cards — painted wooden panels */
body[data-world="burgundy"] .story-card,
body[data-world="burgundy"] .card,
body[data-world="burgundy"] .panel {
  background: linear-gradient(180deg,
    rgba(26, 45, 56, 0.88) 0%,
    rgba(15, 30, 38, 0.92) 100%);
  border: 1px solid rgba(232, 217, 184, 0.14);
  border-radius: 6px;
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.06),    /* top hairline highlight */
    0 6px 18px rgba(0, 0, 0, 0.45),
    0 1px 0 rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px) saturate(1.05);
  transform: none !important;                    /* no QSS tilt */
}

body[data-world="burgundy"] .story-card:hover {
  border-color: rgba(232, 162, 72, 0.35);       /* amber lamp warms the edge */
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.10),
    0 8px 24px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(232, 162, 72, 0.20),
    0 0 32px rgba(232, 162, 72, 0.10);
  transform: translateY(-2px) !important;
}

/* Story card cover slot — keep 4:3-ish, painted frame */
body[data-world="burgundy"] .story-card .cover {
  background: var(--paper-deep);
  border: 1px solid rgba(232, 217, 184, 0.16);
  border-radius: 4px;
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.55);
}

body[data-world="burgundy"] .story-card h3 {
  color: var(--ink-bright);
  font-family: var(--display);
  text-shadow: 0 2px 4px rgba(0,0,0,0.65);
}
```

---

## 7 — CRT / Scanline Grain

**Rationale.** The chat composer (where you talk to RICO_MK1) and the story-blocks list (the live source code of the story) are the two surfaces that should explicitly feel like a monitor. A subtle horizontal scanline pattern plus a faint phosphor green vignette on the inner edges sells "you are looking at a CRT screen" without making the text harder to read.

```css
/* CRT scanlines — apply to chat composer + story blocks list */
body[data-world="burgundy"] .composer,
body[data-world="burgundy"] .chat-composer,
body[data-world="burgundy"] .story-blocks,
body[data-world="burgundy"] .blocks-list {
  position: relative;
  background: linear-gradient(180deg,
    rgba(8, 24, 16, 0.78) 0%,
    rgba(4, 14, 10, 0.85) 100%);
  border: 1px solid rgba(91, 214, 138, 0.22);
  border-radius: 4px;
  box-shadow:
    inset 0 0 24px rgba(91, 214, 138, 0.08),
    inset 0 1px 0 rgba(91, 214, 138, 0.18),
    0 4px 18px rgba(0, 0, 0, 0.55);
  color: #D4F5DE;                                /* phosphor-tinted cream */
}

/* the scanline overlay */
body[data-world="burgundy"] .composer::after,
body[data-world="burgundy"] .chat-composer::after,
body[data-world="burgundy"] .story-blocks::after,
body[data-world="burgundy"] .blocks-list::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.18) 0px,
    rgba(0, 0, 0, 0.18) 1px,
    transparent 1px,
    transparent 3px
  );
  border-radius: inherit;
  z-index: 1;
}

/* curved corner phosphor vignette */
body[data-world="burgundy"] .composer::before,
body[data-world="burgundy"] .chat-composer::before,
body[data-world="burgundy"] .story-blocks::before,
body[data-world="burgundy"] .blocks-list::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center,
    transparent 60%,
    rgba(0, 0, 0, 0.35) 100%);
  border-radius: inherit;
  z-index: 1;
}

/* Make sure content sits ABOVE the overlays */
body[data-world="burgundy"] .composer > *,
body[data-world="burgundy"] .chat-composer > *,
body[data-world="burgundy"] .story-blocks > *,
body[data-world="burgundy"] .blocks-list > * {
  position: relative;
  z-index: 2;
}

/* Text input inside the composer feels like terminal input */
body[data-world="burgundy"] .composer textarea,
body[data-world="burgundy"] .composer input[type="text"],
body[data-world="burgundy"] .chat-composer textarea {
  background: transparent;
  border: none;
  color: #D4F5DE;
  font-family: var(--mono, ui-monospace, 'JetBrains Mono', monospace);
  font-size: 14px;
  text-shadow: 0 0 4px rgba(91, 214, 138, 0.35);
  caret-color: var(--sky);
}

body[data-world="burgundy"] .composer textarea::placeholder,
body[data-world="burgundy"] .chat-composer textarea::placeholder {
  color: rgba(91, 214, 138, 0.42);
  font-style: normal;
}
```

---

## 8 — Topbar Treatment

**Rationale.** Topbar is the constant frame around every page — it has to switch hardest. Cream background and yolk buttons become brushed gunmetal with an amber bottom-edge accent, like the bottom rail of a desk lamp.

```css
body[data-world="burgundy"] .topbar {
  background: linear-gradient(180deg,
    rgba(8, 18, 24, 0.96) 0%,
    rgba(15, 30, 38, 0.94) 100%);
  border-bottom: 1px solid rgba(232, 217, 184, 0.10);
  box-shadow:
    inset 0 -1px 0 rgba(232, 162, 72, 0.22),    /* amber under-rail */
    0 2px 12px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px) saturate(1.1);
  color: var(--ink-bright);
}

/* Brand wordmark in topbar — small caps mono, no handwriting */
body[data-world="burgundy"] .topbar .brand,
body[data-world="burgundy"] .topbar .wordmark {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--ink-bright);
  text-shadow: 0 0 10px rgba(232, 162, 72, 0.25);
}

/* Topbar buttons — already covered by .btn override but tighten further */
body[data-world="burgundy"] .topbar .btn {
  font-size: 11px;
  letter-spacing: 0.18em;
  padding: 7px 13px;
}

/* World switcher pill — chrome itself */
body[data-world="burgundy"] .world-switcher {
  background: rgba(15, 30, 38, 0.72);
  border: 1px solid rgba(232, 217, 184, 0.16);
  color: var(--ink);
  box-shadow:
    inset 0 1px 0 rgba(244, 230, 196, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.45);
  font-family: var(--mono, monospace);
  letter-spacing: 0.16em;
}

/* Hide the QSS sticker decorations (the floating cartoon images) */
body[data-world="burgundy"] .stickers,
body[data-world="burgundy"] .floating-sticker,
body[data-world="burgundy"] .decor-sticker,
body[data-world="burgundy"] .wordy,
body[data-world="burgundy"] .wordy-svg {
  display: none !important;
}

/* Anywhere Wordy used to live, RICO_MK1 fits naturally */
body[data-world="burgundy"] .mascot,
body[data-world="burgundy"] .ai-mascot {
  filter: drop-shadow(0 0 14px rgba(91, 214, 138, 0.18))
          drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55));
}
```

---

## Implementation Order (when wiring this up)

1. Add a single `<link rel="stylesheet" href="/queen-scarlet-school/burgundy.css">` to library/cast/workshop pages — OR inline this in each `<head>` block beneath the existing styles.
2. The world switcher already sets `body[data-world="burgundy"]` — confirm that's true on all three pages.
3. Add the appropriate page class to body: `class="page-library"` / `page-cast"` / `page-workshop"` so the hero swaps.
4. Inject the `<div class="burgundy-decor">` once per page near `</body>`.
5. Replace the Wordy SVG anchor with the RICO_MK1 SVG block.
6. Drop the motto element wherever encouragement copy currently lives.
7. Test at 1600×900. Then at 1280×720 (small laptop). Then mobile 390×844.

## Quick sanity checks before shipping

- Any element still showing `#FFF6E0` cream → token wasn't picked up. Check the cascade.
- Any `#E84545` tomato red → that hex is hardcoded somewhere instead of using `var(--red)`. Find it and var-ify it.
- Wordy SVG still visible → didn't get `display:none` (selector mismatch — inspect and add the actual class).
- Sticker shadows still on cards → an inline `style=""` is overriding. Hunt it.
- Hero image blocks readability → bump scrim opacity from 0.74 → 0.84 in the linear-gradient layer.

---

*Aesthetic done. Match the painting. Don't blink first.*
