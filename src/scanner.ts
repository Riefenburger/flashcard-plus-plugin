import { TFile, App, getAllTags } from 'obsidian';
import { parseTOMLDict, flattenDict } from './utils/toml-dict';

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
        // Parse inventory-dict blocks (TOML format)
        const dictRegex = /```inventory-dict\s*([\s\S]*?)\s*```/g;
        let dictMatch;
        while ((dictMatch = dictRegex.exec(content)) !== null) {
            if (!dictMatch[1]) continue;
            try {
                const data = parseTOMLDict(dictMatch[1]);
                Object.assign(dict, flattenDict(data));
            } catch (e) {
                console.error(`Failed to parse inventory-dict in ${file.path}`, e);
            }
        }

        // Parse inventory-card blocks (JSON format)
        const regex = /```inventory-card\s*([\s\S]*?)\s*```/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            if (!match[1]) continue;
            try {
                const json = JSON.parse(match[1]);

                // Legacy JSON dictionary support
                if (json.type === 'dictionary') {
                    const entries: Record<string, any> = json.entries || {};
                    for (const [ns, fields] of Object.entries(entries)) {
                        if (typeof fields === 'object' && fields !== null) {
                            for (const [key, val] of Object.entries(fields as Record<string, string>)) {
                                dict[`${ns}.${key}`] = String(val);
                            }
                        }
                    }
                    continue;
                }

                const deckName = json.deck || file.basename;
                cards.push({ ...json, deck: deckName, filePath: file.path });
            } catch (e) {
                console.error(`Failed to parse card in ${file.path}`, e);
            }
        }
    }
}
