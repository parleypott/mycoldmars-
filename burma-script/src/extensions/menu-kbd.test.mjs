/*
 * menu-kbd.test.mjs — L6 / ux-02 keyboard contract for the floating menus (block menu + timecode menu).
 *
 * The block/timecode popups were mouse-only. attachMenuKeynav + makeItemKeyActivatable add the keyboard
 * path: Escape closes, arrows move focus between items (wrapping), Enter/Space activates a focused item.
 * Pure logic over a tiny DOM stub (no jsdom) — verifies the wiring deterministically.
 */
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗', name, extra != null ? '— ' + extra : ''); } }

// ── minimal DOM stub ────────────────────────────────────────────────────────────────────────────
let FOCUSED = null;
class El {
  constructor(cls) { this.className = cls || ''; this.children = []; this.attrs = {}; this.listeners = {}; this.dispatched = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  focus() { FOCUSED = this; }
  dispatchEvent(ev) { this.dispatched.push(ev); (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
  // querySelectorAll('.wp-bm-item') → flatten descendants whose className contains the class.
  querySelectorAll(sel) {
    const want = sel.replace('.', '');
    const out = [];
    const walk = (n) => { for (const c of n.children) { if ((c.className || '').split(/\s+/).includes(want)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
class MouseEvent { constructor(type) { this.type = type; } }
globalThis.MouseEvent = MouseEvent;
globalThis.requestAnimationFrame = (fn) => fn(); // run focus-first synchronously

// document keydown registry so we can fire keys at the handler attachMenuKeynav installs.
const docKeydown = [];
globalThis.document = {
  activeElement: null,
  addEventListener: (t, fn) => { if (t === 'keydown') docKeydown.push(fn); },
  removeEventListener: (t, fn) => { if (t === 'keydown') { const i = docKeydown.indexOf(fn); if (i >= 0) docKeydown.splice(i, 1); } },
};
function fireKey(key) {
  const ev = { key, preventDefault() { this._pd = true; } };
  // keep document.activeElement in sync with our stub's focus
  document.activeElement = FOCUSED;
  docKeydown.slice().forEach((fn) => fn(ev));
  return ev;
}

const { attachMenuKeynav, makeItemKeyActivatable } = await import('./menu-kbd.js');

// Build a menu with 3 items.
const menu = new El('wp-blockmenu');
const items = [new El('wp-bm-item'), new El('wp-bm-item'), new El('wp-bm-item')];
items.forEach((it) => { makeItemKeyActivatable(it); menu.appendChild(it); });

// makeItemKeyActivatable: role + not in tab order; Enter fires a synthetic mousedown.
ok('item role=menuitem', items[0].getAttribute('role') === 'menuitem');
ok('item tabindex=-1', items[0].getAttribute('tabindex') === '-1');
items[0].dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
ok('Enter on item → mousedown dispatched', items[0].dispatched.some((e) => e.type === 'mousedown'));

let closed = false;
const onClose = () => { closed = true; };
attachMenuKeynav(menu, onClose);

// attachMenuKeynav focuses the first item immediately (rAF stubbed sync).
ok('first item focused on open', FOCUSED === items[0], FOCUSED && FOCUSED.className);

// ArrowDown moves focus 0→1→2→0 (wraps).
fireKey('ArrowDown'); ok('ArrowDown → item 1', FOCUSED === items[1]);
fireKey('ArrowDown'); ok('ArrowDown → item 2', FOCUSED === items[2]);
fireKey('ArrowDown'); ok('ArrowDown wraps → item 0', FOCUSED === items[0]);
// ArrowUp wraps backward.
fireKey('ArrowUp'); ok('ArrowUp wraps → item 2', FOCUSED === items[2]);
// Home/End.
fireKey('Home'); ok('Home → item 0', FOCUSED === items[0]);
fireKey('End'); ok('End → item 2', FOCUSED === items[2]);
// Escape calls onClose.
const ev = fireKey('Escape');
ok('Escape → onClose fired', closed);
ok('Escape preventDefault called', ev._pd === true);

console.log(`menu-kbd: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
