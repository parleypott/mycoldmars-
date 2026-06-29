// Locks the SHARED stripComments blanker (scripts/lib/strip-comments.mjs).
// The load-bearing property is the REGEX-LITERAL handling: a regex whose body
// holds a quote must be consumed as a regex, NOT mistaken for a string opener —
// otherwise the lexer runs away and blanks real downstream code (a silent
// false-negative for every gate that imports this). Run: node strip-comments.test.mjs
import { stripComments } from './strip-comments.mjs';

let pass = 0,
  fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};

// Helper: did `needle` survive (stay intact) in the blanked output?
const survives = (src, needle) => stripComments(src).includes(needle);

// 1) Plain comment/string blanking still works.
ok(!survives('a = 1; // arr.length\n', 'arr.length'), 'line comment is blanked');
ok(!survives('s = "arr.length";\n', 'arr.length'), 'string body is blanked');
ok(!survives('s = /* arr.length */ 1;\n', 'arr.length'), 'block comment is blanked');

// 2) Real code OUTSIDE strings/comments survives.
ok(survives('x = total / items.length;\n', 'items.length'), 'real divide survives');

// 3) THE DESYNC GUARD — a regex with a quote inside must not eat downstream code.
//    Pre-fix lexers treated the inner `'` as a string opener and blanked to the
//    next quote, swallowing `userArray` below.
const desync = "str.replace(/['\"]/g, ''); call(...userArray);\n";
ok(survives(desync, 'userArray'), 'code after a quote-bearing regex survives (desync guard)');

// 4) Regex whose body holds a `/` inside a char class must still terminate right.
const classRe = "str.split(/[,;]/); needLen / rows.length;\n";
ok(survives(classRe, 'rows.length'), 'code after a char-class regex survives');

// 5) Division is NOT mistaken for a regex: `a / b / c` stays intact.
ok(survives('y = a / b / c;\n', 'a / b / c'), 'chained division survives');

// 6) Template-literal ${...} expressions keep their real code.
ok(survives('`${done / items.length}`\n', 'items.length'), 'template expr code survives');

// 7) Escaped quote inside a string does not end it early.
ok(!survives('s = "he said \\"arr.length\\" ok";\n', 'arr.length'), 'escaped-quote string fully blanked');

console.log(fail === 0 ? `strip-comments.test: ${pass} passed` : `strip-comments.test: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
