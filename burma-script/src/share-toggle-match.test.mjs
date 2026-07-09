// share-toggle-match — locks findProjectRow, the row selector behind the masthead Share popover.
//
// WHY THIS EXISTS (iter #18): ShareToggle used to hardcode slug 'burma' AND match only on `p.slug`.
// But the SAME engine (burma-script/src/main.jsx) boots EVERY episode — burma, palau, palau2, and any
// library project — so a fixed 'burma' meant flipping the Share switch while editing Palau silently
// revoked/toggled the BURMA script's public sharing (wrong live document). main.jsx now passes
// EPISODE.id, and this selector matches on slug OR id because a legacy episode id IS the slug
// (burma/palau/palau2) while a brand-new library project's episode id is the cloud-row UUID
// (configForProject: id = row.id). Match slug-only and every library project (UUID ref) misses.

import assert from 'node:assert';

import { findProjectRow } from './share-project-match.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); pass++; };

// A realistic list as /api/script-projects returns it: legacy slug rows + a UUID-id library project.
const BURMA = { id: 'a1b2c3d4-0000-4000-8000-000000000001', slug: 'burma', title: 'Burma', is_public: true };
const PALAU = { id: 'a1b2c3d4-0000-4000-8000-000000000002', slug: 'palau', title: 'Palau', is_public: false };
const PALAU2 = { id: 'a1b2c3d4-0000-4000-8000-000000000003', slug: 'palau2', title: 'Palau V2', is_public: true };
const LIB = { id: 'f9e8d7c6-1111-4000-8000-0000000000ab', slug: 'my-new-doc', title: 'New Doc', is_public: true };
const LIST = [BURMA, PALAU, PALAU2, LIB];

// LEGACY episode ids are the slug — and must select the RIGHT row, not just any row.
eq(findProjectRow(LIST, 'burma'), BURMA, "episode id 'burma' selects the burma row");
eq(findProjectRow(LIST, 'palau'), PALAU, "episode id 'palau' selects the palau row");
eq(findProjectRow(LIST, 'palau2'), PALAU2, "episode id 'palau2' selects the palau2 row");

// LOAD-BEARING: palau must NEVER resolve to burma (the whole point of the fix).
ok(findProjectRow(LIST, 'palau') !== BURMA, 'palau does not resolve to the burma row');
ok(findProjectRow(LIST, 'palau2') !== BURMA, 'palau2 does not resolve to the burma row');

// LIBRARY projects: episode id is the cloud UUID → must match by id (slug-only would miss it).
eq(findProjectRow(LIST, 'f9e8d7c6-1111-4000-8000-0000000000ab'), LIB, 'a UUID episode id selects by row id');

// A row is also reachable by its own UUID for legacy rows (id space and slug space never collide).
eq(findProjectRow(LIST, BURMA.id), BURMA, 'the burma UUID selects the burma row by id');

// Misses and garbage → null (component shows a clean "not-found", never a wrong row).
eq(findProjectRow(LIST, 'nonesuch'), null, 'an unknown ref yields null');
eq(findProjectRow(LIST, ''), null, 'empty ref yields null');
eq(findProjectRow(LIST, null), null, 'null ref yields null');
eq(findProjectRow(LIST, undefined), null, 'undefined ref yields null');
eq(findProjectRow(null, 'burma'), null, 'non-array projects yields null');
eq(findProjectRow(undefined, 'burma'), null, 'undefined projects yields null');
eq(findProjectRow('burma', 'burma'), null, 'a string in place of the array yields null');
eq(findProjectRow([null, undefined, BURMA], 'burma'), BURMA, 'skips null entries without crashing');

// A row with a missing slug still matches by id.
ok(findProjectRow([{ id: 'x', title: 'no slug' }], 'x')?.id === 'x', 'a row with no slug is found by id');

console.log(`share-toggle-match: ${pass} passed, 0 failed`);
