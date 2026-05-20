import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type PathModule = Pick<typeof path, 'resolve' | 'relative' | 'isAbsolute'>;
type RealpathSync = typeof fs.realpathSync & {
    native?: typeof fs.realpathSync.native;
};

interface FsModule {
    realpathSync: RealpathSync;
}

export interface PathSecurityOptions {
    fsModule?: FsModule;
    pathModule?: PathModule;
    platform?: NodeJS.Platform;
}

function getRealPath(filepath: string, fsModule: FsModule, errorMessage: string): string {
    try {
        if (typeof fsModule.realpathSync.native === 'function') {
            return fsModule.realpathSync.native(filepath);
        }
        return fsModule.realpathSync(filepath);
    } catch {
        throw new Error(errorMessage);
    }
}

function normalizeForCompare(filepath: string, platform: NodeJS.Platform): string {
    const normalized = filepath.replace(/[\\/]+/g, platform === 'win32' ? '\\' : '/');
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathInside(child: string, parent: string, options: PathSecurityOptions = {}): boolean {
    const pathModule = options.pathModule || path;
    const platform = options.platform || process.platform;
    const normalizedParent = normalizeForCompare(pathModule.resolve(parent), platform);
    const normalizedChild = normalizeForCompare(pathModule.resolve(child), platform);

    if (normalizedChild === normalizedParent) return true;

    const relative = pathModule.relative(normalizedParent, normalizedChild);
    return relative.length > 0 && !relative.startsWith('..') && !pathModule.isAbsolute(relative);
}

export function resolveLocalProtocolPath(
    requestUrl: string,
    allowedBase: string,
    options: PathSecurityOptions = {},
): string {
    const fsModule = options.fsModule || fs;
    const pathModule = options.pathModule || path;
    const rawPath = requestUrl.replace(/^local:\/\//, '');
    const decoded = decodeURIComponent(rawPath);
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) {
        throw new Error('Path contains control characters');
    }

    const realAllowedBase = getRealPath(pathModule.resolve(allowedBase), fsModule, 'Allowed base not found');
    const normalized = decoded.replace(/\\/g, '/');
    let logicalTarget: string;

    if (/^\/?[A-Za-z]:\//.test(normalized)) {
        const fileUrlPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
        logicalTarget = fileURLToPath(`file://${fileUrlPath}`);
    } else {
        logicalTarget = pathModule.resolve(realAllowedBase, normalized.replace(/^\/+/, ''));
    }

    const realTarget = getRealPath(logicalTarget, fsModule, 'Path not found');
    if (!isPathInside(realTarget, realAllowedBase, options)) {
        throw new Error('Path outside userData');
    }

    return realTarget;
}
