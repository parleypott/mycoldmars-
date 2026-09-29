// sources — read one source from the Newpress citations RAG in context.
//
// /sources/?chunk=<chunk_id>[&quote=<text>]
// The cited passage is highlighted and scrolled into view, the source text reads
// continuously around it, and a side rail lists which Newpress videos cited it.
// Data comes from GET /api/citations-source (overlap already stripped server-side).

import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ensureUnlocked } from '../../scripts-library/src/gate.js';
import './sources.css';

// Google sign-in returns to origin + pathname (scripts-library/src/auth.js), which drops
// ?chunk=…&quote=…. A reader arriving signed-out from a Slack link would land on an empty
// viewer, so keep the query across the sign-in round trip. The URL itself is only put
// back after ensureUnlocked(): rewriting it earlier could race Supabase reading the
// OAuth return parameters.
const SAVED_QUERY = 'sources:query';
let EFFECTIVE_SEARCH = location.search;
try {
  if (new URLSearchParams(location.search).get('chunk')) sessionStorage.setItem(SAVED_QUERY, location.search);
  else EFFECTIVE_SEARCH = sessionStorage.getItem(SAVED_QUERY) || location.search;
} catch {}

const PARAMS = new URLSearchParams(EFFECTIVE_SEARCH);
const CHUNK = (PARAMS.get('chunk') || '').trim().toLowerCase();
const QUOTE = (PARAMS.get('quote') || '').trim();
const STEP = 6; // chunks added per "Show earlier / later"

// What the reader is looking at, when it is not the live page as published.
const ACCESS_NOTES = {
  wayback: 'This text comes from a Wayback Machine snapshot of the page, not the live site. It may differ from what is published now.',
  'recovered-wayback': 'This text comes from a Wayback Machine snapshot of the page, not the live site. It may differ from what is published now.',
  jina: 'This text was extracted from the page with Jina Reader. Menus, captions and other page furniture may be missing.',
  'book-pdf': 'This text comes from a book PDF in the Newpress research library. Page breaks and headers may interrupt the reading.',
  'research-lib': 'This text comes from the Newpress research library, not from a live web page.',
  'drive-service-account': 'This text comes from a file in the Newpress research library (Google Drive).',
  'recovered-ua': 'The live page blocked automated readers; this text was recovered another way and may be incomplete.',
  botwall: 'The live page was behind a bot wall when it was collected, so this text may be incomplete or wrong.',
  'url-stub-unfetched': 'Only the citation reference was saved for this source; the page text itself was never collected.',
  'citation-stub': 'Only the citation reference was saved for this source; the page text itself was never collected.',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whitespace- and case-tolerant search for `quote` inside `text` → [start, end) or null.
export function findQuote(text, quote) {
  const words = String(quote || '').split(/\s+/).filter(Boolean);
  if (!words.length || !text) return null;
  try {
    const m = new RegExp(words.map(escapeRe).join('\\s+'), 'i').exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  } catch { return null; }
}

// Chrome/Edge/Safari text fragment: scrolls the live page to the passage. Best effort —
// if the page's wording differs, the browser simply opens the page at the top.
function textFragment(quote, fallback) {
  const src = (quote || fallback || '').replace(/\s+/g, ' ').trim();
  const words = src.split(' ').filter(Boolean).slice(0, 8).join(' ');
  if (words.length < 8) return '';
  return '#:~:text=' + encodeURIComponent(words).replace(/-/g, '%2D');
}

function outboundHref(url, quote, focusText) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  return url.replace(/#.*$/, '') + textFragment(quote, focusText);
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

const docHref = (id) => (/^[\w-]{10,}$/.test(id || '') ? `https://docs.google.com/document/d/${id}/edit` : null);

async function fetchSource(chunk, before, after) {
  const res = await fetch(`/api/citations-source?chunk=${encodeURIComponent(chunk)}&before=${before}&after=${after}`);
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch {}
    throw new Error(res.status === 401 ? 'You are not signed in.' : (msg || `The server returned ${res.status}.`));
  }
  return res.json();
}

const MD_LINK = /\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g;
const MD_IMAGE = /!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)/g;

// Web sources were captured as Jina Reader markdown: links, images, and whole navigation
// menus. Read them as prose. Links become their text, images go, a line that was nothing
// but links (a menu, "Skip to content") is dropped, and heading/bullet/emphasis marks go.
export function forReading(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(MD_IMAGE, '');
    if (MD_LINK.test(line)) {
      MD_LINK.lastIndex = 0;
      if (!line.replace(MD_LINK, '').replace(/[\s*•|·,>-]+/g, '')) continue;
    }
    MD_LINK.lastIndex = 0;
    let l = line.replace(MD_LINK, '$1');
    const bullet = /^\s*[*+-]\s+/.exec(l);
    if (bullet) l = l.slice(bullet[0].length);
    l = l.replace(/^\s{0,3}#{1,6}\s+/, '');
    out.push((bullet ? '• ' + l : l)
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The capture's own headline beats a title rebuilt from the URL slug.
export function headlineOf(data) {
  const first = data.chunks.find((c) => c.seq === 0);
  if (!first) return null;
  const m = /^Title:\s*(.+)$/m.exec(first.text) || /^#\s+(.+)$/m.exec(first.text);
  return m ? forReading(m[1]).trim() || null : null;
}

function Reading({ data, quote, focusRef }) {
  const parts = [];
  data.chunks.forEach((c, i) => {
    if (i > 0 && !c.continues) parts.push(<div class="gap" key={`gap-${c.chunk_id}`} role="separator">· · ·</div>);
    const text = forReading(c.display_text);
    let body = text;
    if (c.is_focus) {
      const hit = quote ? findQuote(text, quote) : null;
      body = hit
        ? [text.slice(0, hit[0]), <mark class="quote" ref={focusRef} key="q">{text.slice(hit[0], hit[1])}</mark>, text.slice(hit[1])]
        : text;
      parts.push(<span class="focus" key={c.chunk_id} ref={hit ? undefined : focusRef} id="focus">{body}</span>);
    } else {
      parts.push(<span key={c.chunk_id}>{body}</span>);
    }
  });
  return <div class="text">{parts}</div>;
}

function Rail({ data }) {
  const byVideo = useMemo(() => {
    const m = new Map();
    for (const c of data.citations) {
      const k = c.video || 'Unnamed video';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return [...m.entries()];
  }, [data.citations]);
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 900px)').matches ?? true);
  return (
    <aside class="rail">
      <details open={wide} onToggle={(e) => setWide(e.currentTarget.open)}>
        <summary><h2>Cited by Newpress in</h2><span class="count">{byVideo.length ? `${byVideo.length} video${byVideo.length === 1 ? '' : 's'}` : ''}</span></summary>
        {byVideo.length === 0 && <p class="dim">No Newpress video has cited this part of the source.</p>}
        <ul>
          {byVideo.map(([video, cites]) => (
            <li key={video}>
              <div class="vid">{video}</div>
              {cites.map((c, i) => {
                const href = docHref(c.doc_id);
                return (
                  <div class="cite" key={i}>
                    {c.context && <p class="ctx">{c.context}</p>}
                    {c.quoted_span && !/^\[?\s*citation\s*\]?$/i.test(c.quoted_span) && <p class="span">“{c.quoted_span}”</p>}
                    {href && <a href={href} target="_blank" rel="noopener noreferrer">Open the script doc</a>}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}

function App() {
  const [state, setState] = useState({ phase: CHUNK ? 'loading' : 'missing' });
  const [win, setWin] = useState({ before: 3, after: 3 });
  const [busy, setBusy] = useState(null);      // 'before' | 'after' while widening
  const [spent, setSpent] = useState({ before: false, after: false }); // a widen that added nothing
  const focusRef = useRef(null);
  const scrolled = useRef(false);
  const first = useRef(true);
  const countRef = useRef(0);

  useEffect(() => {
    if (!CHUNK) return;
    let dead = false;
    (async () => {
      try {
        if (first.current) {
          await ensureUnlocked();
          if (EFFECTIVE_SEARCH !== location.search) {
            try { history.replaceState(null, '', location.pathname + EFFECTIVE_SEARCH); } catch {}
          }
        }
        const data = await fetchSource(CHUNK, win.before, win.after);
        if (dead) return;
        if (data.notFound) { setState({ phase: 'notfound' }); return; }
        if (busy && data.chunks.length <= countRef.current) setSpent((sp) => ({ ...sp, [busy]: true }));
        countRef.current = data.chunks.length;
        setState((prev) => ({ ...prev, phase: 'ready', data, widenError: null }));
        first.current = false;
        setBusy(null);
      } catch (err) {
        if (dead) return;
        if (first.current) setState({ phase: 'error', message: err?.message || String(err) });
        else { setBusy(null); setState((p) => ({ ...p, widenError: err?.message || String(err) })); }
      }
    })();
    return () => { dead = true; };
  }, [win.before, win.after]);

  // Scroll the highlighted passage into view once, on first render of the text.
  useLayoutEffect(() => {
    if (state.phase !== 'ready' || scrolled.current) return;
    scrolled.current = true;
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === 'ready') document.title = `${headlineOf(state.data) || state.data.source.title} — Newpress citations`;
  }, [state.phase]);

  if (state.phase === 'missing') {
    return <main class="msg"><h1>No source selected</h1><p>This page opens from a citation link. The link needs a <code>?chunk=</code> id.</p></main>;
  }
  if (state.phase === 'loading') return <main class="msg"><p class="dim">Loading the source…</p></main>;
  if (state.phase === 'notfound') {
    return <main class="msg"><h1>Source not found</h1><p>The citation library has no passage with the id <code>{CHUNK}</code>. The link may be from an older version of the library, or mistyped.</p></main>;
  }
  if (state.phase === 'error') {
    return <main class="msg err"><h1>Could not load the source</h1><p>{state.message}</p><p><button onClick={() => location.reload()}>Try again</button></p></main>;
  }

  const { data } = state;
  const { source } = data;
  const focus = data.chunks.find((c) => c.is_focus);
  const href = outboundHref(source.url, QUOTE, focus?.display_text || focus?.text);
  const note = ACCESS_NOTES[source.access_method];
  const partial = data.total > data.chunks.length;
  const quoteMissing = QUOTE && focus && !findQuote(forReading(focus.display_text), QUOTE);
  const canBefore = partial && data.has_before && !spent.before;
  const canAfter = partial && !spent.after && data.chunks.length > 1;
  const looksLikeSingle = data.chunks.length === 1 && data.first_seq == null;

  return (
    <div class="page">
      <header class="head">
        <div class="brand">NEWPRESS · CITATIONS</div>
        <h1>{headlineOf(data) || source.title}</h1>
        <p class="meta">
          {href
            ? <a class="out" href={href} target="_blank" rel="noopener noreferrer">Open the original{hostOf(source.url) ? ` on ${hostOf(source.url)}` : ''} ↗</a>
            : source.url ? <span class="dim">{source.url}</span> : <span class="dim">No public link for this source.</span>}
          {source.video && <span class="dim"> · first collected for “{source.video}”</span>}
        </p>
        {note && <p class="note">{note}</p>}
      </header>
      <div class="cols">
        <article class="read" aria-label="Source text">
          {canBefore && <button class="more" disabled={!!busy} onClick={() => { setBusy('before'); setWin((w) => ({ ...w, before: w.before + STEP })); }}>{busy === 'before' ? 'Loading…' : 'Show earlier'}</button>}
          {!canBefore && partial && <p class="edge">Start of the text we have</p>}
          <Reading data={data} quote={QUOTE} focusRef={focusRef} />
          {canAfter && <button class="more" disabled={!!busy} onClick={() => { setBusy('after'); setWin((w) => ({ ...w, after: w.after + STEP })); }}>{busy === 'after' ? 'Loading…' : 'Show later'}</button>}
          {!canAfter && partial && <p class="edge">End of the text we have</p>}
          {looksLikeSingle && data.total > 1 && <p class="edge">Only this passage could be shown; its place in the full source is not known.</p>}
          {state.widenError && <p class="err small">Could not load more: {state.widenError}</p>}
          {quoteMissing && <p class="edge">The quoted wording was not found in this passage, so the whole passage is highlighted instead.</p>}
        </article>
        <Rail data={data} />
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app'));
