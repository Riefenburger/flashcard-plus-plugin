import { App, Modal, Notice, setIcon } from 'obsidian';
import { GridPainterModal } from './grid-painter';
import { TraditionalCreatorModal } from './creators/traditional-creator';
import { AudioCreatorModal } from './creators/audio-creator';
import { SVGPainterModal } from './svg-painter';
import { MapPainterModal } from './map-painter';

type EngineType = 'traditional' | 'grid' | 'audio' | 'svg' | 'map' | 'code' | 'timeline';

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

        const grid = contentEl.createDiv({ cls: 'gi-picker-grid' });

        ENGINE_CARDS.forEach(ec => {
            const card = grid.createDiv({ cls: 'gi-picker-card' });
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
            default:
                new Notice('This engine type is not yet implemented.');
        }
    }
}
