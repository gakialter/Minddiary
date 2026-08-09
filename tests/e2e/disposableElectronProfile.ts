import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const profileRemovalMaxAttempts = 4;
const profileRemovalRetryDelayMs = 100;
const transientWindowsRemovalErrors = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
const profilePrefixPattern = /^minddiary-[a-z0-9]+(?:-[a-z0-9]+)*-e2e-$/;
const createdDisposableProfiles = new Set<string>();

function normalizeForComparison(target: string): string {
    return process.platform === 'win32' ? target.toLowerCase() : target;
}

function getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
}

function assertDisposableProfilePath(profilePath: string, prefix: string): void {
    if (!profilePrefixPattern.test(prefix)) {
        throw new Error(`Refusing unsafe Electron profile prefix: ${prefix}`);
    }

    const resolvedProfile = path.resolve(profilePath);
    const resolvedTemp = realpathSync(tmpdir());
    if (
        normalizeForComparison(path.dirname(resolvedProfile)) !== normalizeForComparison(resolvedTemp)
        || !path.basename(resolvedProfile).startsWith(prefix)
    ) {
        throw new Error(`Refusing to remove non-disposable Electron profile: ${resolvedProfile}`);
    }

    if (!existsSync(resolvedProfile)) return;
    const profileStat = lstatSync(resolvedProfile);
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) {
        throw new Error(`Disposable Electron profile is not a physical directory: ${resolvedProfile}`);
    }
    const physicalProfile = realpathSync(resolvedProfile);
    if (normalizeForComparison(physicalProfile) !== normalizeForComparison(resolvedProfile)) {
        throw new Error(`Disposable Electron profile resolves outside its created path: ${resolvedProfile}`);
    }
}

export function createDisposableElectronProfile(prefix: string): string {
    if (!profilePrefixPattern.test(prefix)) {
        throw new Error(`Refusing unsafe Electron profile prefix: ${prefix}`);
    }
    const profilePath = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
    assertDisposableProfilePath(profilePath, prefix);
    createdDisposableProfiles.add(normalizeForComparison(profilePath));
    return profilePath;
}

export async function removeDisposableElectronProfile(
    profilePath: string,
    prefix: string,
): Promise<void> {
    assertDisposableProfilePath(profilePath, prefix);
    const profileKey = normalizeForComparison(path.resolve(profilePath));
    if (!createdDisposableProfiles.has(profileKey)) {
        throw new Error(`Refusing to remove an Electron profile not created by this process: ${profilePath}`);
    }
    for (let attempt = 1; attempt <= profileRemovalMaxAttempts; attempt += 1) {
        try {
            assertDisposableProfilePath(profilePath, prefix);
            rmSync(profilePath, { recursive: true, force: true });
            createdDisposableProfiles.delete(profileKey);
            return;
        } catch (error) {
            const retryable = process.platform === 'win32'
                && transientWindowsRemovalErrors.has(getErrorCode(error) || '')
                && attempt < profileRemovalMaxAttempts;
            if (!retryable) throw error;
            await new Promise(resolve => setTimeout(resolve, profileRemovalRetryDelayMs * attempt));
        }
    }
}
