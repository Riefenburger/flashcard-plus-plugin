import { App } from 'obsidian';
import { renderMathInContainer } from '../utils/render-math';

function resolve(str: string, dict: Record<string, string>): string {
    return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => dict[key.trim()] ?? `{{${key}}}`);
}

export class TraditionalEngine {
    static renderInModal(
        _app: App,
        _filePath: string,
        container: HTMLElement,
        cloze: any,
        onComplete: (wasCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ) {
        container.empty();

        if (cloze.style) {
            container.setAttribute('style', (container.getAttribute('style') || '') + '; ' + cloze.style);
            container.style.borderRadius = '8px';
            container.style.padding = '16px';
        }

        const front = resolve(cloze.front || '', dict);
        const back: string[] = (cloze.back || []).map((a: string) => resolve(a, dict));

        const frontEl = container.createEl('h2', { attr: { style: 'text-align: center; margin-bottom: 20px;' } });
        renderMathInContainer(frontEl, front);

        const input = container.createEl('input', { type: 'text', placeholder: 'Type answer...' });
        input.style.width = '100%';
        input.style.padding = '10px';
        input.style.fontSize = '16px';

        setTimeout(() => input.focus(), 50);

        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !input.disabled) {
                input.disabled = true;
                const userAnswer = input.value.trim().toLowerCase();
                const isCorrect = back.map(a => a.toLowerCase()).includes(userAnswer);
                onComplete(isCorrect, input.value.trim());
            }
        };
    }
}
