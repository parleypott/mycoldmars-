import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const res = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `openai poll ${res.status}: ${t.slice(0, 400)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const payload = { id: data.id, status: data.status };

  if (data.status === 'completed') {
    let text = '';
    const sources = [];
    for (const item of data.output ?? []) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') text += c.text + '\n';
          if (c.type === 'text' && typeof c.text === 'string') text += c.text + '\n';
          if (Array.isArray(c.annotations)) {
            for (const a of c.annotations) {
              if (a.type === 'url_citation' && a.url) sources.push(a.url);
            }
          }
        }
      }
    }
    const merged = text.trim() +
      (sources.length ? `\n\n## Sources\n${[...new Set(sources)].map((u, i) => `${i + 1}. ${u}`).join('\n')}` : '');
    payload.report = merged;
  } else if (data.status === 'failed' || data.status === 'cancelled') {
    payload.error = JSON.stringify(data.error ?? {}).slice(0, 300);
  }

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}
