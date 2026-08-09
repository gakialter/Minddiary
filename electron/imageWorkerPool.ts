/**
 * imageWorkerPool.ts — Fixed-size thread pool for image processing.
 *
 * ADR-001 — Status: **Phase 0 — Scaffolding only (2026-04-28)**
 * Not yet used by fileManager.ts. See integration gate in imageWorker.ts.
 *
 * Uses worker_threads with a bounded pool (default 2 workers).
 * Main thread only orchestrates: validates args, normalises paths,
 * dispatches tasks, and confirms final disk state.
 */

import type { Worker as NodeWorker } from 'worker_threads';

const { Worker: NodeWorkerCtor } = require('worker_threads') as { Worker: typeof NodeWorker };
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

const DEFAULT_POOL_SIZE = 2;
const TASK_TIMEOUT_MS = 30_000;
const MAX_REPLACEMENT_ATTEMPTS = 2;

// ── Worker task payload/result shapes ───────────────────────────────────────
interface WriteBufferPayload {
    bufferB64: string;
    filepath: string;
    expectedExt?: string;
}

interface ValidateImagePayload {
    bufferB64: string;
}

type TaskPayload = WriteBufferPayload | ValidateImagePayload;

interface WorkerResult {
    id: number;
    success: boolean;
    data?: { format: string | null };
    error?: string;
    errorCode?: string;
}

interface WorkerError {
    code: string;
    message: string;
}

// ── Pool internals ──────────────────────────────────────────────────────────
interface PoolWorker {
    worker: NodeWorker;
    busy: boolean;
    retired: boolean;
    id: number;
    currentTaskId?: number;
}

interface PendingTask {
    id: number;
    type: string;
    payload: TaskPayload;
    resolve: (value: WorkerResult['data']) => void;
    reject: (reason: WorkerError) => void;
    timer: ReturnType<typeof setTimeout>;
    dispatched: boolean;
}

let workers: PoolWorker[] = [];
let pending: PendingTask[] = [];
let nextTaskId = 0;
let initialized = false;
let poolSize = DEFAULT_POOL_SIZE;

function getWorkerScript(): string {
    // In production the compiled worker is next to this file
    return path.join(__dirname, 'imageWorker.js');
}

function initialize(size?: number): void {
    if (initialized) return;
    poolSize = size || Math.min(4, Math.max(2, os.cpus().length - 1));
    for (let i = 0; i < poolSize; i++) {
        spawnWorker(i);
    }
    initialized = true;
}

function spawnWorker(id: number): void {
    const worker = new NodeWorkerCtor(getWorkerScript());
    const poolWorker: PoolWorker = { worker, busy: false, retired: false, id };

    worker.on('message', (result: WorkerResult) => {
        if (poolWorker.retired || poolWorker.currentTaskId !== result.id) return;
        // Find the pending task that matches this result
        const idx = pending.findIndex(t => t.id === result.id);
        if (idx === -1) return;
        const task = pending.splice(idx, 1)[0]!;
        clearTimeout(task.timer);
        poolWorker.busy = false;
        poolWorker.currentTaskId = undefined;

        if (result.success) {
            task.resolve(result.data);
        } else {
            task.reject({
                code: result.errorCode || 'PROCESSING_ERROR',
                message: result.error || 'Unknown worker error',
            });
        }
        flushPending();
    });

    worker.on('error', (err: Error) => {
        if (poolWorker.retired) return;
        logger.error(`[imageWorkerPool] Worker ${id} error:`, err.message);
        rejectCurrentTask(poolWorker, err.message);
        if (retireWorker(poolWorker, true)) {
            replaceWorker(id);
            flushPending();
        }
    });

    worker.on('exit', (code: number) => {
        if (poolWorker.retired) return;
        const message = `Worker exited with code ${code}`;
        logger.error(`[imageWorkerPool] Worker ${id} exited:`, message);
        rejectCurrentTask(poolWorker, message);
        if (retireWorker(poolWorker, false)) {
            replaceWorker(id);
            flushPending();
        }
    });

    workers.push(poolWorker);
}

function rejectCurrentTask(poolWorker: PoolWorker, message: string): void {
    if (poolWorker.currentTaskId === undefined) return;
    const taskIndex = pending.findIndex(t => t.id === poolWorker.currentTaskId);
    if (taskIndex === -1) return;
    const task = pending.splice(taskIndex, 1)[0]!;
    clearTimeout(task.timer);
    task.reject({ code: 'WORKER_TERMINATED', message });
}

function terminateWorker(poolWorker: PoolWorker): void {
    try {
        void poolWorker.worker.terminate().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[imageWorkerPool] Worker ${poolWorker.id} termination failed:`, message);
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[imageWorkerPool] Worker ${poolWorker.id} termination failed:`, message);
    }
}

function retireWorker(poolWorker: PoolWorker, shouldTerminate: boolean): boolean {
    if (poolWorker.retired) return false;
    const idx = workers.indexOf(poolWorker);
    if (idx === -1) return false;

    poolWorker.retired = true;
    poolWorker.busy = true;
    poolWorker.currentTaskId = undefined;
    workers.splice(idx, 1);

    if (shouldTerminate) terminateWorker(poolWorker);
    return true;
}

function replaceWorker(id: number): void {
    if (!initialized) return;

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_REPLACEMENT_ATTEMPTS; attempt += 1) {
        try {
            spawnWorker(id);
            return;
        } catch (err) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            logger.error(
                `[imageWorkerPool] Worker ${id} replacement attempt ${attempt}/${MAX_REPLACEMENT_ATTEMPTS} failed:`,
                message,
            );
        }
    }

    if (workers.length === 0) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        failUndispatchedTasks(`Worker pool replacement failed: ${message}`);
    }
}

function replenishOneMissingWorker(): void {
    if (!initialized || workers.length >= poolSize) return;

    const activeIds = new Set(workers.map(worker => worker.id));
    for (let id = 0; id < poolSize; id += 1) {
        if (!activeIds.has(id)) {
            replaceWorker(id);
            return;
        }
    }
}

function failUndispatchedTasks(message: string): void {
    const queued = pending.filter(task => !task.dispatched);
    pending = pending.filter(task => task.dispatched);
    for (const task of queued) {
        clearTimeout(task.timer);
        task.reject({ code: 'WORKER_TERMINATED', message });
    }
}

function findFreeWorker(): PoolWorker | null {
    return workers.find(w => !w.busy) || null;
}

function flushPending(): void {
    while (pending.some(task => !task.dispatched)) {
        const free = findFreeWorker();
        if (!free) break;
        const task = pending.find(t => !t.dispatched)!;
        dispatchTask(free, task);
    }
}

function dispatchTask(poolWorker: PoolWorker, task: PendingTask): void {
    poolWorker.busy = true;
    poolWorker.currentTaskId = task.id;
    task.dispatched = true;
    poolWorker.worker.postMessage({ id: task.id, type: task.type, payload: task.payload });
}

function submit(type: string, payload: TaskPayload): Promise<WorkerResult['data']> {
    const id = nextTaskId++;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Task timed out — remove from pending
            const idx = pending.findIndex(t => t.id === id);
            if (idx !== -1) {
                const task = pending.splice(idx, 1)[0]!;
                clearTimeout(task.timer);
                let retiredWorkerId: number | undefined;
                if (task.dispatched) {
                    const worker = workers.find(w => w.currentTaskId === id);
                    if (worker && retireWorker(worker, true)) {
                        retiredWorkerId = worker.id;
                    }
                }
                task.reject({ code: 'WORKER_TERMINATED', message: `Task ${type} timed out after ${TASK_TIMEOUT_MS}ms` });
                if (retiredWorkerId !== undefined) replaceWorker(retiredWorkerId);
                flushPending();
            }
        }, TASK_TIMEOUT_MS);

        const task: PendingTask = { id, type, payload, resolve, reject, timer, dispatched: false };
        pending.push(task);

        replenishOneMissingWorker();

        const free = findFreeWorker();
        if (free) {
            dispatchTask(free, task);
        }
    });
}

function shutdown(): void {
    for (const task of pending) {
        clearTimeout(task.timer);
    }
    pending = [];
    initialized = false;
    for (const pw of [...workers]) {
        retireWorker(pw, true);
    }
}

module.exports = { initialize, submit, shutdown };
