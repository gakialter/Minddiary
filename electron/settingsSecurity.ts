export const SENSITIVE_SETTINGS_KEYS = ['aiApiKey'];

export function maskApiKey(key: string | null | undefined): string | null {
    if (!key) return null;
    if (key.length <= 8) return '********';
    return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

export function stripSensitiveSettings(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!settings || typeof settings !== 'object') return {};
    return Object.fromEntries(
        Object.entries(settings).filter(([key]) => !SENSITIVE_SETTINGS_KEYS.includes(key)),
    );
}

export function buildSafeSettingsPayload(
    settings: Record<string, unknown> | null | undefined,
    storedApiKey: string | null | undefined,
): Record<string, unknown> {
    return {
        ...stripSensitiveSettings(settings),
        aiApiKeyMasked: maskApiKey(storedApiKey),
        aiApiKeyPresent: !!storedApiKey,
    };
}
