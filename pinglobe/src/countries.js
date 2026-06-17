import * as topojson from 'topojson-client';
// Use the 50m atlas — the SAME one main.js draws the visible borders from.
// The coarse 110m atlas drops small countries entirely (no feature for
// Maldives 462, Palau 585, Monaco 492), and checkGuess() in game.js judges a
// country clue purely by polygon containment against THIS feature list. A
// missing feature => find() returns undefined => `correct` stays false forever,
// so those country clues were permanently unwinnable: the player could see the
// country (drawn from 50m) and click dead-center on it and still be marked
// wrong. 50m carries all three (plus higher-resolution borders for the rest),
// so judging now matches what the player actually sees.
import worldTopo from 'world-atlas/countries-50m.json';

const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

export function getCountryFeatures() {
  return countriesGeo.features;
}
