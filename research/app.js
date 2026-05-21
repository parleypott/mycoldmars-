// research-hub frontend — vanilla JS, calls mycoldmars edge endpoints.
// All state lives client-side (localStorage). No server-side persistence.

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ----- access code (matches mycoldmars's checkAccess pattern) -----
const ACCESS_KEY = "research-hub-access-code";
function getCode() { return localStorage.getItem(ACCESS_KEY) ?? ""; }
function setCode(c) { c ? localStorage.setItem(ACCESS_KEY, c) : localStorage.removeItem(ACCESS_KEY); }
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
function mdToHtml(md) {
  if (!md) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = esc(md);
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  html = html.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^(?:- |\* )(.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/^(\d+)\. (.*)$/gm, "<li>$2</li>");
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      if (/^\s*<(h\d|ul|ol|pre|li|p|blockquote)/i.test(block.trim())) return block;
      if (!block.trim()) return "";
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return html;
}

// ----- session model -----
const SESSIONS_KEY = "research-hub-sessions-v1";
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) ?? []; } catch { return []; }
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
      if (data.status === "completed") {
        renderReport("chatgpt", data.report ?? "(empty result)");
        setStatus("chatgpt", "done", "done");
        current.status.chatgpt = "done";
        updateSession(current);
        checkAudioReady();
        return;
      }
      if (data.status === "failed" || data.status === "cancelled") {
        throw new Error(`openai ${data.status}: ${data.error ?? ""}`);
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

// ----- master "run" -----
async function runResearch() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) return;

  $("#run").disabled = true;
  $(".stamp-btn-inner").textContent = "GO…";

  current = newSession(prompt);

  for (const p of ["claude", "chatgpt", "gemini", "synthesis"]) {
    const pane = $(`#pane-${p}`);
    pane.innerHTML = `<div class="empty"><span class="empty-big">⋯</span><span class="empty-msg">starting…</span></div>`;
    if (p !== "synthesis") setStatus(p, "queued", "");
  }
  setStatus("synthesis", "—", "");
  switchTab("claude");
  renderHistory();

  await Promise.allSettled([runClaude(prompt), runGemini(prompt), runOpenAI(prompt)]);

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

    const res = await fetch("/api/research-tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, stripMarkdown: source !== "synthesis" }),
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

setStamp();
loadKeys();
renderHistory();
