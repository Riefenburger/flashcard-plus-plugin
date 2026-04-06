import { TFile, App, getAllTags } from 'obsidian';

export interface ScannedCard {
    id: string;
    type: string;
    deck: string;
    clozes: any[];
    filePath: string; // We need this to know where to save edits later
}

export class VaultScanner {
    static async scan(app: App, targetTag: string): Promise<ScannedCard[]> {
        const files = app.vault.getMarkdownFiles();
        const cards: ScannedCard[] =[];

        for (const file of files) {
            const cache = app.metadataCache.getFileCache(file);
            const tags = cache ? getAllTags(cache) : [];
            // This checks for both "grand-inventory" and "#grand-inventory" to be safe
            const hasTag = tags?.some(tag => tag.replaceAll("#", "") === targetTag.replaceAll("#", ""));

            // Optimization: Only scan files with our tag
            if (hasTag) {
                const content = await app.vault.read(file);
                const extracted = this.parseCardsFromContent(content, file);
                cards.push(...extracted);
            }
        }
        return cards;
    }

    private static parseCardsFromContent(content: string, file: TFile): ScannedCard[] {
        const cardList: ScannedCard[] = [];
        // This regex looks for code blocks labeled 'inventory-card'
        const regex = /```inventory-card\s*([\s\S]*?)\s*```/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            if (match[1]) {
                try {
                    const json = JSON.parse(match[1]);
                    // Set default deck to file name if not specified in JSON
                    const deckName = json.deck || file.basename;

                    cardList.push({
                        ...json,
                        deck: deckName,
                        filePath: file.path
                    });
                } catch (e) {
                    console.error(`Failed to parse card in ${file.path}`, e);
                }
            }
        }
        return cardList;
    }
}