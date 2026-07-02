// Palau entry boot. Mirrors burma-script/src/boot.jsx exactly: select the PALAU episode FIRST,
// then dynamically import the shared engine so setEpisode(PALAU) runs before main.jsx's
// module-level `const EPISODE = getEpisode()` (and document-builder's episode-derived regexes)
// evaluate. A static import would hoist above setEpisode and read the default (Burma) episode.
import { PALAU } from './config.js';
import { setEpisode } from '../burma-script/src/episode-config.js';
import { redirectStandaloneToLibrary } from '../burma-script/src/standalone-gate.js';

// GATE THE STANDALONE DOOR (audit finding L): the editable /palau-script/ door redirects into the
// login-gated library route (/scripts-library/#palau). ?read / ?view read-only shares are left alone
// (write-incapable, must work without a login). If we redirect, we do NOT boot the engine here.
if (!redirectStandaloneToLibrary('palau')) {
  setEpisode(PALAU);
  import('../burma-script/src/main.jsx');
}
