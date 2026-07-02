// Burma entry boot. Selects the BURMA episode, THEN dynamically imports the shared script
// engine (./main.jsx). The dynamic import guarantees setEpisode(BURMA) runs before main.jsx's
// module-level `const EPISODE = getEpisode()` (and document-builder's episode-derived regexes)
// evaluate — a static `import './main.jsx'` would be hoisted ABOVE the setEpisode statement and
// read the default episode too early. Each episode entry is this same 4-line shape with its config.
import { BURMA } from '../config.js';
import { setEpisode } from './episode-config.js';
import { redirectStandaloneToLibrary } from './standalone-gate.js';

// GATE THE STANDALONE DOOR (audit finding L): /burma-script/ mounts the full editor + live cloud sync
// with NO login, bypassing the Script Library's sign-in gate. Redirect the EDITABLE door into the
// login-gated library route for this project (/scripts-library/#burma). A ?read / ?view SHARE link is
// left alone — those sessions are read-only and structurally write-incapable, so they must keep
// working WITHOUT a login (that is the whole point of a share). If we redirect, we do NOT boot the
// engine here (the library will boot it behind the gate).
if (!redirectStandaloneToLibrary('burma')) {
  setEpisode(BURMA);
  import('./main.jsx');
}
