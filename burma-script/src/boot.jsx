// Burma entry boot. Selects the BURMA episode, THEN dynamically imports the shared script
// engine (./main.jsx). The dynamic import guarantees setEpisode(BURMA) runs before main.jsx's
// module-level `const EPISODE = getEpisode()` (and document-builder's episode-derived regexes)
// evaluate — a static `import './main.jsx'` would be hoisted ABOVE the setEpisode statement and
// read the default episode too early. Each episode entry is this same 4-line shape with its config.
import { BURMA } from '../config.js';
import { setEpisode } from './episode-config.js';

setEpisode(BURMA);
import('./main.jsx');
