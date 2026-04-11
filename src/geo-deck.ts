import { App, Modal, Notice, TFile, getAllTags } from 'obsidian';
import worldGeoJSON from './data/world-50m.json';
import geoFeaturesData from './data/geo-features.json';
import { appendCardToFile } from './utils/append-card';

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'];
const SUBREGIONS = [
    'Australia and New Zealand', 'Caribbean', 'Central America', 'Central Asia',
    'Eastern Africa', 'Eastern Asia', 'Eastern Europe', 'Melanesia', 'Middle Africa',
    'Northern Africa', 'Northern America', 'Northern Europe', 'South America',
    'South-Eastern Asia', 'Southern Africa', 'Southern Asia', 'Southern Europe',
    'Western Africa', 'Western Asia', 'Western Europe',
];

type QuestionType = 'name-country' | 'name-capital';

interface PhysGeoFeature {
    id: string;
    category: string;
    name: string;
    altNames: string[];
    lat: number;
    lon: number;
}

const CATEGORY_LABELS: Record<string, string> = {
    sea:       'Seas & Gulfs',
    lake:      'Lakes',
    mountain:  'Mountain Ranges',
    strait:    'Straits & Channels',
    desert:    'Deserts',
    plain:     'Plains & Grasslands',
    river:     'Rivers',
    volcano:   'Volcanoes',
    peninsula: 'Peninsulas & Capes',
};

const CATEGORY_FRONTS: Record<string, string> = {
    sea:       'Name this body of water',
    lake:      'Name this lake',
    mountain:  'Name this mountain range',
    strait:    'Name this strait or channel',
    desert:    'Name this desert',
    plain:     'Name this plain or grassland',
    river:     'Name this river',
    volcano:   'Name this volcano',
    peninsula: 'Name this peninsula or cape',
};

const ALL_PHYS_FEATURES: PhysGeoFeature[] = (geoFeaturesData as any).features;

interface GeoFeature {
    name: string;       // e.g. "France"
    adm0: string;       // e.g. "FRA"
    capital?: string;   // e.g. "Paris"  (not in GeoJSON — we skip if absent)
    cx: number;         // centroid longitude
    cy: number;         // centroid latitude
    continent: string;
    subregion: string;
}

// Capital data bundled inline — sourced from public domain.
// Keyed by ADM0_A3. Not exhaustive but covers ~170 countries.
const CAPITALS: Record<string, string> = {
    AFG:'Kabul',ALB:'Tirana',DZA:'Algiers',AND:'Andorra la Vella',AGO:'Luanda',
    ATG:'Saint John\'s',ARG:'Buenos Aires',ARM:'Yerevan',AUS:'Canberra',AUT:'Vienna',
    AZE:'Baku',BHS:'Nassau',BHR:'Manama',BGD:'Dhaka',BRB:'Bridgetown',
    BLR:'Minsk',BEL:'Brussels',BLZ:'Belmopan',BEN:'Porto-Novo',BTN:'Thimphu',
    BOL:'Sucre',BIH:'Sarajevo',BWA:'Gaborone',BRA:'Brasília',BRN:'Bandar Seri Begawan',
    BGR:'Sofia',BFA:'Ouagadougou',BDI:'Gitega',CPV:'Praia',KHM:'Phnom Penh',
    CMR:'Yaoundé',CAN:'Ottawa',CAF:'Bangui',TCD:'N\'Djamena',CHL:'Santiago',
    CHN:'Beijing',COL:'Bogotá',COM:'Moroni',COD:'Kinshasa',COG:'Brazzaville',
    CRI:'San José',CIV:'Yamoussoukro',HRV:'Zagreb',CUB:'Havana',CYP:'Nicosia',
    CZE:'Prague',DNK:'Copenhagen',DJI:'Djibouti',DOM:'Santo Domingo',ECU:'Quito',
    EGY:'Cairo',SLV:'San Salvador',GNQ:'Malabo',ERI:'Asmara',EST:'Tallinn',
    SWZ:'Mbabane',ETH:'Addis Ababa',FJI:'Suva',FIN:'Helsinki',FRA:'Paris',
    GAB:'Libreville',GMB:'Banjul',GEO:'Tbilisi',DEU:'Berlin',GHA:'Accra',
    GRC:'Athens',GRD:'Saint George\'s',GTM:'Guatemala City',GIN:'Conakry',
    GNB:'Bissau',GUY:'Georgetown',HTI:'Port-au-Prince',HND:'Tegucigalpa',
    HUN:'Budapest',ISL:'Reykjavik',IND:'New Delhi',IDN:'Jakarta',IRN:'Tehran',
    IRQ:'Baghdad',IRL:'Dublin',ISR:'Jerusalem',ITA:'Rome',JAM:'Kingston',
    JPN:'Tokyo',JOR:'Amman',KAZ:'Astana',KEN:'Nairobi',KIR:'Tarawa',
    PRK:'Pyongyang',KOR:'Seoul',KWT:'Kuwait City',KGZ:'Bishkek',LAO:'Vientiane',
    LVA:'Riga',LBN:'Beirut',LSO:'Maseru',LBR:'Monrovia',LBY:'Tripoli',
    LIE:'Vaduz',LTU:'Vilnius',LUX:'Luxembourg',MDG:'Antananarivo',MWI:'Lilongwe',
    MYS:'Kuala Lumpur',MDV:'Malé',MLI:'Bamako',MLT:'Valletta',MHL:'Majuro',
    MRT:'Nouakchott',MUS:'Port Louis',MEX:'Mexico City',FSM:'Palikir',MDA:'Chișinău',
    MCO:'Monaco',MNG:'Ulaanbaatar',MNE:'Podgorica',MAR:'Rabat',MOZ:'Maputo',
    MMR:'Naypyidaw',NAM:'Windhoek',NRU:'Yaren',NPL:'Kathmandu',NLD:'Amsterdam',
    NZL:'Wellington',NIC:'Managua',NER:'Niamey',NGA:'Abuja',MKD:'Skopje',
    NOR:'Oslo',OMN:'Muscat',PAK:'Islamabad',PLW:'Ngerulmud',PAN:'Panama City',
    PNG:'Port Moresby',PRY:'Asunción',PER:'Lima',PHL:'Manila',POL:'Warsaw',
    PRT:'Lisbon',QAT:'Doha',ROU:'Bucharest',RUS:'Moscow',RWA:'Kigali',
    KNA:'Basseterre',LCA:'Castries',VCT:'Kingstown',WSM:'Apia',SMR:'San Marino',
    STP:'São Tomé',SAU:'Riyadh',SEN:'Dakar',SRB:'Belgrade',SLE:'Freetown',
    SGP:'Singapore',SVK:'Bratislava',SVN:'Ljubljana',SLB:'Honiara',SOM:'Mogadishu',
    ZAF:'Pretoria',SSD:'Juba',ESP:'Madrid',LKA:'Sri Jayawardenepura Kotte',
    SDN:'Khartoum',SUR:'Paramaribo',SWE:'Stockholm',CHE:'Bern',SYR:'Damascus',
    TWN:'Taipei',TJK:'Dushanbe',TZA:'Dodoma',THA:'Bangkok',TLS:'Dili',
    TGO:'Lomé',TON:'Nukuʻalofa',TTO:'Port of Spain',TUN:'Tunis',TUR:'Ankara',
    TKM:'Ashgabat',TUV:'Funafuti',UGA:'Kampala',UKR:'Kyiv',ARE:'Abu Dhabi',
    GBR:'London',USA:'Washington D.C.',URY:'Montevideo',UZB:'Tashkent',
    VUT:'Port Vila',VEN:'Caracas',VNM:'Hanoi',YEM:'Sana\'a',ZMB:'Lusaka',ZWE:'Harare',
    // extras
    SWK:'Mbabane', // Eswatini alias
    PSE:'Ramallah',XKX:'Pristina',ALA:'Mariehamn',
    // Sovereign nations newly reachable in 50m data
    VAT:'Vatican City',SYC:'Victoria',DMA:'Roseau',
    // Notable territories with well-known administrative capitals
    GRL:'Nuuk',FRO:'Tórshavn',
    GUM:'Hagåtña',ASM:'Pago Pago',MNP:'Saipan',PRI:'San Juan',VIR:'Charlotte Amalie',
    ABW:'Oranjestad',CUW:'Willemstad',SXM:'Philipsburg',
    BLM:'Gustavia',MAF:'Marigot',SPM:'Saint-Pierre',
    PYF:'Papeete',NCL:'Nouméa',WLF:'Mata-Utu',COK:'Avarua',NIU:'Alofi',NFK:'Kingston',
    AIA:'The Valley',BMU:'Hamilton',CYM:'George Town',VGB:'Road Town',TCA:'Cockburn Town',MSR:'Brades',
    GGY:'Saint Peter Port',JEY:'Saint Helier',IMN:'Douglas',
    FLK:'Stanley',ESH:'El Aaiún',
};

function loadFeatures(): GeoFeature[] {
    const features: GeoFeature[] = [];
    for (const f of (worldGeoJSON as any).features) {
        const p = f.properties;
        if (!p?.NAME || !p?.ADM0_A3) continue;
        if (p.ADM0_A3 === 'ATA') continue;
        // Skip territories/non-sovereign (HOMEPART = -99 means it is a territory)
        // Keep all for now — user can filter by region
        features.push({
            name: p.NAME,
            adm0: p.ADM0_A3,
            capital: CAPITALS[p.ADM0_A3],
            cx: p.LABEL_X ?? 0,
            cy: p.LABEL_Y ?? 0,
            continent: p.CONTINENT ?? '',
            subregion: p.SUBREGION ?? '',
        });
    }
    // Deduplicate by ADM0_A3 (some countries have multiple polygons)
    const seen = new Set<string>();
    return features.filter(f => { if (seen.has(f.adm0)) return false; seen.add(f.adm0); return true; });
}

export class GeoDeckModal extends Modal {
    private features: GeoFeature[] = [];
    private selectedRegion = 'World';
    private questionType: QuestionType = 'name-country';
    private selectedCategories: Set<string> = new Set();
    private deck = 'World Geography';
    private title = '';
    private targetFile: TFile | null = null;
    private taggedFiles: TFile[] = [];
    private previewEl: HTMLElement | null = null;

    constructor(app: App) {
        super(app);
        this.features = loadFeatures();
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-dict-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('flashcard-modal-window');

        contentEl.createEl('h2', { text: 'Generate Geography Deck', attr: { style: 'margin-bottom:4px;' } });
        contentEl.createEl('p', {
            text: 'Creates a map card with one cloze per country in the selected region.',
            attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:16px;' }
        });

        // Load tagged files for destination picker
        this.taggedFiles = this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return cache ? getAllTags(cache)?.some(t => t.replace('#', '') === 'flashcard') : false;
        });
        this.targetFile = this.taggedFiles[0] ?? null;

        // ── Region picker ──
        const regionRow = contentEl.createDiv({ attr: { style: 'margin-bottom:12px;' } });
        regionRow.createEl('label', { text: 'Region', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const regionSel = regionRow.createEl('select', { attr: { style: 'width:100%;' } });
        regionSel.createEl('option', { text: 'World (all)', attr: { value: 'World' } });
        CONTINENTS.forEach(c => regionSel.createEl('option', { text: c, attr: { value: c } }));
        const optGrp = regionSel.createEl('optgroup', { attr: { label: 'Subregions' } });
        SUBREGIONS.forEach(s => optGrp.createEl('option', { text: s, attr: { value: s } }));
        regionSel.value = this.selectedRegion;
        regionSel.onchange = () => { this.selectedRegion = regionSel.value; this.updatePreview(); };

        // ── Question type ──
        const typeRow = contentEl.createDiv({ attr: { style: 'margin-bottom:12px;' } });
        typeRow.createEl('label', { text: 'Question type', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const typeSel = typeRow.createEl('select', { attr: { style: 'width:100%;' } });
        typeSel.createEl('option', { text: 'Show highlighted country → name it', attr: { value: 'name-country' } });
        typeSel.createEl('option', { text: 'Show highlighted country → name its capital', attr: { value: 'name-capital' } });
        typeSel.value = this.questionType;
        typeSel.onchange = () => { this.questionType = typeSel.value as QuestionType; this.updatePreview(); };

        // ── Deck / title ──
        const metaRow = contentEl.createDiv({ attr: { style: 'display:flex; gap:10px; margin-bottom:12px;' } });
        const deckWrap = metaRow.createDiv({ attr: { style: 'flex:1;' } });
        deckWrap.createEl('label', { text: 'Deck', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const deckInput = deckWrap.createEl('input', { type: 'text', attr: { style: 'width:100%;' } });
        deckInput.value = this.deck;
        deckInput.oninput = () => { this.deck = deckInput.value; };

        const titleWrap = metaRow.createDiv({ attr: { style: 'flex:1;' } });
        titleWrap.createEl('label', { text: 'Card title', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const titleInput = titleWrap.createEl('input', { type: 'text', attr: { style: 'width:100%;' } });
        titleInput.oninput = () => { this.title = titleInput.value; };

        // ── Destination file ──
        if (this.taggedFiles.length > 0) {
            const fileRow = contentEl.createDiv({ attr: { style: 'margin-bottom:12px;' } });
            fileRow.createEl('label', { text: 'Save to', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
            const fileSel = fileRow.createEl('select', { attr: { style: 'width:100%;' } });
            this.taggedFiles.forEach(f => fileSel.createEl('option', { text: f.basename, attr: { value: f.path } }));
            fileSel.onchange = () => {
                this.targetFile = this.app.vault.getAbstractFileByPath(fileSel.value) as TFile ?? null;
            };
        } else {
            contentEl.createEl('p', {
                text: '⚠ No #flashcard files found. Tag a note first.',
                attr: { style: 'color:var(--text-error); margin-bottom:12px;' }
            });
        }

        // ── Geographic Features ──
        const featSection = contentEl.createDiv({ attr: { style: 'margin-bottom:16px;' } });
        featSection.createEl('label', {
            text: 'Geographic Features',
            attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:6px;' }
        });

        // Count features per category
        const catCounts: Record<string, number> = {};
        for (const f of ALL_PHYS_FEATURES) catCounts[f.category] = (catCounts[f.category] ?? 0) + 1;

        const catGrid = featSection.createDiv({
            attr: { style: 'display:grid; grid-template-columns:repeat(3,1fr); gap:4px 12px; margin-bottom:6px;' }
        });

        for (const cat of Object.keys(CATEGORY_LABELS)) {
            const count = catCounts[cat] ?? 0;
            const cell = catGrid.createDiv({ attr: { style: 'display:flex; align-items:center; gap:4px; font-size:0.85em;' } });
            const cb = cell.createEl('input', { type: 'checkbox' });
            cb.checked = this.selectedCategories.has(cat);
            cb.onchange = () => {
                if (cb.checked) this.selectedCategories.add(cat);
                else this.selectedCategories.delete(cat);
                this.updatePreview();
            };
            cell.appendText(`${CATEGORY_LABELS[cat]} (${count})`);
        }

        const catBtnRow = featSection.createDiv({ attr: { style: 'display:flex; gap:8px;' } });
        catBtnRow.createEl('button', { text: 'Select all', cls: 'mod-ghost', attr: { style: 'font-size:0.8em;' } }).onclick = () => {
            for (const cat of Object.keys(CATEGORY_LABELS)) this.selectedCategories.add(cat);
            catGrid.querySelectorAll('input[type=checkbox]').forEach((el: Element) => (el as HTMLInputElement).checked = true);
            this.updatePreview();
        };
        catBtnRow.createEl('button', { text: 'Clear all', cls: 'mod-ghost', attr: { style: 'font-size:0.8em;' } }).onclick = () => {
            this.selectedCategories.clear();
            catGrid.querySelectorAll('input[type=checkbox]').forEach((el: Element) => (el as HTMLInputElement).checked = false);
            this.updatePreview();
        };

        // ── Preview ──
        this.previewEl = contentEl.createDiv({
            attr: { style: 'background:var(--background-secondary); padding:8px 12px; border-radius:6px; font-size:0.85em; margin-bottom:16px;' }
        });
        this.updatePreview();

        // ── Generate button ──
        const genBtn = contentEl.createEl('button', { text: 'Generate Deck', cls: 'mod-cta', attr: { style: 'width:100%;' } });
        genBtn.onclick = () => this.generate();
    }

    private filteredFeatures(): GeoFeature[] {
        const r = this.selectedRegion;
        if (r === 'World') return this.features;
        return this.features.filter(f => f.continent === r || f.subregion === r);
    }

    private updatePreview() {
        if (!this.previewEl) return;
        const ff = this.filteredFeatures();
        const withCapital = ff.filter(f => f.capital);
        const countryCount = this.questionType === 'name-capital' ? withCapital.length : ff.length;
        const skipped = this.questionType === 'name-capital' ? ff.length - withCapital.length : 0;
        const featCount = ALL_PHYS_FEATURES.filter(f => this.selectedCategories.has(f.category)).length;
        const total = countryCount + featCount;

        this.previewEl.empty();
        this.previewEl.createEl('strong', { text: `${total} cloze${total !== 1 ? 's' : ''}` });
        this.previewEl.appendText(' will be created');
        if (countryCount > 0 && featCount > 0) {
            this.previewEl.appendText(` (${countryCount} countries + ${featCount} features)`);
        }
        if (skipped > 0) this.previewEl.appendText(` · ${skipped} skipped — no capital data`);

        if (ff.length <= 20) {
            const list = ff.map(f => f.name).join(', ');
            this.previewEl.createEl('div', { text: list, attr: { style: 'color:var(--text-muted); margin-top:4px; font-size:0.9em;' } });
        }
    }

    private buildFeatureClozes(): any[] {
        if (this.selectedCategories.size === 0) return [];
        return ALL_PHYS_FEATURES
            .filter(f => this.selectedCategories.has(f.category))
            .map(f => ({
                id: `geo-feat-${f.id}`,
                type: 'point',
                era: 'present',
                lat: f.lat,
                lng: f.lon,
                featureName: f.name,
                front: CATEGORY_FRONTS[f.category] ?? 'Name this feature',
                back: f.altNames.length > 0 ? [f.name, ...f.altNames] : [f.name],
            }));
    }

    private async generate() {
        if (!this.targetFile) {
            new Notice('No destination file selected.');
            return;
        }

        const ff = this.filteredFeatures();
        const clozes: any[] = [];

        ff.forEach(f => {
            if (this.questionType === 'name-capital' && !f.capital) return;

            const front = this.questionType === 'name-country'
                ? `Name this country`
                : `What is the capital of ${f.name}?`;

            const back = this.questionType === 'name-country'
                ? [f.name]
                : [f.capital!];

            clozes.push({
                id: `geo-${f.adm0}-${this.questionType}`,
                type: 'region',
                era: 'present',
                featureId: f.adm0,
                featureName: f.name,
                front,
                back,
            });
        });

        clozes.push(...this.buildFeatureClozes());

        if (clozes.length === 0) {
            new Notice('No clozes to generate for this selection.');
            return;
        }

        const regionLabel = this.selectedRegion === 'World' ? 'World' : this.selectedRegion;
        const typeLabel = this.questionType === 'name-country' ? 'Countries' : 'Capitals';
        const cardTitle = this.title.trim() || `${regionLabel} — ${typeLabel}`;

        const card: any = {
            type: 'map',
            title: cardTitle,
            deck: this.deck.trim() || 'World Geography',
            id: `geo-${regionLabel.replace(/\s+/g, '-').toLowerCase()}-${this.questionType}`,
            clozes,
        };

        const ok = await appendCardToFile(this.app, card, this.targetFile);
        if (ok) {
            new Notice(`Generated ${clozes.length} cloze${clozes.length !== 1 ? 's' : ''}!`);
            this.close();
        }
    }

    onClose() { this.contentEl.empty(); }
}
