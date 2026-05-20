export const AUTO_UPDATE_NOT_CONFIGURED_STATUS = {
    status: 'auto-update-not-configured',
    message: '当前版本未配置自动更新源',
} as const;

type PublishConfig = {
    provider?: unknown;
    owner?: unknown;
    repo?: unknown;
    url?: unknown;
};

type PackageMetadata = {
    build?: {
        publish?: PublishConfig | PublishConfig[] | string | null;
    };
    publish?: PublishConfig | PublishConfig[] | string | null;
};

interface AutoUpdateConfigOptions {
    isPackaged: boolean;
    appUpdateConfigPath: string;
    fsExists: (filepath: string) => boolean;
    packageMetadata?: PackageMetadata;
}

function isPlaceholder(value: unknown): boolean {
    return typeof value === 'string' && /^your(org|repo)$/i.test(value);
}

function isUsablePublishEntry(entry: PublishConfig | string): boolean {
    if (typeof entry === 'string') {
        return entry.trim().length > 0 && !entry.includes('YourOrg') && !entry.includes('YourRepo');
    }

    if (entry.provider === 'github') {
        return typeof entry.owner === 'string'
            && typeof entry.repo === 'string'
            && entry.owner.length > 0
            && entry.repo.length > 0
            && !isPlaceholder(entry.owner)
            && !isPlaceholder(entry.repo);
    }

    if (typeof entry.provider === 'string' && entry.provider.length > 0) {
        return true;
    }

    return typeof entry.url === 'string' && entry.url.length > 0;
}

export function hasPublishConfiguration(packageMetadata: PackageMetadata | null | undefined): boolean {
    const publish = packageMetadata?.build?.publish ?? packageMetadata?.publish;
    if (!publish) return false;
    const entries = Array.isArray(publish) ? publish : [publish];
    return entries.some(isUsablePublishEntry);
}

export function isAutoUpdateConfigured({
    isPackaged,
    appUpdateConfigPath,
    fsExists,
    packageMetadata,
}: AutoUpdateConfigOptions): boolean {
    if (isPackaged && fsExists(appUpdateConfigPath)) return true;
    return hasPublishConfiguration(packageMetadata);
}

export function getAutoUpdateNotConfiguredStatus(): typeof AUTO_UPDATE_NOT_CONFIGURED_STATUS {
    return AUTO_UPDATE_NOT_CONFIGURED_STATUS;
}
