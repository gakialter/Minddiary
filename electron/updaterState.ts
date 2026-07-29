export type UpdaterStatusType =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'auto-update-not-configured';

export type UpdaterErrorCode =
    | 'invalid-metadata'
    | 'checksum-mismatch'
    | 'invalid-signature'
    | 'network'
    | 'invalid-transition'
    | 'update-failed';

export type UpdaterStatus = {
    status: UpdaterStatusType;
    version?: string;
    releaseNotes?: string;
    releaseDate?: string;
    percent?: number;
    bytesPerSecond?: number;
    transferred?: number;
    total?: number;
    message?: string;
    errorCode?: UpdaterErrorCode;
};

export type UpdaterEvent =
    | { type: 'checking' }
    | { type: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
    | { type: 'not-available' }
    | {
        type: 'download-progress';
        percent: number;
        bytesPerSecond: number;
        transferred: number;
        total: number;
    }
    | { type: 'downloaded'; version: string }
    | { type: 'error'; error: unknown };

const RELEASE_DETAIL_KEYS = ['version', 'releaseNotes', 'releaseDate'] as const;

function preserveReleaseDetails(previous: UpdaterStatus): Partial<UpdaterStatus> {
    const details: Partial<UpdaterStatus> = {};
    for (const key of RELEASE_DETAIL_KEYS) {
        if (previous[key] !== undefined) details[key] = previous[key];
    }
    return details;
}

function requireStatus(previous: UpdaterStatus, allowed: readonly UpdaterStatusType[], event: UpdaterEvent['type']): void {
    if (!allowed.includes(previous.status)) {
        throw new Error(`Invalid updater transition from ${previous.status} via ${event}`);
    }
}

function boundedNonNegative(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

export function classifyUpdaterError(error: unknown): Pick<UpdaterStatus, 'message' | 'errorCode'> {
    const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalized = `${code} ${message}`.toLowerCase();

    if (/checksum|sha512|sha256|digest/.test(normalized)) {
        return { message: '更新文件校验失败', errorCode: 'checksum-mismatch' };
    }
    if (/invalid_signature|not signed by the application owner/.test(normalized)) {
        return { message: '更新文件签名验证失败', errorCode: 'invalid-signature' };
    }
    if (/invalid_update_info|invalid_version|no_files_provided|no_checksum|cannot parse update info|yaml|unterminated|unexpected end|bad indentation|duplicated mapping key|end of the stream/.test(normalized)) {
        return { message: '更新元数据无效', errorCode: 'invalid-metadata' };
    }
    if (/econnrefused|econnreset|enotfound|etimedout|network|http error|status code/.test(normalized)) {
        return { message: '无法连接更新服务器', errorCode: 'network' };
    }
    return { message: '自动更新失败，请重试', errorCode: 'update-failed' };
}

export function transitionUpdaterStatus(previous: UpdaterStatus, event: UpdaterEvent): UpdaterStatus {
    switch (event.type) {
        case 'checking':
            return { status: 'checking' };
        case 'available':
            requireStatus(previous, ['checking'], event.type);
            return {
                status: 'available',
                version: event.version,
                ...(event.releaseNotes ? { releaseNotes: event.releaseNotes } : {}),
                ...(event.releaseDate ? { releaseDate: event.releaseDate } : {}),
            };
        case 'not-available':
            requireStatus(previous, ['checking'], event.type);
            return { status: 'not-available' };
        case 'download-progress': {
            requireStatus(previous, ['available', 'downloading'], event.type);
            const total = boundedNonNegative(event.total);
            const transferred = Math.min(boundedNonNegative(event.transferred), total || Number.MAX_SAFE_INTEGER);
            const percent = Math.min(100, Math.max(0, Math.round(event.percent)));
            return {
                ...preserveReleaseDetails(previous),
                status: 'downloading',
                percent,
                bytesPerSecond: boundedNonNegative(event.bytesPerSecond),
                transferred,
                total,
            };
        }
        case 'downloaded':
            requireStatus(previous, ['available', 'downloading'], event.type);
            return {
                ...preserveReleaseDetails(previous),
                status: 'downloaded',
                version: event.version,
            };
        case 'error':
            return { status: 'error', ...classifyUpdaterError(event.error) };
    }
}

export function canQuitAndInstall(status: UpdaterStatus): boolean {
    return status.status === 'downloaded';
}
