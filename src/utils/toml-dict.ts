/**
 * Minimal TOML-style parser/serializer for `inventory-dict` blocks.
 *
 * Supported syntax:
 *   [Namespace]
 *   key = value
 *   # comment lines (ignored)
 *   blank lines (ignored)
 *
 * Values are unquoted strings; leading/trailing whitespace is trimmed.
 */

export type DictData = Record<string, Record<string, string>>;

export function parseTOMLDict(src: string): DictData {
    const result: DictData = {};
    let currentNs: string | null = null;

    for (const raw of src.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        if (line.startsWith('[') && line.endsWith(']')) {
            currentNs = line.slice(1, -1).trim();
            if (currentNs && !result[currentNs]) result[currentNs] = {};
            continue;
        }

        if (currentNs && line.includes('=')) {
            const eqIdx = line.indexOf('=');
            const key = line.slice(0, eqIdx).trim();
            const val = line.slice(eqIdx + 1).trim();
            if (key) result[currentNs]![key] = val;
        }
    }

    return result;
}

export function serializeTOMLDict(data: DictData): string {
    const parts: string[] = [];
    for (const [ns, fields] of Object.entries(data)) {
        parts.push(`[${ns}]`);
        for (const [key, val] of Object.entries(fields)) {
            parts.push(`${key} = ${val}`);
        }
        parts.push('');
    }
    // Remove trailing blank line
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('\n');
}

/** Flatten nested dict to "Ns.key" → value lookup map */
export function flattenDict(data: DictData): Record<string, string> {
    const flat: Record<string, string> = {};
    for (const [ns, fields] of Object.entries(data)) {
        for (const [key, val] of Object.entries(fields)) {
            flat[`${ns}.${key}`] = val;
        }
    }
    return flat;
}
