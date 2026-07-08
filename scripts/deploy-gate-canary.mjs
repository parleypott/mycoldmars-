// deploy-gate-canary.mjs — proves a runtime can ACTUALLY run the burma-script tests.
//
// The deploy gate (scripts/deploy-gate.mjs) never judges the real suite with an
// unproven runner. Before running 90+ test files it runs THIS file under each
// candidate runtime (bun first, then whatever is executing the gate). Only a
// runtime that passes the canary gets to declare the suite red.
//
// The canary deliberately exercises the exact import surface the real tests use,
// so a runtime that would fail them SPURIOUSLY fails HERE instead (and the gate
// fails open) rather than failing the suite (which would brick a deploy):
//   1. node:assert/strict         — every test's assertion library
//   2. @tiptap/core ESM           — the heaviest dependency the tests pull in
//   3. a BARE json import         — bun allows it; node throws
//      ERR_IMPORT_ATTRIBUTE_MISSING (several tests import sample-blocks.json
//      bare, so a runtime that can't do this can't run the suite)
//
// Exit 0 = this runtime can run the suite. Anything else = it can't.
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import fixture from './deploy-gate-canary.json';

assert.equal(typeof getSchema, 'function', '@tiptap/core did not resolve');
assert.equal(fixture.ok, true, 'bare json import did not resolve');
console.log('canary: this runtime can run the burma-script tests');
