// research-hub frontend — vanilla JS, calls mycoldmars edge endpoints.
// All state lives client-side (localStorage). No server-side persistence.

import { mdToHtml } from "./md.js";
import { renderClarifyPanel } from "./clarify.js";
import { decidePollOutcome } from "./poll-decision.js";
import { parseSessionList } from "./sessions-store.js";
import { parseCookieValue } from "../shared/cookie.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ----- access code (matches the rest of mycoldmars: sessionStorage + np_access cookie) -----
const ACCESS_SESSION_KEY = "mcm_access_code";
const ACCESS_COOKIE = "np_access";

function getCookie(name) {
  return parseCookieValue(document.cookie, name);
}
function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 90}`;
}
function getCode() {
  return sessionStorage.getItem(ACCESS_SESSION_KEY) || getCookie(ACCESS_COOKIE) || "";
}
function setCode(c) {
  if (c) {
    sessionStorage.setItem(ACCESS_SESSION_KEY, c);
    setCookie(ACCESS_COOKIE, c);
  } else {
    sessionStorage.removeItem(ACCESS_SESSION_KEY);
  }
}
function promptCode(reason = "this server requires an access code") {
  const c = prompt(`${reason}\n\nenter access code:`);
  if (c) setCode(c.trim());
  return !!c;
}

const _fetch = window.fetch.bind(window);
async function gFetch(input, init = {}) {
  const code = getCode();
  const headers = new Headers(init.headers ?? {});
  if (code) headers.set("x-access-code", code);
  const res = await _fetch(input, { ...init, headers });
  if (res.status === 401) {
    if (promptCode("server requires an access code")) {
      const retry = new Headers(init.headers ?? {});
      retry.set("x-access-code", getCode());
      return _fetch(input, { ...init, headers: retry });
    }
  }
  return res;
}
window.fetch = gFetch;

// ----- markdown -> html (tiny inline renderer) -----
// ----- session model -----
const SESSIONS_KEY = "research-hub-sessions-v1";
function loadSessions() {
  return parseSessionList(localStorage.getItem(SESSIONS_KEY));
}
function saveSessions(arr) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(arr.slice(0, 60))); } catch {}
}
function newSession(prompt) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const s = {
    id, prompt, createdAt: new Date().toISOString(),
    reports: { claude: "", chatgpt: "", gemini: "", synthesis: "" },
    status: { claude: "pending", chatgpt: "pending", gemini: "pending" },
  };
  const all = [s, ...loadSessions()];
  saveSessions(all);
  return s;
}
function updateSession(s) {
  const all = loadSessions();
  const i = all.findIndex((x) => x.id === s.id);
  if (i === -1) all.unshift(s); else all[i] = s;
  saveSessions(all);
  renderHistory();
}

let current = null;

// ----- date stamp -----
function setStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  $("#date-stamp").textContent = `${yyyy} / ${mm} / ${dd}`;
}

// ----- health / keys -----
async function loadKeys() {
  // Stub: with edge functions we don't have a /health endpoint. Show all 4 as set
  // (Vercel env confirmed at deploy time). Errors will surface inline if a key is missing.
  const ks = $("#keystatus");
  ks.innerHTML = ["anthropic", "openai", "gemini", "elevenlabs"]
    .map((k) => `<span class="k set">${k}</span>`)
    .join("");
}

// ----- tabs -----
function switchTab(name) {
  $$(".folder-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${name}`));
}
$$(".folder-tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

// ----- status pills + phase lines -----
function setStatus(provider, label, cls) {
  const el = document.getElementById(`status-${provider}`);
  if (!el) return;
  el.textContent = `— ${label}`;
  el.className = `folder-tab-status ${cls ?? ""}`;
}
function appendPhase(provider, text, isError = false) {
  const pane = $(`#pane-${provider}`);
  if (!pane) return;
  const empty = pane.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `phase-line${isError ? " error" : ""}`;
  div.textContent = text;
  pane.appendChild(div);
  pane.scrollTop = pane.scrollHeight;
}
function renderReport(provider, text) {
  if (!current) return;
  current.reports[provider] = text;
  updateSession(current);
  const pane = $(`#pane-${provider}`);
  if (!pane) return;
  pane.innerHTML = mdToHtml(text);
}

// ----- the 3 provider runners -----
async function runClaude(prompt) {
  setStatus("claude", "calling + web search…", "running");
  appendPhase("claude", "starting claude with web_search tool…");
  try {
    const res = await fetch("/api/research-claude", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `http ${res.status}`);
    }
    const { report, searches } = await res.json();
    appendPhase("claude", `synthesized from ${searches} web searches`);
    renderReport("claude", report);
    setStatus("claude", "done", "done");
    current.status.claude = "done";
    updateSession(current);
    checkAudioReady();
  } catch (e) {
    setStatus("claude", "error", "error");
    appendPhase("claude", e.message, true);
    current.status.claude = "error";
    updateSession(current);
  }
}

async function runGemini(prompt) {
  setStatus("gemini", "grounding with google search…", "running");
  appendPhase("gemini", "calling gemini-2.5-pro with google_search grounding…");
  try {
    const res = await fetch("/api/research-gemini", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `http ${res.status}`);
    }
    const { report, sources, queries } = await res.json();
    appendPhase("gemini", `grounded on ${sources} sources via ${queries} queries`);
    renderReport("gemini", report);
    setStatus("gemini", "done", "done");
    current.status.gemini = "done";
    updateSession(current);
    checkAudioReady();
  } catch (e) {
    setStatus("gemini", "error", "error");
    appendPhase("gemini", e.message, true);
    current.status.gemini = "error";
    updateSession(current);
  }
}

async function runOpenAI(prompt) {
  setStatus("chatgpt", "starting deep research…", "running");
  appendPhase("chatgpt", "kicking off o4-mini-deep-research (background mode)…");
  let jobId;
  try {
    const startRes = await fetch("/api/research-openai-start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!startRes.ok) {
      const j = await startRes.json().catch(() => ({}));
      throw new Error(j.error || `http ${startRes.status}`);
    }
    const j = await startRes.json();
    jobId = j.id;
    appendPhase("chatgpt", `job started: ${jobId.slice(-12)}`);
  } catch (e) {
    setStatus("chatgpt", "error", "error");
    appendPhase("chatgpt", e.message, true);
    current.status.chatgpt = "error";
    updateSession(current);
    return;
  }

  // poll
  const deadline = Date.now() + 30 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const r = await fetch(`/api/research-openai-status?id=${encodeURIComponent(jobId)}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `poll http ${r.status}`);
      }
      const data = await r.json();
      if (data.status !== lastStatus) {
        setStatus("chatgpt", data.status, "running");
        appendPhase("chatgpt", `· ${data.status}`);
        lastStatus = data.status;
      }
      const outcome = decidePollOutcome(data);
      if (outcome.action === "done") {
        renderReport("chatgpt", outcome.report);
        setStatus("chatgpt", "done", "done");
        current.status.chatgpt = "done";
        updateSession(current);
        checkAudioReady();
        return;
      }
      if (outcome.action === "error") {
        throw new Error(outcome.error);
      }
    } catch (e) {
      setStatus("chatgpt", "error", "error");
      appendPhase("chatgpt", e.message, true);
      current.status.chatgpt = "error";
      updateSession(current);
      return;
    }
  }
  setStatus("chatgpt", "timeout (30m)", "error");
  appendPhase("chatgpt", "openai job exceeded 30 minute polling deadline", true);
}

// ----- clarification step (Anthropic deep-research pattern) -----
// Returns { enrichedPrompt } once user answers (or skips).
async function clarifyPhase(prompt) {
  const panel = $("#clarify-panel");
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="clarify-thinking"><span class="dot-pulse"></span> thinking about what would sharpen this research…</div>`;
  $("#run").disabled = true;
  $(".stamp-btn-inner").textContent = "…";

  let data;
  try {
    const res = await fetch("/api/research-clarify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      // Fall through silently — if clarifier fails, dispatch original prompt.
      panel.classList.add("hidden");
      return { enrichedPrompt: prompt, skipped: true };
    }
    data = await res.json();
  } catch {
    panel.classList.add("hidden");
    return { enrichedPrompt: prompt, skipped: true };
  }

  const questions = data?.questions ?? [];
  const summary = data?.summary ?? "";

  return new Promise((resolve) => {
    panel.innerHTML = renderClarifyPanel(summary, questions);

    const finish = (useAnswers) => {
      let enrichedPrompt = prompt;
      if (useAnswers) {
        const answered = Array.from(panel.querySelectorAll(".clarify-q-input"))
          .map((el) => ({ q: el.dataset.question, a: el.value.trim() }))
          .filter((x) => x.a);
        if (answered.length) {
          enrichedPrompt = `${prompt}\n\n---\nAdditional context the researcher provided:\n${answered.map((x) => `• ${x.q}\n   → ${x.a}`).join("\n")}`;
        }
      }
      panel.classList.add("hidden");
      resolve({ enrichedPrompt, skipped: !useAnswers });
    };

    panel.querySelector("#clarify-skip").addEventListener("click", () => finish(false));
    panel.querySelector("#clarify-go").addEventListener("click", () => finish(true));
    panel.querySelector(".clarify-q-input")?.focus();
  });
}

function escapeHtml(s) {
  return (s ?? "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ----- master "run" -----
async function runResearch() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) return;

  $("#run").disabled = true;
  $(".stamp-btn-inner").textContent = "GO…";

  // 1. Clarify phase
  const { enrichedPrompt } = await clarifyPhase(prompt);

  // 2. Create session using ENRICHED prompt (so history reflects what actually ran)
  current = newSession(enrichedPrompt);
  current.originalPrompt = prompt;

  for (const p of ["claude", "chatgpt", "gemini", "synthesis"]) {
    const pane = $(`#pane-${p}`);
    pane.innerHTML = `<div class="empty"><span class="empty-big">⋯</span><span class="empty-msg">starting…</span></div>`;
    if (p !== "synthesis") setStatus(p, "queued", "");
  }
  setStatus("synthesis", "—", "");
  switchTab("claude");
  renderHistory();

  await Promise.allSettled([runClaude(enrichedPrompt), runGemini(enrichedPrompt), runOpenAI(enrichedPrompt)]);

  $("#run").disabled = false;
  $(".stamp-btn-inner").textContent = "GO.";
  if (current.reports.claude || current.reports.chatgpt || current.reports.gemini) {
    $("#synth-now").style.display = "inline-block";
  }
}

// ----- synthesis -----
async function makeSynthesis() {
  if (!current) return;
  setStatus("synthesis", "writing narration…", "running");
  switchTab("synthesis");
  const pane = $("#pane-synthesis");
  pane.innerHTML = '<div class="phase-line">▸ claude is merging the three reports into a single narration…</div>';
  try {
    const res = await fetch("/api/research-synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: current.prompt,
        claude: current.reports.claude,
        chatgpt: current.reports.chatgpt,
        gemini: current.reports.gemini,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `http ${res.status}`);
    }
    const { text, minutes } = await res.json();
    current.reports.synthesis = text;
    updateSession(current);
    renderReport("synthesis", text);
    setStatus("synthesis", `done · ~${minutes} min`, "done");
  } catch (e) {
    setStatus("synthesis", "error", "error");
    pane.innerHTML = `<div class="phase-line error">${e.message}</div>`;
  }
}

function checkAudioReady() {
  const ready = !!(current && (current.reports.claude || current.reports.chatgpt || current.reports.gemini));
  $("#audio-go").disabled = !ready;
  if (ready) $("#synth-now").style.display = "inline-block";
}

// ----- audio -----
async function renderAudio() {
  if (!current) return;
  const source = document.querySelector('input[name="audio-source"]:checked').value;
  const btn = $("#audio-go");
  btn.disabled = true;
  const oldText = $(".cassette-text").innerHTML;
  $(".cassette-text").innerHTML = "RENDERING<br />…";

  try {
    // build the text to narrate
    let text = "";
    if (source === "synthesis") {
      if (!current.reports.synthesis) await makeSynthesis();
      text = current.reports.synthesis;
    } else if (source === "stitched") {
      const stitch = (label, body) => body ? `[${label}'s take]\n\n${body}\n\n` : "";
      text = stitch("Claude", current.reports.claude) + stitch("ChatGPT", current.reports.chatgpt) + stitch("Gemini", current.reports.gemini);
    } else {
      text = current.reports[source] ?? "";
    }
    if (!text.trim()) throw new Error(`${source} has no content yet`);

    const voiceSel = $("#voice-pick").value;
    const voice = voiceSel === "custom" ? ($("#voice-custom").value.trim() || undefined) : voiceSel;
    const res = await fetch("/api/research-tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice, stripMarkdown: source !== "synthesis" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `tts http ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    $("#audio-bar").classList.remove("hidden");
    $("#player").src = url;
    $("#dl").href = url;
    $("#dl").download = `research-${source}-${Date.now()}.mp3`;
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.round((words / 150) * 10) / 10;
    $("#audio-meta-text").textContent = `${source} · ~${minutes} min · ${(blob.size / 1024).toFixed(0)} kb`;
    $("#player").play().catch(() => {});
  } catch (e) {
    alert(e.message);
  } finally {
    $(".cassette-text").innerHTML = oldText;
    btn.disabled = false;
  }
}

// ----- history (corkboard) -----
function renderHistory() {
  const all = loadSessions();
  const ul = $("#sessions");
  const empty = $("#cork-empty");
  ul.innerHTML = "";
  if (!all.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  for (const s of all.slice(0, 24)) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="session-prompt">${s.prompt.replace(/</g, "&lt;")}</span>
      <span class="session-time">${new Date(s.createdAt).toLocaleString()}</span>
    `;
    li.addEventListener("click", () => openSession(s.id));
    ul.appendChild(li);
  }
}

function openSession(id) {
  const all = loadSessions();
  const s = all.find((x) => x.id === id);
  if (!s) return;
  current = s;
  $("#prompt").value = s.prompt;
  for (const p of ["claude", "chatgpt", "gemini", "synthesis"]) {
    if (s.reports[p]) {
      $(`#pane-${p}`).innerHTML = mdToHtml(s.reports[p]);
      setStatus(p, "loaded", "done");
    } else {
      $(`#pane-${p}`).innerHTML = `<div class="empty"><span class="empty-big">∅</span><span class="empty-msg">no ${p} output saved for this session.</span></div>`;
      setStatus(p, s.status?.[p] ?? "—", "");
    }
  }
  checkAudioReady();
  switchTab("claude");
  $("#prompt").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ----- wire up -----
$("#run").addEventListener("click", runResearch);
$("#audio-go").addEventListener("click", renderAudio);
$("#synth-now").addEventListener("click", makeSynthesis);
$("#prompt").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runResearch();
});
$("#voice-pick").addEventListener("change", (e) => {
  $("#voice-custom").style.display = e.target.value === "custom" ? "block" : "none";
  if (e.target.value === "custom") $("#voice-custom").focus();
});

setStamp();
loadKeys();
renderHistory();
