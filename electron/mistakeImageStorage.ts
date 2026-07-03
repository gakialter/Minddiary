import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { fileURLToPath } from 'url';
import { resolveManagedDeletionTarget } from './pathSecurity';

function getMistakeImagesDir(): string {
    return path.join(app.getPath('userData'), 'mistake_images');
}

export function getManagedMistakeImagePath(urlPathname: string): string | null {
    const baseDir = getMistakeImagesDir();
    const normalized = urlPathname.replace(/^local:\/\//, '').replace(/\\/g, '/');
    const decoded = decodeURIComponent(normalized);
    let filepath: string;
    if (/^\/?[A-Za-z]:\//.test(decoded)) {
        const fileUrlPath = decoded.startsWith('/') ? decoded : `/${decoded}`;
        filepath = fileURLToPath(`file://${fileUrlPath}`);
    } else if (decoded.startsWith('mistake_images/')) {
        filepath = path.resolve(app.getPath('userData'), decoded);
    } else {
        filepath = path.resolve(baseDir, decoded.replace(/^\/+/, ''));
    }
    const relative = path.relative(baseDir, filepath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }
    return filepath;
}

export function getMistakeImageReferenceKey(urlPathname: string): string | null {
    try {
        const filepath = getManagedMistakeImagePath(urlPathname);
        if (!filepath) return null;
        const relative = path.relative(getMistakeImagesDir(), filepath).replace(/\\/g, '/');
        return process.platform === 'win32' ? relative.toLowerCase() : relative;
    } catch {
        return null;
    }
}

export async function deleteManagedMistakeImage(urlPathname: string): Promise<void> {
    const filepath = getManagedMistakeImagePath(urlPathname);
    if (!filepath) {
        throw { code: 'PATH_TRAVERSAL', message: 'Invalid image path' };
    }

    let deletionTarget: string | null;
    try {
        deletionTarget = await resolveManagedDeletionTarget(getMistakeImagesDir(), filepath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'PATH_TRAVERSAL') {
            throw { code: 'PATH_TRAVERSAL', message: 'Invalid image path' };
        }
        throw error;
    }

    if (!deletionTarget) return;
    await fs.promises.unlink(deletionTarget).catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
}
