/**
 * Converts world-atlas countries-50m.json (TopoJSON) to a GeoJSON file with
 * Natural Earth-compatible properties (NAME, ADM0_A3, ISO_A3, CONTINENT,
 * SUBREGION, LABEL_X, LABEL_Y) so it can be a drop-in replacement for the
 * existing world-110m.json.
 *
 * Run once after installing world-atlas:
 *   node scripts/build-world-50m.mjs
 */

import * as topojson from 'topojson-client';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const topology  = JSON.parse(readFileSync(join(root, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const world110m = JSON.parse(readFileSync(join(root, 'src/data/world-110m.json'), 'utf8'));

// ── Convert TopoJSON → GeoJSON ─────────────────────────────────────────────
const countries50m = topojson.feature(topology, topology.objects.countries);

// ── Build 110m property lookup (ADM0_A3 → feature) ──────────────────────
const lookup110m = {};
for (const f of world110m.features) {
  if (f.properties?.ADM0_A3) lookup110m[f.properties.ADM0_A3] = f;
}

// ── ISO 3166-1 numeric → Natural Earth ADM0_A3 ────────────────────────────
const numericToAdm0 = {
  "004":"AFG","008":"ALB","010":"ATA","012":"DZA","016":"ASM","020":"AND",
  "024":"AGO","028":"ATG","031":"AZE","032":"ARG","036":"AUS","040":"AUT",
  "044":"BHS","048":"BHR","050":"BGD","051":"ARM","052":"BRB","056":"BEL",
  "060":"BMU","064":"BTN","068":"BOL","070":"BIH","072":"BWA","076":"BRA",
  "084":"BLZ","086":"IOT","090":"SLB","092":"VGB","096":"BRN","100":"BGR",
  "104":"MMR","108":"BDI","112":"BLR","116":"KHM","120":"CMR","124":"CAN",
  "132":"CPV","136":"CYM","140":"CAF","144":"LKA","148":"TCD","152":"CHL",
  "156":"CHN","158":"TWN","170":"COL","174":"COM","178":"COG","180":"COD",
  "184":"COK","188":"CRI","191":"HRV","192":"CUB","196":"CYP","203":"CZE",
  "204":"BEN","208":"DNK","212":"DMA","214":"DOM","218":"ECU","222":"SLV",
  "226":"GNQ","231":"ETH","232":"ERI","233":"EST","234":"FRO","238":"FLK",
  "239":"SGS","242":"FJI","246":"FIN","248":"ALA","250":"FRA","258":"PYF",
  "260":"ATF","262":"DJI","266":"GAB","268":"GEO","270":"GMB","275":"PSE",
  "276":"DEU","288":"GHA","296":"KIR","300":"GRC","304":"GRL","308":"GRD",
  "316":"GUM","320":"GTM","324":"GIN","328":"GUY","332":"HTI","334":"HMD",
  "336":"VAT","340":"HND","344":"HKG","348":"HUN","352":"ISL","356":"IND",
  "360":"IDN","364":"IRN","368":"IRQ","372":"IRL","376":"ISR","380":"ITA",
  "384":"CIV","388":"JAM","392":"JPN","398":"KAZ","400":"JOR","404":"KEN",
  "408":"PRK","410":"KOR","414":"KWT","417":"KGZ","418":"LAO","422":"LBN",
  "426":"LSO","428":"LVA","430":"LBR","434":"LBY","438":"LIE","440":"LTU",
  "442":"LUX","446":"MAC","450":"MDG","454":"MWI","458":"MYS","462":"MDV",
  "466":"MLI","470":"MLT","478":"MRT","480":"MUS","484":"MEX","492":"MCO",
  "496":"MNG","498":"MDA","499":"MNE","500":"MSR","504":"MAR","508":"MOZ",
  "512":"OMN","516":"NAM","520":"NRU","524":"NPL","528":"NLD","531":"CUW",
  "533":"ABW","534":"SXM","540":"NCL","548":"VUT","554":"NZL","558":"NIC",
  "562":"NER","566":"NGA","570":"NIU","574":"NFK","578":"NOR","580":"MNP",
  "583":"FSM","584":"MHL","585":"PLW","586":"PAK","591":"PAN","598":"PNG",
  "600":"PRY","604":"PER","608":"PHL","612":"PCN","616":"POL","620":"PRT",
  "624":"GNB","626":"TLS","630":"PRI","634":"QAT","642":"ROU","643":"RUS",
  "646":"RWA","652":"BLM","654":"SHN","659":"KNA","660":"AIA","662":"LCA",
  "663":"MAF","666":"SPM","670":"VCT","674":"SMR","678":"STP","682":"SAU",
  "686":"SEN","688":"SRB","690":"SYC","694":"SLE","702":"SGP","703":"SVK",
  "704":"VNM","705":"SVN","706":"SOM","710":"ZAF","716":"ZWE","724":"ESP",
  "728":"SSD","729":"SDN","732":"ESH","740":"SUR","748":"SWZ","752":"SWE",
  "756":"CHE","760":"SYR","762":"TJK","764":"THA","768":"TGO","776":"TON",
  "780":"TTO","784":"ARE","788":"TUN","792":"TUR","795":"TKM","796":"TCA",
  "800":"UGA","804":"UKR","807":"MKD","818":"EGY","826":"GBR","831":"GGY",
  "832":"JEY","833":"IMN","834":"TZA","840":"USA","850":"VIR","854":"BFA",
  "858":"URY","860":"UZB","862":"VEN","876":"WLF","882":"WSM","887":"YEM",
  "894":"ZMB",
};

// ── Minimal props for territories not present in world-110m ───────────────
// (NAME, ADM0_A3, ISO_A3, CONTINENT, SUBREGION — LABEL_X/Y computed below)
const extraProps = {
  ASM:{NAME:"American Samoa",   ADM0_A3:"ASM",ISO_A3:"ASM",CONTINENT:"Oceania",        SUBREGION:"Polynesia"},
  BMU:{NAME:"Bermuda",          ADM0_A3:"BMU",ISO_A3:"BMU",CONTINENT:"North America",   SUBREGION:"Northern America"},
  IOT:{NAME:"Br. Indian Ocean Ter.",ADM0_A3:"IOT",ISO_A3:"IOT",CONTINENT:"Asia",        SUBREGION:"Southern Asia"},
  VGB:{NAME:"British Virgin Islands",ADM0_A3:"VGB",ISO_A3:"VGB",CONTINENT:"North America",SUBREGION:"Caribbean"},
  CYM:{NAME:"Cayman Islands",   ADM0_A3:"CYM",ISO_A3:"CYM",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  COK:{NAME:"Cook Islands",     ADM0_A3:"COK",ISO_A3:"COK",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
  CUW:{NAME:"Curaçao",          ADM0_A3:"CUW",ISO_A3:"CUW",CONTINENT:"North America",   SUBREGION:"Caribbean"},
  FRO:{NAME:"Faroe Islands",    ADM0_A3:"FRO",ISO_A3:"FRO",CONTINENT:"Europe",          SUBREGION:"Northern Europe"},
  FLK:{NAME:"Falkland Is.",     ADM0_A3:"FLK",ISO_A3:"FLK",CONTINENT:"South America",  SUBREGION:"South America"},
  ATF:{NAME:"Fr. S. Antarctic Lands",ADM0_A3:"ATF",ISO_A3:"ATF",CONTINENT:"Antarctica",SUBREGION:""},
  ALA:{NAME:"Aland Islands",    ADM0_A3:"ALA",ISO_A3:"ALA",CONTINENT:"Europe",          SUBREGION:"Northern Europe"},
  PYF:{NAME:"Fr. Polynesia",    ADM0_A3:"PYF",ISO_A3:"PYF",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
  GRL:{NAME:"Greenland",        ADM0_A3:"GRL",ISO_A3:"GRL",CONTINENT:"North America",   SUBREGION:"Northern America"},
  GUM:{NAME:"Guam",             ADM0_A3:"GUM",ISO_A3:"GUM",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  GGY:{NAME:"Guernsey",         ADM0_A3:"GGY",ISO_A3:"GGY",CONTINENT:"Europe",          SUBREGION:"Northern Europe"},
  HMD:{NAME:"Heard I. and McDonald Is.",ADM0_A3:"HMD",ISO_A3:"HMD",CONTINENT:"Antarctica",SUBREGION:""},
  HKG:{NAME:"Hong Kong",        ADM0_A3:"HKG",ISO_A3:"HKG",CONTINENT:"Asia",            SUBREGION:"Eastern Asia"},
  IMN:{NAME:"Isle of Man",      ADM0_A3:"IMN",ISO_A3:"IMN",CONTINENT:"Europe",          SUBREGION:"Northern Europe"},
  JEY:{NAME:"Jersey",           ADM0_A3:"JEY",ISO_A3:"JEY",CONTINENT:"Europe",          SUBREGION:"Northern Europe"},
  KIR:{NAME:"Kiribati",         ADM0_A3:"KIR",ISO_A3:"KIR",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  MAC:{NAME:"Macao",            ADM0_A3:"MAC",ISO_A3:"MAC",CONTINENT:"Asia",            SUBREGION:"Eastern Asia"},
  MDV:{NAME:"Maldives",         ADM0_A3:"MDV",ISO_A3:"MDV",CONTINENT:"Asia",            SUBREGION:"Southern Asia"},
  MLT:{NAME:"Malta",            ADM0_A3:"MLT",ISO_A3:"MLT",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  MHL:{NAME:"Marshall Islands", ADM0_A3:"MHL",ISO_A3:"MHL",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  FSM:{NAME:"Micronesia",       ADM0_A3:"FSM",ISO_A3:"FSM",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  MCO:{NAME:"Monaco",           ADM0_A3:"MCO",ISO_A3:"MCO",CONTINENT:"Europe",          SUBREGION:"Western Europe"},
  MSR:{NAME:"Montserrat",       ADM0_A3:"MSR",ISO_A3:"MSR",CONTINENT:"North America",   SUBREGION:"Caribbean"},
  NCL:{NAME:"New Caledonia",    ADM0_A3:"NCL",ISO_A3:"NCL",CONTINENT:"Oceania",         SUBREGION:"Melanesia"},
  NIU:{NAME:"Niue",             ADM0_A3:"NIU",ISO_A3:"NIU",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
  NFK:{NAME:"Norfolk Island",   ADM0_A3:"NFK",ISO_A3:"NFK",CONTINENT:"Oceania",         SUBREGION:"Australia and New Zealand"},
  MNP:{NAME:"N. Mariana Islands",ADM0_A3:"MNP",ISO_A3:"MNP",CONTINENT:"Oceania",       SUBREGION:"Micronesia"},
  PLW:{NAME:"Palau",            ADM0_A3:"PLW",ISO_A3:"PLW",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  PCN:{NAME:"Pitcairn Is.",     ADM0_A3:"PCN",ISO_A3:"PCN",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
  PRI:{NAME:"Puerto Rico",      ADM0_A3:"PRI",ISO_A3:"PRI",CONTINENT:"North America",   SUBREGION:"Caribbean"},
  BLM:{NAME:"St-Barthélemy",    ADM0_A3:"BLM",ISO_A3:"BLM",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  SHN:{NAME:"Saint Helena",     ADM0_A3:"SHN",ISO_A3:"SHN",CONTINENT:"Africa",         SUBREGION:"Western Africa"},
  MAF:{NAME:"St-Martin",        ADM0_A3:"MAF",ISO_A3:"MAF",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  SPM:{NAME:"St. Pierre and Miquelon",ADM0_A3:"SPM",ISO_A3:"SPM",CONTINENT:"North America",SUBREGION:"Northern America"},
  SMR:{NAME:"San Marino",       ADM0_A3:"SMR",ISO_A3:"SMR",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  SGS:{NAME:"S. Geo. and S. Sandw. Is.",ADM0_A3:"SGS",ISO_A3:"SGS",CONTINENT:"Antarctica",SUBREGION:""},
  SXM:{NAME:"Sint Maarten",     ADM0_A3:"SXM",ISO_A3:"SXM",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  TWN:{NAME:"Taiwan",           ADM0_A3:"TWN",ISO_A3:"TWN",CONTINENT:"Asia",            SUBREGION:"Eastern Asia"},
  TCA:{NAME:"Turks and Caicos Is.",ADM0_A3:"TCA",ISO_A3:"TCA",CONTINENT:"North America",SUBREGION:"Caribbean"},
  VIR:{NAME:"U.S. Virgin Islands",ADM0_A3:"VIR",ISO_A3:"VIR",CONTINENT:"North America",SUBREGION:"Caribbean"},
  VAT:{NAME:"Vatican",          ADM0_A3:"VAT",ISO_A3:"VAT",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  VUT:{NAME:"Vanuatu",          ADM0_A3:"VUT",ISO_A3:"VUT",CONTINENT:"Oceania",         SUBREGION:"Melanesia"},
  WLF:{NAME:"Wallis and Futuna Is.",ADM0_A3:"WLF",ISO_A3:"WLF",CONTINENT:"Oceania",    SUBREGION:"Polynesia"},
  ABW:{NAME:"Aruba",            ADM0_A3:"ABW",ISO_A3:"ABW",CONTINENT:"North America",   SUBREGION:"Caribbean"},
  AIA:{NAME:"Anguilla",         ADM0_A3:"AIA",ISO_A3:"AIA",CONTINENT:"North America",   SUBREGION:"Caribbean"},
  PSE:{NAME:"Palestine",        ADM0_A3:"PSE",ISO_A3:"PSE",CONTINENT:"Asia",            SUBREGION:"Western Asia"},
  ESH:{NAME:"W. Sahara",        ADM0_A3:"ESH",ISO_A3:"ESH",CONTINENT:"Africa",          SUBREGION:"Northern Africa"},
  // Small nations not present in the 110m scale dataset
  AND:{NAME:"Andorra",          ADM0_A3:"AND",ISO_A3:"AND",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  ATG:{NAME:"Antigua and Barbuda",ADM0_A3:"ATG",ISO_A3:"ATG",CONTINENT:"North America", SUBREGION:"Caribbean"},
  BHR:{NAME:"Bahrain",          ADM0_A3:"BHR",ISO_A3:"BHR",CONTINENT:"Asia",           SUBREGION:"Western Asia"},
  BRB:{NAME:"Barbados",         ADM0_A3:"BRB",ISO_A3:"BRB",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  CPV:{NAME:"Cape Verde",       ADM0_A3:"CPV",ISO_A3:"CPV",CONTINENT:"Africa",          SUBREGION:"Western Africa"},
  COM:{NAME:"Comoros",          ADM0_A3:"COM",ISO_A3:"COM",CONTINENT:"Africa",          SUBREGION:"Eastern Africa"},
  DMA:{NAME:"Dominica",         ADM0_A3:"DMA",ISO_A3:"DMA",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  GRD:{NAME:"Grenada",          ADM0_A3:"GRD",ISO_A3:"GRD",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  KNA:{NAME:"St. Kitts and Nevis",ADM0_A3:"KNA",ISO_A3:"KNA",CONTINENT:"North America",SUBREGION:"Caribbean"},
  LCA:{NAME:"Saint Lucia",      ADM0_A3:"LCA",ISO_A3:"LCA",CONTINENT:"North America",  SUBREGION:"Caribbean"},
  LIE:{NAME:"Liechtenstein",    ADM0_A3:"LIE",ISO_A3:"LIE",CONTINENT:"Europe",         SUBREGION:"Western Europe"},
  MCO:{NAME:"Monaco",           ADM0_A3:"MCO",ISO_A3:"MCO",CONTINENT:"Europe",          SUBREGION:"Western Europe"},
  MUS:{NAME:"Mauritius",        ADM0_A3:"MUS",ISO_A3:"MUS",CONTINENT:"Africa",          SUBREGION:"Eastern Africa"},
  NRU:{NAME:"Nauru",            ADM0_A3:"NRU",ISO_A3:"NRU",CONTINENT:"Oceania",         SUBREGION:"Micronesia"},
  SGP:{NAME:"Singapore",        ADM0_A3:"SGP",ISO_A3:"SGP",CONTINENT:"Asia",            SUBREGION:"South-Eastern Asia"},
  SMR:{NAME:"San Marino",       ADM0_A3:"SMR",ISO_A3:"SMR",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  SSD:{NAME:"S. Sudan",         ADM0_A3:"SSD",ISO_A3:"SSD",CONTINENT:"Africa",          SUBREGION:"Eastern Africa"},
  STP:{NAME:"São Tomé and Principe",ADM0_A3:"STP",ISO_A3:"STP",CONTINENT:"Africa",     SUBREGION:"Middle Africa"},
  SYC:{NAME:"Seychelles",       ADM0_A3:"SYC",ISO_A3:"SYC",CONTINENT:"Africa",         SUBREGION:"Eastern Africa"},
  TON:{NAME:"Tonga",            ADM0_A3:"TON",ISO_A3:"TON",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
  VAT:{NAME:"Vatican",          ADM0_A3:"VAT",ISO_A3:"VAT",CONTINENT:"Europe",          SUBREGION:"Southern Europe"},
  VCT:{NAME:"St. Vin. and Gren.",ADM0_A3:"VCT",ISO_A3:"VCT",CONTINENT:"North America", SUBREGION:"Caribbean"},
  WSM:{NAME:"Samoa",            ADM0_A3:"WSM",ISO_A3:"WSM",CONTINENT:"Oceania",         SUBREGION:"Polynesia"},
};

// ── Round all coordinates to given decimal places ────────────────────────
function roundGeom(geometry, dp = 3) {
  const r = (n) => +n.toFixed(dp);
  const roundRing = (ring) => ring.map(([x, y]) => [r(x), r(y)]);
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(roundRing) };
  } else if (geometry.type === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(poly => poly.map(roundRing)) };
  }
  return geometry;
}

// ── 3-D Cartesian centroid (handles antimeridian wrap) ────────────────────
function computeCentroid(geometry) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  const rings = geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map(p => p[0]);
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const lo = lon * Math.PI / 180, la = lat * Math.PI / 180;
      sx += Math.cos(la) * Math.cos(lo);
      sy += Math.cos(la) * Math.sin(lo);
      sz += Math.sin(la);
      n++;
    }
  }
  if (!n) return [0, 0];
  return [
    Math.atan2(sy / n, sx / n) * 180 / Math.PI,
    Math.atan2(sz / n, Math.hypot(sx / n, sy / n)) * 180 / Math.PI,
  ];
}

// ── Build output features ─────────────────────────────────────────────────
const seen = new Set();
const features = [];
const skipped = [];

for (const f of countries50m.features) {
  const numId = f.id != null ? String(f.id).padStart(3, '0') : null;
  const adm0  = numId ? (numericToAdm0[numId] ?? null) : null;

  if (!adm0) { skipped.push(f.id); continue; }
  if (seen.has(adm0)) continue; // deduplicate (e.g. Australia has 2 entries)
  seen.add(adm0);

  // Skip Antarctica and uninhabited specks
  if (adm0 === 'ATA') continue;

  let props;
  if (lookup110m[adm0]) {
    // Inherit only the fields we actually use (strips 190+ dead-weight NE props)
    const p = lookup110m[adm0].properties;
    props = {
      NAME: p.NAME, ADM0_A3: p.ADM0_A3, ISO_A3: p.ISO_A3,
      CONTINENT: p.CONTINENT, SUBREGION: p.SUBREGION,
      LABEL_X: p.LABEL_X, LABEL_Y: p.LABEL_Y,
    };
  } else if (extraProps[adm0]) {
    // New territory — compute centroid and use minimal props
    const [cx, cy] = computeCentroid(f.geometry);
    props = { ...extraProps[adm0], LABEL_X: +cx.toFixed(4), LABEL_Y: +cy.toFixed(4) };
  } else {
    skipped.push(`${adm0} (no props)`);
    continue;
  }

  features.push({ type: 'Feature', properties: props, geometry: roundGeom(f.geometry, 2) });
}

const result = { type: 'FeatureCollection', features };
const out = join(root, 'src/data/world-50m.json');
writeFileSync(out, JSON.stringify(result));

console.log(`✓ world-50m.json written: ${features.length} features`);
if (skipped.length) console.log('  Skipped:', skipped.join(', '));
