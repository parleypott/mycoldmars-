/* The James Watch Hunt — public gallery. Baked listings + shared "Mel Approves"
   state via /api/watch-approvals (Supabase-backed). Mobile-first, optimistic. */

const BASE = window.WH_BASE || "";
const API = window.WH_APPROVALS_API || "/api/watch-approvals";

const $ = (s, e = document) => e.querySelector(s);
const grid = $("#grid");

const state = {
  listings: [],
  approved: new Set(), // shared, from the server
  filter: "all",
  pending: new Set(),
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FALLBACK = `<svg class="fallback" viewBox="0 0 200 200"><g fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="100" cy="100" r="62"/><circle cx="100" cy="100" r="70" stroke-width="1.5"/><line x1="100" y1="100" x2="100" y2="55" stroke-linecap="round"/><line x1="100" y1="100" x2="132" y2="112" stroke-linecap="round"/><path d="M70 32 L74 14 M130 32 L126 14 M70 168 L74 186 M130 168 L126 186"/></g></svg>`;
window.__fb = (el) => { el.parentElement.innerHTML = FALLBACK; };

// ---- theme ----
(() => {
  const saved = localStorage.getItem("jwh-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("jwh-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#17150f" : "#f5f1e8");
  });
})();

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---- data ----
async function load() {
  const [listings, approved] = await Promise.all([
    fetch(`${BASE}/listings.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetchApproved(),
  ]);
  state.listings = listings;
  state.approved = new Set(approved);
  grid.setAttribute("aria-busy", "false");
  render();
  $("#foot").textContent = `${listings.length} watches · verified in stock · confirm on the dealer's page before buying`;
}

async function fetchApproved() {
  try {
    const r = await fetch(API, { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.approved) ? d.approved : [];
  } catch {
    return [];
  }
}

function card(l) {
  const on = state.approved.has(l.id);
  const img = l.photo_local || l.photo_url;
  return `<article class="card ${on ? "approved" : ""}" data-id="${l.id}">
    <div class="photo" data-open>
      ${img ? `<img loading="lazy" src="${esc(img)}" alt="${esc(l.title)}" onerror="window.__fb(this)" />` : FALLBACK}
      <span class="ribbon">♥ Mel approves</span>
    </div>
    <div class="body">
      <h2 class="title" data-open>${esc(l.title)}</h2>
      <div class="meta">
        <span class="price">${esc(l.price_display)}</span>
        <span class="dealer"><span class="dot"></span>${esc(l.dealer)}</span>
      </div>
      <a class="open" href="${esc(l.url)}" target="_blank" rel="noopener">view &amp; buy ↗</a>
      <button class="approve-btn ${on ? "on" : ""}" data-approve aria-pressed="${on}">
        <span class="box">✓</span><span class="lbl">Mel Approves</span>
      </button>
    </div>
  </article>`;
}

function render() {
  const list = state.filter === "mel" ? state.listings.filter((l) => state.approved.has(l.id)) : state.listings;
  grid.innerHTML = list.length
    ? list.map(card).join("")
    : `<p class="empty">${state.filter === "mel" ? "No picks yet — Mel hasn't approved any." : "No watches to show."}</p>`;
  $("#count-all").textContent = state.listings.length ? `· ${state.listings.length}` : "";
  const n = state.approved.size;
  $("#count-mel").textContent = n ? `· ${n}` : "";
}

// ---- approve toggle (optimistic, shared) ----
async function toggle(id, btn) {
  if (state.pending.has(id)) return;
  const willApprove = !state.approved.has(id);
  state.pending.add(id);
  btn.classList.add("busy");

  // optimistic
  if (willApprove) state.approved.add(id);
  else state.approved.delete(id);
  reflect(id);

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approved: willApprove, by: "mel" }),
    });
    if (!r.ok) throw new Error("save failed");
  } catch {
    // revert
    if (willApprove) state.approved.delete(id);
    else state.approved.add(id);
    reflect(id);
    toast("couldn't save — check connection, tap again");
  } finally {
    state.pending.delete(id);
    btn.classList.remove("busy");
  }
}

function reflect(id) {
  const on = state.approved.has(id);
  const el = grid.querySelector(`.card[data-id="${id}"]`);
  if (el) {
    el.classList.toggle("approved", on);
    const b = el.querySelector(".approve-btn");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const n = state.approved.size;
  $("#count-mel").textContent = n ? `· ${n}` : "";
  if (state.filter === "mel") {
    // keep the filtered view honest without a full re-render jump
    const c = grid.querySelector(`.card[data-id="${id}"]`);
    if (c && !on) c.classList.add("hide");
  }
}

grid.addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  const id = c.dataset.id;
  const l = state.listings.find((x) => x.id === id);
  if (e.target.closest("[data-approve]")) {
    toggle(id, c.querySelector(".approve-btn"));
    return;
  }
  if (e.target.closest("[data-open]") && l) window.open(l.url, "_blank", "noopener");
});

$("#seg").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  state.filter = b.dataset.filter;
  document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  render();
});

// keep Johnny's view fresh as Mel taps on her phone
setInterval(async () => {
  if (state.pending.size) return; // don't stomp an in-flight toggle
  const before = state.approved.size;
  state.approved = new Set(await fetchApproved());
  if (state.approved.size !== before || state.filter === "mel") render();
}, 12000);

load();
