import { App, Modal, Notice, setIcon } from 'obsidian';
import { GridPainterModal } from './grid-painter';
import { TraditionalCreatorModal } from './creators/traditional-creator';
import { AudioCreatorModal } from './creators/audio-creator';
import { SVGPainterModal } from './svg-painter';
import { MapPainterModal } from './map-painter';
import { GeoDeckModal } from './geo-deck';
import { ConstellationDeckModal } from './constellation-deck';

type EngineType = 'traditional' | 'grid' | 'audio' | 'svg' | 'map' | 'code' | 'timeline' | 'geo-deck' | 'constellation-deck';

interface EngineCard {
    type: EngineType;
    icon: string;
    label: string;
    description: string;
}

const ENGINE_CARDS: EngineCard[] = [
    {
        type: 'traditional',
        icon: 'file-text',
        label: 'Traditional',
        description: 'Type an answer to a written question'
    },
    {
        type: 'grid',
        icon: 'layout-grid',
        label: 'Grid',
        description: 'Spatial CSS grid — periodic table, codon table'
    },
    {
        type: 'audio',
        icon: 'volume-2',
        label: 'Audio',
        description: 'Listen and type what you hear'
    },
    {
        type: 'svg',
        icon: 'pen-tool',
        label: 'SVG Diagram',
        description: 'Pin-annotate any SVG — anatomy, circuits, IPA'
    },
    {
        type: 'map',
        icon: 'map',
        label: 'Map',
        description: 'World geography with historical timeline layers'
    },
    {
        type: 'code',
        icon: 'code-2',
        label: 'Code',
        description: 'Solve programming problems — Rust, Python, C, and more'
    },
    {
        type: 'timeline',
        icon: 'milestone',
        label: 'Timeline',
        description: 'Pin events on a horizontal time bar — history, geology'
    },
];

const DECK_GENERATOR_CARDS: EngineCard[] = [
    {
        type: 'geo-deck',
        icon: 'globe',
        label: 'Geography Deck',
        description: 'Generate countries, capitals, and physical features'
    },
    {
        type: 'constellation-deck',
        icon: 'star',
        label: 'Constellation Deck',
        description: 'Generate a full deck of night-sky constellations'
    },
];

export class CardCreatorPickerModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-picker-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'Create a card' });
        contentEl.createEl('p', {
            text: 'Choose a card type. The card will be appended to your currently open note.',
            attr: { style: 'color: var(--text-muted); margin-bottom: 20px;' }
        });

        const renderCards = (cards: EngineCard[], container: HTMLElement) => {
            cards.forEach(ec => {
                const card = container.createDiv({ cls: 'gi-picker-card' });
                const iconEl = card.createDiv({ cls: 'gi-picker-card-icon' });
                setIcon(iconEl, ec.icon);
                card.createEl('strong', { text: ec.label, attr: { style: 'margin-top: 6px;' } });
                card.createEl('small', {
                    text: ec.description,
                    attr: { style: 'color: var(--text-muted); text-align: center; line-height: 1.3;' }
                });
                card.addEventListener('click', () => {
                    this.close();
                    this.openCreator(ec.type);
                });
            });
        };

        const grid = contentEl.createDiv({ cls: 'gi-picker-grid' });
        renderCards(ENGINE_CARDS, grid);

        contentEl.createEl('p', {
            text: 'Deck Generators',
            attr: { style: 'font-size: 0.75em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin: 16px 0 8px;' }
        });
        const deckGrid = contentEl.createDiv({ cls: 'gi-picker-grid' });
        renderCards(DECK_GENERATOR_CARDS, deckGrid);
    }

    onClose() { this.contentEl.empty(); }

    private openCreator(type: EngineType) {
        const activeFile = this.app.workspace.getActiveFile();

        switch (type) {
            case 'traditional':
                new TraditionalCreatorModal(this.app, activeFile).open();
                break;
            case 'grid':
                new GridPainterModal(this.app).open();
                break;
            case 'audio':
                new AudioCreatorModal(this.app, activeFile).open();
                break;
            case 'svg':
                new SVGPainterModal(this.app, activeFile).open();
                break;
            case 'map':
                new MapPainterModal(this.app, activeFile).open();
                break;
            case 'code': {
                import('./creators/code-creator').then(m => new m.CodeCreatorModal(this.app, activeFile).open());
                break;
            }
            case 'timeline': {
                import('./creators/timeline-creator').then(m => new m.TimelineCreatorModal(this.app, activeFile).open());
                break;
            }
            case 'geo-deck':
                new GeoDeckModal(this.app).open();
                break;
            case 'constellation-deck':
                new ConstellationDeckModal(this.app).open();
                break;
            default:
                new Notice('This engine type is not yet implemented.');
        }
    }
}
