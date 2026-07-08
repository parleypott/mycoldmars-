// Attribute-safe HTML escaper for the layer/shape/old-map panel rows, whose
// names get interpolated into innerHTML — including title="..." attributes.
// Old-map overlays are named from external Allmaps IIIF labels, which really
// do carry `&` ("Baist & Sanborn") and quotes; user layer/shape names can too.
// Escaping quotes (not just <>&) keeps it safe inside a double-quoted attr and
// clears the find-attr-unsafe-escaper gate. Byte-identical for any clean name.
export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
