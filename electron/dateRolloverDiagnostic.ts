import { createServer, type Server } from 'node:http';
import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';

const OLD_DATE = '2026-05-31';
const NEW_DATE = '2026-06-01';
const OLD_CANDIDATE_DATE = '2026-06-01';
const NEW_CANDIDATE_DATE = '2026-06-02';
const DIAGNOSTIC_TASK_TITLE = 'MindDiary rollover diagnostic task';
const FAKE_API_KEY = 'minddiary-rollover-fake-key';

export type DateRolloverBusinessSnapshot = {
    entries: number;
    studyTasks: number;
    mistakes: number;
    pomodoroSessions: number;
    attachments: number;
};

export type DateRolloverRequestLog = {
    sequence: number;
    method: 'POST';
    path: '/v1/chat/completions';
    authorizationPresent: boolean;
    reviewDate: string;
    candidateDate: string;
};

export type DateRolloverDiagnosticDetails = {
    schemaVersion: 1;
    oldDate: typeof OLD_DATE;
    newDate: typeof NEW_DATE;
    oldCandidateDate: typeof OLD_CANDIDATE_DATE;
    newCandidateDate: typeof NEW_CANDIDATE_DATE;
    eventSequence: string[];
    mockRequests: DateRolloverRequestLog[];
    database: {
        beforeRollover: DateRolloverBusinessSnapshot;
        afterRollover: DateRolloverBusinessSnapshot;
        afterConfirmedCreate: DateRolloverBusinessSnapshot;
        afterCleanup: DateRolloverBusinessSnapshot;
    };
    businessWrites: {
        duringRollover: number;
        confirmedAfterRollover: number;
    };
    createdTask: {
        plannedDate: string;
        status: string;
        source: string;
    };
    checks: {
        oldDialogOpened: boolean;
        oldCandidateGenerated: boolean;
        oldDialogClosedAtRollover: boolean;
        oldCandidateDetached: boolean;
        oldCandidateMainWriteRejected: boolean;
        rolloverZeroWrite: boolean;
        newDialogOpened: boolean;
        newCandidateGenerated: boolean;
        requestDatesCorrect: boolean;
        confirmedTaskUsesNewCandidateDate: boolean;
        cleanupComplete: boolean;
    };
};

type DateRolloverDatabase = {
    getDb: () => Database.Database;
    setSetting: (key: string, value: unknown) => unknown;
    setAiApiKey: (key: string) => unknown;
};

type RendererStage = {
    events: string[];
    failureStep?: string;
    oldDialogOpened?: boolean;
    oldCandidateGenerated?: boolean;
    oldDialogClosedAtRollover?: boolean;
    oldCandidateDetached?: boolean;
    oldCandidateMainWriteRejected?: boolean;
    newDialogOpened?: boolean;
    newCandidateGenerated?: boolean;
    confirmedCreate?: boolean;
};

function countTable(database: Database.Database, table: string): number {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
}

export function snapshotDateRolloverBusinessState(database: Database.Database): DateRolloverBusinessSnapshot {
    return {
        entries: countTable(database, 'entries'),
        studyTasks: countTable(database, 'study_tasks'),
        mistakes: countTable(database, 'mistakes'),
        pomodoroSessions: countTable(database, 'pomodoro_sessions'),
        attachments: countTable(database, 'attachments'),
    };
}

function totalBusinessRows(snapshot: DateRolloverBusinessSnapshot): number {
    return Object.values(snapshot).reduce((total, value) => total + value, 0);
}

function snapshotsEqual(left: DateRolloverBusinessSnapshot, right: DateRolloverBusinessSnapshot): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function extractPromptDate(content: string, field: 'review_date' | 'candidate_date'): string {
    const match = new RegExp(`"${field}":"(\\d{4}-\\d{2}-\\d{2})"`).exec(content);
    if (!match?.[1]) throw new Error(`Mock AI request is missing ${field}`);
    return match[1];
}

async function readRequestBody(request: import('node:http').IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 64 * 1024) throw new Error('Mock AI request exceeds the diagnostic limit');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function startMockAiServer(requests: DateRolloverRequestLog[]): Promise<{ server: Server; endpoint: string }> {
    const responseContent = JSON.stringify({
        observations: [{
            summary: 'Date rollover diagnostic observation',
            reason: 'Fixed local mock response',
            source_refs: [],
        }],
        candidates: [{
            title: DIAGNOSTIC_TASK_TITLE,
            type: 'custom',
            estimate_minutes: 25,
            reason: 'Fixed local mock candidate',
            priority: 'medium',
            subject_ref: null,
            related_mistake_ref: null,
            related_entry_ref: null,
        }],
    });
    const server = createServer(async (request, response) => {
        try {
            if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
                response.writeHead(404).end();
                return;
            }
            if (request.headers.authorization !== `Bearer ${FAKE_API_KEY}`) {
                response.writeHead(401).end();
                return;
            }
            if (requests.length >= 2) {
                response.writeHead(409).end();
                return;
            }
            const body = JSON.parse(await readRequestBody(request)) as {
                messages?: Array<{ content?: unknown }>;
            };
            const prompt = (body.messages || [])
                .map(message => typeof message.content === 'string' ? message.content : '')
                .join('\n');
            requests.push({
                sequence: requests.length + 1,
                method: 'POST',
                path: '/v1/chat/completions',
                authorizationPresent: true,
                reviewDate: extractPromptDate(prompt, 'review_date'),
                candidateDate: extractPromptDate(prompt, 'candidate_date'),
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
        } catch {
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'invalid diagnostic request' }));
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock AI server did not bind a TCP port');
    return { server, endpoint: `http://127.0.0.1:${address.port}/v1` };
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

async function reloadStartedRenderer(window: BrowserWindow): Promise<void> {
    await window.webContents.executeJavaScript("localStorage.setItem('started', 'true')", true);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            window.webContents.removeListener('did-finish-load', handleLoad);
            reject(new Error('Date rollover renderer reload timed out'));
        }, 30_000);
        const handleLoad = () => {
            clearTimeout(timer);
            resolve();
        };
        window.webContents.once('did-finish-load', handleLoad);
        window.webContents.reload();
    });
}

const INSTALL_CLOCK_AND_OPEN_OLD_DIALOG = `(async () => {
    let step = 'initialize-clock';
    try {
    const waitFor = async (predicate, label) => {
        const started = performance.now();
        while (performance.now() - started < 20000) {
            const value = predicate();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
    };
    const NativeDate = globalThis.Date;
    let nowMs = new NativeDate(2026, 4, 31, 23, 59, 50).getTime();
    class DiagnosticDate extends NativeDate {
        constructor(...args) {
            if (args.length === 0) super(nowMs);
            else super(...args);
        }
        static now() { return nowMs; }
    }
    globalThis.Date = DiagnosticDate;
    const events = ['clock-installed:2026-05-31T23:59:50-local'];
    const probe = globalThis.__mindDiaryDateRolloverProbe = {
        events,
        setNow: value => { nowMs = value; },
        NativeDate,
        oldCreateButton: null,
    };
    step = 'refresh-old-date';
    window.dispatchEvent(new Event('focus'));
    events.push('old-date-focus-refresh');
    step = 'wait-old-dashboard-date';
    await waitFor(() => document.querySelector('[data-testid="today-execution-overview"]')?.textContent?.includes('2026-05-31'), 'old-date Dashboard data');
    step = 'find-old-open-button';
    const open = await waitFor(() => document.querySelector('[data-testid="open-daily-review-agent"]'), 'old-date Daily Review button');
    step = 'open-old-dialog';
    open.click();
    await waitFor(() => document.querySelector('[role="dialog"]'), 'old-date Daily Review dialog');
    events.push('old-dialog-opened');
    step = 'generate-old-candidate';
    const generate = await waitFor(() => {
        const button = document.querySelector('[data-testid="daily-review-generate"]');
        return button && !button.disabled ? button : null;
    }, 'old-date generate button');
    step = 'click-old-generate';
    generate.click();
    step = 'wait-old-candidate';
    await waitFor(() => document.querySelector('[data-testid="daily-review-candidates"]'), 'old-date candidate');
    step = 'verify-old-candidate-date';
    const candidateRegion = document.querySelector('[data-testid="daily-review-candidates"]');
    if (!candidateRegion?.textContent?.includes('2026-06-01')) throw new Error('Old candidate date is incorrect');
    step = 'capture-old-create-button';
    probe.oldCreateButton = await waitFor(() => {
        const button = document.querySelector('[data-testid="daily-review-create-selected"]');
        return button && !button.disabled ? button : null;
    }, 'old-date create button');
    events.push('old-candidate-generated:2026-06-01');
    return { events: [...events], oldDialogOpened: true, oldCandidateGenerated: true };
    } catch {
        return { events: [], failureStep: step };
    }
})()`;

const ROLL_OVER_AND_REJECT_OLD_CANDIDATE = `(async () => {
    const waitFor = async (predicate, label) => {
        const started = performance.now();
        while (performance.now() - started < 20000) {
            const value = predicate();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
    };
    const probe = globalThis.__mindDiaryDateRolloverProbe;
    if (!probe) throw new Error('Date rollover probe is not initialized');
    probe.setNow(new probe.NativeDate(2026, 5, 1, 0, 0, 1).getTime());
    window.dispatchEvent(new Event('focus'));
    probe.events.push('logical-midnight-crossed:2026-06-01T00:00:01-local');
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'old dialog close');
    const detached = Boolean(probe.oldCreateButton && !probe.oldCreateButton.isConnected);
    if (!detached) throw new Error('Old candidate control remained connected after rollover');
    probe.oldCreateButton.click();
    await new Promise(resolve => setTimeout(resolve, 100));
    let oldCandidateMainWriteRejected = false;
    try {
        await globalThis.api.tasks.createForCurrentDate({
            title: 'MindDiary rollover diagnostic task',
            description: 'Fixed stale candidate write probe',
            type: 'custom',
            subject_id: null,
            related_mistake_id: null,
            related_entry_id: null,
            related_chapter_id: null,
            planned_date: '2026-06-01',
            estimate_minutes: 25,
            status: 'todo',
            source: 'ai',
        }, '2026-05-31');
    } catch {
        oldCandidateMainWriteRejected = true;
    }
    if (!oldCandidateMainWriteRejected) throw new Error('Main process accepted the stale old-date candidate');
    await waitFor(() => document.querySelector('[data-testid="today-execution-overview"]')?.textContent?.includes('2026-06-01'), 'new-date Dashboard data');
    await waitFor(() => document.querySelector('[data-testid="open-daily-review-agent"]'), 'new-date Dashboard');
    probe.events.push('old-dialog-closed', 'old-candidate-detached', 'old-candidate-main-write-rejected', 'new-date-dashboard-ready');
    return {
        events: [...probe.events],
        oldDialogClosedAtRollover: true,
        oldCandidateDetached: detached,
        oldCandidateMainWriteRejected,
    };
})()`;

const OPEN_NEW_DIALOG_AND_CREATE = `(async () => {
    const waitFor = async (predicate, label) => {
        const started = performance.now();
        while (performance.now() - started < 20000) {
            const value = predicate();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
    };
    const probe = globalThis.__mindDiaryDateRolloverProbe;
    if (!probe) throw new Error('Date rollover probe is not initialized');
    document.querySelector('[data-testid="open-daily-review-agent"]').click();
    await waitFor(() => document.querySelector('[role="dialog"]'), 'new-date Daily Review dialog');
    probe.events.push('new-dialog-opened');
    const generate = await waitFor(() => {
        const button = document.querySelector('[data-testid="daily-review-generate"]');
        return button && !button.disabled ? button : null;
    }, 'new-date generate button');
    generate.click();
    await waitFor(() => document.querySelector('[data-testid="daily-review-candidates"]'), 'new-date candidate');
    const candidateRegion = document.querySelector('[data-testid="daily-review-candidates"]');
    if (!candidateRegion?.textContent?.includes('2026-06-02')) throw new Error('New candidate date is incorrect');
    probe.events.push('new-candidate-generated:2026-06-02');
    const create = await waitFor(() => {
        const button = document.querySelector('[data-testid="daily-review-create-selected"]');
        return button && !button.disabled ? button : null;
    }, 'new-date create button');
    create.click();
    await waitFor(() => {
        const text = document.querySelector('[data-testid="daily-review-creation-summary"]')?.textContent;
        return text?.includes('本次新创建 1 项')
            && text?.includes('重放确认 0 项')
            && text?.includes('未新建 0 项')
            && text?.includes('结果待检查 0 项');
    }, 'confirmed task creation');
    probe.events.push('new-candidate-confirmed');
    return { events: [...probe.events], newDialogOpened: true, newCandidateGenerated: true, confirmedCreate: true };
})()`;

export function validateDateRolloverDiagnosticDetails(details: DateRolloverDiagnosticDetails): boolean {
    return Object.values(details.checks).every(Boolean)
        && details.businessWrites.duringRollover === 0
        && details.businessWrites.confirmedAfterRollover === 1;
}

export async function runDateRolloverDiagnostic(
    window: BrowserWindow,
    database: DateRolloverDatabase,
    setCurrentDateKey: (dateKey: string | null) => void,
): Promise<DateRolloverDiagnosticDetails> {
    const requests: DateRolloverRequestLog[] = [];
    const { server, endpoint } = await startMockAiServer(requests);
    const connection = database.getDb();
    let createdTaskId: number | null = null;
    let stage = 'configure-local-mock';
    try {
        setCurrentDateKey(OLD_DATE);
        database.setSetting('aiEndpoint', endpoint);
        database.setSetting('aiModel', 'minddiary-rollover-local-mock');
        database.setAiApiKey(FAKE_API_KEY);
        stage = 'reload-production-renderer';
        await reloadStartedRenderer(window);

        stage = 'open-old-dialog';
        const oldStage = await window.webContents.executeJavaScript(INSTALL_CLOCK_AND_OPEN_OLD_DIALOG, true) as RendererStage;
        if (oldStage.failureStep) {
            stage = `open-old-dialog-${oldStage.failureStep}`;
            throw new Error('Old-date renderer stage failed');
        }
        const beforeRollover = snapshotDateRolloverBusinessState(connection);
        stage = 'cross-logical-midnight';
        setCurrentDateKey(NEW_DATE);
        const rolloverStage = await window.webContents.executeJavaScript(ROLL_OVER_AND_REJECT_OLD_CANDIDATE, true) as RendererStage;
        const afterRollover = snapshotDateRolloverBusinessState(connection);
        stage = 'open-new-dialog-and-create';
        const newStage = await window.webContents.executeJavaScript(OPEN_NEW_DIALOG_AND_CREATE, true) as RendererStage;
        stage = 'verify-database';
        const afterConfirmedCreate = snapshotDateRolloverBusinessState(connection);
        const createdTasks = connection.prepare(`
            SELECT id, planned_date AS plannedDate, status, source
            FROM study_tasks
            WHERE title = ?
            ORDER BY id
        `).all(DIAGNOSTIC_TASK_TITLE) as Array<{
            id: number;
            plannedDate: string;
            status: string;
            source: string;
        }>;
        if (createdTasks.length !== 1) throw new Error('Date rollover diagnostic created an unexpected task count');
        createdTaskId = createdTasks[0]!.id;
        const createdTask = {
            plannedDate: createdTasks[0]!.plannedDate,
            status: createdTasks[0]!.status,
            source: createdTasks[0]!.source,
        };
        connection.prepare('DELETE FROM study_tasks WHERE id = ?').run(createdTaskId);
        createdTaskId = null;
        const afterCleanup = snapshotDateRolloverBusinessState(connection);
        const duringRollover = totalBusinessRows(afterRollover) - totalBusinessRows(beforeRollover);
        const confirmedAfterRollover = totalBusinessRows(afterConfirmedCreate) - totalBusinessRows(afterRollover);
        const requestDatesCorrect = requests.length === 2
            && requests.every(request => request.authorizationPresent)
            && requests[0]?.reviewDate === OLD_DATE
            && requests[0]?.candidateDate === OLD_CANDIDATE_DATE
            && requests[1]?.reviewDate === NEW_DATE
            && requests[1]?.candidateDate === NEW_CANDIDATE_DATE;
        const checks = {
            oldDialogOpened: oldStage.oldDialogOpened === true,
            oldCandidateGenerated: oldStage.oldCandidateGenerated === true,
            oldDialogClosedAtRollover: rolloverStage.oldDialogClosedAtRollover === true,
            oldCandidateDetached: rolloverStage.oldCandidateDetached === true,
            oldCandidateMainWriteRejected: rolloverStage.oldCandidateMainWriteRejected === true,
            rolloverZeroWrite: snapshotsEqual(beforeRollover, afterRollover) && duringRollover === 0,
            newDialogOpened: newStage.newDialogOpened === true,
            newCandidateGenerated: newStage.newCandidateGenerated === true,
            requestDatesCorrect,
            confirmedTaskUsesNewCandidateDate: createdTask.plannedDate === NEW_CANDIDATE_DATE
                && createdTask.status === 'todo'
                && createdTask.source === 'ai'
                && confirmedAfterRollover === 1,
            cleanupComplete: snapshotsEqual(beforeRollover, afterCleanup),
        };
        const details: DateRolloverDiagnosticDetails = {
            schemaVersion: 1,
            oldDate: OLD_DATE,
            newDate: NEW_DATE,
            oldCandidateDate: OLD_CANDIDATE_DATE,
            newCandidateDate: NEW_CANDIDATE_DATE,
            eventSequence: newStage.events,
            mockRequests: requests,
            database: { beforeRollover, afterRollover, afterConfirmedCreate, afterCleanup },
            businessWrites: { duringRollover, confirmedAfterRollover },
            createdTask,
            checks,
        };
        if (!validateDateRolloverDiagnosticDetails(details)) {
            throw new Error('Date rollover diagnostic gates did not all pass');
        }
        return details;
    } catch (error) {
        process.stderr.write(`[date-rollover] failed-stage=${stage}\n`);
        throw error;
    } finally {
        setCurrentDateKey(null);
        if (createdTaskId !== null) connection.prepare('DELETE FROM study_tasks WHERE id = ?').run(createdTaskId);
        connection.prepare('DELETE FROM study_tasks WHERE title = ?').run(DIAGNOSTIC_TASK_TITLE);
        connection.prepare("DELETE FROM settings WHERE key IN ('aiEndpoint', 'aiModel', 'aiApiKey')").run();
        await closeServer(server);
    }
}
