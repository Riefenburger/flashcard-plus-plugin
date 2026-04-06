/**
 * Timeline engine — horizontal scrollable time bar with labeled eras and
 * pin-drop clozes. Card JSON format:
 *
 * {
 *   "type": "timeline",
 *   "title": "Geologic Time Scale",
 *   "deck": "Earth Science",
 *   "start": -540,        // start year (negative = BCE)
 *   "end": 0,             // end year
 *   "unit": "Ma",         // label unit shown in axis ticks ("Ma", "BCE", "CE", …)
 *   "bands": [            // colored background bands
 *     { "label": "Cambrian", "start": -540, "end": -485, "color": "#8ecae6" },
 *     ...
 *   ],
 *   "clozes": [
 *     {
 *       "id": "tl-001",
 *       "front": "When did the Permian end?",
 *       "back": ["252 Ma"],
 *       "year": -252,
 *       "notes": ""
 *     }
 *   ]
 * }
 */

import { App } from 'obsidian';
import { BaseEngine } from './base-engine';
import { renderMathInContainer } from '../utils/render-math';

export class TimelineEngine {
    static renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void
    ): void {
        container.empty();

        const start: number = cardData.start ?? 0;
        const end: number = cardData.end ?? 100;
        const span = end - start || 1;
        const unit: string = cardData.unit ?? '';
        const bands: any[] = Array.isArray(cardData.bands) ? cardData.bands : [];

        // ── Question ──
        const questionEl = container.createEl('h3', { cls: 'gi-tl-question' });
        renderMathInContainer(questionEl, cloze.front || 'When did this occur?');

        // ── Timeline bar ──
        const wrap = container.createDiv({ cls: 'gi-tl-wrap' });
        const bar = wrap.createDiv({ cls: 'gi-tl-bar' });

        // Band segments
        bands.forEach(band => {
            const left = ((band.start - start) / span) * 100;
            const width = ((band.end - band.start) / span) * 100;
            const seg = bar.createDiv({ cls: 'gi-tl-band' });
            seg.style.left = `${Math.max(0, left)}%`;
            seg.style.width = `${Math.min(100 - Math.max(0, left), width)}%`;
            seg.style.background = band.color || 'var(--background-secondary)';
            seg.title = band.label || '';
            seg.createEl('span', { text: band.label || '', cls: 'gi-tl-band-label' });
        });

        // Axis ticks — 5 evenly spaced
        const axis = wrap.createDiv({ cls: 'gi-tl-axis' });
        for (let i = 0; i <= 4; i++) {
            const val = start + (span * i) / 4;
            const tick = axis.createDiv({ cls: 'gi-tl-tick' });
            tick.style.left = `${(i / 4) * 100}%`;
            tick.createEl('small', { text: `${Math.round(val)} ${unit}` });
        }

        // Drag-to-answer pin
        const pinWrap = bar.createDiv({ cls: 'gi-tl-pin-wrap' });
        const pin = pinWrap.createDiv({ cls: 'gi-tl-pin' });
        pin.title = 'Drag to your answer';
        let pinPct = 50;
        pin.style.left = `${pinPct}%`;

        const updatePin = (clientX: number) => {
            const rect = bar.getBoundingClientRect();
            pinPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            pin.style.left = `${pinPct}%`;
        };

        bar.addEventListener('pointerdown', (e) => {
            bar.setPointerCapture(e.pointerId);
            updatePin(e.clientX);
        });
        bar.addEventListener('pointermove', (e) => {
            if (e.buttons === 0) return;
            updatePin(e.clientX);
        });

        // ── Input or Submit ──
        const footer = container.createDiv({ cls: 'gi-tl-footer' });

        const modeToggle = footer.createDiv({ cls: 'gi-tl-mode-row' });
        let useDrag = true;

        const dragLabel = modeToggle.createEl('label', { cls: 'gi-tl-mode-label' });
        const dragRadio = dragLabel.createEl('input', { type: 'radio', attr: { name: 'tlmode' } });
        dragRadio.checked = true;
        dragLabel.appendText(' Place on bar');

        const textLabel = modeToggle.createEl('label', { cls: 'gi-tl-mode-label' });
        const textRadio = textLabel.createEl('input', { type: 'radio', attr: { name: 'tlmode' } });
        textLabel.appendText(' Type year');

        dragRadio.onchange = () => { useDrag = true; textInput.style.display = 'none'; };
        textRadio.onchange = () => { useDrag = false; textInput.style.display = ''; setTimeout(() => textInput.focus(), 50); };

        const textInput = footer.createEl('input', {
            type: 'text',
            placeholder: `e.g. -252`,
            cls: 'gi-tl-text-input'
        });
        textInput.style.display = 'none';

        const submitBtn = footer.createEl('button', { text: 'Submit', cls: 'mod-cta gi-tl-submit' });

        submitBtn.onclick = () => {
            const correctYear: number = cloze.year ?? 0;
            const tolerance: number = cardData.tolerance ?? Math.max(1, span * 0.03); // 3% of span

            let guessYear: number;
            if (useDrag) {
                guessYear = start + (pinPct / 100) * span;
            } else {
                guessYear = parseFloat(textInput.value.replace(/[^-\d.]/g, ''));
                if (isNaN(guessYear)) {
                    textInput.style.border = '2px solid var(--text-error)';
                    return;
                }
            }

            const delta = Math.abs(guessYear - correctYear);
            const isCorrect = delta <= tolerance;
            const userAnswer = `${Math.round(guessYear)} ${unit}`;

            if (isCorrect) {
                onComplete(true, userAnswer);
            } else {
                // Show where the correct answer is on the bar
                const correctPct = ((correctYear - start) / span) * 100;
                const correctPin = bar.createDiv({ cls: 'gi-tl-pin gi-tl-pin--correct' });
                correctPin.style.left = `${Math.max(0, Math.min(100, correctPct))}%`;
                correctPin.title = `Correct: ${correctYear} ${unit}`;

                BaseEngine.renderIncorrectScreen(app, filePath, container, cloze, userAnswer, (wasCorrect) => onComplete(wasCorrect, userAnswer));
            }
        };

        textInput.onkeydown = (e) => { if (e.key === 'Enter') submitBtn.click(); };
    }
}
