export interface ClozeState {
    interval: number; // in days
    ease: number;     // multiplier
    lastReviewed: number; // Unix timestamp
}

export interface SessionRecord {
    date: number;    // Unix timestamp (start of session)
    reviewed: number;
    correct: number;
    decks: string[]; // decks included in this session
}

export interface PluginData {
    cards: Record<string, ClozeState>;
    history: SessionRecord[];
}

export const DEFAULT_DATA: PluginData = {
    cards: {},
    history: [],
};

export class SRSEngine {
    static processReview(
        state: ClozeState | undefined,
        isCorrect: boolean,
        isConfident: boolean
    ): ClozeState {
        const now = Date.now();
        
        // Default state for a brand new card
        const current = state || { interval: 0, ease: 2.5, lastReviewed: 0 };

        let newInterval = current.interval;
        let newEase = current.ease;

        if (!isCorrect) {
            // WRONG: Reset the card
            newInterval = 0.1;
            newEase = Math.max(1.3, current.ease - 0.2)
        } else if (!isConfident) {
            // CORRECT but NOT CONFIDENT: Small progress
            newInterval = current.interval == 0 ? 1 : current.interval * 1.2;
            newEase = Math.max(1.3, current.ease - 0.1);
        } else {
            // CORRECT and CONFIDENT: Standard progress
            newInterval = current.interval === 0 ? 1 : current.interval * current.ease;
        }

        return { interval: newInterval, ease: newEase, lastReviewed: now};
    }
}