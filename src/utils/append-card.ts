import { App, Notice, TFile } from 'obsidian';

/**
 * Appends a new inventory-card JSON block to a file.
 * Uses vault.process for an atomic write (no read-then-write race).
 * Returns true on success, false if no target file was provided.
 */
export async function appendCardToFile(
    app: App,
    cardJson: object,
    targetFile: TFile | null
): Promise<boolean> {
    if (!targetFile) {
        new Notice('No active file. Open or create a note first, then add a card.');
        return false;
    }

    const block =
        '```inventory-card\n' +
        JSON.stringify(cardJson, null, 2) +
        '\n```';

    await app.vault.process(targetFile, (data) => {
        const separator = data.length > 0 && !data.endsWith('\n') ? '\n\n' : '\n';
        return data + separator + block + '\n';
    });

    new Notice(`Card saved to "${targetFile.basename}".`);
    return true;
}
