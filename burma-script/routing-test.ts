// Burma Script importer — BLOCK ROUTING regression suite.
// parser.ts turns JH's raw script text into typed blocks (chapter / scene / sot / broll /
// vo / oncam / map-need / archive-req / note / bin). The timecode DETECTOR is locked by
// parse-test.ts; the block-ROUTING classifier had zero assertion coverage until now.
//
// Headline bug locked here: a bracketed-timecode soundbite that mentions a "controlled" /
// "patrolled" border (constant in a military/border story) was misfiled as B-ROLL because
// /\[.*roll/ matched the "roll" SUBSTRING inside "cont-roll-ed" / "pat-roll-ed". The fix
// word-bounds it (\broll\b) so real footage cues ("aerial roll") still read as b-roll while
// the prose substrings do not.  Run: bun routing-test.ts
import { parseScript } from "./parser";

let pass = 0, fail = 0;
function check(label: string, input: string, wantType: string) {
  const { doc } = parseScript(input);
  const got = doc.blocks[0]?.type;
  if (got === wantType) { pass++; }
  else { fail++; console.error(`  FAIL ${label}\n       ${JSON.stringify(input)}\n       got ${got}  want ${wantType}`); }
}

// --- the bug: substring "roll" inside prose words must NOT become b-roll ---------------
check("controlled soundbite -> sot", "[02:02:01:07] Jack: the army controlled the border", "sot");
check("patrolled soundbite -> sot", "[03:08:33:13] Drew: soldiers patrolled the river at night", "sot");
check("enrolled soundbite -> sot", "[01:08:54:15] the students enrolled in secret schools", "sot");
check("payroll soundbite -> sot", "[01:00:00:00] the payroll scandal broke that week", "sot");
// --- genuine footage cues MUST still read as b-roll -----------------------------------
check("aerial roll cue -> broll", "[02:02:01:07] aerial roll over the misty valley", "broll");
check("explicit b-roll -> broll", "[01:00:00:00] b-roll of soldiers marching", "broll");
check("establishing shot -> broll", "[01:00:00:00] establishing shot of the capital", "broll");
check("montage -> broll", "[01:00:00:00] montage of border crossings", "broll");
// --- speaker-attributed lines stay SOT even with footage-ish words --------------------
check("JH controlled stays sot", "[01:00:00:00] JH: the regime controlled everything", "sot");

// --- surrounding classifier behaviour locked so the fix can't regress it --------------
check("chapter heading", "CH: COLD OPEN FROM JH: still thinking what this is", "chapter");
check("scene heading", "SCENE: the night market at dawn", "scene");
check("mapping needs box", "[Mapping data needs: show the Salween river basin]", "map-need");
check("archive request box", "ARCHIVE: 1962 coup footage from state TV", "archive-req");
check("editor note", "!NOTE check the casualty figure before lock", "note");
check("vo writing surface", "VO: this is the story of a border that never settled {tk tighten}", "vo");
check("oncam monologue", "ON CAM: Johnny faces the camera on the ridge", "oncam");
check("plain prose -> bin", "just a loose paragraph of thinking with no markup", "bin");
check("bracket prose -> vo", "[drone b-roll of the misty hills] with no timecode", "vo");
check("map cue inside VO stays vo", "[MAP] + VO: our story begins at the river", "vo");

console.log(`=== BLOCK ROUTING: ${pass}/${pass + fail} cases pass ===`);
if (fail) process.exit(1);
