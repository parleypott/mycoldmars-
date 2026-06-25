// Pure resolution of what an EEZ hover should display + highlight.
//
// A hovered EEZ feature carries a `Country` name; some features only carry an
// `ISO_A3` code. The tooltip falls back Country -> ISO_A3, but the map highlight
// can only light up the hovered polygon if it matches on the SAME property the
// label came from. The old inline code always matched on `Country` regardless of
// which field produced the label, so an ISO_A3-only feature showed a tooltip but
// never highlighted (and a blank label leaked a visible-but-empty tooltip box).
//
// resolveEezHover(props) -> { name, field, value } | null
//   null  => nothing nameable under the cursor: hide the tooltip, no highlight.
//   field => the property the highlight `case` must compare against, so the
//            polygon that produced the label is the one that lights up.
export function resolveEezHover(props) {
  if (!props || typeof props !== 'object') return null;

  const country = typeof props.Country === 'string' ? props.Country.trim() : '';
  if (country) return { name: country, field: 'Country', value: country };

  const iso = typeof props.ISO_A3 === 'string' ? props.ISO_A3.trim() : '';
  if (iso) return { name: iso, field: 'ISO_A3', value: iso };

  return null;
}
