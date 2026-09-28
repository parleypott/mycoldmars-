/* The James Watch Hunt — public gallery. Just the listings + a shared
   "Mel Approves" box per watch (state via /api/watch-approvals). Nothing else. */

const BASE = window.WH_BASE || "";
const API = window.WH_APPROVALS_API || "/api/watch-approvals";

const $ = (s, e = document) => e.querySelector(s);
const grid = $("#grid");

const state = { listings: [], approved: new Set(), pending: new Set() };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FALLBACK = `<svg class="fallback" viewBox="0 0 200 200"><g fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="100" cy="100" r="62"/><circle cx="100" cy="100" r="70" stroke-width="1.5"/><line x1="100" y1="100" x2="100" y2="55" stroke-linecap="round"/><line x1="100" y1="100" x2="132" y2="112" stroke-linecap="round"/><path d="M70 32 L74 14 M130 32 L126 14 M70 168 L74 186 M130 168 L126 186"/></g></svg>`;
window.__fb = (el) => { el.parentElement.innerHTML = FALLBACK; };

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
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

async function load() {
  const [listings, approved] = await Promise.all([
    fetch(`${BASE}/listings.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetchApproved(),
  ]);
  state.listings = listings;
  state.approved = new Set(approved);
  grid.setAttribute("aria-busy", "false");
  render();
}

function card(l) {
  const on = state.approved.has(l.id);
  const img = l.photo_local || l.photo_url;
  return `<article class="card ${on ? "approved" : ""}" data-id="${l.id}">
    <div class="photo" data-open>${img ? `<img loading="lazy" src="${esc(img)}" alt="${esc(l.title)}" onerror="window.__fb(this)" />` : FALLBACK}</div>
    <div class="body">
      <h2 class="title" data-open>${esc(l.title)}</h2>
      <span class="price">${esc(l.price_display)}</span>
      <button class="approve-btn ${on ? "on" : ""}" data-approve aria-pressed="${on}">
        <span class="box">✓</span><span class="lbl">Mel Approves</span>
      </button>
    </div>
  </article>`;
}

function render() {
  grid.innerHTML = state.listings.length
    ? state.listings.map(card).join("")
    : `<p class="empty">No watches to show.</p>`;
}

async function toggle(id, btn) {
  if (state.pending.has(id)) return;
  const willApprove = !state.approved.has(id);
  state.pending.add(id);
  btn.classList.add("busy");
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
  if (!el) return;
  el.classList.toggle("approved", on);
  const b = el.querySelector(".approve-btn");
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
}

grid.addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  const id = c.dataset.id;
  const l = state.listings.find((x) => x.id === id);
  if (e.target.closest("[data-approve]")) return toggle(id, c.querySelector(".approve-btn"));
  if (e.target.closest("[data-open]") && l) window.open(l.url, "_blank", "noopener");
});

// keep the view fresh as Mel taps on her phone
setInterval(async () => {
  if (state.pending.size) return;
  const next = new Set(await fetchApproved());
  let changed = next.size !== state.approved.size;
  if (!changed) for (const id of next) if (!state.approved.has(id)) { changed = true; break; }
  if (changed) {
    state.approved = next;
    for (const l of state.listings) reflect(l.id);
  }
}, 12000);

load();
