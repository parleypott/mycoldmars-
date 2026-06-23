// MapKeys — country-search ranking (extracted from main.js for headless testing).
//
// Pure: ranks a country list by how well each name matches the query, so the
// "add a country shape" picker surfaces the most relevant matches first.
// Score tiers (LOWER = better, most-specific-wins, one tier per country):
//   0 exact match · 1 name-prefix · 2 word-prefix (query starts a later word)
//   · 3 substring anywhere. Ties break alphabetically by name.
// Empty/whitespace query returns the first `limit` of the list verbatim
// (main.js keeps COUNTRIES alphabetically sorted). Results capped at `limit`.
//
// Behaviour-identical to the inline original for every string query (the only
// real call shape — the picker passes an <input>.value). The lone addition is a
// defensive guard: a null/undefined query degrades to the empty-query path
// instead of throwing on `.trim()`.

export function searchCountries(query, countries, limit = 60) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return countries.slice(0, limit);
  const scored = [];
  for (const c of countries) {
    const lower = c.name.toLowerCase();
    if (lower === q) scored.push([c, 0]);
    else if (lower.startsWith(q)) scored.push([c, 1]);
    else if (lower.includes(' ' + q)) scored.push([c, 2]);
    else if (lower.includes(q)) scored.push([c, 3]);
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name));
  return scored.slice(0, limit).map(s => s[0]);
}
