// devchat-render.js — the pure render boundary for the in-product devchat
// panel. Devchat messages can be written ANONYMOUSLY (intentional, for bug
// reports — /api/devchat-respond is a public endpoint), so every field on a
// message row (body, sender, metadata.images[].url, id) is attacker-
// controllable and gets rendered into the operator's DOM via innerHTML /
// insertAdjacentHTML. This module is the single place that turns an untrusted
// message row into HTML, so the XSS + URL-scheme boundary lives in one tested
// spot. Pure (no DOM, no network) so it can be locked headlessly.

// HTML-encode the five characters that can break out of an HTML context
// (text node OR a double/single-quoted attribute value).
export function escDc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Whitelist the URL scheme before emitting an attachment <a href>/<img src>.
// HTML-encoding alone still leaves `javascript:` and `data:text/html` schemes
// live as a click-to-execute link in the operator's session — only http(s)
// is allowed through; everything else (and anything unparseable) → null so
// the caller drops the image entirely.
export function safeImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {}
  return null;
}

// Friendly display label per sender role. Unknown roles fall through to the
// raw value — which is why the caller ALWAYS escDc()s the result.
export function senderLabel(s) {
  if (s === 'user') return 'you';
  if (s === 'assistant') return 'parley';
  if (s === 'agent') return 'fixer';
  return s;
}

// Render one (untrusted) message row to HTML. Every interpolation is either
// escDc()'d (body, sender, id, label) or scheme-whitelisted + escDc()'d
// (image urls), so no field can inject live markup or a live href.
export function messageToHtml(m) {
  const images = m.metadata?.images || [];
  const safeImages = images
    .map(img => ({ ...img, url: safeImageUrl(img?.url) }))
    .filter(img => img.url);
  const imagesHtml = safeImages.length ? `
    <div class="devchat-msg-images">
      ${safeImages.map(img => `
        <a class="devchat-msg-image" href="${escDc(img.url)}" target="_blank" rel="noopener noreferrer">
          <img src="${escDc(img.url)}" alt="attachment" loading="lazy">
        </a>
      `).join('')}
    </div>
  ` : '';
  const bodyHtml = m.body ? `<div class="devchat-msg-body">${escDc(m.body).replace(/\n/g, '<br>')}</div>` : '';
  return `
    <div class="devchat-msg devchat-msg--${escDc(m.sender)}" data-msg-id="${escDc(m.id || '')}">
      <div class="devchat-msg-sender">${escDc(senderLabel(m.sender))}</div>
      ${imagesHtml}
      ${bodyHtml}
    </div>
  `;
}
