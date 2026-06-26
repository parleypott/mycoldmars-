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
// `value` must be the RAW property string, not the trimmed display name: the map
// highlight runs `['==', ['get', field], value]`, and Mapbox `['get', field]`
// returns the unmodified feature property. If we matched against the trimmed name,
// any whitespace-padded feature (e.g. " Palau ") would show a tooltip but never
// light up its polygon — the exact label-vs-highlight divergence this module exists
// to prevent. So: trim for the human-readable `name`, keep the raw string for `value`.
export function resolveEezHover(props) {
  if (!props || typeof props !== 'object') return null;

  if (typeof props.Country === 'string' && props.Country.trim()) {
    return { name: props.Country.trim(), field: 'Country', value: props.Country };
  }

  if (typeof props.ISO_A3 === 'string' && props.ISO_A3.trim()) {
    return { name: props.ISO_A3.trim(), field: 'ISO_A3', value: props.ISO_A3 };
  }

  return null;
}
