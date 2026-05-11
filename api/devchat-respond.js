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

async function fetchThreadAndMessages(supaUrl, serviceKey, threadId) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const [tRes, mRes] = await Promise.all([
    fetch(`${supaUrl}/rest/v1/devchat_threads?id=eq.${threadId}&select=*`, { headers }),
    fetch(`${supaUrl}/rest/v1/devchat_messages?thread_id=eq.${threadId}&order=created_at.asc&select=*`, { headers }),
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

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  let body = {};
  try { body = await req.json(); } catch {}
  const threadId = body.threadId;
  if (!threadId) return json({ error: 'threadId required' }, 400);

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supaUrl || !serviceKey) return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' }, 500);
  if (!anthropicKey)           return json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, 500);

  const { thread, messages } = await fetchThreadAndMessages(supaUrl, serviceKey, threadId);
  if (!thread) return json({ error: 'Thread not found' }, 404);

  // Build the Anthropic messages array. Map our 'system' rows to context
  // injected at the top; map 'user'/'assistant' rows directly. Skip prior
  // 'agent' rows (those are worker logs, not conversational).
  const historyMessages = messages
    .filter(m => m.sender === 'user' || m.sender === 'assistant')
    .map(m => ({ role: m.sender === 'assistant' ? 'assistant' : 'user', content: m.body }));

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
      return json({ error: data?.error?.message || `Anthropic ${ar.status}` }, 502);
    }
    replyText = (data?.content || []).map(c => c.text || '').join('').trim();
    if (!replyText) replyText = '(no reply text — model returned an empty turn)';
  } catch (err) {
    return json({ error: 'Anthropic request failed: ' + (err?.message || String(err)) }, 502);
  }

  const inserted = await insertAssistantMessage(supaUrl, serviceKey, threadId, replyText, {
    model: MODEL,
  });
  return json({ ok: true, message: inserted, replyText });
}
