import { TFile, App, getAllTags } from 'obsidian';

export interface ScannedCard {
    id: string;
    type: string;
    deck: string;
    clozes: any[];
    filePath: string;
}

export interface ScanResult {
    cards: ScannedCard[];
    dict: Record<string, string>;  // flat "Ns.key" → value lookup
}

export class VaultScanner {
    static async scan(app: App, targetTag: string): Promise<ScanResult> {
        const files = app.vault.getMarkdownFiles();
        const cards: ScannedCard[] = [];
        const dict: Record<string, string> = {};

        for (const file of files) {
            const cache = app.metadataCache.getFileCache(file);
            const tags = cache ? getAllTags(cache) : [];
            const hasTag = tags?.some(tag => tag.replaceAll('#', '') === targetTag.replaceAll('#', ''));

            if (hasTag) {
                const content = await app.vault.read(file);
                this.parseFromContent(content, file, cards, dict);
            }
        }
        return { cards, dict };
    }

    private static parseFromContent(
        content: string,
        file: TFile,
        cards: ScannedCard[],
        dict: Record<string, string>
    ) {
        const regex = /```inventory-card\s*([\s\S]*?)\s*```/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            if (!match[1]) continue;
            try {
                const json = JSON.parse(match[1]);

                if (json.type === 'dictionary') {
                    // Flatten nested namespace entries: { "F": { "mass": "18.998" } } → "F.mass" = "18.998"
                    const entries: Record<string, any> = json.entries || {};
                    for (const [ns, fields] of Object.entries(entries)) {
                        if (typeof fields === 'object' && fields !== null) {
                            for (const [key, val] of Object.entries(fields as Record<string, string>)) {
                                dict[`${ns}.${key}`] = String(val);
                            }
                        }
                    }
                    continue;  // dictionary blocks are not cards
                }

                const deckName = json.deck || file.basename;
                cards.push({ ...json, deck: deckName, filePath: file.path });
            } catch (e) {
                console.error(`Failed to parse card in ${file.path}`, e);
            }
        }
    }
}
