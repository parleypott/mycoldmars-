// WP-01 LIST round-trip test — proves the "- " bullet input rule actually fires inside the
// three block bodies that previously forbade lists, and that a list survives the canonical
// doc round-trip losslessly.
//
// THE BUG THIS GUARDS (regression): the list-support commit widened only 7 of 10 editable
// block nodes to content '(paragraph | bulletList | orderedList)+' and LEFT noneBlock,
// chapterBlock and sceneBlock at 'paragraph+'. Because noneBlock is the default type for
// every newly inserted block (insertBlockBelow), the most common authoring path — add a
// block, type "- " — produced NO bullet at all: findWrapping returns null in a paragraph-only
// container, so StarterKit's BulletList wrappingInputRule silently no-ops.
//
// We assert at the SCHEMA level (the same schema the live editor + the migrate-doc save gate
// enforce), so this test can't be fooled by anything above ProseMirror:
//   1) bulletList(listItem(paragraph)) is a VALID child of none/chapter/scene/vo/sot.
//   2) findWrapping([list-range], bulletList) SUCCEEDS inside each — i.e. "- " will convert.
//   3) a list nested in a block survives getJSON -> docToBlocks (text captured, not dropped).
//
// Run: bun burma-script/list-roundtrip-test.ts

import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import { Gapcursor } from "@tiptap/extension-gapcursor";
import { findWrapping } from "@tiptap/pm/transform";
import { BURMA_NODES } from "./src/extensions/blocks.js";
import { BURMA_TABLE_NODES } from "./src/extensions/table.js";
import { BURMA_MARKS } from "./src/extensions/marks.js";
import { docToBlocks } from "./src/document-builder.js";

// Mirror migrate-doc.js buildSchema() / Editor.jsx exactly — lists ON.
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: "#d23b2c", width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
] as any);

let failures = 0;
const fail = (msg: string) => { failures++; console.error("  ✗ " + msg); };

const { bulletList, listItem, paragraph } = schema.nodes;

// Build a bulletList(listItem(paragraph("one")), listItem(paragraph("two"))).
function sampleList() {
  return bulletList.create(null, [
    listItem.create(null, paragraph.create(null, schema.text("one"))),
    listItem.create(null, paragraph.create(null, schema.text("two"))),
  ]);
}

// The three blocks the bug left list-hostile, plus two that were already fine (positive control).
const BLOCK_NODES = ["noneBlock", "chapterBlock", "sceneBlock", "voBlock", "sotBlock"];

// 1) + 2) schema validity AND the input-rule precondition (findWrapping) for each block body.
for (const name of BLOCK_NODES) {
  const nodeType = schema.nodes[name];
  if (!nodeType) { fail(`schema is missing node type ${name}`); continue; }

  // (1) a list is a structurally valid child of this block.
  const block = nodeType.create(null, [sampleList()]);
  try {
    block.check(); // throws if the content doesn't satisfy the schema
  } catch (e) {
    fail(`${name}: bulletList is NOT a valid child — ${(e as Error).message}`);
    continue;
  }

  // (2) the actual "- " precondition: a paragraph sitting in this block must be wrappable in a
  //     bulletList. This is exactly what StarterKit's wrappingInputRule calls; if it returns
  //     null the bullet rule no-ops and typing "- " does nothing.
  const blockWithPara = nodeType.create(null, [
    paragraph.create(null, schema.text("draft")),
  ]);
  // Resolve a position inside that inner paragraph: depth 0 = block, 1 = paragraph, +1 into text.
  const $inner = blockWithPara.resolve(2); // 0:start, 1:into-block, 2:into-paragraph
  const range = $inner.blockRange();
  if (!range) { fail(`${name}: could not derive a block range for the inner paragraph`); continue; }
  const wrapping = findWrapping(range, bulletList);
  if (!wrapping) {
    fail(`${name}: findWrapping(bulletList) returned null — "- " would no-op inside this block`);
  }
}

// 3) lossless-enough round-trip: a list nested in a block survives getJSON -> docToBlocks.
//    The blocks array is a flattened export view (lists collapse to their text there), but the
//    list TEXT must survive — nothing silently dropped — and the canonical doc JSON keeps the
//    full bulletList structure (that JSON is what saveDoc persists to localStorage).
{
  const noneWithList = schema.nodes.noneBlock.create({ blockId: "lst_1" }, [
    sampleList(),
  ]);
  const doc = schema.nodes.doc.create(null, [noneWithList]);
  const json = doc.toJSON();

  // canonical JSON keeps the bulletList structure intact (this is what gets persisted).
  const jsonStr = JSON.stringify(json);
  if (!jsonStr.includes('"bulletList"') || !jsonStr.includes('"listItem"'))
    fail("canonical doc JSON dropped the bulletList/listItem structure");

  // re-parse the JSON back to a node to prove it survives the schema on reload (the seed path).
  try {
    const reparsed = schema.nodeFromJSON(json);
    reparsed.check();
  } catch (e) {
    fail(`doc with a nested list failed to re-parse against the schema: ${(e as Error).message}`);
  }

  // derived blocks export captures the list text (no words lost).
  const blocks = docToBlocks(json);
  const blk = blocks.find((b: any) => b.id === "lst_1");
  if (!blk) fail("docToBlocks dropped the block that held the list");
  else {
    const text = (blk.text || blk.title || "");
    if (!text.includes("one") || !text.includes("two"))
      fail(`docToBlocks lost the list text: got "${text}"`);
  }
}

console.log(`list round-trip: checked ${BLOCK_NODES.length} block bodies for list validity + "- " wrappability`);
if (failures) { console.error(`FAILED — ${failures} assertion(s) broke`); process.exit(1); }
console.log('OK — lists form via "- " inside none/chapter/scene/vo/sot and round-trip losslessly');
