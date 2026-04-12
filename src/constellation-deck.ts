import { App, Modal, Notice, TFile, getAllTags } from 'obsidian';
import { CONSTELLATION_NAMES, ConstellationInfo } from './data/constellation-names';
import { appendCardToFile } from './utils/append-card';

type QuestionType = 'name-constellation' | 'name-abbrev';
type Hemisphere = 'All' | 'N' | 'S' | 'Eq';
type Season = 'All' | 'spring' | 'summer' | 'autumn' | 'winter' | 'circumpolar';

const HEMISPHERES: { label: string; value: Hemisphere }[] = [
    { label: 'All',         value: 'All' },
    { label: 'Northern',    value: 'N'   },
    { label: 'Southern',    value: 'S'   },
    { label: 'Equatorial',  value: 'Eq'  },
];

const SEASONS: { label: string; value: Season }[] = [
    { label: 'All seasons',  value: 'All'        },
    { label: 'Spring',       value: 'spring'      },
    { label: 'Summer',       value: 'summer'      },
    { label: 'Autumn',       value: 'autumn'      },
    { label: 'Winter',       value: 'winter'      },
    { label: 'Circumpolar',  value: 'circumpolar' },
];

export class ConstellationDeckModal extends Modal {
    private selectedHem: Hemisphere = 'All';
    private selectedSeason: Season = 'All';
    private questionType: QuestionType = 'name-constellation';
    private showLines = true;
    private deck = 'Constellations';
    private title = '';
    private batch = '';
    private targetFile: TFile | null = null;
    private taggedFiles: TFile[] = [];
    private previewEl: HTMLElement | null = null;

    constructor(app: App) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-dict-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('flashcard-modal-window');

        contentEl.createEl('h2', { text: 'Generate Constellation Deck', attr: { style: 'margin-bottom:4px;' } });
        contentEl.createEl('p', {
            text: 'Creates one card per constellation in the selected filter with a highlighted boundary map.',
            attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:16px;' }
        });

        // Destination files
        this.taggedFiles = this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return cache ? getAllTags(cache)?.some(t => t.replace('#', '') === 'flashcard') : false;
        });
        this.targetFile = this.taggedFiles[0] ?? null;

        // ── Row helper ──────────────────────────────────────────────────────
        const makeRow = (label: string) => {
            const row = contentEl.createDiv({ attr: { style: 'margin-bottom:12px;' } });
            row.createEl('label', { text: label, attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
            return row;
        };

        // ── Hemisphere picker ───────────────────────────────────────────────
        const hemRow = makeRow('Hemisphere');
        const hemSel = hemRow.createEl('select', { attr: { style: 'width:100%;' } });
        HEMISPHERES.forEach(({ label, value }) => hemSel.createEl('option', { text: label, attr: { value } }));
        hemSel.value = this.selectedHem;
        hemSel.onchange = () => { this.selectedHem = hemSel.value as Hemisphere; this.updatePreview(); };

        // ── Season picker ───────────────────────────────────────────────────
        const seasonRow = makeRow('Best season');
        const seasonSel = seasonRow.createEl('select', { attr: { style: 'width:100%;' } });
        SEASONS.forEach(({ label, value }) => seasonSel.createEl('option', { text: label, attr: { value } }));
        seasonSel.value = this.selectedSeason;
        seasonSel.onchange = () => { this.selectedSeason = seasonSel.value as Season; this.updatePreview(); };

        // ── Question type ───────────────────────────────────────────────────
        const typeRow = makeRow('Question type');
        const typeSel = typeRow.createEl('select', { attr: { style: 'width:100%;' } });
        typeSel.createEl('option', { text: 'Show highlighted boundary → name the constellation', attr: { value: 'name-constellation' } });
        typeSel.createEl('option', { text: 'Show highlighted boundary → give the abbreviation (e.g. Ori)', attr: { value: 'name-abbrev' } });
        typeSel.value = this.questionType;
        typeSel.onchange = () => { this.questionType = typeSel.value as QuestionType; this.updatePreview(); };

        // ── Display mode toggle ─────────────────────────────────────────────
        const linesRow = makeRow('Display mode');
        const linesWrap = linesRow.createDiv({ attr: { style: 'display:flex; gap:16px;' } });

        const mkRadio = (label: string, checked: boolean, val: boolean) => {
            const wrap = linesWrap.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px; cursor:pointer;' } });
            const radio = wrap.createEl('input', { type: 'radio', attr: { name: 'gi-con-lines' } });
            radio.checked = checked;
            wrap.createEl('span', { text: label });
            radio.onchange = () => { if (radio.checked) this.showLines = val; };
            return radio;
        };
        mkRadio('Boundaries + constellation lines', true, true);
        mkRadio('Boundaries only (no lines)', false, false);

        // ── Deck / title / batch ────────────────────────────────────────────
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

        const batchWrap = metaRow.createDiv({ attr: { style: 'flex:1;' } });
        batchWrap.createEl('label', { text: 'Batch', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const batchInput = batchWrap.createEl('input', { type: 'text', attr: { style: 'width:100%;', placeholder: 'e.g. Northern Sky' } });
        batchInput.oninput = () => { this.batch = batchInput.value; };

        // ── Destination file ────────────────────────────────────────────────
        if (this.taggedFiles.length > 0) {
            const fileRow = makeRow('Save to');
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

        // ── Preview ─────────────────────────────────────────────────────────
        this.previewEl = contentEl.createDiv({
            attr: { style: 'background:var(--background-secondary); padding:8px 12px; border-radius:6px; font-size:0.85em; margin-bottom:16px;' }
        });
        this.updatePreview();

        // ── Generate button ─────────────────────────────────────────────────
        const genBtn = contentEl.createEl('button', { text: 'Generate Deck', cls: 'mod-cta', attr: { style: 'width:100%;' } });
        genBtn.onclick = () => this.generate();
    }

    private filtered(): ConstellationInfo[] {
        return Object.values(CONSTELLATION_NAMES).filter(c => {
            if (this.selectedHem !== 'All' && c.hem !== this.selectedHem) return false;
            if (this.selectedSeason !== 'All' && c.season !== this.selectedSeason) return false;
            return true;
        });
    }

    private updatePreview() {
        if (!this.previewEl) return;
        const ff = this.filtered();
        this.previewEl.empty();
        this.previewEl.createEl('strong', { text: `${ff.length} clozes` });
        this.previewEl.appendText(' will be created');
        if (ff.length <= 25) {
            const list = ff.map(c => c.name).join(', ');
            this.previewEl.createEl('div', { text: list, attr: { style: 'color:var(--text-muted); margin-top:4px; font-size:0.9em;' } });
        }
    }

    private async generate() {
        if (!this.targetFile) {
            new Notice('No destination file selected.');
            return;
        }

        const ff = this.filtered();
        if (ff.length === 0) {
            new Notice('No constellations match this filter.');
            return;
        }

        const hemLabel = this.selectedHem === 'All' ? '' : ({ N: 'Northern', S: 'Southern', Eq: 'Equatorial' }[this.selectedHem] ?? '');
        const seasonLabel = this.selectedSeason === 'All' ? '' : (this.selectedSeason.charAt(0).toUpperCase() + this.selectedSeason.slice(1));
        const filterLabel = [hemLabel, seasonLabel].filter(Boolean).join(' · ') || 'All';
        const groupLabel = [hemLabel, seasonLabel].filter(Boolean).join(' · ');
        const typeLabel = this.questionType === 'name-constellation' ? 'Names' : 'Abbreviations';
        const cardTitle = this.title.trim() || `${filterLabel} Constellations — ${typeLabel}`;
        const cardId = `con-${filterLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${this.questionType}`;

        const clozes = ff.map(c => {
            const front = this.questionType === 'name-constellation'
                ? 'Name this constellation'
                : 'Give the abbreviation for this constellation';

            // For name-constellation: accept full name + abbreviation
            // For name-abbrev: accept abbreviation only
            const back = this.questionType === 'name-constellation'
                ? [c.name, c.abbr]
                : [c.abbr];

            const cloze: any = {
                id: `con-${c.abbr}-${this.questionType}`,
                featureId: c.abbr,
                featureName: c.name,
                front,
                back,
            };
            if (groupLabel) cloze.group = groupLabel;
            return cloze;
        });

        const card: any = {
            type: 'constellation',
            title: cardTitle,
            deck: this.deck.trim() || 'Constellations',
            id: cardId,
            showLines: this.showLines,
            clozes,
        };
        if (this.batch.trim()) card.batch = this.batch.trim();

        const ok = await appendCardToFile(this.app, card, this.targetFile);
        if (ok) {
            new Notice(`Generated ${clozes.length} constellation clozes!`);
            this.close();
        }
    }

    onClose() { this.contentEl.empty(); }
}
