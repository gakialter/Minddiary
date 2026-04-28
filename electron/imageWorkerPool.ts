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

const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const DEFAULT_POOL_SIZE = 2;
const TASK_TIMEOUT_MS = 30_000;

interface PoolWorker {
    worker: any; // Worker
    busy: boolean;
    id: number;
}

interface PendingTask {
    id: number;
    type: string;
    payload: any;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
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
    const worker = new Worker(getWorkerScript());
    const poolWorker: PoolWorker = { worker, busy: false, id };

    worker.on('message', (result: any) => {
        poolWorker.busy = false;
        // Find the pending task that matches this result
        const idx = pending.findIndex(t => t.id === result.id);
        if (idx === -1) return;
        const task = pending.splice(idx, 1)[0];
        clearTimeout(task.timer);

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
        console.error(`[imageWorkerPool] Worker ${id} error:`, err.message);
        // Replace crashed worker
        poolWorker.busy = false;
        const idx = workers.indexOf(poolWorker);
        if (idx !== -1) {
            workers.splice(idx, 1);
            spawnWorker(id);
        }
        flushPending();
    });

    workers.push(poolWorker);
}

function findFreeWorker(): PoolWorker | null {
    return workers.find(w => !w.busy) || null;
}

function flushPending(): void {
    while (pending.length > 0) {
        const free = findFreeWorker();
        if (!free) break;
        const task = pending.shift()!;
        dispatchTask(free, task);
    }
}

function dispatchTask(poolWorker: PoolWorker, task: PendingTask): void {
    poolWorker.busy = true;
    poolWorker.worker.postMessage({ id: task.id, type: task.type, payload: task.payload });
}

function submit(type: string, payload: any): Promise<any> {
    const id = nextTaskId++;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Task timed out — remove from pending
            const idx = pending.findIndex(t => t.id === id);
            if (idx !== -1) {
                pending.splice(idx, 1);
                reject({ code: 'WORKER_TERMINATED', message: `Task ${type} timed out after ${TASK_TIMEOUT_MS}ms` });
            }
        }, TASK_TIMEOUT_MS);

        const task: PendingTask = { id, type, payload, resolve, reject, timer };

        const free = findFreeWorker();
        if (free) {
            dispatchTask(free, task);
        } else {
            pending.push(task);
        }
    });
}

function shutdown(): void {
    for (const pw of workers) {
        try { pw.worker.terminate(); } catch { /* ignore */ }
    }
    workers = [];
    pending = [];
    initialized = false;
}

module.exports = { initialize, submit, shutdown };
