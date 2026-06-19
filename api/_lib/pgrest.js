// Shared PostgREST helpers.
//
// pgrValue() escapes a value that gets interpolated into a PostgREST filter
// (e.g. `id=eq.${v}`). PostgREST query params are `&`-separated and `=`-keyed,
// so a raw, caller-supplied value containing `&` or `=` lets a request append
// EXTRA query parameters onto the request URL — e.g. a bare `id=eq.0&or=(...)`
// broadens or rewrites the filter. On an endpoint that queries with a Supabase
// service-role key (which bypasses RLS), that is a real data-exposure hole, not
// a cosmetic one. The gemini.js `pgrEscape` and the ~30 QSS call sites already
// encodeURIComponent every interpolated filter value for exactly this reason;
// this is the shared single-source version of that guard.
//
// encodeURIComponent neutralizes the param separators (& → %26, = → %3D) so the
// value is treated as one opaque filter literal. It is a no-op for legitimate
// ids — UUIDs and integers contain only URL-unreserved characters — so escaping
// changes nothing for real traffic and only defangs an injection payload.
export function pgrValue(v) {
  if (v === null || v === undefined) return '';
  return encodeURIComponent(String(v));
}
