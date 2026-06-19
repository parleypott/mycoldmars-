// Devchat assistant reply.
//
// POST { threadId } → fetch the thread + all messages from Supabase via
// service role, format them into a Claude conversation, get a reply,
// write that reply back to devchat_messages as sender='assistant'.
//
// The realtime subscription on the client picks the new message up
// instantly — same channel that streams human user messages.
//
// This v1 is conversational only: Claude acts as a helpful collaborator
// who acknowledges the bug, asks clarifying questions, and summarizes
// what to fix. The autonomous code-fixing worker is a separate v2 path.

// Intentionally NOT gated by checkAccess — devchat is open to anonymous
// visitors on the public sequencer route so they can flag bugs without
// signing in. Per-call cost is bounded (one Anthropic message per user
// turn); add IP rate-limiting here if abuse ever surfaces.

import { checkRateLimit } from './_lib/rate-limit.js';
import { pgrValue } from './_lib/pgrest.js';
import { readJsonBody } from './_lib/read-json-body.js';

export const config = { runtime: 'edge' };

const MODEL  = 'claude-sonnet-4-6';
const MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You are an in-product dev-chat assistant inside Newpress Interpreter — a transcript editing and sequencing tool used by one person, Johnny Harris.

You're talking to Johnny while he uses the product. He's reporting a bug, requesting a feature, or thinking out loud about something he wants changed.

Your job in this conversation:
1. Acknowledge what he's saying clearly and briefly.
2. If the request is ambiguous, ask one clarifying question.
3. If it's clear, restate it as a precise change you understand — file, behavior, expected outcome — so the actual code-fixing pass picks it up cleanly later.
4. Suggest a fix direction when you have one. Be specific.
5. Don't promise to ship code in this thread. The autonomous fixer is a separate process; you're triaging.

Tone: peer-level, terse, no boilerplate, no apologies, no "great question." Match his fast-and-loose energy. Match his preference for editorial, lowercase-friendly, never marketing-shouty copy.

Context for every reply:
- Page URL and current view are in the system "context" message.
- Previous messages in this thread are the conversation history.
- If a transcript_id is in context, that's what's loaded in the editor right now.

Keep replies under 150 words unless the user asks for depth.`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build the two service-role PostgREST URLs for a thread. threadId is
// caller-supplied on a PUBLIC, anonymous endpoint, so it MUST be escaped —
// raw interpolation lets a request inject extra `&`-separated query params
// onto a service-role (RLS-bypassing) read. Pure + exported for testing.
export function buildThreadQueryUrls(supaUrl, threadId) {
  const v = pgrValue(threadId);
  return {
    threadUrl: `${supaUrl}/rest/v1/devchat_threads?id=eq.${v}&select=*`,
    messagesUrl: `${supaUrl}/rest/v1/devchat_messages?thread_id=eq.${v}&order=created_at.asc&select=*`,
  };
}

async function fetchThreadAndMessages(supaUrl, serviceKey, threadId) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const { threadUrl, messagesUrl } = buildThreadQueryUrls(supaUrl, threadId);
  const [tRes, mRes] = await Promise.all([
    fetch(threadUrl, { headers }),
    fetch(messagesUrl, { headers }),
  ]);
  const thread   = (await tRes.json())?.[0] || null;
  const messages = await mRes.json();
  return { thread, messages };
}

async function insertAssistantMessage(supaUrl, serviceKey, threadId, body, metadata) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const r = await fetch(`${supaUrl}/rest/v1/devchat_messages`, {
    method: 'POST', headers,
    body: JSON.stringify([{ thread_id: threadId, sender: 'assistant', body, metadata: metadata || null }]),
  });
  return r.ok ? (await r.json())[0] : null;
}

// Write an error directly into the thread as a 'system' message so the
// failure is visible in the chat UI itself — saves DevTools spelunking.
async function logErrorToThread(threadId, errMsg) {
  if (!threadId) return;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !serviceKey) return;
  try {
    await fetch(`${supaUrl}/rest/v1/devchat_messages`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        thread_id: threadId,
        sender: 'system',
        body: `⚠ /api/devchat-respond failed: ${errMsg}`,
      }]),
    });
  } catch {} // best effort — if even this fails, at least we returned the JSON error
}

export default async function handler(req) {
  // Top-level guard so any unhandled throw returns a real JSON body
  // instead of a bare Vercel 500 with no message.
  try {
    return await handleInner(req);
  } catch (err) {
    const reason = `Unhandled: ${err?.message || String(err)}${err?.stack ? '\n' + err.stack.split('\n').slice(0, 3).join('\n') : ''}`;
    console.error('[devchat-respond]', reason);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.threadId) await logErrorToThread(body.threadId, reason);
    } catch {}
    return json({ error: reason }, 500);
  }
}

// Per-IP rate limit. Edge runtime keeps module state alive per
// instance — this is a simple token bucket so a botted POST loop
// can't blast Sonnet 4.6 inference costs. 6 calls per 60s per IP.
const _devchatBucket = new Map();
const RATE_LIMIT_PER_MIN = 6;
const RATE_WINDOW_MS = 60_000;
// Bounded rate limiter — the backing Map can't grow without bound under a burst
// of distinct IPs (it prunes expired windows, then evicts oldest over a cap).
// A falsy IP is allowed through; this is a cost guard, not the DoS boundary.
function rateLimitOk(ip) {
  return checkRateLimit(_devchatBucket, ip, Date.now(), {
    limit: RATE_LIMIT_PER_MIN,
    windowMs: RATE_WINDOW_MS,
  });
}
function extractIp(req) {
  try {
    const h = (typeof req.headers.get === 'function')
      ? (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '')
      : (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '');
    return (h || '').split(',')[0].trim() || null;
  } catch { return null; }
}

async function handleInner(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Cost-guard rate limit — endpoint is intentionally anonymous for
  // bug-reporting from the public site, but a 500KB body running
  // Sonnet 4.6 at 10 rps is $14k/hr. Hard cap at 6/min/IP.
  const ip = extractIp(req);
  if (!rateLimitOk(ip)) {
    return json({ error: 'Too many requests. Wait a minute.' }, 429);
  }

  // A non-object body (JSON-literal null / number / string / array) used to
  // crash at `body.threadId` -> unhandled TypeError -> HTTP 500 on this
  // public, anonymous endpoint. readJsonBody guarantees a plain object or a
  // clean 400. Same null-body-crash class fixed across the research-* /
  // prawn / burma-tk endpoints.
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const threadId = body.threadId;
  if (!threadId) return json({ error: 'threadId required' }, 400);

  // Diagnostics — what env vars do we actually see at runtime?
  console.log('[devchat-respond] threadId:', threadId);
  console.log('[devchat-respond] env present:', {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
  });

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supaUrl || !serviceKey) {
    const reason = 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).';
    await logErrorToThread(threadId, reason);
    return json({ error: reason }, 500);
  }
  if (!anthropicKey) {
    const reason = 'Server is missing ANTHROPIC_API_KEY.';
    await logErrorToThread(threadId, reason);
    return json({ error: reason }, 500);
  }

  const { thread, messages } = await fetchThreadAndMessages(supaUrl, serviceKey, threadId);
  if (!thread) return json({ error: 'Thread not found' }, 404);

  // Build the Anthropic messages array. Map our 'system' rows to context
  // injected at the top; map 'user'/'assistant' rows directly. Skip prior
  // 'agent' rows (those are worker logs, not conversational).
  //
  // For user messages with metadata.images, build a multi-block content
  // array so Claude's vision can read the screenshots inline.
  // Cap input size before forwarding to Anthropic. The adversarial
  // audit verified: anyone can anonymously INSERT a 500KB message
  // row into devchat_messages (the table is intentionally public
  // for bug-reporting), then POST here to spend ~$0.40/call on
  // Sonnet 4.6. Limit:
  //   - Last 20 messages only (truncate older history).
  //   - Total body chars <= 40KB across the truncated window.
  const userOrAssistant = messages.filter(m => m.sender === 'user' || m.sender === 'assistant');
  const recent = userOrAssistant.slice(-20);
  let totalChars = 0;
  for (const m of recent) totalChars += (m.body || '').length;
  if (totalChars > 40_000) {
    return json({ error: 'Conversation history too long. Start a new thread.' }, 413);
  }

  const historyMessages = recent
    .map(m => {
      const role = m.sender === 'assistant' ? 'assistant' : 'user';
      const images = (m.metadata && Array.isArray(m.metadata.images)) ? m.metadata.images : [];
      if (role === 'user' && images.length) {
        const content = [];
        for (const img of images) {
          if (!img?.url) continue;
          // Validate scheme + host before forwarding to Anthropic. The
          // image-URL passthrough is an SSRF surface — Anthropic will
          // fetch any URL we hand it server-side. Restrict to http(s)
          // and our own storage hosts.
          let safeUrl = null;
          try {
            const u = new URL(img.url);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              // Anchored allowlist — bug from prior pass: `^localhost`
              // with no end anchor matched `localhost.attacker.com`,
              // and `.supabase.co$` matched ANY supabase project
              // (attacker can create their own). Tighter:
              //   * our exact Supabase project
              //   * our exact Vercel hosts
              //   * literal localhost only
              const okHost =
                u.hostname === 'localhost' ||
                u.hostname === '127.0.0.1' ||
                u.hostname === 'ukqimqkifkhdavveopdm.supabase.co' ||
                u.hostname === 'mycoldmars.com' ||
                u.hostname === 'www.newpress.press' ||
                u.hostname === 'mycoldmars.vercel.app' ||
                /^mycoldmars-[a-z0-9-]+-johnnywharris-4274s-projects\.vercel\.app$/i.test(u.hostname);
              if (okHost) safeUrl = u.toString();
            }
          } catch {}
          if (!safeUrl) continue;
          content.push({
            type: 'image',
            source: { type: 'url', url: safeUrl },
          });
        }
        if (m.body) content.push({ type: 'text', text: m.body });
        else if (content.length) content.push({ type: 'text', text: '(image)' });
        return { role, content };
      }
      return { role, content: m.body || '(empty)' };
    });

  if (historyMessages.length === 0) {
    return json({ error: 'No user messages to reply to.' }, 400);
  }

  const contextHeader = [
    `Page: ${thread.page_url || '(unknown)'}`,
    thread.transcript_id ? `Transcript ID: ${thread.transcript_id}` : null,
    thread.page_state ? `Page state: ${JSON.stringify(thread.page_state).slice(0, 800)}` : null,
  ].filter(Boolean).join('\n');

  const callBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: `${SYSTEM_PROMPT}\n\n--- Live page context ---\n${contextHeader}`,
    messages: historyMessages,
  };

  let replyText = '';
  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(callBody),
    });
    const data = await ar.json();
    if (!ar.ok) {
      const reason = data?.error?.message || `Anthropic ${ar.status}`;
      await logErrorToThread(threadId, reason);
      return json({ error: reason }, 502);
    }
    replyText = (data?.content || []).map(c => c.text || '').join('').trim();
    if (!replyText) replyText = '(no reply text — model returned an empty turn)';
  } catch (err) {
    const reason = 'Anthropic request failed: ' + (err?.message || String(err));
    await logErrorToThread(threadId, reason);
    return json({ error: reason }, 502);
  }

  const inserted = await insertAssistantMessage(supaUrl, serviceKey, threadId, replyText, {
    model: MODEL,
  });
  return json({ ok: true, message: inserted, replyText });
}
