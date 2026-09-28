/* Watch Hunt front-end. No framework — one state object, render functions per view. */

// ---------------------------------------------------------------- state

const state = {
  view: "quiz",
  profile: null,
  manifest: {}, // card key -> [{src, credit}]
  listings: [],
  decisions: {},
  quizStep: "basics", // basics | deck | brands | done
  deckIndex: 0,
  huntStatus: null,
  huntPoll: null,
  filters: { maxPrice: "", brand: "", size: "", dealer: "", papers: false },
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $("#app");

// STATIC mode: a hosted, server-less snapshot. Profile + shortlist live in the
// visitor's own browser (localStorage); listings are a baked JSON file; the
// live hunt and re-verify (which need the API key + a real browser) are hidden.
const STATIC = !!window.WH_STATIC;
const BASE = window.WH_BASE || ""; // e.g. "/watch" when deployed under a subpath
const LS = {
  profile: "wh-profile",
  decisions: "wh-decisions",
};

const DEFAULT_PROFILE = {
  budget: [3500, 6500],
  size_pref: "any",
  styles: {},
  metals: {},
  dials: {},
  band: {},
  brands: { include: [], exclude: [], surprise: true },
  include_marketplaces: false,
  completed: false,
  updated_at: new Date(0).toISOString(),
};

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const api = {
  async get(p) {
    if (STATIC) {
      if (p === "/api/profile") return lsGet(LS.profile, structuredClone(DEFAULT_PROFILE));
      if (p === "/api/listings") {
        const r = await fetch(`${BASE}/listings.json`);
        const listings = r.ok ? await r.json() : [];
        return { listings, decisions: lsGet(LS.decisions, {}) };
      }
      if (p === "/api/hunt/status") return { running: false, phase: "static", log: [], thin_searches: [] };
      return {};
    }
    return fetch(p).then((r) => r.json());
  },
  async post(p, body) {
    if (STATIC) {
      if (p === "/api/profile") {
        body.updated_at = new Date().toISOString();
        lsSet(LS.profile, body);
        return body;
      }
      if (p === "/api/decision") {
        const d = lsGet(LS.decisions, {});
        if (body.decision) d[body.id] = body.decision;
        else delete d[body.id];
        lsSet(LS.decisions, d);
        return { ok: true };
      }
      return { ok: false, static: true };
    }
    return fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  },
};

// ---------------------------------------------------------------- cards

const BRANDS = ["Rolex", "Omega", "Universal Genève", "Jaeger-LeCoultre", "Cartier", "Longines", "Heuer", "IWC", "Tudor", "Grand Seiko", "Zenith"];

const CARDS = [
  { group: "styles", key: "dress", kind: "round", title: "The time-only dress watch", sub: "Smooth bezel, no date, nothing it doesn't need. The quietest thing in the room." },
  { group: "styles", key: "piepan", kind: "piepan", title: "The pie-pan dial", sub: "A faceted dial that catches light like cut stone — Omega's Constellation made it famous." },
  { group: "styles", key: "rectangular", kind: "tank", title: "The rectangular", sub: "Tank-style. Deco geometry on the wrist; reads as jewelry as much as instrument." },
  { group: "styles", key: "field", kind: "field", title: "The field & explorer", sub: "Legible, matte, workmanlike. Numerals you can read at a glance in bad light." },
  { group: "styles", key: "sport", kind: "diver", title: "The understated sport", sub: "Skin-divers and gentleman's sport watches — capable, but never shouting about it." },
  { group: "styles", key: "chrono", kind: "chrono", title: "The chronograph", sub: "Two or three registers, a tachymeter maybe. The busiest dial of the bunch." },
  { group: "metals", key: "steel", kind: "round", title: "Stainless steel", sub: "Cool, grey, ages into soft satin. The default of the tool-watch era." },
  { group: "metals", key: "gold", kind: "gold", title: "Gold", sub: "Yellow or rose, solid or capped. Warms every dial it frames." },
  { group: "metals", key: "twotone", kind: "twotone", title: "Two-tone", sub: "Steel case, gold bezel and accents. Very 1965. Either you love it or you don't." },
  { group: "dials", key: "silverwhite", kind: "round", title: "Silver & white dials", sub: "The classic. Disappears under a cuff, works with everything." },
  { group: "dials", key: "black", kind: "black", title: "Black dials", sub: "Higher contrast, a little more presence, still restrained." },
  { group: "dials", key: "cream", kind: "cream", title: "Cream & patina", sub: "Sixty years of sun in the lacquer. No two age the same way." },
  { group: "dials", key: "blue", kind: "blue", title: "Blue dials", sub: "Rarer in vintage — from slate grey-blue to deep navy." },
  { group: "dials", key: "other", kind: "exotic", title: "The unusual dial", sub: "Linen texture, salmon, tropical brown, sector layouts — character pieces." },
  { group: "band", key: "bracelet", kind: "bracelet", title: "On a bracelet", sub: "Beads-of-rice, Oyster, mesh. Jangles a little; wears cooler in summer." },
  { group: "band", key: "leather", kind: "strap", title: "On leather", sub: "The dressier read. Swappable, forgiving on size, quieter on the wrist." },
];

const GROUP_LABEL = { styles: "style archetype", metals: "case metal", dials: "dial color", band: "bracelet or strap" };

// ---------------------------------------------------------------- placeholder illustrations

function placeholderSVG(kind, i = 0) {
  const s = 'fill="none" stroke="currentColor" stroke-width="2.5"';
  const markers = Array.from({ length: 12 }, (_, k) => {
    const a = (k * Math.PI) / 6;
    const x1 = 100 + Math.sin(a) * 52, y1 = 100 - Math.cos(a) * 52;
    const x2 = 100 + Math.sin(a) * 60, y2 = 100 - Math.cos(a) * 60;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${s}/>`;
  }).join("");
  const hands = `<line x1="100" y1="100" x2="100" y2="55" ${s} stroke-linecap="round"/><line x1="100" y1="100" x2="132" y2="112" ${s} stroke-linecap="round"/>`;
  const lugs = `<path d="M70 32 L74 14 M130 32 L126 14 M70 168 L74 186 M130 168 L126 186" ${s}/>`;
  const round = (extra = "", fill = "none") =>
    `<svg viewBox="0 0 200 200" style="color:var(--ink-35)"><g opacity="0.9">${lugs}<circle cx="100" cy="100" r="70" ${s}/><circle cx="100" cy="100" r="62" ${s} ${fill ? `fill="${fill}"` : ""} stroke-width="1.5"/>${markers}${hands}${extra}</g></svg>`;
  switch (kind) {
    case "tank":
      return `<svg viewBox="0 0 200 200" style="color:var(--ink-35)"><g opacity="0.9"><rect x="58" y="34" width="84" height="132" ${s}/><rect x="66" y="46" width="68" height="108" ${s} stroke-width="1.5"/><line x1="100" y1="100" x2="100" y2="62" ${s} stroke-linecap="round"/><line x1="100" y1="100" x2="122" y2="108" ${s} stroke-linecap="round"/><path d="M58 34 L58 16 M142 34 L142 16 M58 166 L58 184 M142 166 L142 184" ${s}/></g></svg>`;
    case "chrono":
      return round(`<circle cx="72" cy="100" r="13" ${s} stroke-width="1.5"/><circle cx="128" cy="100" r="13" ${s} stroke-width="1.5"/><circle cx="100" cy="132" r="13" ${s} stroke-width="1.5"/><rect x="166" y="70" width="10" height="14" ${s}/><rect x="166" y="116" width="10" height="14" ${s}/>`);
    case "diver":
      return `<svg viewBox="0 0 200 200" style="color:var(--ink-35)"><g opacity="0.9">${lugs}<circle cx="100" cy="100" r="72" ${s} stroke-width="5"/><circle cx="100" cy="100" r="58" ${s} stroke-width="1.5"/><circle cx="100" cy="46" r="4" fill="currentColor"/>${hands}</g></svg>`;
    case "field":
      return round(`<text x="100" y="52" text-anchor="middle" font-size="13" fill="currentColor" font-family="monospace">12</text><text x="152" y="105" text-anchor="middle" font-size="13" fill="currentColor" font-family="monospace">3</text><text x="100" y="160" text-anchor="middle" font-size="13" fill="currentColor" font-family="monospace">6</text><text x="48" y="105" text-anchor="middle" font-size="13" fill="currentColor" font-family="monospace">9</text>`);
    case "piepan":
      return round(`<polygon points="100,44 148,72 148,128 100,156 52,128 52,72" ${s} stroke-width="1.2" opacity="0.7"/>`);
    case "gold":
      return `<svg viewBox="0 0 200 200" style="color:#a8892c"><g opacity="0.85">${lugs}<circle cx="100" cy="100" r="70" ${s}/><circle cx="100" cy="100" r="62" ${s} stroke-width="1.5"/>${markers}${hands}</g></svg>`;
    case "twotone":
      return `<svg viewBox="0 0 200 200"><g opacity="0.85"><g style="color:var(--ink-35)">${lugs}<circle cx="100" cy="100" r="70" ${s}/></g><g style="color:#a8892c"><circle cx="100" cy="100" r="62" ${s}/></g><g style="color:var(--ink-35)">${markers}${hands}</g></g></svg>`;
    case "black":
      return round("", "rgba(32,28,22,0.75)");
    case "cream":
      return round("", "rgba(213,193,150,0.5)");
    case "blue":
      return round("", "rgba(66,84,120,0.45)");
    case "exotic":
      return round(`<path d="M52 100 H148 M100 62 V100" ${s} stroke-width="1" opacity="0.6"/>`);
    case "bracelet":
      return `<svg viewBox="0 0 200 200" style="color:var(--ink-35)"><g opacity="0.9"><circle cx="100" cy="100" r="46" ${s}/><path d="M78 60 h44 M78 48 h44 M78 36 h44 M78 152 h44 M78 140 h44 M78 164 h44" ${s} stroke-width="2"/><path d="M78 60 v-30 M122 60 v-30 M100 60 v-30 M78 140 v30 M122 140 v30 M100 140 v30" ${s} stroke-width="1"/><line x1="100" y1="100" x2="100" y2="70" ${s} stroke-linecap="round"/><line x1="100" y1="100" x2="118" y2="108" ${s} stroke-linecap="round"/></g></svg>`;
    case "strap":
      return `<svg viewBox="0 0 200 200" style="color:var(--ink-35)"><g opacity="0.9"><circle cx="100" cy="100" r="46" ${s}/><path d="M84 58 Q100 48 116 58 L112 20 Q100 14 88 20 Z" ${s} stroke-width="1.6"/><path d="M84 142 Q100 152 116 142 L112 180 Q100 186 88 180 Z" ${s} stroke-width="1.6"/><line x1="100" y1="100" x2="100" y2="70" ${s} stroke-linecap="round"/><line x1="100" y1="100" x2="118" y2="108" ${s} stroke-linecap="round"/></g></svg>`;
    default:
      return round();
  }
}

// ---------------------------------------------------------------- init

async function init() {
  const saved = localStorage.getItem("wh-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";

  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("wh-theme", next);
  });

  $$(".nav-btn[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      setView(b.dataset.view);
    }),
  );

  document.addEventListener("keydown", onKey);

  const [profile, manifest, listingData] = await Promise.all([
    api.get("/api/profile"),
    fetch(`${BASE}/cache/manifest.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    api.get("/api/listings"),
  ]);
  state.profile = profile;
  state.manifest = manifest;
  state.listings = listingData.listings ?? [];
  state.decisions = listingData.decisions ?? {};

  if (profile.completed && state.listings.length) {
    state.view = "results";
    $$(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === "results"));
  }
  render();
  if (!STATIC) pollHuntIfRunning();
}

function setView(v) {
  state.view = v;
  $$(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  render();
}

function render() {
  updateShortlistCount();
  app.onclick = null; // views assign their own delegated handler
  if (state.view === "quiz") renderQuiz();
  else if (state.view === "results") renderResults();
  else renderShortlist();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- quiz

function renderQuiz() {
  if (state.quizStep === "basics") renderBasics();
  else if (state.quizStep === "deck") renderDeck();
  else if (state.quizStep === "brands") renderBrands();
  else renderQuizDone();
}

function renderBasics() {
  const p = state.profile;
  app.innerHTML = `
    <div class="quiz-stage">
      <div class="section-head">
        <span class="eyebrow">part one · the brief</span>
        <h2>Before we look at a single watch.</h2>
        <p>Two practical questions, then the fun part. Everything is saved as you go — come back and edit any time.</p>
      </div>
      <div class="field-block">
        <div class="field-label">Budget</div>
        <div class="budget-readout"><span id="b-lo"></span><span class="sep">—</span><span id="b-hi"></span></div>
        <div class="dual-slider">
          <div class="slider-track"></div>
          <div class="slider-fill" id="slider-fill"></div>
          <input type="range" id="r-lo" min="1000" max="15000" step="250" value="${p.budget[0]}" />
          <input type="range" id="r-hi" min="1000" max="15000" step="250" value="${p.budget[1]}" />
        </div>
      </div>
      <div class="field-block">
        <div class="field-label">Case size</div>
        <div class="pill-row" id="size-row">
          ${[["under34", "under 34mm"], ["34-36", "34–36mm"], ["37-39", "37–39mm"], ["40plus", "40mm +"], ["any", "no preference"]]
            .map(([k, label]) => `<button class="pill ${p.size_pref === k ? "on" : ""}" data-size="${k}">${label}</button>`)
            .join("")}
        </div>
      </div>
      <div class="quiz-actions">
        <span class="quiz-note">↳ next: sixteen quick cards. arrow keys work.</span>
        <button class="btn primary" id="to-deck">Begin the cards →</button>
      </div>
    </div>`;

  const lo = $("#r-lo"), hi = $("#r-hi");
  const update = () => {
    let a = +lo.value, b = +hi.value;
    if (a > b - 500) { if (event?.target === lo) a = b - 500, (lo.value = a); else b = a + 500, (hi.value = b); }
    $("#b-lo").textContent = `$${a.toLocaleString()}`;
    $("#b-hi").textContent = `$${b.toLocaleString()}`;
    const min = +lo.min, max = +lo.max;
    const fill = $("#slider-fill");
    fill.style.left = `${((a - min) / (max - min)) * 100}%`;
    fill.style.right = `${100 - ((b - min) / (max - min)) * 100}%`;
    state.profile.budget = [a, b];
  };
  lo.addEventListener("input", update);
  hi.addEventListener("input", update);
  update();

  $("#size-row").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.profile.size_pref = btn.dataset.size;
    $$("#size-row .pill").forEach((x) => x.classList.toggle("on", x === btn));
    saveProfile(false);
  });

  $("#to-deck").addEventListener("click", () => {
    saveProfile(false);
    state.quizStep = "deck";
    state.deckIndex = firstUnansweredCard();
    render();
  });
}

function firstUnansweredCard() {
  const p = state.profile;
  const idx = CARDS.findIndex((c) => !p[c.group][c.key]);
  return idx === -1 ? 0 : idx;
}

function renderDeck() {
  const i = state.deckIndex;
  if (i >= CARDS.length) {
    state.quizStep = "brands";
    render();
    return;
  }
  const card = CARDS[i];
  const photos = (state.manifest[card.key] ?? []).slice(0, 3);
  const cells = photos.length
    ? photos.map((ph) => `<div class="ph"><img src="${ph.src}" alt="" onerror="this.parentElement.innerHTML=window.__ph('${card.kind}')" /></div>`).join("")
    : `<div class="ph">${placeholderSVG(card.kind, 0)}</div>`;
  const n = photos.length || 1;

  app.innerHTML = `
    <div class="deck-wrap">
      <div class="deck-progress">card <b>${String(i + 1).padStart(2, "0")}</b> / ${CARDS.length} · ${GROUP_LABEL[card.group]}</div>
      <div class="swipe-card" id="swipe-card">
        <div class="card-photos n${Math.min(n, 3)}">${cells}</div>
        <span class="card-group-tag">${GROUP_LABEL[card.group]}</span>
        <h3>${card.title}</h3>
        <p class="card-sub">${card.sub}</p>
        <div class="vote-row">
          <button class="vote" data-vote="pass">✕ &nbsp;Pass</button>
          <button class="vote" data-vote="like">Like</button>
          <button class="vote love" data-vote="love">♥ &nbsp;Love</button>
        </div>
        <div class="key-hints"><kbd>←</kbd> pass &nbsp; <kbd>→</kbd> like &nbsp; <kbd>↑</kbd> love &nbsp; <kbd>⌫</kbd> back</div>
      </div>
    </div>`;

  $$("#swipe-card .vote").forEach((b) => b.addEventListener("click", () => voteCard(b.dataset.vote)));
}

window.__ph = (kind) => placeholderSVG(kind);

function voteCard(vote) {
  const card = CARDS[state.deckIndex];
  if (!card) return;
  state.profile[card.group][card.key] = vote;
  saveProfile(false);
  const el = $("#swipe-card");
  if (el) {
    el.classList.add(vote === "pass" ? "exit-left" : vote === "love" ? "exit-up" : "exit-right");
    setTimeout(() => {
      state.deckIndex++;
      renderDeck();
    }, 240);
  } else {
    state.deckIndex++;
    renderDeck();
  }
}

function onKey(e) {
  if (state.view !== "quiz" || state.quizStep !== "deck") return;
  if (e.key === "ArrowLeft") voteCard("pass");
  else if (e.key === "ArrowRight") voteCard("like");
  else if (e.key === "ArrowUp") { e.preventDefault(); voteCard("love"); }
  else if (e.key === "Backspace") {
    e.preventDefault();
    state.deckIndex = Math.max(0, state.deckIndex - 1);
    renderDeck();
  }
}

function renderBrands() {
  const p = state.profile;
  const stateOf = (b) => (p.brands.include.includes(b) ? "include" : p.brands.exclude.includes(b) ? "exclude" : "neutral");
  app.innerHTML = `
    <div class="quiz-stage">
      <div class="section-head">
        <span class="eyebrow">part three · the makers</span>
        <h2>Any strong feelings about brands?</h2>
        <p>Tap once to include, twice to exclude, three times to clear. Leave everything neutral and the hunt roams freely.</p>
      </div>
      <div class="field-block">
        <div class="field-label">Brands</div>
        <div class="pill-row" id="brand-row">
          ${BRANDS.map((b) => {
            const s = stateOf(b);
            return `<button class="pill ${s === "include" ? "on" : s === "exclude" ? "exclude" : ""}" data-brand="${b}">${b}</button>`;
          }).join("")}
          <button class="pill ${p.brands.surprise ? "on" : ""}" data-surprise="1">surprise me</button>
        </div>
      </div>
      <div class="field-block">
        <div class="field-label">Marketplaces</div>
        <div class="pill-row">
          <button class="pill ${p.include_marketplaces ? "on" : ""}" id="mk-toggle">include eBay & Etsy (private sellers — riskier)</button>
        </div>
      </div>
      <div class="quiz-actions">
        <button class="btn" id="back-deck">← back to cards</button>
        <button class="btn primary" id="finish-quiz">Save my profile →</button>
      </div>
    </div>`;

  $("#brand-row").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-brand],[data-surprise]");
    if (!btn) return;
    if (btn.dataset.surprise) {
      p.brands.surprise = !p.brands.surprise;
      btn.classList.toggle("on", p.brands.surprise);
    } else {
      const b = btn.dataset.brand;
      const s = stateOf(b);
      p.brands.include = p.brands.include.filter((x) => x !== b);
      p.brands.exclude = p.brands.exclude.filter((x) => x !== b);
      if (s === "neutral") p.brands.include.push(b);
      else if (s === "include") p.brands.exclude.push(b);
      btn.className = `pill ${s === "neutral" ? "on" : s === "include" ? "exclude" : ""}`;
    }
    saveProfile(false);
  });
  $("#mk-toggle").addEventListener("click", (e) => {
    p.include_marketplaces = !p.include_marketplaces;
    e.target.classList.toggle("on", p.include_marketplaces);
    saveProfile(false);
  });
  $("#back-deck").addEventListener("click", () => {
    state.quizStep = "deck";
    state.deckIndex = 0;
    render();
  });
  $("#finish-quiz").addEventListener("click", async () => {
    p.completed = true;
    await saveProfile(true);
    state.quizStep = "done";
    render();
  });
}

function renderQuizDone() {
  const p = state.profile;
  const loved = CARDS.filter((c) => p[c.group][c.key] === "love").map((c) => c.title.replace(/^The /, "").toLowerCase());
  app.innerHTML = `
    <div class="quiz-stage" style="text-align:center; padding: 60px 0;">
      <div class="section-head" style="text-align:center">
        <span class="eyebrow">profile saved</span>
        <h2>The brief is set.</h2>
        <p style="margin: 14px auto 0">$${p.budget[0].toLocaleString()}–$${p.budget[1].toLocaleString()} · ${p.size_pref === "any" ? "any size" : p.size_pref.replace("under34", "under 34mm").replace("40plus", "40mm+") + "mm".replace("mmmm", "mm")}${loved.length ? ` · loves: ${loved.slice(0, 4).join(", ")}` : ""}</p>
      </div>
      <div style="display:flex; gap:14px; justify-content:center; margin-top: 30px;">
        <button class="btn" id="edit-quiz">edit answers</button>
        <button class="btn primary" id="go-hunt">Start the hunt →</button>
      </div>
    </div>`;
  $("#edit-quiz").addEventListener("click", () => {
    state.quizStep = "basics";
    render();
  });
  $("#go-hunt").addEventListener("click", async () => {
    setView("results");
    await startHunt();
  });
}

async function saveProfile(toastIt) {
  state.profile = await api.post("/api/profile", state.profile);
  if (toastIt) toast("profile saved to data/profile.json");
}

// ---------------------------------------------------------------- results

function renderResults() {
  const running = state.huntStatus?.running;
  const listings = filteredListings();
  const brands = [...new Set(state.listings.map((l) => l.brand).filter(Boolean))].sort();
  const dealers = [...new Set(state.listings.map((l) => l.dealer).filter(Boolean))].sort();

  app.innerHTML = `
    <div class="hunt-bar">
      <div class="section-head" style="margin:0">
        <span class="eyebrow">part two · the hunt</span>
        <h2>${state.listings.length ? `${state.listings.length} verified listings.` : "The hunt."}</h2>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        ${STATIC ? "" : `<button class="btn primary" id="run-hunt" ${running ? "disabled" : ""}>${running ? "hunting…" : state.listings.length ? "Hunt again" : "Start the hunt"}</button>`}
      </div>
    </div>
    ${STATIC ? snapshotNote() : `<div class="hunt-log" id="hunt-log" ${state.huntStatus?.log?.length ? "" : "hidden"}></div>`}
    ${state.listings.length ? renderFilters(brands, dealers) : ""}
    <div class="grid" id="grid"></div>
    ${!state.listings.length && !running ? emptyState() : ""}
  `;

  $("#run-hunt")?.addEventListener("click", startHunt);
  bindFilters();
  if (!STATIC) drawLog();
  drawGrid(listings);
}

function snapshotNote() {
  const when = window.WH_SNAPSHOT_DATE || "recently";
  return `<div class="snapshot-note">
    Every watch below was machine-verified in stock on <b>${esc(when)}</b> — its dealer page was fetched and checked for a live buy button, with sold, on-hold and waitlisted pieces dropped. Listings move fast, so treat this as a curated starting point: <b>click any card to open the dealer's page and confirm it's still available before you buy.</b>
  </div>`;
}

function emptyState() {
  if (STATIC) {
    return `<div class="empty-state">
      <h3>No listings loaded.</h3>
      <p>This snapshot didn't ship any watches — try reloading the page.</p>
    </div>`;
  }
  return `<div class="empty-state">
    <h3>Nothing on the table yet.</h3>
    <p>Finish the questionnaire, then start the hunt. Discovery searches the trusted dealers, and every candidate page gets fetched and checked for a live buy button before it earns a place here.</p>
  </div>`;
}

function renderFilters(brands, dealers) {
  const f = state.filters;
  return `<div class="filters">
    <label>max price <input type="number" id="f-price" step="250" placeholder="any" value="${f.maxPrice}" style="width:90px" /></label>
    <label>brand <select id="f-brand"><option value="">all</option>${brands.map((b) => `<option ${f.brand === b ? "selected" : ""}>${b}</option>`).join("")}</select></label>
    <label>size <select id="f-size">
      <option value="">all</option>
      <option value="under34" ${f.size === "under34" ? "selected" : ""}>under 34mm</option>
      <option value="34-36" ${f.size === "34-36" ? "selected" : ""}>34–36mm</option>
      <option value="37-39" ${f.size === "37-39" ? "selected" : ""}>37–39mm</option>
      <option value="40plus" ${f.size === "40plus" ? "selected" : ""}>40mm+</option>
    </select></label>
    <label>dealer <select id="f-dealer"><option value="">all</option>${dealers.map((d) => `<option ${f.dealer === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="f-papers" ${f.papers ? "checked" : ""}/> box &amp; papers</label>
    <span class="spacer"></span>
    <label id="f-count"></label>
  </div>`;
}

function bindFilters() {
  const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
  on("#f-price", "input", (e) => { state.filters.maxPrice = e.target.value; drawGrid(filteredListings()); });
  on("#f-brand", "change", (e) => { state.filters.brand = e.target.value; drawGrid(filteredListings()); });
  on("#f-size", "change", (e) => { state.filters.size = e.target.value; drawGrid(filteredListings()); });
  on("#f-dealer", "change", (e) => { state.filters.dealer = e.target.value; drawGrid(filteredListings()); });
  on("#f-papers", "change", (e) => { state.filters.papers = e.target.checked; drawGrid(filteredListings()); });
}

function filteredListings() {
  const f = state.filters;
  return state.listings.filter((l) => {
    if (f.maxPrice && l.price_usd && l.price_usd > +f.maxPrice) return false;
    if (f.brand && l.brand !== f.brand) return false;
    if (f.dealer && l.dealer !== f.dealer) return false;
    if (f.papers && !(l.box_papers && /set|papers|box/i.test(l.box_papers))) return false;
    if (f.size && l.case_size_mm != null) {
      const mm = l.case_size_mm;
      const ok =
        (f.size === "under34" && mm < 34) ||
        (f.size === "34-36" && mm >= 34 && mm <= 36.9) ||
        (f.size === "37-39" && mm >= 37 && mm <= 39.9) ||
        (f.size === "40plus" && mm >= 40);
      if (!ok) return false;
    }
    return true;
  });
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function listingCard(l) {
  const decision = state.decisions[l.id];
  const specs = [
    l.reference && `ref <b>${l.reference}</b>`,
    l.year && `<b>${l.year}</b>`,
    l.case_size_mm && `<b>${l.case_size_mm}mm</b>`,
    l.material && `<b>${esc(l.material)}</b>`,
    l.box_papers && `<b>${esc(l.box_papers)}</b>`,
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join("");
  const img = l.photo_local || l.photo_url;
  return `<article class="card ${decision === "pass" ? "dimmed" : ""}" data-id="${l.id}">
    <div class="photo" data-open>${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.outerHTML=window.__ph('round')" />` : placeholderSVG("round")}</div>
    <span class="badge">✓ verified in stock · ${timeAgo(l.verified_at)}</span>
    ${l.marketplace_warning ? `<span class="badge warn">⚠ unvetted marketplace seller</span>` : ""}
    ${l.score != null ? `<span class="score-chip">${l.score}</span>` : ""}
    <div class="card-body">
      <h3 data-open>${esc(l.title)}</h3>
      <div class="price-line"><span class="price">${l.price_display}</span></div>
      <div class="dealer-line">${esc(l.dealer)}${l.dealer_location ? ` · ${esc(l.dealer_location)}` : ""}${l.warranty ? " · warranty" : ""}</div>
      <div class="spec-row">${specs || "<span>details on listing</span>"}</div>
      ${l.score_why ? `<p class="why">${esc(l.score_why)}</p>` : ""}
      ${l.price_flag ? `<p class="price-flag">⚑ ${esc(l.price_flag)}</p>` : ""}
      <div class="card-actions">
        <button class="vote like ${decision === "like" ? "on" : ""}" data-decide="like">${decision === "like" ? "♥ shortlisted" : "shortlist"}</button>
        <button class="vote ${decision === "pass" ? "on" : ""}" data-decide="pass">pass</button>
      </div>
      <div class="verified-line">✓ ${esc(l.verify_reason)} <span style="flex:1"></span>${STATIC ? `<a class="reverify-btn" href="${esc(l.url)}" target="_blank" rel="noopener">open ↗</a>` : `<button class="reverify-btn" data-reverify>re-verify</button>`}</div>
    </div>
  </article>`;
}

function drawGrid(listings) {
  const grid = $("#grid");
  if (!grid) return;
  grid.innerHTML = listings.map(listingCard).join("");
  const count = $("#f-count");
  if (count) count.textContent = `${listings.length} shown`;
  bindCardEvents(grid);
}

function bindCardEvents(root) {
  root.onclick = async (e) => {
    const cardEl = e.target.closest(".card");
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    const l = state.listings.find((x) => x.id === id);
    if (!l) return;

    if (e.target.closest("[data-open]")) {
      window.open(l.url, "_blank", "noopener");
      return;
    }
    const decideBtn = e.target.closest("[data-decide]");
    if (decideBtn) {
      const d = decideBtn.dataset.decide;
      const next = state.decisions[id] === d ? null : d;
      if (next) state.decisions[id] = next;
      else delete state.decisions[id];
      await api.post("/api/decision", { id, decision: next });
      render();
      return;
    }
    if (e.target.closest("[data-reverify]")) {
      e.target.textContent = "checking…";
      const res = await api.post("/api/reverify", { id });
      if (res.ok) {
        l.verified_at = res.verified_at;
        l.verify_reason = res.reason;
        toast("still in stock ✓");
      } else {
        state.listings = state.listings.filter((x) => x.id !== id);
        toast(`gone: ${res.reason}`);
      }
      render();
    }
  };
}

// ---------------------------------------------------------------- hunt status

async function startHunt() {
  if (!state.profile?.completed) {
    toast("finish the questionnaire first");
    setView("quiz");
    return;
  }
  const res = await api.post("/api/hunt", {});
  if (!res.ok && res.error) toast(res.error);
  pollHuntIfRunning(true);
}

function pollHuntIfRunning(force) {
  if (state.huntPoll) clearInterval(state.huntPoll);
  const tick = async () => {
    state.huntStatus = await api.get("/api/hunt/status");
    if (state.view === "results") {
      drawLog();
      const btn = $("#run-hunt");
      if (btn) {
        btn.disabled = state.huntStatus.running;
        btn.textContent = state.huntStatus.running ? `hunting… ${state.huntStatus.verified} verified` : state.listings.length ? "Hunt again" : "Start the hunt";
      }
    }
    if (!state.huntStatus.running && state.huntStatus.phase === "done") {
      clearInterval(state.huntPoll);
      state.huntPoll = null;
      const data = await api.get("/api/listings");
      const had = state.listings.length;
      state.listings = data.listings;
      state.decisions = data.decisions;
      if (state.view === "results" && (had !== state.listings.length || !had)) render();
    }
    if (!state.huntStatus.running && state.huntStatus.phase !== "done" && !force) {
      clearInterval(state.huntPoll);
      state.huntPoll = null;
    }
  };
  tick();
  state.huntPoll = setInterval(tick, 2500);
}

function drawLog() {
  const el = $("#hunt-log");
  if (!el || !state.huntStatus) return;
  const s = state.huntStatus;
  if (!s.log?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = s.log.slice(-120).join("\n");
  if (s.thin_searches?.length && !s.running) {
    el.innerHTML = esc(s.log.slice(-120).join("\n")) + `\n<span class="thin">thin searches: ${esc(s.thin_searches.join(" | "))}</span>`;
  }
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- shortlist

function updateShortlistCount() {
  const n = Object.values(state.decisions).filter((d) => d === "like").length;
  const el = $("#shortlist-count");
  el.hidden = n === 0;
  el.textContent = n;
}

function renderShortlist() {
  const liked = state.listings.filter((l) => state.decisions[l.id] === "like");
  if (!liked.length) {
    app.innerHTML = `<div class="empty-state"><h3>Nothing shortlisted yet.</h3><p>Hit “shortlist” on any result and it lands here, side by side with the others.</p></div>`;
    return;
  }
  const row = (label, fn) => `<tr><td>${label}</td>${liked.map((l) => `<td>${fn(l)}</td>`).join("")}</tr>`;
  app.innerHTML = `
    <div class="section-head">
      <span class="eyebrow">the shortlist</span>
      <h2>${liked.length} in contention.</h2>
      <p>Side by side. Click a title to open the dealer's page; re-verify before you commit.</p>
    </div>
    <div class="compare-scroll"><table class="compare-table">
      ${row("", (l) => {
        const img = l.photo_local || l.photo_url;
        return img ? `<img src="${esc(img)}" alt="" onerror="this.style.display='none'" />` : "";
      })}
      ${row("watch", (l) => `<span class="c-title"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a></span>`)}
      ${row("price", (l) => `<span class="c-price">${l.price_display}</span>${l.price_flag ? `<br/><span class="price-flag">⚑ suspicious price</span>` : ""}`)}
      ${row("score", (l) => `${l.score ?? "—"} <span style="color:var(--ink-60)">/100</span><br/><span style="font-size:13px;color:var(--ink-60);font-style:italic">${esc(l.score_why ?? "")}</span>`)}
      ${row("dealer", (l) => `${esc(l.dealer)}${l.dealer_location ? `<br/><span style="color:var(--ink-60)">${esc(l.dealer_location)}</span>` : ""}${l.marketplace_warning ? `<br/><span style="color:var(--warn)">⚠ unvetted seller</span>` : ""}`)}
      ${row("reference", (l) => esc(l.reference ?? "—"))}
      ${row("year", (l) => esc(l.year ?? "—"))}
      ${row("case", (l) => `${l.case_size_mm ? l.case_size_mm + "mm" : "—"}${l.material ? " · " + esc(l.material) : ""}`)}
      ${row("dial", (l) => esc(l.dial ?? "—"))}
      ${row("band", (l) => esc(l.bracelet_strap ?? "—"))}
      ${row("box & papers", (l) => esc(l.box_papers ?? "unstated"))}
      ${row("warranty", (l) => esc(l.warranty ?? "—"))}
      ${row("verified", (l) => `<span style="color:var(--verified)">✓ ${timeAgo(l.verified_at)}</span><br/>${STATIC ? `<a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener" style="margin-top:8px; display:inline-block">open listing ↗</a>` : `<button class="btn small" data-sl-reverify="${l.id}" style="margin-top:8px">re-verify</button>`}`)}
      ${row("", (l) => `<button class="btn small" data-sl-remove="${l.id}">remove</button>`)}
    </table></div>`;

  app.onclick = async (e) => {
    const rv = e.target.closest("[data-sl-reverify]");
    if (rv) {
      rv.textContent = "checking…";
      const id = rv.dataset.slReverify;
      const res = await api.post("/api/reverify", { id });
      if (res.ok) toast("still in stock ✓");
      else {
        state.listings = state.listings.filter((x) => x.id !== id);
        toast(`gone: ${res.reason}`);
      }
      render();
    }
    const rm = e.target.closest("[data-sl-remove]");
    if (rm) {
      const id = rm.dataset.slRemove;
      delete state.decisions[id];
      await api.post("/api/decision", { id, decision: null });
      render();
    }
  };
}

// ---------------------------------------------------------------- misc

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

init();
