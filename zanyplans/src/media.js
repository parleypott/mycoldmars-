/**
 * Media resolution for zanyplans spaces.
 *
 * Extracted from main.js so the two load-bearing pure-ish helpers every space's
 * render depends on can be unit-tested in isolation:
 *   - getMediaType  decides video-vs-gif-vs-image, which picks the DOM element
 *     the gallery/collage builds (a wrong verdict ships a broken <video> for a
 *     still image, or an <img> for a clip).
 *   - getMediaForSpace turns a slug into the render list — real files when the
 *     manifest has them, else a deterministic-hue placeholder grid.
 */

import { mediaManifest } from './spaces.js';

export function getMediaType(filename) {
  const ext = String(filename ?? '').split('.').pop().toLowerCase();
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (ext === 'gif') return 'gif';
  return 'image';
}

// Placeholder hue ranges per space; everything else gets the full wheel.
const PLACEHOLDER_PALETTES = {
  void: [220, 260],
  memories: [0, 30],
};

export function getMediaForSpace(slug) {
  const files = mediaManifest[slug] || [];
  if (files.length > 0) {
    return files.map(f => ({
      src: `/zanyplans/spaces/${slug}/${f}`,
      type: getMediaType(f),
      label: f
    }));
  }
  // Generate placeholders
  const [hueMin, hueMax] = PLACEHOLDER_PALETTES[slug] || [0, 360];
  return Array.from({ length: 12 }, (_, i) => ({
    src: null,
    type: 'placeholder',
    color: `hsl(${hueMin + ((hueMax - hueMin) * i / 12)}, 50%, ${15 + Math.random() * 20}%)`,
    label: `${slug.toUpperCase()}_${String(i).padStart(3, '0')}.DAT`
  }));
}
