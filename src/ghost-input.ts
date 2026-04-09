import { Platform } from 'obsidian';

export interface AnswerInputHandle {
    remove: () => void;
    focus: () => void;
}

/**
 * Answer input for map / constellation cards.
 *
 * Desktop  — normal inline input bar appended to `container`.
 *
 * Mobile (iOS WKWebView) — ghost-over-fake pattern:
 *
 *   The visible UI is a floating overlay (position:fixed) with a prompt label,
 *   a fake-text-display div, and a Submit button.
 *
 *   On top of the fake-text-display (same fixed coordinates, higher z-index)
 *   sits a nearly-transparent real <input>.  Because the user's finger DIRECTLY
 *   hits the <input> element, iOS opens the keyboard immediately — no
 *   programmatic focus() call required (which WKWebView blocks).
 *
 *   The overlay display mirrors the ghost's value via the `input` event.
 */
export function createAnswerInput(
    container: HTMLElement,
    promptText: string,
    onSubmit: (value: string) => void
): AnswerInputHandle {

    // ── Desktop ──────────────────────────────────────────────────────────────
    if (!Platform.isMobile) {
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

    // ── Mobile: ghost-over-fake ───────────────────────────────────────────────
    //
    // Layer order (bottom → top):
    //   1. gi-answer-overlay   (z-index 9999) — visual background, prompt, fake field, button
    //   2. gi-ghost-input      (z-index 10001) — covers the fake-field hit area, opacity 0.01
    //   3. submit button       (z-index 10002) — on top so it's tappable despite ghost above it
    //
    // The user taps what looks like the text field and is actually tapping the
    // ghost input directly → iOS opens the keyboard without any focus() call.

    const overlay = document.body.createDiv({ cls: 'gi-answer-overlay' });
    overlay.createEl('span', { text: promptText, cls: 'gi-answer-overlay-prompt' });

    const fakeField       = overlay.createDiv({ cls: 'gi-fake-field' });
    const fakeText        = fakeField.createEl('span', { cls: 'gi-fake-field-text' });
    const fakeCursor      = fakeField.createEl('span', { cls: 'gi-fake-cursor' });
    const fakePlaceholder = fakeField.createEl('span', {
        text: 'Tap to type…',
        cls: 'gi-fake-field-placeholder'
    });
    fakeCursor.style.display = 'none';

    const submitBtn = overlay.createEl('button', {
        text: '→',
        cls: 'gi-map-submit-btn mod-cta gi-submit-above-ghost'
    });

    // Ghost input — covers the fake-field area, nearly invisible, directly tappable
    const ghost = document.body.createEl('input', {
        type: 'text',
        cls: 'gi-ghost-input',
        attr: {
            autocomplete:    'off',
            autocorrect:     'off',
            autocapitalize:  'none',
            spellcheck:      'false',
            inputmode:       'text',
        },
    });

    // Mirror ghost value into the fake display
    const sync = () => {
        const val = ghost.value;
        fakeText.textContent = val;
        fakePlaceholder.style.display  = val ? 'none' : '';
        fakeCursor.style.display       = val ? 'inline-block' : 'none';
    };
    ghost.addEventListener('input', sync);

    const doSubmit = () => onSubmit(ghost.value);
    ghost.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
    submitBtn.onclick = doSubmit;

    const cleanup = () => { ghost.remove(); overlay.remove(); };
    return {
        remove: cleanup,
        // focus() here is a best-effort fallback for non-iOS (Android, etc.)
        // On iOS the user taps the ghost directly.
        focus: () => { try { ghost.focus(); } catch { /* silent */ } },
    };
}
