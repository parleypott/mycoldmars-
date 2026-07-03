// Palau V2 entry boot. Mirrors palau-script/boot.jsx exactly: select the PALAU2 episode FIRST,
// then dynamically import the shared engine so setEpisode(PALAU2) runs before main.jsx's
// module-level `const EPISODE = getEpisode()` (and document-builder's episode-derived regexes)
// evaluate. A static import would hoist above setEpisode and read the default (Burma) episode.
import { PALAU2 } from './config.js';
import { setEpisode } from '../burma-script/src/episode-config.js';
import { redirectStandaloneToLibrary } from '../burma-script/src/standalone-gate.js';

// GATE THE STANDALONE DOOR: the editable /palau2-script/ door redirects into the login-gated
// library route (/scripts-library/#palau2). ?read / ?view read-only shares are left alone
// (write-incapable, must work without a login). If we redirect, we do NOT boot the engine here.
if (!redirectStandaloneToLibrary('palau2')) {
  setEpisode(PALAU2);
  import('../burma-script/src/main.jsx');
}
