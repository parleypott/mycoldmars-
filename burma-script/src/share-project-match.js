// Row selector behind the masthead Share popover (ShareToggle). Pulled into a plain module so the
// headless suite can import and mutation-lock it without pulling in Preact/JSX.
//
// Find THIS script's row in the /api/script-projects list. `ref` is the current episode id, which is
// the project SLUG for legacy configs (burma/palau/palau2) but the cloud-row UUID for brand-new library
// projects (configForProject sets id = row.id). So we must match on EITHER — matching slug only would
// silently miss every library project (UUID ref, no matching slug), and a hardcoded slug targets the
// WRONG document entirely when the shared engine boots a non-burma episode. Slugs are human strings and
// ids are UUIDs, so the two spaces never collide. Null-safe: bad/empty input yields null (→ "not-found").
export function findProjectRow(projects, ref) {
  if (!Array.isArray(projects) || ref == null || ref === '') return null;
  return projects.find((p) => p && (p.slug === ref || p.id === ref)) || null;
}
