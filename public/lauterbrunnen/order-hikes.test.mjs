// Mutation-lock for orderByHikeOrder in public/lauterbrunnen/index.html.
// The page's intro promises hikes are shown "most iconic first" and the live
// dataset is swapped wholesale via window.__loadData, so the canonical order must
// be enforced in code, not assumed from the injected array. This is a byte-for-byte
// copy of the function in the page (inline <script>, can't import). Keep in sync.
import assert from 'node:assert';

// ---- COPY START (must match index.html exactly) ----
function orderByHikeOrder(hikes, order){
  if(!Array.isArray(hikes)) return [];
  if(!Array.isArray(order) || !order.length) return hikes.slice();
  const rank=new Map(order.map((id,i)=>[id,i]));
  const BIG=order.length;
  return hikes
    .map((h,i)=>[h,i])
    .sort((a,b)=>{
      const ra=rank.has(a[0].id)?rank.get(a[0].id):BIG;
      const rb=rank.has(b[0].id)?rank.get(b[0].id):BIG;
      return ra!==rb ? ra-rb : a[1]-b[1];
    })
    .map(x=>x[0]);
}
function hikeNumber(ordered, h){ return Array.isArray(ordered) ? ordered.indexOf(h)+1 : 0; }
// ---- COPY END ----

const ids = a => a.map(h => h.id);
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// 1. A SCRAMBLED input is reordered to match meta.hikeOrder.
//    (This is the load-bearing case: a no-op comparator / identity return goes RED here.)
{
  const order = ['a','b','c','d'];
  const scrambled = [{id:'c'},{id:'a'},{id:'d'},{id:'b'}];
  eq(ids(orderByHikeOrder(scrambled, order)), ['a','b','c','d'],
     'scrambled hikes must follow meta.hikeOrder');
}

// 2. Already-ordered input is unchanged (today's live data shape — proves zero regression).
{
  const order = ['a','b','c'];
  const inOrder = [{id:'a'},{id:'b'},{id:'c'}];
  eq(ids(orderByHikeOrder(inOrder, order)), ['a','b','c'],
     'already-ordered input stays put');
}

// 3. ids NOT in the order list go to the END, preserving their original relative order.
{
  const order = ['a','b'];
  const mixed = [{id:'z'},{id:'b'},{id:'y'},{id:'a'}];
  eq(ids(orderByHikeOrder(mixed, order)), ['a','b','z','y'],
     'unranked ids appended in original relative order (stable)');
}

// 4. Stability among ranked ties is not a concern (ranks unique), but stability among
//    multiple unranked ids must hold.
{
  const order = ['a'];
  const many = [{id:'q'},{id:'a'},{id:'p'},{id:'r'}];
  eq(ids(orderByHikeOrder(many, order)), ['a','q','p','r'],
     'multiple unranked ids keep input order');
}

// 5. Missing / empty / non-array order => copy in original order, no throw.
{
  const hikes = [{id:'b'},{id:'a'}];
  eq(ids(orderByHikeOrder(hikes, undefined)), ['b','a'], 'undefined order -> original order');
  eq(ids(orderByHikeOrder(hikes, [])), ['b','a'], 'empty order -> original order');
  eq(ids(orderByHikeOrder(hikes, null)), ['b','a'], 'null order -> original order');
  const copy = orderByHikeOrder(hikes, undefined);
  ok(copy !== hikes, 'returns a copy, not the same array reference');
}

// 6. Non-array hikes => [] (defensive; __loadData could hand us junk).
{
  eq(orderByHikeOrder(null, ['a']), [], 'null hikes -> []');
  eq(orderByHikeOrder(undefined, ['a']), [], 'undefined hikes -> []');
  eq(orderByHikeOrder({}, ['a']), [], 'non-array hikes -> []');
}

// 7. hikeNumber: card placard number AND map-dot number both come from this helper.
//    It is the 1-based position in the CANONICAL ordered array — never the filtered
//    sublist's position. This is the load-bearing contract: the number a user sees on
//    a card must equal the number on its map dot, even inside a filtered view.
{
  const order = ['a','b','c','d','e'];
  const hikes = [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}];
  const ordered = orderByHikeOrder(hikes, order);
  // each hike numbered by its global rank
  eq(ordered.map(h => hikeNumber(ordered, h)), [1,2,3,4,5],
     'hikeNumber = 1-based position in the canonical ordered array');

  // Filter view: drop a,b,d — c and e remain. Their numbers MUST stay 3 and 5,
  // matching their map dots — NOT 1 and 2 (which a filtered-index impl would give).
  const filtered = ordered.filter(h => h.id === 'c' || h.id === 'e');
  eq(filtered.map(h => hikeNumber(ordered, h)), [3,5],
     'filtered cards keep their canonical number (filtered-index regression goes RED here)');

  // Sanity: the buggy "number by filtered position" would have produced [1,2].
  ok(filtered.map((h,i)=>i+1).join() === '1,2',
     'guard: the regression we forbid (filtered-index) yields the wrong [1,2]');

  // marker parity: the marker's forEach index+1 equals hikeNumber over the same array.
  ordered.forEach((h,i) => ok(i+1 === hikeNumber(ordered, h),
     'map-dot forEach index must equal hikeNumber (no divergence between the two render paths)'));

  // defensive: non-array ordered -> 0 (never throws, never NaN)
  ok(hikeNumber(null, hikes[0]) === 0, 'non-array ordered -> 0');
}

console.log(`order-hikes.test.mjs: ${n} assertions passed`);
