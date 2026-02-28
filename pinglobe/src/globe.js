import * as THREE from 'three';
import * as topojson from 'topojson-client';
import worldTopo from 'world-atlas/countries-110m.json';
import { featureCentroid, GLOBE_RADIUS } from './geo-utils.js';

// ─── Country name lookup ───
const COUNTRY_NAMES = {
  "004":"Afghanistan","008":"Albania","012":"Algeria","024":"Angola",
  "032":"Argentina","036":"Australia","040":"Austria","050":"Bangladesh",
  "056":"Belgium","064":"Bhutan","068":"Bolivia","070":"Bosnia and Herz.",
  "076":"Brazil","100":"Bulgaria","104":"Myanmar","116":"Cambodia",
  "120":"Cameroon","124":"Canada","144":"Sri Lanka","152":"Chile",
  "156":"China","170":"Colombia","178":"Congo","180":"Dem. Rep. Congo",
  "188":"Costa Rica","191":"Croatia","192":"Cuba","196":"Cyprus",
  "203":"Czechia","208":"Denmark","218":"Ecuador","818":"Egypt",
  "222":"El Salvador","231":"Ethiopia","232":"Eritrea","233":"Estonia",
  "246":"Finland","250":"France","268":"Georgia","276":"Germany",
  "288":"Ghana","300":"Greece","320":"Guatemala","324":"Guinea",
  "332":"Haiti","340":"Honduras","348":"Hungary","352":"Iceland",
  "356":"India","360":"Indonesia","364":"Iran","368":"Iraq",
  "372":"Ireland","376":"Israel","380":"Italy","388":"Jamaica",
  "392":"Japan","400":"Jordan","398":"Kazakhstan","404":"Kenya",
  "408":"N. Korea","410":"S. Korea","414":"Kuwait","418":"Laos",
  "422":"Lebanon","434":"Libya","440":"Lithuania","442":"Luxembourg",
  "450":"Madagascar","458":"Malaysia","466":"Mali","484":"Mexico",
  "496":"Mongolia","504":"Morocco","508":"Mozambique","516":"Namibia",
  "524":"Nepal","528":"Netherlands","540":"New Caledonia","554":"New Zealand",
  "558":"Nicaragua","562":"Niger","566":"Nigeria","578":"Norway",
  "586":"Pakistan","591":"Panama","598":"Papua New Guinea","600":"Paraguay",
  "604":"Peru","608":"Philippines","616":"Poland","620":"Portugal",
  "630":"Puerto Rico","634":"Qatar","642":"Romania","643":"Russia",
  "682":"Saudi Arabia","686":"Senegal","694":"Sierra Leone","702":"Singapore",
  "703":"Slovakia","704":"Vietnam","706":"Somalia","710":"South Africa",
  "716":"Zimbabwe","724":"Spain","729":"Sudan","736":"S. Sudan",
  "740":"Suriname","752":"Sweden","756":"Switzerland","760":"Syria",
  "762":"Tajikistan","764":"Thailand","780":"Trinidad and Tobago",
  "788":"Tunisia","792":"Turkey","800":"Uganda","804":"Ukraine",
  "784":"U.A.E.","826":"United Kingdom","840":"United States",
  "858":"Uruguay","860":"Uzbekistan","862":"Venezuela","887":"Yemen",
  "894":"Zambia"
};

// ─── Parse world data ───
const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

export function getCountryFeatures() {
  return countriesGeo.features;
}

// ─── Canvas Config ───
const CANVAS_W = 4096;
const CANVAS_H = 2048;

function project(lon, lat) {
  return [
    (lon + 180) / 360 * CANVAS_W,
    (90 - lat) / 180 * CANVAS_H
  ];
}

function drawRing(ctx, ring) {
  const [x0, y0] = project(ring[0][0], ring[0][1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGeometry(ctx, geom) {
  ctx.beginPath();
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) drawRing(ctx, ring);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) drawRing(ctx, ring);
    }
  }
}

/**
 * Render a monochrome map canvas — one for day, one for night.
 */
function createMapCanvas(mode) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const isDark = mode === 'night';

  // ── Palette ──
  const ocean     = isDark ? '#050505' : '#eaeaea';
  const land      = isDark ? '#141414' : '#fafafa';
  const border    = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.15)';
  const labelFill = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';

  // Ocean
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Land
  ctx.fillStyle = land;
  for (const feature of countriesGeo.features) {
    drawGeometry(ctx, feature.geometry);
    ctx.fill('evenodd');
  }

  // Borders — thin, clean
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const feature of countriesGeo.features) {
    drawGeometry(ctx, feature.geometry);
    ctx.stroke();
  }

  // Country labels — barely visible, ultra light weight
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const feature of countriesGeo.features) {
    const name = COUNTRY_NAMES[feature.id];
    if (!name) continue;

    const centroid = featureCentroid(feature);
    if (!centroid) continue;

    const [cx, cy] = project(centroid.lon, centroid.lat);

    const geom = feature.geometry;
    let coordCount = 0;
    if (geom.type === 'Polygon') coordCount = geom.coordinates[0].length;
    else if (geom.type === 'MultiPolygon') {
      for (const p of geom.coordinates) coordCount += p[0].length;
    }

    if (coordCount < 15) continue;

    const fontSize = coordCount > 200 ? 24 : coordCount > 80 ? 17 : coordCount > 30 ? 13 : 10;

    ctx.font = `300 ${fontSize}px "DM Sans", "Helvetica Neue", sans-serif`;
    ctx.fillStyle = labelFill;
    ctx.fillText(name, cx, cy);
  }

  return canvas;
}

// ─── Sun Direction ───

export function getSunDirection() {
  const now = new Date();
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const sunLonRad = -((hours - 12) / 24) * Math.PI * 2;
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const declination = 23.44 * Math.sin(((dayOfYear - 81) / 365) * Math.PI * 2) * (Math.PI / 180);

  return new THREE.Vector3(
    Math.cos(declination) * Math.cos(sunLonRad),
    Math.sin(declination),
    Math.cos(declination) * Math.sin(sunLonRad)
  ).normalize();
}

// ─── Shaders ───

const globeVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const globeFragmentShader = `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform vec3 sunDir;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 day = texture2D(dayTexture, vUv);
    vec4 night = texture2D(nightTexture, vUv);

    float sunDot = dot(normalize(vNormal), sunDir);

    // Tight, clean transition
    float dayFactor = smoothstep(-0.06, 0.06, sunDot);

    vec3 color = mix(night.rgb, day.rgb, dayFactor);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const atmosVertexShader = `
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosFragmentShader = `
  uniform vec3 sunDir;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
    float intensity = pow(rim, 5.0);

    // Monochrome — cool gray rim
    float sunDot = dot(vNormal, sunDir);
    vec3 dayGlow = vec3(0.55, 0.55, 0.6);
    vec3 nightGlow = vec3(0.1, 0.1, 0.12);
    vec3 glowColor = mix(nightGlow, dayGlow, smoothstep(-0.2, 0.3, sunDot));

    gl_FragColor = vec4(glowColor, intensity * 0.25);
  }
`;

// ─── Build Globe ───

export function createGlobe() {
  const group = new THREE.Group();

  // Dual textures
  const dayTexture = new THREE.CanvasTexture(createMapCanvas('day'));
  dayTexture.colorSpace = THREE.SRGBColorSpace;

  const nightTexture = new THREE.CanvasTexture(createMapCanvas('night'));
  nightTexture.colorSpace = THREE.SRGBColorSpace;

  const sunDir = getSunDirection();
  const sunDirUniform = { value: sunDir };

  // Globe
  const globeGeom = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 64);
  const globeMat = new THREE.ShaderMaterial({
    vertexShader: globeVertexShader,
    fragmentShader: globeFragmentShader,
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      sunDir: sunDirUniform,
    },
  });
  const globeMesh = new THREE.Mesh(globeGeom, globeMat);
  group.add(globeMesh);

  // Atmosphere — subtle rim light
  const atmosGeom = new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 64, 32);
  const atmosMat = new THREE.ShaderMaterial({
    vertexShader: atmosVertexShader,
    fragmentShader: atmosFragmentShader,
    uniforms: { sunDir: sunDirUniform },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(atmosGeom, atmosMat));

  return { group, globeMesh, sunDirUniform };
}
