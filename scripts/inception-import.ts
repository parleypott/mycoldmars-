#!/usr/bin/env bun
// Inception Import — batch-creates all 3 QSS story arcs in the library
// with scene breaks detected by Claude and illustrations by Gemini.
// Run: bun run scripts/inception-import.ts

import { readFileSync } from "fs";
import * as path from "path";

function loadEnv() {
  const envFiles = [
    path.join(import.meta.dir, "../.env.local"),
    path.join(import.meta.dir, "../.env"),
    `${process.env.HOME}/.config/mycoldmars/secrets.env`,
  ];
  for (const f of envFiles) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
    } catch {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.HENRY_UNIVERSE_SUPABASE_URL || process.env.QSS_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.HENRY_UNIVERSE_SUPABASE_SERVICE_KEY || process.env.QSS_SUPABASE_SERVICE_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("❌ HENRY_UNIVERSE_SUPABASE_URL / HENRY_UNIVERSE_SUPABASE_SERVICE_KEY missing"); process.exit(1); }
if (!GEMINI_KEY) { console.error("❌ GEMINI_API_KEY missing"); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error("❌ ANTHROPIC_API_KEY missing"); process.exit(1); }

const WORLD_SLUG = "queen-scarlet";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function genId(len = 8) {
  let s = "";
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

// Same djb2 hash the browser uses for __sceneBreaksScanned fingerprints.
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── Supabase REST ───────────────────────────────────────────────────────────
async function sb(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${urlPath}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`sb_${res.status}: ${t.slice(0, 400)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : null;
}

async function sbUpload(storagePath: string, data: Uint8Array, mime: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/qss-scenes/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": mime,
      "x-upsert": "true",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body: data,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`storage_${res.status}: ${t.slice(0, 300)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/qss-scenes/${storagePath}`;
}

// ── Scene break detection (Claude) ─────────────────────────────────────────
const BREAK_SYSTEM = `You are a picture-book art director. You read a block of a kid's story and decide where the ILLUSTRATION should change. Your output is a list of character offsets where a new picture would help the reader.

PHILOSOPHY:
One picture per beat. A "beat" is a unit of visual life — a single moment a single image could show. Most stories have 3-10 beats per page. When in doubt, BREAK MORE OFTEN rather than less.

ALWAYS BREAK AT:
1. EXPLICIT MOVIE CUTS — "Cut to:", "Meanwhile,", "Back at...", time jumps, "[Setting], [time]."
2. A NEW NAMED CHARACTER takes the stage — first appearance in this block.
3. SETTING CHANGE — different room, building, planet, indoors→outdoors, flashback.
4. BIG TONAL SWING — calm→chaos, dialogue→action, comedy→emotion.
5. A SURPRISING NEW IMAGE enters the story.

DO NOT BREAK AT:
- Every sentence, paragraph, or line of dialogue.
- Small moves the same picture could cover.

OFFSET RULES:
- The offset is the character index in the INPUT text where the new picture starts.
- Use the START of the sentence or the cut line.
- Offsets must be > 0 and < text.length. Strictly increasing.
- Two breaks within 80 characters of each other are too close — pick one.
- SNAP to paragraph start (just after a \\n\\n) whenever possible — never land mid-sentence.

OUTPUT — strict JSON only:
{ "breaks": [ { "offset": number, "label": "short phrase", "why": "one sentence" }, ... ] }

If text is short (<300 chars) or no natural breaks, return { "breaks": [] }.
Cap at 16 breaks total.`;

interface SceneBreak { offset: number; label: string; why: string; }

async function detectBreaks(text: string): Promise<SceneBreak[]> {
  if (text.length < 300) return [];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: BREAK_SYSTEM,
      messages: [{
        role: "user",
        content: `Find the image-break offsets in this story block. Return JSON only.\n\nTEXT (length=${text.length}):\n${text}`,
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`claude_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  const raw = (data.content?.[0]?.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Snap each break offset to the nearest paragraph boundary so cues
  // never start mid-sentence.
  function snapToParagraph(t: string, off: number): number {
    if (off <= 0 || off >= t.length) return off;
    // Forward: look for \n\n within 200 chars
    const fwd = Math.min(t.length - 1, off + 200);
    for (let i = off; i < fwd; i++) {
      if (t[i] === '\n' && t[i + 1] === '\n') {
        let j = i + 2;
        while (j < t.length && /[\s\n]/.test(t[j])) j++;
        if (j < t.length) return j;
      }
    }
    // Backward: look for start of current paragraph
    for (let i = off - 1; i >= Math.max(0, off - 300); i--) {
      if (t[i] === '\n' && (i === 0 || t[i - 1] === '\n')) {
        let j = i + 1;
        while (j < t.length && /[ \t]/.test(t[j])) j++;
        if (j < t.length && j > 0) return j;
      }
    }
    return off;
  }

  try {
    const parsed = JSON.parse(raw) as { breaks: SceneBreak[] };
    return (parsed.breaks || [])
      .filter(b => b && typeof b.offset === "number" && b.offset > 0 && b.offset < text.length)
      .map(b => ({ ...b, offset: snapToParagraph(text, b.offset) }))
      .filter((b, i, arr) => {
        if (i === 0) return true;
        return Math.abs(b.offset - arr[i - 1].offset) >= 80;
      })
      .slice(0, 16);
  } catch {
    return [];
  }
}

// ── Art prompt (mirrors QSSArt.build in index.html) ─────────────────────────

const ART_STYLE = `Hand-drawn children's storybook illustration, 16:9 single full-bleed frame, thick black ink outlines with slightly varied hand-drawn weight, flat cel-shaded color blocks on a warm cream paper background (#F4ECD8). Soft natural light, no gradients, no airbrush, no photorealism. Mood: warm, expressive, scrappy — zany apocalypse-prep school energy in the tradition of Lauren Child and Oliver Jeffers. Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink. Skin tones rotate across deep brown, warm brown, golden, olive, freckled cream — white is the last option. Every character's full body must be visible and unclipped — wide establishing shot, subjects placed in the lower 55% of the frame, generous empty space above the tallest figure's head.`;

// Canonical character visual signatures — keep in sync with QSSArt.LOOKBOOK in index.html.
const LOOKBOOK: Record<string, { name: string; aliases?: string[]; signature: string }> = {
  'kevin': {
    name: 'Kevin',
    signature: 'a school-age boy whose head is completely swallowed by a giant grey calculator-helmet showing "ERROR: 3000" on its red screen, teal hoodie with a K on the chest, blue backpack',
  },
  'benny': {
    name: 'Benny the Prepared Beaver',
    aliases: ['benny the beaver', 'benny the prepared beaver'],
    signature: 'an anthropomorphic brown beaver standing upright in an orange high-visibility safety vest, buck teeth visible',
  },
  'queen scarlet': {
    name: 'Queen Scarlet',
    aliases: ['scarlet'],
    signature: 'a large red cartoon dragon with yellow horns and teal-and-orange wings, fierce-but-charming face, dominant presence in the room',
  },
  'mark rober': {
    name: 'Mark Rober',
    aliases: ['mark', 'mr rober'],
    // Based on actual reference photo: olive-tan skin, short dark brown hair, backward tan
    // Hurley baseball cap (brim facing back), short stubble, brown eyes, black t-shirt.
    // His studio background is a pegboard wall covered in colourful tools.
    signature: 'a man in his late thirties, olive-tan skin, brown eyes, short dark brown hair, backward tan baseball cap (brim facing back — his signature), short stubble beard, black t-shirt; when in his studio he stands in front of a pegboard tool wall',
  },
  'principal gerald': {
    name: 'Principal Gerald',
    signature: 'a tall stooped older man in a brown suit, balding with grey side hair, glasses on a chain, carrying a clipboard',
  },
  'lunch lady': {
    name: 'The Lunch Lady',
    signature: 'a middle-aged woman in a white kitchen apron and hairnet, holding a giant ladle',
  },
  'lila': {
    name: 'Lila',
    signature: 'a school-age girl with warm brown skin and two puffed-out pigtails, wearing a lab coat two sizes too big, eyes wide with enthusiasm',
  },
};

function detectCharacters(text: string): Array<{ key: string; name: string; signature: string }> {
  const t = text.toLowerCase();
  const hits: Array<{ key: string; name: string; signature: string }> = [];
  for (const [key, entry] of Object.entries(LOOKBOOK)) {
    const names = [key, ...(entry.aliases || []), entry.name];
    for (const n of names) {
      const lname = n.toLowerCase();
      const escaped = lname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(t)) { hits.push({ key, name: entry.name, signature: entry.signature }); break; }
    }
  }
  return hits;
}

function buildPrompt(sceneText: string): string {
  const clean = sceneText.trim();
  const characters = detectCharacters(clean);
  const charBlock = characters.length
    ? `The characters in this picture:\n${characters.map(c => `- ${c.name}: ${c.signature}`).join('\n')}\nBackground extras are ordinary-looking kids and grown-ups with naturalistic faces.`
    : 'The people in this picture are ordinary-looking kids and grown-ups with naturalistic faces and varied skin tones.';

  const scenePart = clean
    ? `Show one strong single moment from this passage — pick the most visually surprising or emotionally loaded beat and render only that one picture, like a single page of a picture book:\n"${clean.slice(0, 800)}"`
    : `Draw an inviting establishing shot for an empty scene in Queen Scarlet's School — a bright classroom or hallway, no specific action yet.`;

  const composition = `One camera angle, one moment, full-bleed frame. No comic panels, no speech bubbles, no visible text, words, or letters anywhere in the image. Wide enough that every character is fully visible from feet to top of head, with comfortable breathing room above the tallest figure.`;

  return [ART_STYLE, scenePart, charBlock, composition].filter(Boolean).join('\n\n');
}

// ── Gemini image generation ─────────────────────────────────────────────────
interface GeminiImage { base64: string; mime: string; }

async function generateImage(sceneText: string): Promise<GeminiImage | null> {
  const prompt = buildPrompt(sceneText);
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) {
      console.log(`    ⚠ gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ inlineData?: { data: string; mimeType: string } }> } }> };
    for (const cand of (data.candidates || [])) {
      for (const part of (cand.content?.parts || [])) {
        if (part.inlineData?.data) {
          return { base64: part.inlineData.data, mime: part.inlineData.mimeType || "image/png" };
        }
      }
    }
    console.log("    ⚠ no image in gemini response");
    return null;
  } catch (e) {
    console.log(`    ⚠ gemini error: ${e}`);
    return null;
  }
}

function b64toUint8(b64: string): Uint8Array {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Story data ──────────────────────────────────────────────────────────────
interface Episode { arc: string; name: string; text: string; }

const STORIES: Episode[] = [
  // ── Arc 1: The CrunchLabs Apocalypse ─────────────────────────────────
  {
    arc: "The CrunchLabs Apocalypse",
    name: "The Forty-Million-Dollar Glitter Bomb",
    text: `Mark Rober was a man who loved science. He loved squirrel obstacle courses, he loved dropping eggs from space, and he absolutely loved shooting glitter at package thieves.

He did not love the woman currently sitting in his filming studio.

Queen Scarlet sat atop a stool, sipping from a mug that said WORLD'S OKAYEST SURVIVOR, flanked by two men in full hazmat suits. On the table between her and Mark sat a standard-issue CrunchLabs cardboard box.

"I love your work, Mark," Scarlet beamed, her eyes twitching with excessive caffeine. "The engineering! The passion! The fact that you understand the fundamental truth that all problems can be solved with sufficient velocity!"

"Thank you," Mark said cautiously. "But I usually make, you know, fun physics toys. I don't really see how my brand aligns with a school for... nuclear apocalypse preparedness."

Scarlet snapped her fingers. One of the hazmat men placed a briefcase on the table and popped the latches. It was completely stuffed with cash.

"Forty million dollars," Scarlet whispered.

Mark choked on his own spit.

"Just for one sponsorship video," Scarlet continued, leaning in so close Mark could smell the shelf-stable cheese on her breath. "A special, limited-edition Queen Scarlet CrunchLabs box. We'll teach the kids real, practical STEM skills. Things they actually need."

Mark looked at the money. He thought about the engineering scholarships he could fund. He thought about how many slow-motion cameras he could buy. He slowly reached out and opened the prototype box on the table. Inside was a brightly colored instruction booklet, some plastic gears, a Nerf dart, and a heavy, glowing cylinder labeled: WARNING: ACTUAL WEAPONS-GRADE PAYLOAD (DO NOT EAT).

"This is a miniature nuclear weapon," Mark said, his voice terribly high.

"It's a learning opportunity," Scarlet corrected. "And the Nerf blaster is heavily modified to fire a miniaturized, heat-seeking cruise missile! It teaches aerodynamics!"

Mark stared at the forty million dollars. He stared at the glowing cylinder.

"Well," Mark sighed, putting on his signature backward baseball cap. "I guess I need to get the safety squints."

Two weeks later, the video dropped. Mark stood in front of his pegboard wall, smiling a smile that did not reach his terrified eyes.

"Hey guys!" he chirped to the camera. "Today's video is sponsored by Queen Scarlet! Have you ever looked at a standard Nerf battle and thought, 'Wow, this really lacks mutually assured destruction?' Well, thanks to this month's special CrunchLabs box..."`,
  },
  {
    arc: "The CrunchLabs Apocalypse",
    name: "The Show-and-Tell Incident",
    text: `The mail arrived at Totally Safe and Absolutely Educational Academy at exactly 9:00 AM. By 9:15 AM, chaos had erupted in Period 2.

Kevin, an aggressively average student who had thus far survived the semester by hiding under his desk, proudly brought his completed CrunchLabs project to the front of the classroom.

The teacher, who was currently wearing three layers of lead-lined aprons, peered at Kevin's desk.

"Kevin, what is that?" the teacher asked nervously.

"It's the new Mark Rober box!" Kevin said happily. He held up a bright orange plastic toy. "I learned about thrust-to-weight ratios, gyroscopic stabilization, and how to violate the Geneva Convention before recess!"

The rest of the class leaned in. Benny the Prepared Beaver, who was passing through the hallway with a tiny clipboard, stopped and pressed his gas-masked face against the door's window.

"Observe," Kevin said.

He aimed the orange blaster at a towering pyramid of canned beans in the back of the room. He pulled the trigger.

There was no pop or pew. Instead, there was a sound like a jet engine starting inside a garbage can. A tiny, sleek projectile shot out of the plastic barrel, leaving a visible contrail of smoke across the whiteboard. It struck the bean pyramid dead center.

KABOOOOOM.

The entire classroom shook. A miniature mushroom cloud made of pulverized baked beans and tomato sauce plumed into the air, hitting the ceiling tiles. Bean shrapnel rained down on the students, who simply opened their notebooks to shield their heads. They were used to this.

The teacher wiped a dollop of bean sauce off his safety goggles. He looked at the smoking crater where the pyramid had been. He looked at Kevin.

"Kevin," the teacher said softly.

"Yes, Mr. Henderson?"

"Did you remember to use my creator code at checkout?"

"Yes, sir."

"Excellent. A-minus. Please put the weapon of mass destruction in your locker until the final bell."`,
  },
  {
    arc: "The CrunchLabs Apocalypse",
    name: "The Barricade at the Post Office",
    text: `The Legal Department had finally had enough.

For three weeks, they had tolerated the infinite bean supply. They had tolerated the radioactive rock collections. But they absolutely drew the line at the United States Postal Service delivering military-grade ordnance to twelve-year-olds via a monthly subscription service.

Four lawyers, trembling but determined, marched out of the library and straight into Scarlet's office.

"You must stop this immediately!" the Lead Lawyer squeaked, slamming a cease-and-desist order onto Scarlet's desk. "You are mailing cruise missiles to children! The federal government is going to arrest us all!"

Scarlet, who was currently using a miniature CrunchLabs laser array to heat up her afternoon tea, didn't even look up.

"Oh, hush," Scarlet said. "It's perfectly legal. Mark Rober said it was educational on YouTube, which makes it binding corporate law."

"That is not how the law works!" the lawyer cried.

"Besides," Scarlet continued, waving a hand dismissively. "The kids aren't even using them for war. They're middle schoolers. They lack the strategic vision for global domination."

The Lead Lawyer paused. "They aren't?"

"Look out the window," Scarlet suggested.

The lawyers huddled around the reinforced glass of Scarlet's office. Down in the courtyard, a group of students had gathered around a massive, frozen puddle left over from Period 3's Nuclear Winter simulation.

They weren't fighting. They weren't plotting the downfall of rival middle schools. Instead, Kevin and three other boys had duct-taped their CrunchLabs mini-nukes to the back of a cafeteria lunch tray.

"Ready?" Kevin yelled, strapping on a bicycle helmet.

"Ready!" the others cheered.

Kevin hit a button. The miniature cruise missiles ignited, propelling the lunch tray across the ice at roughly three hundred miles per hour. Kevin screamed in pure, unadulterated joy before crashing spectacularly into a snowbank. Benny the Prepared Beaver trotted over and held up a scorecard that read: 9.5.

Scarlet smirked, taking a sip of her perfectly laser-heated tea.

"See?" she said to the horrified lawyers. "Physics in action. Now, if you'll excuse me, I need to call MrBeast. I have a frightfully good idea involving a deserted island and a very large bunker."`,
  },

  // ── Arc 2: Crunch Lab: The Invasion Arc ──────────────────────────────────
  {
    arc: "Crunch Lab: The Invasion Arc",
    name: "The Crunch Lab Invasion",
    text: `At 8:17 a.m., the mail truck backed up to the academy gates like a nervous turtle. Benny the Prepared Beaver hopped off his tiny forklift, adjusted his gas mask, and began unloading brown boxes stamped with a cheerful red logo: CRUNCH LAB – BROUGHT TO YOU BY QUEEN SCARLET.

Inside the cafeteria, Kevin poked his beans with a plastic spork. "Why does my box smell like uranium and regret?"

The lunch lady leaned in. "Because Mark Rober sold his soul for forty million dollars, dear. One video. That's all it took."

On every classroom TV, Mark Rober's face appeared, looking slightly sweaty but very rich. "Hey crunchers! Today, in collaboration with Queen Scarlet's Totally Safe and Absolutely Educational Academy, we're building MINI NUCLEAR WEAPONS and NERF CRUISE MISSILES! For learning! And practice! Totally safe in your backyard bunker!"

A small note fell out of Kevin's box: Warning: Do not hug glowing parts. Love, Queen Scarlet.

One girl named Lila already had her mini reactor humming like a happy microwave. "It says if I add two more rubber bands it becomes a real cruise missile," she whispered, eyes sparkling with the pure joy of mild apocalypse.

Benny drove past dragging a wagon of replacement beans, just in case.`,
  },
  {
    arc: "Crunch Lab: The Invasion Arc",
    name: "Period 5 Goes Boom (Politely)",
    text: `In Bunker Engineering class, Queen Scarlet stood atop a desk wearing a crown made of bottle caps. "Today we test our Crunch Lab creations! Remember: accountants are boring. Mini-nuke enthusiasts are heroes!"

Kevin's Nerf cruise missile had a smiley face drawn on it. It also had a real guidance chip that kept whispering "target acquired" in a soothing British accent.

Lila's mini reactor glowed a friendly green. "It's purring," she said proudly. "Mark Rober said purring is good."

The Legal Department, watching from a vent in the ceiling, whispered, "We're going to need a bigger barricade."

A gentle pop echoed as Kevin's missile launched, flew three feet, and stuck to the ceiling with a cheerful suction cup. Fake snow from the Nuclear Winter classroom drifted down like confetti.

Scarlet clapped. "Excellent! Only a small war crime. Ten points to everyone still alive!"

The principal poked his head through the fresh hole in the wall. "Can we please go back to long division?"

The children groaned in unison. Long division had never felt so safe.`,
  },
  {
    arc: "Crunch Lab: The Invasion Arc",
    name: "Beans, Bunkers, and Billion-Dollar Regret",
    text: `By afternoon recess the playground looked like a very cheerful scrapyard. Mini cruise missiles zoomed overhead carrying tiny notes that read "You forgot your beans."

Mark Rober appeared on the big screen again, now wearing a Scarlet-branded lab coat. "Thanks to our amazing sponsor, every Crunch Lab box also includes a lifetime supply of shelf-stable cheese! Because when the missiles fly, you'll still want snacks!"

Kevin sat on a pile of empty bean cans, looking thoughtful. "I like the glowing parts. But I also like my phone charger. And not dying."

Lila nodded slowly. "Mark Rober seemed really happy about the forty million. But Benny looks tired."

Benny the Prepared Beaver rolled by pulling a wagon full of slightly radioactive plush toys. He gave them all a tiny, exhausted thumbs-up.

Queen Scarlet burst through the ceiling on her emergency scooter, trailing glitter and mild fallout. "My brilliant students! Tomorrow we combine Crunch Lab with Emergency Bean Economics! We will calculate exactly how many beans equal one small mushroom cloud!"

Somewhere in the library, the Legal Department wept softly into their emergency pudding.

Kevin smiled a tiny, crooked smile. "At least middle school is never boring."

He picked up a glowing green barrel (strictly for hugging practice) and whispered, "Please don't explode before math class."

The barrel hummed happily back.

And the beans, as always, outlived everyone's good decisions.`,
  },

  // ── Arc 3: The Box That Changed Everything ────────────────────────────────
  {
    arc: "The Box That Changed Everything",
    name: "The Forty-Million-Dollar Box",
    text: `Queen Scarlet had decided that schools were too small.

"Children must learn at home!" she announced at breakfast, while eating beans with a silver shovel. "Disaster does not politely wait until homeroom!"

The legal department fainted into a filing cabinet.

So Scarlet flew to California in her private emergency blimp, which was shaped like a bean and said PLEASE DO NOT SHOOT THIS on the side.

She arrived at the studio of a very famous science YouTuber named Mark Rober.

Mark was building a robot that could sort M&Ms by color, mood, and secret opinions.

Scarlet burst through the door.

"MARK!" she cried. "I want to sponsor your next video."

Mark blinked.

"That depends. Is it educational?"

"Extremely."

"Is it safe?"

Scarlet looked out the window.

A pigeon exploded.

"Safe-ish," she said.

Then Scarlet slid a golden suitcase across the table. Mark opened it.

Inside was a check for forty million dollars.

Mark stared at it for a long time.

A very, very long time.

Finally, he said, "What exactly is the box?"

Scarlet smiled the sort of smile that made insurance companies lose hair.

"A special Crunch Lab box," she said, "for building tiny nuclear weapons and Nerf guns that shoot real cruise missiles."

Mark shut the suitcase.

"No."

Scarlet opened another suitcase.

"Forty million and one dollars."

Mark opened his mouth.

The legal department, who had secretly followed Scarlet in a rental van, crashed through the wall.

"NO REAL WEAPONS!" shouted a lawyer.

"NO RADIOACTIVE MATERIALS!" shouted another.

"NO CHILDREN WITH CRUISE MISSILES!" screamed the smallest lawyer, who had hidden inside a printer.

Mark thought carefully.

Then he smiled.

"All right," he said. "I'll do the video."

Scarlet clapped.

"But," said Mark, "I design the box."

Scarlet frowned.

"Fine. But it must be terrifying."

"It will be educational."

"Terrifyingly educational?"

"Educationally ridiculous."

"That will do."

The next day, Mark's video went live.

"Today's video," he said cheerfully, "is a collaboration with Queen Scarlet."

Scarlet appeared beside him wearing three medals, a cape, and a helmet that said CEO OF DOOM.

Mark held up the box.

"This is the Apocalypse Engineering Crunch Box. Inside, you'll find everything you need to build a mini nuclear weapon."

Scarlet nodded proudly.

Mark continued.

"By which I mean a completely harmless cardboard model that teaches chain reactions using ping-pong balls."

Scarlet's smile twitched.

"And a Nerf launcher that shoots real cruise missiles."

Scarlet brightened.

"By which I mean foam rockets that cruise gently across the room and deliver apology notes."

Scarlet's eye began to sparkle in a dangerous way.

Mark pressed a button.

A foam rocket shot across the studio, bounced off Scarlet's helmet, and unfolded a tiny note.

It read:
Dear Civilization,
Sorry about everything.
Love, Science.

The video got ninety million views.

Scarlet made a fortune.

Mark donated most of the money to safety education.

The legal department went on a small holiday to a cupboard.

And Benny the Prepared Beaver was hired to drive the tiny forklift full of boxes.

He was paid in beans.

He considered this rude.`,
  },
  {
    arc: "The Box That Changed Everything",
    name: "The Boxening",
    text: `On Thursday morning, every student at Scarlet's Academy received a package at home.

The box was bright orange.

On the front it said:
CRUNCH LABS APOCALYPSE BOX
Ages 8+
Definitely Not Illegal
Do Not Feed to Hamsters

Kevin opened his box at the kitchen table.

His mother watched nervously from behind a colander.

"What's inside?" she asked.

Kevin pulled out a booklet.

The title was:
HOW TO BUILD A MINI NUKE

His mother screamed into a banana.

Kevin opened the booklet.

Underneath the title, in very small letters, it said:
Not really. Calm down. This is about physics, choices, and why adults need naps.

Inside the box were:
A cardboard atom.
A packet of ping-pong balls.
A plastic button labeled DO NOT PRESS UNLESS YOU ENJOY CONSEQUENCES.
A foam rocket.
A coupon for one emergency bean.
And a tiny figure of Benny the Prepared Beaver wearing goggles.

Kevin pressed the button.

Immediately, the cardboard atom sprang open. Ping-pong balls bounced everywhere.

One hit the toaster.
One hit the dog.
One landed in Kevin's cereal and caused a small breakfast panic.

The dog ate the emergency bean.

"Congratulations!" said a recorded voice from the box. It was Mark Rober. "You have created a chain reaction. Notice how one thing can bump into another thing, and suddenly the kitchen is chaos."

Kevin's mother lowered the banana.

"So it's not a weapon?"

"No," said Kevin. "It's worse."

"What?"

"Homework."

At school, everyone brought their boxes to show-and-tell.

Scarlet stood at the front of the room, trembling with pride.

"Behold!" she cried. "My army of prepared children!"

The principal stepped forward.

"Scarlet, these are cardboard atoms."

"Starter atoms," said Scarlet.

The legal department inspected one box and looked confused.

"This is… actually safe," said a lawyer.

Another lawyer burst into tears.

"I don't know what to do with myself."

Then Kevin fired his foam rocket.

It soared across the classroom, made a heroic little fwip, and landed in the glue-eater's lap.

The rocket popped open.

A note fell out.

It read:
Dear Kevin,
Real missiles are bad.
Foam missiles are silly.
Choose silly.

The glue-eater nodded.

"That is wisdom," he said, and licked the note.

At lunch, the cafeteria served beans shaped like atoms.

Nobody liked them.

Except Benny.

Benny ate seventeen, saluted the microwave, and drove his forklift into a mop bucket.

Scarlet stood on a chair.

"Students!" she shouted. "Today you have learned the first rule of apocalypse preparation!"

Kevin raised his hand.

"Don't let you design toys?"

"No," said Scarlet. "Always monetize fear before someone else does."

The principal wrote that down in a little notebook labeled Reasons to Retire.`,
  },
  {
    arc: "The Box That Changed Everything",
    name: "The Cruise Missile That Apologized",
    text: `By Friday, Scarlet was furious.

The Crunch Lab boxes were selling wonderfully, which she liked.

But they were teaching safety, which she hated.

"This box is too responsible!" she shouted.

She threw a foam rocket at the wall.

It bounced back and bonked her on the nose.

The rocket opened.

A note fell out.

Dear Scarlet,
Please stop.
Love, Everyone.

Scarlet narrowed her eyes.

"Betrayal by stationery."

That afternoon, she announced a new assembly.

All students were ordered into the gym, which had been decorated with sandbags, bean pyramids, and one banner reading:
WELCOME TO RESPONSIBLE ENGINEERING DAY
Someone had crossed out "responsible" and written LOUD.

Mark appeared on the big screen.

"Hey everyone," he said. "Today we're testing the foam cruise rocket challenge."

The students cheered.

Scarlet stepped onstage beside a giant launcher.

"This," she said, "is a Nerf gun upgraded for serious disaster practice."

The legal department stood in front of it wearing bicycle helmets.

"It shoots foam," said Mark from the screen.

"Foam with ambition," said Scarlet.

Kevin raised his hand.

"What are we aiming at?"

The principal wheeled out three targets.

The first said PANIC.

The second said BAD DECISIONS.

The third said MIDDLE SCHOOL MATH.

The whole gym gasped.

"You can't shoot math," whispered one student.

"It always shoots back," said another.

Scarlet aimed the launcher.

"Fire!"

The foam rocket sailed through the air and hit PANIC.

A little parachute popped out.

Then a speaker inside the rocket played Mark's voice:

"When scary things exist, the best answer is not panic. It's understanding, rules, and not giving children missiles."

Everyone clapped.

Except Scarlet.

She aimed again.

The second rocket hit BAD DECISIONS.

It opened and released glitter.

The glitter spelled:
ASK A LAWYER FIRST.

The legal department wept with joy.

Then Scarlet turned toward the third target.

Middle School Math.

The room went silent.

Even Benny stopped chewing.

Scarlet fired.

The rocket flew straight at the math target.

But just before it hit, the math teacher stepped in front of it.

He caught the rocket with one hand.

"Nice try," he said.

The students screamed.

The math teacher opened the rocket.

Inside was a note.

He read it aloud.

Dear Students,
Some disasters cannot be avoided.
Please turn to page 47.

There was a terrible sound.

It was the sound of thirty children opening math books.

Scarlet smiled slowly.

"At last," she whispered. "A weapon truly powerful enough."

The principal pointed at her.

"No."

Mark's face on the screen sighed.

"Scarlet, the whole point of the box is that knowledge can make people safer."

Scarlet folded her arms.

"And richer?"

"Sometimes."

"And dramatic?"

"Unfortunately."

"And full of beans?"

Mark paused.

"No."

At that exact moment, Benny drove into the gym on his tiny forklift carrying fifty cans of beans and one very worried hamster.

The hamster wore a helmet.

The forklift horn went meep meep.

Scarlet looked at the hamster.

The hamster looked at Scarlet.

The hamster squeaked.

Nobody knew what it meant, but it sounded legally binding.

That evening, every student went home with a new badge.

It said:
I SURVIVED APOCALYPSE BOX DAY
AND ONLY LEARNED A LITTLE MATH

Kevin pinned his badge to his backpack.

His mother asked, "So what did you learn?"

Kevin thought about cardboard atoms, foam rockets, apology notes, and Scarlet being bonked by her own invention.

"I learned," he said, "that the scariest thing in the world is a grown-up with a sponsorship deal."

His mother nodded.

"And?"

Kevin sighed.

"And page 47."`,
  },
];

// ── Cue type ─────────────────────────────────────────────────────────────────
interface Variation { id: string; url: string; mimeType: string; created_at: number; }
interface Cue {
  id: string;
  offset: number;
  label: string;
  auto: boolean;
  source_text: string;
  variations: Variation[];
  active_variation_id: string | null;
  image?: { url: string; mimeType: string };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function importStory(ep: Episode, index: number): Promise<string | null> {
  const n = `[${index + 1}/9]`;
  const blockId = genId(8);

  console.log(`\n${n} 📖 "${ep.name}" (${ep.arc})`);

  // 1. Create or reset story
  console.log(`${n}   Creating story record...`);
  let storyId: string;
  try {
    const rows = await sb("POST", "qss_stories", {
      name: ep.name,
      world_slug: WORLD_SLUG,
      rules: { inception: true, arc: ep.arc },
      blocks: [{ id: blockId, text: ep.text, __cues: [] }],
    }) as Array<{ id: string }>;
    storyId = rows[0].id;
    console.log(`${n}   ✓ Story created: ${storyId}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      console.log(`${n}   ↩ Duplicate — finding existing story...`);
      try {
        const rows = await sb("GET", `qss_stories?name=eq.${encodeURIComponent(ep.name)}&select=id&limit=1`) as Array<{ id: string }>;
        if (!rows?.length) throw new Error("not found after duplicate error");
        storyId = rows[0].id;
        await sb("PATCH", `qss_stories?id=eq.${storyId}`, {
          rules: { inception: true, arc: ep.arc },
          blocks: [{ id: blockId, text: ep.text, __cues: [] }],
          updated_at: new Date().toISOString(),
        });
        console.log(`${n}   ✓ Reset existing story: ${storyId}`);
      } catch (e2) {
        console.error(`${n}   ✗ Could not recover from duplicate: ${e2}`);
        return null;
      }
    } else {
      console.error(`${n}   ✗ Failed to create story: ${e}`);
      return null;
    }
  }

  // 2. Detect scene breaks
  console.log(`${n}   Detecting scene breaks...`);
  let breaks: SceneBreak[] = [];
  try {
    breaks = await detectBreaks(ep.text);
    console.log(`${n}   ✓ Found ${breaks.length} scene breaks`);
  } catch (e) {
    console.log(`${n}   ⚠ Scene break detection failed: ${e}`);
  }
  await sleep(500);

  // 3. Build cues — offset-0 opener first, then detected breaks
  const rawCues: Array<{ id: string; offset: number; label: string }> = [
    { id: genId(8), offset: 0, label: "opening" },
    ...breaks.map(b => ({ id: genId(8), offset: b.offset, label: b.label })),
  ];

  // Assign source_text slices now so the browser never falls back to full block text
  const cues: Cue[] = rawCues.map((rc, i) => {
    const nextOffset = rawCues[i + 1]?.offset ?? ep.text.length;
    return {
      id: rc.id,
      offset: rc.offset,
      label: rc.label,
      auto: true,
      source_text: ep.text.slice(rc.offset, nextOffset),
      variations: [],
      active_variation_id: null,
    };
  });

  // 4. Generate images for each cue
  console.log(`${n}   Generating ${cues.length} images...`);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    console.log(`${n}   🎨 [${i + 1}/${cues.length}] "${cue.label.slice(0, 50)}"`);
    let img: GeminiImage | null = null;
    for (let attempt = 0; attempt < 3 && !img; attempt++) {
      if (attempt > 0) { console.log(`${n}   ↩ retry ${attempt}...`); await sleep(3000); }
      img = await generateImage(cue.source_text);
    }
    if (img) {
      try {
        const ext = img.mime.includes("jpeg") ? "jpg" : "png";
        const varId = genId(8) + "-v";
        const storagePath = `${WORLD_SLUG}/${storyId}/storybook/${blockId}/${cue.id}-${varId}.${ext}`;
        const url = await sbUpload(storagePath, b64toUint8(img.base64), img.mime);
        const variation: Variation = { id: varId, url, mimeType: img.mime, created_at: Date.now() };
        cue.variations.push(variation);
        cue.active_variation_id = varId;
        cue.image = { url, mimeType: img.mime };
        console.log(`${n}   ✓ ...${url.split("/").slice(-2).join("/")}`);
      } catch (e) { console.log(`${n}   ⚠ upload failed: ${e}`); }
    } else {
      console.log(`${n}   ⚠ No image after 3 attempts — skipping`);
    }
    if (i < cues.length - 1) await sleep(2000);
  }

  // 5. Save with __sceneBreaksScanned fingerprint so the browser won't
  //    re-run detection and overwrite the import cues.
  const fp = `${ep.text.length}:${hashString(ep.text)}`;
  console.log(`${n}   Saving ${cues.length} cues (fp: ${fp})...`);
  try {
    await sb("PATCH", `qss_stories?id=eq.${storyId}`, {
      blocks: [{
        id: blockId,
        text: ep.text,
        __cues: cues,
        __sceneBreaksScanned: fp,
      }],
      rules: { inception: true, arc: ep.arc },
      updated_at: new Date().toISOString(),
    });
    const withImages = cues.filter(c => c.variations.length > 0).length;
    console.log(`${n}   ✓ Saved! ${withImages}/${cues.length} cues have images`);
  } catch (e) {
    console.error(`${n}   ✗ Failed to save: ${e}`);
  }

  return storyId;
}

async function main() {
  console.log("🚀 Inception Import — Queen Scarlet's School");
  console.log(`   ${STORIES.length} episodes across 3 arcs`);
  console.log(`   Supabase: ${SUPABASE_URL}`);
  console.log(`   World: ${WORLD_SLUG}\n`);

  try {
    await sb("GET", "qss_stories?select=id&limit=1");
    console.log("✓ Supabase connection OK\n");
  } catch (e) {
    console.error(`✗ Supabase connection failed: ${e}`);
    process.exit(1);
  }

  const results: Array<{ name: string; storyId: string | null }> = [];
  for (let i = 0; i < STORIES.length; i++) {
    const storyId = await importStory(STORIES[i], i);
    results.push({ name: STORIES[i].name, storyId });
    if (i < STORIES.length - 1) {
      console.log("\n⏳ Pausing 3s...");
      await sleep(3000);
    }
  }

  console.log("\n\n════════════════════════════════════");
  console.log("📋 Import Summary");
  console.log("════════════════════════════════════");
  for (const r of results) console.log(`${r.storyId ? "✓" : "✗"} "${r.name}" → ${r.storyId || "FAILED"}`);
  const ok = results.filter(r => r.storyId).length;
  console.log(`\n${ok}/${results.length} stories imported successfully`);
  console.log("\n✅ Done! Refresh the QSS library to see your inception stories.");
}

await main();
