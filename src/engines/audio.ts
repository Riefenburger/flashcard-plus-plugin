import { App, TFile } from 'obsidian';
import { BaseEngine } from './base-engine';

/**
 * AudioEngine — for language learning flashcards.
 *
 * Card JSON format:
 * {
 *   "id": "spanish-001",
 *   "type": "audio",
 *   "deck": "Spanish Frequency",
 *   "title": "Spanish Top 500",
 *   "clozes": [
 *     {
 *       "id": "sf-hola",
 *       "audioPath": "audio/hola.mp3",   ← path relative to vault root
 *       "back": ["hello", "hi", "hola"], ← accepted answers
 *       "notes": "Most common greeting"
 *     }
 *   ]
 * }
 */
export class AudioEngine {
    static renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void
    ) {
        container.empty();

        // Optional context notes shown above the player
        if (cloze.notes) {
            container.createEl("p", {
                text: cloze.notes,
                attr: { style: "color: var(--text-muted); font-style: italic; text-align: center; margin-bottom: 16px;" }
            });
        }

        // Audio player
        const audioWrap = container.createDiv({
            attr: { style: "display:flex; flex-direction:column; align-items:center; gap:8px; margin: 20px 0;" }
        });

        const audio = audioWrap.createEl("audio", { attr: { controls: true } });
        audio.style.width = "100%";

        // Resolve vault path to a playable URL
        const audioPath: string = cloze.audioPath || '';
        if (audioPath) {
            const tfile = app.vault.getAbstractFileByPath(audioPath);
            if (tfile instanceof TFile) {
                audio.src = app.vault.getResourcePath(tfile);
            } else {
                audioWrap.createEl("p", {
                    text: `Audio file not found: "${audioPath}"`,
                    attr: { style: "color: var(--text-error); font-size: 0.9em;" }
                });
            }
        } else {
            audioWrap.createEl("p", {
                text: "No audioPath specified on this cloze.",
                attr: { style: "color: var(--text-error); font-size: 0.9em;" }
            });
        }

        // Replay button
        const replayBtn = audioWrap.createEl("button", { text: "↺  Replay", cls: "mod-ghost" });
        replayBtn.onclick = () => { audio.currentTime = 0; audio.play(); };

        // Answer input
        const input = container.createEl("input", {
            type: "text",
            placeholder: "Type what you heard…"
        });
        input.style.width = "100%";
        input.style.padding = "10px";
        input.style.fontSize = "16px";

        // Auto-play and focus
        setTimeout(() => {
            input.focus();
            audio.play().catch(() => {
                // Auto-play blocked by browser policy — user can press play manually
            });
        }, 50);

        input.onkeydown = (e) => {
            if (e.key === "Enter") {
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
