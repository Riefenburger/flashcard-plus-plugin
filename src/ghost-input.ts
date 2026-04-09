import { Platform } from 'obsidian';

export interface AnswerInputHandle {
    remove: () => void;
    focus: () => void;
}

/**
 * Answer input for map / constellation cards.
 *
 * Desktop  — inline bar appended inside `container`.
 *
 * Mobile   — position:fixed overlay appended to document.body.
 *            Stays anchored above the keyboard on both Android and iOS.
 *            Contains a real <input> (font-size:16px to prevent auto-zoom)
 *            and a submit button.  The card layout is completely unaffected.
 */
export function createAnswerInput(
    container: HTMLElement,
    promptText: string,
    onSubmit: (value: string) => void
): AnswerInputHandle {

    if (!Platform.isMobile) {
        // ── Desktop: plain inline bar ─────────────────────────────────────────
        const wrap = container.createDiv({ cls: 'gi-map-input-wrap' });
        wrap.createEl('span', { text: promptText, cls: 'gi-map-input-label' });
        const input = wrap.createEl('input', {
            type: 'text',
            placeholder: 'Type answer…',
            cls: 'gi-map-answer-input',
            attr: { autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' },
        });
        const btn = wrap.createEl('button', { text: '→', cls: 'gi-map-submit-btn mod-cta' });
        btn.onclick = () => onSubmit(input.value);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(input.value); });
        return {
            remove: () => wrap.remove(),
            focus: () => setTimeout(() => input.focus(), 80),
        };
    }

    // ── Mobile: fixed overlay with a real input ───────────────────────────────
    //
    // The overlay is position:fixed so it sits in the visual viewport above
    // the soft keyboard on both Android and iOS — the card behind it is never
    // scrolled, resized, or obscured.
    //
    // We use a real <input> (not a fake mirror) so tapping it directly opens
    // the keyboard without any programmatic focus() tricks.
    // font-size:16px prevents the OS from auto-zooming the page on focus.

    const overlay = document.body.createDiv({ cls: 'gi-answer-overlay' });

    const promptEl = overlay.createEl('span', {
        text: promptText,
        cls: 'gi-answer-overlay-prompt'
    });
    promptEl.title = promptText; // full text on long-press

    const input = overlay.createEl('input', {
        type: 'text',
        placeholder: '👆 Tap here to type…',
        cls: 'gi-answer-overlay-input',
        attr: {
            autocomplete:   'off',
            autocorrect:    'off',
            autocapitalize: 'none',
            spellcheck:     'false',
            inputmode:      'text',
        },
    });

    const submitBtn = overlay.createEl('button', {
        text: '→',
        cls: 'gi-map-submit-btn mod-cta'
    });

    const doSubmit = () => onSubmit(input.value);
    submitBtn.onclick = doSubmit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

    return {
        remove: () => overlay.remove(),
        // Don't programmatically focus — Android WebView blocks it outside a
        // user gesture. The overlay input is a direct tap target; the user
        // taps it and the keyboard opens reliably every time.
        focus: () => { /* intentionally empty */ },
    };
}
