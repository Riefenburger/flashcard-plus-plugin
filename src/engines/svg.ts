import { App, TFile } from 'obsidian';
import { attachPanZoom, createSVGPin } from '../utils/svg-pan-zoom';
import { BaseEngine } from './base-engine';

export class SVGEngine {
    static async renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        _cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void
    ): Promise<void> {
        container.empty();

        // Question header
        container.createEl('h3', {
            text: cloze.front || 'What is this?',
            attr: { style: 'text-align:center; margin-bottom:12px;' }
        });

        // SVG viewer
        const viewerWrap = container.createDiv({ cls: 'gi-svg-viewer-wrap' });
        const svgContainer = viewerWrap.createDiv({ cls: 'gi-svg-container' });

        container.createEl('p', {
            text: 'Pan: drag · Zoom: scroll',
            attr: { style: 'color:var(--text-muted); font-size:0.8em; text-align:center; margin:4px 0 10px;' }
        });

        // Load SVG
        const svgPath: string = _cardData.svgPath || '';
        if (svgPath) {
            const file = app.vault.getAbstractFileByPath(svgPath);
            if (file instanceof TFile) {
                const content = await app.vault.read(file);
                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'image/svg+xml');
                const parsed = doc.querySelector('svg');

                if (parsed) {
                    parsed.removeAttribute('width');
                    parsed.removeAttribute('height');
                    parsed.style.width = '100%';
                    parsed.style.height = '100%';
                    parsed.style.display = 'block';

                    const svgEl = document.adoptNode(parsed) as SVGSVGElement;
                    svgContainer.appendChild(svgEl);

                    // Drop the ? pin at cloze coordinates
                    if (typeof cloze.x === 'number' && typeof cloze.y === 'number') {
                        createSVGPin(svgEl, cloze.x, cloze.y, '?');
                    }

                    // Attach pan+zoom (no pin-drop callback in review mode)
                    const handle = attachPanZoom(svgEl);

                    // Store cleanup on container so session-modal can call it
                    (container as any)._svgCleanup = () => handle.destroy();
                } else {
                    svgContainer.createEl('p', {
                        text: 'Could not parse SVG.',
                        attr: { style: 'color:var(--text-error);' }
                    });
                }
            } else {
                svgContainer.createEl('p', {
                    text: `SVG not found: "${svgPath}"`,
                    attr: { style: 'color:var(--text-error);' }
                });
            }
        }

        // Answer input
        const input = container.createEl('input', {
            type: 'text',
            placeholder: 'Type your answer…'
        });
        input.style.width = '100%';
        input.style.padding = '10px';
        input.style.fontSize = '16px';
        setTimeout(() => input.focus(), 50);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const userAnswer = input.value.trim().toLowerCase();
                const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
                const isCorrect = correctAnswers.includes(userAnswer);

                if (isCorrect) {
                    onComplete(true, userAnswer);
                } else {
                    BaseEngine.renderIncorrectScreen(
                        app,
                        filePath,
                        container,
                        cloze,
                        userAnswer,
                        (correct) => onComplete(correct, userAnswer)
                    );
                }
            }
        };
    }
}
