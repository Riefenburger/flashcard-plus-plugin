import { Platform } from 'obsidian';

export interface AnswerInputHandle {
    /** Remove both the display element and ghost input from the DOM. */
    remove: () => void;
    /** Focus the real input (call after setup). */
    focus: () => void;
}

/**
 * Creates an answer input for map / constellation cards.
 *
 * Desktop  — appends a normal inline input bar to `container`.
 *
 * Mobile   — ghost input pattern:
 *   • A real <input> (position:fixed, bottom:0, opacity:0.01) is appended to
 *     document.body.  iOS sees it as "already at the keyboard edge", so it
 *     opens the keyboard without scrolling or squishing the card layout.
 *   • A floating overlay (position:fixed, above keyboard) is also on body,
 *     showing a fake typed-text display and a Submit button.
 *   • The card behind is completely unaffected by the keyboard.
 *
 * In both cases `handle.remove()` cleans everything up.
 */
export function createAnswerInput(
    container: HTMLElement,
    promptText: string,
    onSubmit: (value: string) => void
): AnswerInputHandle {

    if (!Platform.isMobile) {
        // ── Desktop: plain inline bar appended to container ──────────────────
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
            focus: () => { setTimeout(() => input.focus(), 80); },
        };
    }

    // ── Mobile: ghost input + floating overlay ────────────────────────────
    //
    // The ghost input sits at position:fixed; bottom:0 with opacity:0.01.
    // When it gets focus iOS treats it as already at the keyboard's arrival
    // edge, so it doesn't scroll the page or resize the card container.
    //
    // The overlay is position:fixed just above the safe-area bottom so it
    // floats above the keyboard naturally (iOS fixed elements follow the
    // visual viewport when the keyboard is open).

    const ghost = document.body.createEl('input', {
        type: 'text',
        cls: 'gi-ghost-input',
        attr: {
            autocomplete: 'off',
            autocorrect:  'off',
            autocapitalize: 'off',
            spellcheck:   'false',
            inputmode:    'text',
        },
    });

    const overlay = document.body.createDiv({ cls: 'gi-answer-overlay' });
    overlay.createEl('span', { text: promptText, cls: 'gi-answer-overlay-prompt' });

    const fakeField = overlay.createDiv({ cls: 'gi-fake-field' });
    const fakeText        = fakeField.createEl('span', { cls: 'gi-fake-field-text' });
    const fakeCursor      = fakeField.createEl('span', { cls: 'gi-fake-cursor' });
    const fakePlaceholder = fakeField.createEl('span', {
        text: 'Tap here to type…',
        cls: 'gi-fake-field-placeholder'
    });
    fakeCursor.style.display = 'none';

    const submitBtn = overlay.createEl('button', { text: '→', cls: 'gi-map-submit-btn mod-cta' });

    // Keep display in sync with ghost input value
    const sync = () => {
        const val = ghost.value;
        fakeText.textContent = val;
        if (val.length > 0) {
            fakePlaceholder.style.display = 'none';
            fakeCursor.style.display = 'inline-block';
        } else {
            fakePlaceholder.style.display = '';
            fakeCursor.style.display = 'none';
        }
    };
    ghost.addEventListener('input', sync);

    // Submit handlers
    const doSubmit = () => onSubmit(ghost.value);
    submitBtn.onclick = doSubmit;
    ghost.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

    // Tapping fake field or overlay opens keyboard via programmatic focus.
    // Must be in a touchend handler (direct user-gesture context) for iOS.
    const openKeyboard = (e: Event) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        e.preventDefault();
        ghost.focus();
    };
    overlay.addEventListener('touchend', openKeyboard);
    overlay.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'BUTTON') ghost.focus();
    });

    const cleanup = () => { ghost.remove(); overlay.remove(); };
    return {
        remove: cleanup,
        focus: () => { setTimeout(() => ghost.focus(), 80); },
    };
}
