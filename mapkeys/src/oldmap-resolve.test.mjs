import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOldMapInput, allmapsTiles, annotationBounds, annotationLabel,
} from './oldmap-resolve.js';

test('xyz template passes through', () => {
  const r = classifyOldMapInput('https://maps.example.com/t/{z}/{x}/{y}.png?key=abc');
  assert.equal(r.kind, 'xyz');
  assert.equal(r.tiles, 'https://maps.example.com/t/{z}/{x}/{y}.png?key=abc');
});

test('annotation URL becomes proxied tiles', () => {
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput(anno);
  assert.equal(r.kind, 'allmaps');
  assert.equal(r.annotation, anno);
  assert.equal(r.tiles, allmapsTiles(anno));
  assert.ok(r.tiles.startsWith('https://allmaps.xyz/{z}/{x}/{y}.png?url='));
});

test('bare 16-hex allmaps id expands to annotation URL', () => {
  const r = classifyOldMapInput('393A52E3E3882BC6');
  assert.equal(r.kind, 'allmaps');
  assert.equal(r.annotation, 'https://annotations.allmaps.org/maps/393a52e3e3882bc6');
});

test('viewer share link with ?url= param unwraps', () => {
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput('https://viewer.allmaps.org/?url=' + encodeURIComponent(anno));
  assert.equal(r.kind, 'allmaps');
  assert.equal(r.annotation, anno);
});

test('editor link with url in hash unwraps', () => {
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput('https://editor.allmaps.org/#/mask?url=' + encodeURIComponent(anno));
  assert.equal(r.kind, 'allmaps');
  assert.equal(r.annotation, anno);
});

test('garbage input returns null', () => {
  assert.equal(classifyOldMapInput(''), null);
  assert.equal(classifyOldMapInput('   '), null);
  assert.equal(classifyOldMapInput('not a url at all'), null);
});

const FAKE_ANNO = {
  type: 'Annotation',
  motivation: 'georeferencing',
  target: {
    source: {
      partOf: [{ type: 'Canvas', label: { none: ['Europa : Geologie'] } }],
    },
  },
  body: {
    features: [
      { geometry: { type: 'Point', coordinates: [10, 40] } },
      { geometry: { type: 'Point', coordinates: [30, 60] } },
      { geometry: { type: 'Point', coordinates: [20, 50] } },
    ],
  },
};

test('annotationBounds pads the GCP bbox', () => {
  const b = annotationBounds(FAKE_ANNO);
  assert.ok(b[0][0] < 10 && b[1][0] > 30);
  assert.ok(b[0][1] < 40 && b[1][1] > 60);
});

test('annotationBounds handles AnnotationPage wrapper', () => {
  const b = annotationBounds({ type: 'AnnotationPage', items: [FAKE_ANNO] });
  assert.ok(b && b[0][0] < 10);
});

test('annotationBounds returns null with no GCPs', () => {
  assert.equal(annotationBounds({ type: 'Annotation', body: { features: [] } }), null);
});

test('annotationLabel reads IIIF canvas label', () => {
  assert.equal(annotationLabel(FAKE_ANNO), 'Europa : Geologie');
  assert.equal(annotationLabel({}), null);
});
