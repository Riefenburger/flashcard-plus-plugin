import { App, Modal, Notice } from 'obsidian';
import { CONSTELLATION_NAMES, ConstellationInfo } from './data/constellation-names';

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

export class ConstellationEditorModal extends Modal {
    private cardData: any;
    private filePath: string;
    private originalSource: string;

    private clozes: any[];
    private questionType: QuestionType;
    private selectedHem: Hemisphere = 'All';
    private selectedSeason: Season = 'All';
    private listEl: HTMLElement | null = null;
    private addBtnEl: HTMLButtonElement | null = null;

    constructor(app: App, cardData: any, filePath: string, originalSource: string) {
        super(app);
        this.cardData = cardData;
        this.filePath = filePath;
        this.originalSource = originalSource;
        this.clozes = [...(cardData.clozes || [])];

        // Infer question type from existing cloze IDs
        const firstId: string = this.clozes[0]?.id ?? '';
        this.questionType = firstId.endsWith('-name-abbrev') ? 'name-abbrev' : 'name-constellation';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-dict-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('flashcard-modal-window');

        contentEl.createEl('h2', { text: 'Edit Constellation Card', attr: { style: 'margin-bottom:4px;' } });
        contentEl.createEl('p', {
            text: `"${this.cardData.title || 'Constellation Card'}" · ${this.clozes.length} constellations`,
            attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:16px;' }
        });

        // ── Filter row ───────────────────────────────────────────────────────
        const filterRow = contentEl.createDiv({ attr: { style: 'display:flex; gap:10px; margin-bottom:10px; align-items:flex-end;' } });

        const hemWrap = filterRow.createDiv({ attr: { style: 'flex:1;' } });
        hemWrap.createEl('label', { text: 'Hemisphere', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const hemSel = hemWrap.createEl('select', { attr: { style: 'width:100%;' } });
        HEMISPHERES.forEach(({ label, value }) => hemSel.createEl('option', { text: label, attr: { value } }));
        hemSel.value = this.selectedHem;
        hemSel.onchange = () => { this.selectedHem = hemSel.value as Hemisphere; this.updateAddBtn(); };

        const seasonWrap = filterRow.createDiv({ attr: { style: 'flex:1;' } });
        seasonWrap.createEl('label', { text: 'Season', attr: { style: 'display:block; font-size:0.8em; font-weight:600; margin-bottom:4px;' } });
        const seasonSel = seasonWrap.createEl('select', { attr: { style: 'width:100%;' } });
        SEASONS.forEach(({ label, value }) => seasonSel.createEl('option', { text: label, attr: { value } }));
        seasonSel.value = this.selectedSeason;
        seasonSel.onchange = () => { this.selectedSeason = seasonSel.value as Season; this.updateAddBtn(); };

        const addBtnWrap = filterRow.createDiv();
        this.addBtnEl = addBtnWrap.createEl('button', { text: 'Add matching', cls: 'mod-cta' });
        this.addBtnEl.onclick = () => this.addFiltered();
        this.updateAddBtn();

        // ── Constellation list ───────────────────────────────────────────────
        contentEl.createEl('p', {
            text: 'Constellations in this card:',
            attr: { style: 'font-size:0.8em; font-weight:600; margin-bottom:6px;' }
        });

        this.listEl = contentEl.createDiv({
            attr: { style: 'max-height:320px; overflow-y:auto; border:1px solid var(--background-modifier-border); border-radius:6px; padding:4px; margin-bottom:16px;' }
        });
        this.renderList();

        // ── Save / Cancel buttons ────────────────────────────────────────────
        const btnRow = contentEl.createDiv({ attr: { style: 'display:flex; gap:8px; justify-content:flex-end;' } });
        btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }).onclick = () => this.close();
        const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveBtn.onclick = () => this.save();
    }

    private renderList() {
        if (!this.listEl) return;
        this.listEl.empty();
        if (this.clozes.length === 0) {
            this.listEl.createEl('p', {
                text: 'No constellations — use "Add matching" to add some.',
                attr: { style: 'color:var(--text-muted); font-size:0.85em; padding:8px; margin:0;' }
            });
            return;
        }

        this.clozes.forEach((cloze, i) => {
            const row = this.listEl!.createDiv({ attr: { style: 'display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-radius:4px;' } });
            row.style.setProperty('background', i % 2 === 0 ? 'transparent' : 'var(--background-secondary)');

            const labelWrap = row.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center;' } });
            labelWrap.createEl('span', { text: cloze.featureName || cloze.featureId || cloze.id });

            const info = CONSTELLATION_NAMES[cloze.featureId];
            if (info) {
                const tag = labelWrap.createEl('span', {
                    text: `${info.hem} · ${info.season}`,
                    attr: { style: 'font-size:0.75em; color:var(--text-muted);' }
                });
                tag.style.display = 'inline';
            }

            const removeBtn = row.createEl('button', { text: 'Remove', cls: 'mod-ghost', attr: { style: 'font-size:0.75em;' } });
            removeBtn.onclick = () => {
                this.clozes.splice(i, 1);
                this.renderList();
                this.updateAddBtn();
            };
        });
    }

    private getFiltered(): ConstellationInfo[] {
        const existingAbbrs = new Set(this.clozes.map(c => c.featureId));
        return Object.values(CONSTELLATION_NAMES).filter(c => {
            if (existingAbbrs.has(c.abbr)) return false;
            if (this.selectedHem !== 'All' && c.hem !== this.selectedHem) return false;
            if (this.selectedSeason !== 'All' && c.season !== this.selectedSeason) return false;
            return true;
        });
    }

    private updateAddBtn() {
        if (!this.addBtnEl) return;
        const count = this.getFiltered().length;
        this.addBtnEl.textContent = count > 0 ? `Add matching (${count})` : 'Add matching';
        this.addBtnEl.disabled = count === 0;
    }

    private addFiltered() {
        const toAdd = this.getFiltered();
        if (toAdd.length === 0) return;

        const hemLabel = this.selectedHem === 'All' ? '' : ({ N: 'Northern', S: 'Southern', Eq: 'Equatorial' }[this.selectedHem] ?? '');
        const seasonLabel = this.selectedSeason === 'All' ? '' : (this.selectedSeason.charAt(0).toUpperCase() + this.selectedSeason.slice(1));
        const groupLabel = [hemLabel, seasonLabel].filter(Boolean).join(' · ');

        const front = this.questionType === 'name-constellation'
            ? 'Name this constellation'
            : 'Give the abbreviation for this constellation';

        for (const c of toAdd) {
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
            this.clozes.push(cloze);
        }

        this.renderList();
        this.updateAddBtn();
    }

    private async save() {
        const updatedCard = { ...this.cardData, clozes: this.clozes };
        const newBlock = '```inventory-card\n' + JSON.stringify(updatedCard, null, 2) + '\n```';
        const oldBlock = '```inventory-card\n' + this.originalSource + '\n```';

        const file = this.app.vault.getAbstractFileByPath(this.filePath);
        if (!file) {
            new Notice('Could not find the source file.');
            return;
        }

        await this.app.vault.process(file as any, content => {
            if (content.includes(oldBlock)) {
                return content.replace(oldBlock, newBlock);
            }
            new Notice('Original block not found — appending instead.');
            return content + '\n\n' + newBlock + '\n';
        });

        new Notice(`Constellation card updated (${this.clozes.length} constellations).`);
        this.close();
    }

    onClose() { this.contentEl.empty(); }
}
