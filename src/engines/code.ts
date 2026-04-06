import { App, Platform } from 'obsidian';
import { runCode, SupportedLanguage, LANGUAGE_LABELS, TOOLCHAIN_HINTS } from '../utils/code-runner';

export class CodeEngine {
    static async renderInModal(
        app: App,
        _filePath: string,
        container: HTMLElement,
        cardData: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void
    ): Promise<void> {
        container.empty();

        // Code execution requires Node.js (desktop only)
        if (Platform.isMobile) {
            container.createEl('h3', { text: cardData.title || 'Code Problem' });
            container.createEl('p', {
                text: cardData.problem || '',
                attr: { style: 'white-space:pre-wrap; color:var(--text-muted);' }
            });
            container.createEl('p', {
                text: 'Code execution is not available on mobile. Review this card on desktop.',
                attr: { style: 'color:var(--text-error); margin-top:16px;' }
            });
            const skipBtn = container.createEl('button', { text: 'Skip →', cls: 'mod-ghost' });
            skipBtn.style.marginTop = '12px';
            skipBtn.onclick = () => onComplete(false, '');
            return;
        }

        const language: SupportedLanguage = cardData.language || 'rust';
        const hints: string[] = cardData.hints || [];

        // ── Problem header ──
        const problemEl = container.createDiv({ cls: 'gi-code-problem' });
        problemEl.createEl('h3', { text: cardData.title || 'Code Problem' });
        problemEl.createEl('p', { text: cardData.problem || '' });

        // ── Toolbar row ──
        const toolbar = container.createDiv({ cls: 'gi-code-toolbar' });
        toolbar.createEl('span', {
            text: LANGUAGE_LABELS[language],
            cls: 'gi-code-lang-badge'
        });

        let hintsVisible = false;
        if (hints.length > 0) {
            const hintBtn = toolbar.createEl('button', { text: 'Hint', cls: 'mod-ghost' });
            const hintBox = container.createDiv({ cls: 'gi-code-hints', attr: { style: 'display:none;' } });
            hints.forEach((h, i) => hintBox.createEl('p', { text: `${i + 1}. ${h}` }));
            hintBtn.onclick = () => {
                hintsVisible = !hintsVisible;
                hintBox.style.display = hintsVisible ? 'block' : 'none';
                hintBtn.setText(hintsVisible ? 'Hide hints' : 'Hint');
            };
        }

        // ── Code editor ──
        const editorWrap = container.createDiv({ cls: 'gi-code-editor-wrap' });
        const editor = editorWrap.createEl('textarea', { cls: 'gi-code-editor' });
        editor.value = cardData.starter || '';
        editor.spellcheck = false;

        // Tab key inserts spaces instead of leaving the field
        editor.onkeydown = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.slice(0, start) + '    ' + editor.value.slice(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            }
        };

        // ── Run button ──
        const runBtn = container.createEl('button', { text: 'Run ▶', cls: 'mod-cta' });
        runBtn.style.marginTop = '8px';

        // ── Output area ──
        const outputEl = container.createDiv({ cls: 'gi-code-output' });
        outputEl.style.display = 'none';

        // ── Result actions ──
        const resultRow = container.createDiv({ cls: 'gi-code-result-row' });
        resultRow.style.display = 'none';

        runBtn.onclick = async () => {
            runBtn.disabled = true;
            runBtn.setText('Running…');
            outputEl.style.display = 'block';
            outputEl.style.color = 'var(--text-muted)';
            outputEl.setText('Compiling and running…');
            resultRow.style.display = 'none';

            try {
                const result = await runCode(language, editor.value);

                if (result.exitCode !== 0 || result.stderr) {
                    outputEl.style.color = 'var(--text-error)';
                    outputEl.setText(result.stderr || result.stdout || 'Unknown error');
                    runBtn.disabled = false;
                    runBtn.setText('Run ▶');

                    // Toolchain hint if the error looks like "command not found"
                    const stderr = result.stderr.toLowerCase();
                    if (stderr.includes('not found') || stderr.includes('no such file')) {
                        outputEl.appendText(`\n\n💡 ${TOOLCHAIN_HINTS[language]}`);
                    }
                    return;
                }

                const actual = result.stdout.trim();
                const expected = (cardData.expectedOutput || '').trim();
                const isCorrect = actual === expected;

                outputEl.style.color = 'var(--text-normal)';
                outputEl.setText(actual || '(no output)');

                resultRow.style.display = 'flex';
                resultRow.empty();

                if (isCorrect) {
                    resultRow.createEl('span', {
                        text: 'Output matches! Correct.',
                        attr: { style: 'color:var(--color-green); font-weight:600; flex:1;' }
                    });
                    const nextBtn = resultRow.createEl('button', { text: 'Next →', cls: 'mod-cta' });
                    nextBtn.onclick = () => onComplete(true, actual);
                } else {
                    resultRow.createEl('span', {
                        text: 'Output mismatch.',
                        attr: { style: 'color:var(--text-error); font-weight:600; flex:1;' }
                    });
                    const expEl = container.createDiv({ cls: 'gi-code-expected' });
                    expEl.createEl('small', { text: 'Expected:', attr: { style: 'color:var(--text-muted); display:block;' } });
                    expEl.createEl('pre', { text: expected });

                    const markCorrectBtn = resultRow.createEl('button', { text: 'Mark correct', cls: 'mod-ghost' });
                    markCorrectBtn.onclick = () => onComplete(true, actual);
                    const nextBtn = resultRow.createEl('button', { text: 'Try again', cls: 'mod-warning' });
                    nextBtn.onclick = () => onComplete(false, actual);
                }
            } catch (err: any) {
                outputEl.style.color = 'var(--text-error)';
                outputEl.setText('Error: ' + (err?.message ?? String(err)));
            } finally {
                runBtn.disabled = false;
                runBtn.setText('Run ▶');
            }
        };

        setTimeout(() => editor.focus(), 50);
    }
}
