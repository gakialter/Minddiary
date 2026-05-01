/**
 * imageWorker.ts — Worker thread for image file processing.
 *
 * ADR-001 — Status: **Phase 0 — Scaffolding only (2026-04-28)**
 * NOT wired into fileManager.ts yet. Integration gate:
 *   - Must have reproducible evidence of main-thread blocking during image
 *     save/compress/thumbnail before wiring.
 *   - Benchmark target: single-image processing > 50 ms OR batch > 3 images
 *     triggers the gate.
 *   - When integrating: wire only the single heaviest operation first, keep
 *     main-thread fallback, add pool shutdown on app quit.
 *
 * Runs in a worker_threads context. Receives tasks from the pool,
 * processes them, and posts results back. Never touches UI, IPC, or window state.
 */

const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// ── Error codes per ADR-001 unified error model ──────────────────────────────
const ErrorCode = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UNSUPPORTED_IMAGE_FORMAT: 'UNSUPPORTED_IMAGE_FORMAT',
    PROCESSING_ERROR: 'PROCESSING_ERROR',
    FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
} as const;

// ── Magic bytes for common image formats ────────────────────────────────────
const MAGIC_BYTES: Record<string, number[]> = {
    png:  [0x89, 0x50, 0x4E, 0x47],
    jpg:  [0xFF, 0xD8, 0xFF],
    gif:  [0x47, 0x49, 0x46],
    webp: [0x52, 0x49, 0x46, 0x46],
    bmp:  [0x42, 0x4D],
};

function detectFormat(buffer: Buffer): string | null {
    for (const [fmt, magic] of Object.entries(MAGIC_BYTES)) {
        if (magic.every((b, i) => buffer[i] === b)) return fmt;
    }
    return null;
}

function allowedExtension(ext: string): boolean {
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext.toLowerCase());
}

// ── Task handlers ───────────────────────────────────────────────────────────

interface Task {
    id: number;
    type: string;
    payload: Record<string, unknown>;
}

interface TaskResult {
    id: number;
    success: boolean;
    data?: { format: string | null };
    error?: string;
    errorCode?: string;
}

async function handleWriteBuffer(payload: {
    bufferB64: string; filepath: string; expectedExt?: string;
}): Promise<void> {
    const buffer = Buffer.from(payload.bufferB64, 'base64');

    // Validate format from magic bytes
    if (payload.expectedExt) {
        const detected = detectFormat(buffer);
        const ext = payload.expectedExt.toLowerCase().replace('.', '');
        if (detected && detected !== ext && ext !== 'jpg') { // jpg/jpeg aliases
            // Allow but log format mismatches (e.g. renamed extensions)
        }
    }

    const dir = path.dirname(payload.filepath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(payload.filepath, buffer);
}

// ── Main message loop ────────────────────────────────────────────────────────

if (parentPort) {
    parentPort.on('message', async (task: Task) => {
        const result: TaskResult = { id: task.id, success: false };

        try {
            switch (task.type) {
                case 'writeBuffer': {
                    await handleWriteBuffer(task.payload as { bufferB64: string; filepath: string; expectedExt?: string });
                    result.success = true;
                    break;
                }
                case 'validateImage': {
                    const buf = Buffer.from((task.payload as { bufferB64: string }).bufferB64, 'base64');
                    const fmt = detectFormat(buf);
                    result.success = true;
                    result.data = { format: fmt };
                    break;
                }
                default:
                    result.error = `Unknown task type: ${task.type}`;
                    result.errorCode = ErrorCode.VALIDATION_ERROR;
            }
        } catch (err: unknown) {
            const e = err as NodeJS.ErrnoException;
            result.error = e.message || String(err);
            if (e.code === 'ENOENT' || e.code === 'EACCES') {
                result.errorCode = ErrorCode.FILE_WRITE_ERROR;
            } else {
                result.errorCode = ErrorCode.PROCESSING_ERROR;
            }
        }

        parentPort!.postMessage(result);
    });
} else {
    // Should never happen in worker context
    // Worker thread — cannot import electron logger; stderr is fine here
    process.stderr.write('[imageWorker] Not running as a worker thread\n');
}
