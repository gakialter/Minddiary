interface ReleaseNoteEntry {
    version?: unknown;
    note?: unknown;
}

type UpdaterStatus = Record<string, unknown>;

function normalizeNoteText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

/** Convert electron-updater's string or full-changelog array to plain text. */
export function normalizeUpdaterReleaseNotes(value: unknown): string | undefined {
    const directNote = normalizeNoteText(value);
    if (directNote) return directNote;
    if (!Array.isArray(value)) return undefined;

    const notes = value.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const entry = item as ReleaseNoteEntry;
        const note = normalizeNoteText(entry.note);
        if (!note) return [];
        const version = normalizeNoteText(entry.version);
        return [version ? `v${version}\n${note}` : note];
    });

    return notes.length > 0 ? notes.join('\n\n') : undefined;
}

/** Keep release metadata visible while electron-updater advances download states. */
export function preserveUpdaterReleaseDetails(previous: UpdaterStatus, next: UpdaterStatus): UpdaterStatus {
    const details: UpdaterStatus = {};
    for (const key of ['version', 'releaseNotes', 'releaseDate']) {
        if (previous[key] !== undefined) details[key] = previous[key];
    }
    return { ...details, ...next };
}
