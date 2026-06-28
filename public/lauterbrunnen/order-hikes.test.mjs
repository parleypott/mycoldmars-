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

console.log(`order-hikes.test.mjs: ${n} assertions passed`);
