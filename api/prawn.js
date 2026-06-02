// /api/prawn — the Prawn Weekend RSVP endpoint.
//
// POST body { name, arrive_when, depart_when, flight_in, flight_out,
//             food, drink, notes } -> writes a row into public.prawns.
// GET       -> returns the full list of prawns (most recent first).
//
// No access gate. Friends know the URL; data is non-sensitive food/flight
// preferences. Service-role key is server-side only.

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS };

function clean(value, max) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    return new Response(
      JSON.stringify({ error: 'supabase_not_configured' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const base = `${url}/rest/v1/prawns`;
  const auth = { apikey: key, Authorization: `Bearer ${key}` };

  if (req.method === 'GET') {
    const r = await fetch(
      `${base}?select=id,name,arrive_when,depart_when,flight_in,flight_out,food,drink,notes,created_at&order=created_at.desc&limit=500`,
      { headers: auth }
    );
    if (!r.ok) {
      const msg = await r.text();
      return new Response(
        JSON.stringify({ error: 'read_failed', detail: msg }),
        { status: 500, headers: JSON_HEADERS }
      );
    }
    const rows = await r.json();
    return new Response(JSON.stringify({ prawns: rows }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'bad_json' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const row = {
      name: clean(body.name, 80),
      arrive_when: clean(body.arrive_when, 200),
      depart_when: clean(body.depart_when, 200),
      flight_in: clean(body.flight_in, 60),
      flight_out: clean(body.flight_out, 60),
      food: clean(body.food, 2000),
      drink: clean(body.drink, 2000),
      notes: clean(body.notes, 2000),
    };

    if (!row.name) {
      return new Response(JSON.stringify({ error: 'name_required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const r = await fetch(base, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const detail = await r.text();
      return new Response(
        JSON.stringify({ error: 'write_failed', detail }),
        { status: 500, headers: JSON_HEADERS }
      );
    }
    const [saved] = await r.json();
    return new Response(JSON.stringify({ ok: true, prawn: saved }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}
