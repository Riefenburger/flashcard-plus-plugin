export interface ClozeState {
    interval: number;          // days until next review
    ease: number;              // SM-2 ease multiplier
    lastReviewed: number;      // Unix timestamp
    consecutiveDailyCorrect?: number; // streak of correct answers in daily mode
}

export interface SessionRecord {
    date: number;    // Unix timestamp (start of session)
    reviewed: number;
    correct: number;
    decks: string[]; // decks included in this session
}

export interface SessionPrefs {
    selectedDecks: string[];
    selectedBatches: string[];
    excludedClozeIds: string[];
    sessionGroups: Record<string, string[]>; // groupName → cloze IDs
}

export interface PluginData {
    cards: Record<string, ClozeState>;
    history: SessionRecord[];
    sessionPrefs?: SessionPrefs;
    lastDailyDate?: string;       // ISO date "YYYY-MM-DD" of last completed daily
    newCardsDate?: string;        // ISO date for resetting today's new card count
    newCardsSeenToday?: number;   // how many new (interval=0) cards reviewed so far today
    newCardsPerDay?: number;      // max new cards allowed in daily session (default 15)
}

export const DEFAULT_DATA: PluginData = {
    cards: {},
    history: [],
};

export function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

export function isDue(state: ClozeState | undefined): boolean {
    if (!state || state.interval === 0) return true; // new card, always due
    return Date.now() >= state.lastReviewed + state.interval * 86_400_000;
}

/** A card is mastered when it has a 6-month+ interval AND 8+ consecutive daily correct answers. */
export function isMastered(state: ClozeState | undefined): boolean {
    if (!state) return false;
    return state.interval >= 180 && (state.consecutiveDailyCorrect ?? 0) >= 8;
}

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
            newEase = Math.max(1.3, current.ease - 0.2);
        } else if (!isConfident) {
            // CORRECT but NOT CONFIDENT: Small progress
            newInterval = current.interval === 0 ? 1 : current.interval * 1.2;
            newEase = Math.max(1.3, current.ease - 0.1);
        } else {
            // CORRECT and CONFIDENT: Standard progress
            newInterval = current.interval === 0 ? 1 : current.interval * current.ease;
        }

        return {
            interval: newInterval,
            ease: newEase,
            lastReviewed: now,
            consecutiveDailyCorrect: current.consecutiveDailyCorrect, // preserved by default
        };
    }
}
