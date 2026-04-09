import { App, Notice, TFile, setIcon } from 'obsidian';
import { renderMathInContainer } from '../utils/render-math';

function resolve(str: string, dict: Record<string, string>): string {
    return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => dict[key.trim()] ?? `{{${key}}}`);
}

export class BaseEngine {
    /**
     * Full incorrect screen — empties container, shows header, then content.
     * Use this for card types that don't need custom visuals (traditional, svg, etc.)
     */
    static renderIncorrectScreen(
        app: App,
        filePath: string,
        container: HTMLElement,
        cloze: any,
        userAnswer: string,
        onComplete: (wasCorrect: boolean) => void,
        allCards: any[] = [],
        dict: Record<string, string> = {},
        cardData: any = null
    ) {
        container.empty();
        const card = container.createDiv({ cls: 'gi-incorrect-card' });

        const hdr = card.createDiv({ cls: 'gi-incorrect-hdr' });
        const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
        setIcon(iconEl, 'x-circle');
        hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });

        BaseEngine.renderIncorrectContent(app, filePath, card, cloze, userAnswer, onComplete, allCards, dict, cardData);
    }

    /**
     * Appends the comparison, extra info, notes, linked clozes and action buttons
     * to an existing element. Called by renderIncorrectScreen and by engine-specific
     * incorrect screens (grid, map) that manage their own visuals above this section.
     */
    static renderIncorrectContent(
        app: App,
        filePath: string,
        card: HTMLElement,
        cloze: any,
        userAnswer: string,
        onComplete: (wasCorrect: boolean) => void,
        allCards: any[] = [],
        dict: Record<string, string> = {},
        cardData: any = null
    ) {
        const fmt = cardData?.clozeFormat;
        const ns: string | undefined = cloze.clozeNamespace || cloze.namespace;
        const useFormat = !!(ns && fmt);

        // ── Resolve answers from namespace ───────────────────────────────────
        let resolvedAnswers: string[];
        if (useFormat && Array.isArray(fmt.answers) && fmt.answers.length > 0) {
            resolvedAnswers = (fmt.answers as string[]).map((k: string) => dict[`${ns}.${k}`] ?? k);
        } else {
            resolvedAnswers = Array.isArray(cloze.back) ? cloze.back : (cloze.answers || []);
        }
        const displayAnswer = resolvedAnswers.join(' / ') || '(unknown)';

        // ── Resolve notes from namespace ─────────────────────────────────────
        // cloze.notes may contain {{Ns.key}} template references — resolve them
        let resolvedNotes = resolve(cloze.notes || '', dict);
        // If still empty and clozeFormat has a notes key, look it up directly
        if (!resolvedNotes && useFormat && fmt.notes) {
            resolvedNotes = dict[`${ns}.${fmt.notes}`] ?? '';
        }

        // ── Answer comparison ─────────────────────────────────────────────────
        const compare = card.createDiv({ cls: 'gi-answer-compare' });

        const yoursBox = compare.createDiv({ cls: 'gi-answer-box gi-answer-box--wrong' });
        yoursBox.createEl('small', { text: 'You typed' });
        yoursBox.createEl('p', { text: userAnswer || '(nothing)', cls: 'gi-answer-val' });

        compare.createDiv({ cls: 'gi-answer-arrow', text: '→' });

        const correctBox = compare.createDiv({ cls: 'gi-answer-box gi-answer-box--right' });
        correctBox.createEl('small', { text: 'Correct answer' });
        const answerEl = correctBox.createEl('p', { cls: 'gi-answer-val' });
        renderMathInContainer(answerEl, displayAnswer);

        // ── Extra info keys (from clozeFormat.incorrectExtra) ─────────────────
        if (useFormat && Array.isArray(fmt.incorrectExtra) && fmt.incorrectExtra.length > 0) {
            const extraBox = card.createDiv({ cls: 'gi-incorrect-extra' });
            (fmt.incorrectExtra as string[]).forEach((key: string) => {
                const val = dict[`${ns}.${key}`];
                if (!val) return;
                const chip = extraBox.createDiv({ cls: 'gi-incorrect-extra-chip' });
                chip.createEl('small', { text: key });
                chip.createEl('strong', { text: val });
            });
        }

        // ── Notes (inline edit) ───────────────────────────────────────────────
        const notesBlock = card.createDiv({ cls: 'gi-notes-block' });
        let notesEditOpen = false;

        const renderNotes = () => {
            notesBlock.empty();
            const noteHdr = notesBlock.createDiv({ cls: 'gi-notes-hdr' });
            noteHdr.createEl('small', { text: 'Notes', cls: 'gi-notes-label' });
            const editBtn = noteHdr.createEl('button', { cls: 'mod-ghost gi-notes-edit-btn' });
            setIcon(editBtn, 'pencil');

            if (notesEditOpen) {
                const ta = notesBlock.createEl('textarea', { cls: 'gi-notes-textarea' });
                ta.value = cloze.notes || '';
                ta.rows = 3;
                setTimeout(() => ta.focus(), 30);

                const btnRow = notesBlock.createDiv({ cls: 'gi-notes-btn-row' });
                const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
                const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' });

                saveBtn.onclick = async () => {
                    const newNotes = ta.value;
                    cloze.notes = newNotes;
                    const file = app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        await app.vault.process(file, (data) => {
                            const regex = /```inventory-card\s*([\s\S]*?)\s*```/g;
                            return data.replace(regex, (match, jsonString) => {
                                try {
                                    const parsed = JSON.parse(jsonString);
                                    const hasTarget = parsed.clozes?.some((c: any) => c.id === cloze.id);
                                    if (hasTarget) {
                                        parsed.clozes = parsed.clozes.map((c: any) =>
                                            c.id === cloze.id ? { ...c, notes: newNotes } : c
                                        );
                                        return '```inventory-card\n' + JSON.stringify(parsed, null, 2) + '\n```';
                                    }
                                } catch { /* ignore */ }
                                return match;
                            });
                        });
                        new Notice('Notes saved!');
                    }
                    notesEditOpen = false;
                    renderNotes();
                };
                cancelBtn.onclick = () => { notesEditOpen = false; renderNotes(); };
                editBtn.onclick = () => { notesEditOpen = false; renderNotes(); };
            } else {
                if (resolvedNotes) {
                    notesBlock.createEl('p', { text: resolvedNotes, cls: 'gi-notes-text' });
                } else {
                    notesBlock.createEl('p', { text: 'No notes — click ✏ to add.', cls: 'gi-notes-empty' });
                }
                editBtn.onclick = () => { notesEditOpen = true; renderNotes(); };
            }
        };
        renderNotes();

        // ── Linked clozes ──────────────────────────────────────────────────────
        const links: string[] = Array.isArray(cloze.links) ? cloze.links : [];
        if (links.length > 0 && allCards.length > 0) {
            const linksBox = card.createDiv({ cls: 'gi-linked-clozes' });
            linksBox.createEl('small', { text: 'Related:', attr: { style: 'color:var(--text-muted); display:block; margin-bottom:4px;' } });
            links.forEach((ref: string) => {
                const [cardId, clozeId] = ref.split('#');
                const linkedCard = allCards.find(c => c.id === cardId);
                const linkedCloze = linkedCard?.clozes?.find((c: any) => c.id === clozeId);
                if (!linkedCloze) return;
                const row = linksBox.createDiv({ cls: 'gi-linked-row' });
                setIcon(row, 'link');
                const front = linkedCloze.front || linkedCloze.value || '';
                const back = Array.isArray(linkedCloze.back)
                    ? linkedCloze.back.join(', ')
                    : (linkedCloze.answers || []).join(', ');
                const textSpan = row.createEl('span');
                renderMathInContainer(textSpan, `${front}${back ? ' → ' + back : ''}`);
            });
        }

        // ── Actions ────────────────────────────────────────────────────────────
        const actions = card.createDiv({ cls: 'gi-incorrect-actions' });

        const knewItBtn = actions.createEl('button', { cls: 'gi-knew-it-btn' });
        const knewItIconEl = knewItBtn.createDiv({ cls: 'gi-knew-it-icon' });
        setIcon(knewItIconEl, 'check-circle');
        knewItBtn.appendText(' I knew it');
        knewItBtn.title = 'Mark as correct — you knew the answer but typed it wrong';

        const continueBtn = actions.createEl('button', { cls: 'mod-cta gi-continue-btn' });
        continueBtn.appendText('Continue ');
        continueBtn.createEl('kbd', { text: 'Enter' });
        setTimeout(() => continueBtn.focus(), 50);

        knewItBtn.onclick = () => onComplete(true);
        continueBtn.onclick = () => onComplete(false);
        continueBtn.onkeydown = (e) => { if (e.key === 'Enter') onComplete(false); };
    }
}
