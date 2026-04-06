import { App, Notice, TFile, setIcon } from 'obsidian';
import { renderMathInContainer } from '../utils/render-math';

export class BaseEngine {
    static renderIncorrectScreen(
        app: App,
        filePath: string,
        container: HTMLElement,
        cloze: any,
        userAnswer: string,
        onComplete: (wasCorrect: boolean) => void,
        allCards: any[] = []
    ) {
        container.empty();

        const card = container.createDiv({ cls: 'gi-incorrect-card' });

        // ── Header ────────────────────────────────────────────────────────────
        const hdr = card.createDiv({ cls: 'gi-incorrect-hdr' });
        const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
        setIcon(iconEl, 'x-circle');
        hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });

        // ── Answer comparison ─────────────────────────────────────────────────
        const compare = card.createDiv({ cls: 'gi-answer-compare' });

        const yoursBox = compare.createDiv({ cls: 'gi-answer-box gi-answer-box--wrong' });
        yoursBox.createEl('small', { text: 'You typed' });
        yoursBox.createEl('p', { text: userAnswer || '(nothing)', cls: 'gi-answer-val' });

        compare.createDiv({ cls: 'gi-answer-arrow', text: '→' });

        const correctBox = compare.createDiv({ cls: 'gi-answer-box gi-answer-box--right' });
        correctBox.createEl('small', { text: 'Correct answer' });
        const displayAnswer = cloze.back
            ? cloze.back.join(' / ')
            : (cloze.answers || []).join(' / ');
        const answerEl = correctBox.createEl('p', { cls: 'gi-answer-val' });
        renderMathInContainer(answerEl, displayAnswer);

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
                if (cloze.notes) {
                    notesBlock.createEl('p', { text: cloze.notes, cls: 'gi-notes-text' });
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
