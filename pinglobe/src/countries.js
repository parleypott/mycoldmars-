import * as topojson from 'topojson-client';
import worldTopo from 'world-atlas/countries-110m.json';

const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

export function getCountryFeatures() {
  return countriesGeo.features;
}
