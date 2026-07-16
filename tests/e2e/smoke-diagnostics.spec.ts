import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupRejectedSmokeDiagnosticProcess,
  cleanupSmokeDiagnosticProcess,
  runRejectedSmokeDiagnosticProcess,
  runSmokeDiagnosticProcess,
  type RejectedSmokeDiagnosticProcessResult,
  type SmokeDiagnosticProcessResult,
} from '../helpers/smokeDiagnosticRunner';

const electronPath = require('electron') as string;
const projectRoot = path.resolve(__dirname, '..', '..');

test.describe.configure({ timeout: 120_000 });

test('runs the source-tree diagnostic harness against a disposable profile', async () => {
  let run: SmokeDiagnosticProcessResult | undefined;
  try {
    run = await runSmokeDiagnosticProcess({
      executablePath: electronPath,
      leadingArgs: [projectRoot],
      scenario: 'sqlite-read-write',
      expectedPackaged: false,
    });

    expect(run.result).toMatchObject({
      schemaVersion: 1,
      scenario: 'sqlite-read-write',
      applicationVersion: '1.16.0',
      electronVersion: '42.6.1',
      isPackaged: false,
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      result: 'passed',
      nativeSqlite: { loaded: true, query: 1 },
    });
    expect(run.profileFiles).toContain('minddiary.db');
    expect(run.result.evidence).toContainEqual({ check: 'production-renderer-document', passed: true });
    const serialized = JSON.stringify(run.result);
    expect(serialized).not.toContain(run.profilePath);
    expect(serialized).not.toContain(run.outputPath);
    expect(serialized).not.toContain(run.token);
    expect(run.outputText).not.toContain(run.profilePath);
    expect(run.outputText).not.toContain(run.outputPath);
    expect(run.outputText).not.toContain(run.token);
  } finally {
    if (run) cleanupSmokeDiagnosticProcess(run);
  }
});

test('rejects incomplete diagnostic activation without opening normal mode', async () => {
  let run: RejectedSmokeDiagnosticProcessResult | undefined;
  try {
    run = await runRejectedSmokeDiagnosticProcess({
      executablePath: electronPath,
      leadingArgs: [projectRoot],
    });
    expect(run.exitCode).toBe(2);
    expect(run.outputExists).toBe(false);
    expect(run.outputText).toContain('[smoke-diagnostic] Invalid diagnostic configuration');
    expect(run.outputText).not.toContain(run.profilePath);
    expect(run.outputText).not.toContain(run.outputPath);
    expect(run.profileFiles).not.toContain('minddiary.db');
  } finally {
    if (run) cleanupRejectedSmokeDiagnosticProcess(run);
  }
});

test('runs the source-tree local-date rollover through the production renderer and IPC boundary', async () => {
  let run: SmokeDiagnosticProcessResult | undefined;
  try {
    run = await runSmokeDiagnosticProcess({
      executablePath: electronPath,
      leadingArgs: [projectRoot],
      scenario: 'date-rollover',
      expectedPackaged: false,
      timeoutMs: 90_000,
    });

    expect(run.result.result).toBe('passed');
    expect(run.result.dateRollover).toMatchObject({
      oldDate: '2026-05-31',
      newDate: '2026-06-01',
      oldCandidateDate: '2026-06-01',
      newCandidateDate: '2026-06-02',
      businessWrites: { duringRollover: 0, confirmedAfterRollover: 1 },
      createdTask: { plannedDate: '2026-06-02', status: 'todo', source: 'ai' },
      checks: {
        oldDialogClosedAtRollover: true,
        oldCandidateDetached: true,
        oldCandidateMainWriteRejected: true,
        rolloverZeroWrite: true,
        requestDatesCorrect: true,
        confirmedTaskUsesNewCandidateDate: true,
        cleanupComplete: true,
      },
    });
    expect(run.result.dateRollover?.mockRequests).toEqual([
      expect.objectContaining({ sequence: 1, reviewDate: '2026-05-31', candidateDate: '2026-06-01', authorizationPresent: true }),
      expect.objectContaining({ sequence: 2, reviewDate: '2026-06-01', candidateDate: '2026-06-02', authorizationPresent: true }),
    ]);
    expect(JSON.stringify(run.result)).not.toContain(run.token);
    expect(JSON.stringify(run.result)).not.toContain(run.profilePath);
  } finally {
    if (run) cleanupSmokeDiagnosticProcess(run);
  }
});
