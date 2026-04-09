import { Platform } from 'obsidian';

export interface AnswerInputHandle {
    remove: () => void;
    focus: () => void;
}

export function createAnswerInput(
    container: HTMLElement,
    promptText: string,
    onSubmit: (value: string) => void
): AnswerInputHandle {

    if (!Platform.isMobile) {
        // ── Desktop ───────────────────────────────────────────────────────────
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

    // ── Mobile ────────────────────────────────────────────────────────────────
    //
    // Problem: Leaflet / canvas receive touch events and steal focus away from
    // the input, causing the keyboard to flash open then close.
    //
    // Fix: a full-screen transparent SHIELD (z-index 9998) sits between the
    // card content and the overlay.  Every touch on the map/canvas hits the
    // shield first; the shield swallows it (preventDefault + stopPropagation)
    // so nothing underneath can steal focus.
    //
    // The overlay (z-index 9999) and its real <input> sit above the shield.
    // The user taps the input directly → keyboard opens and STAYS open.

    // Shield — covers the whole screen below the overlay
    const shield = document.body.createDiv({ cls: 'gi-focus-shield' });
    const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    shield.addEventListener('touchstart', swallow, { passive: false });
    shield.addEventListener('touchmove',  swallow, { passive: false });
    shield.addEventListener('touchend',   swallow, { passive: false });
    shield.addEventListener('mousedown',  swallow);
    shield.addEventListener('click',      swallow);

    // Overlay — fixed bar above the keyboard
    const overlay = document.body.createDiv({ cls: 'gi-answer-overlay' });

    overlay.createEl('span', { text: promptText, cls: 'gi-answer-overlay-prompt' });

    const input = overlay.createEl('input', {
        type: 'text',
        placeholder: 'Tap to type…',
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

    // Stop overlay touches from hitting the shield/card too
    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });

    const cleanup = () => { shield.remove(); overlay.remove(); };
    const doSubmit = () => { cleanup(); onSubmit(input.value); };

    submitBtn.onclick = doSubmit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

    return {
        remove: cleanup,
        focus: () => { /* user taps input directly — no programmatic focus needed */ },
    };
}
