import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DATE_ROLLOVER_EVIDENCE_FILES,
  writeDateRolloverEvidence,
} from './helpers/dateRolloverEvidence';
import type { SmokeDiagnosticResult } from '../electron/smokeDiagnostics';

const roots: string[] = [];

function makeResult(): SmokeDiagnosticResult {
  const empty = { entries: 0, studyTasks: 0, mistakes: 0, pomodoroSessions: 0, attachments: 0 };
  return {
    schemaVersion: 1,
    scenario: 'date-rollover',
    applicationVersion: '1.16.0',
    electronVersion: '42.6.1',
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    sandbox: true,
    contextIsolation: true,
    preloadAvailable: true,
    nativeSqlite: { loaded: true, query: 1, sqliteVersion: '3.53.2' },
    result: 'passed',
    evidence: [{ check: 'date-rollover-zero-business-write', passed: true }],
    dateRollover: {
      schemaVersion: 1,
      oldDate: '2026-05-31',
      newDate: '2026-06-01',
      oldCandidateDate: '2026-06-01',
      newCandidateDate: '2026-06-02',
      eventSequence: ['old-dialog-opened', 'old-dialog-closed', 'new-dialog-opened'],
      mockRequests: [
        { sequence: 1, method: 'POST', path: '/v1/chat/completions', authorizationPresent: true, reviewDate: '2026-05-31', candidateDate: '2026-06-01' },
        { sequence: 2, method: 'POST', path: '/v1/chat/completions', authorizationPresent: true, reviewDate: '2026-06-01', candidateDate: '2026-06-02' },
      ],
      database: {
        beforeRollover: empty,
        afterRollover: empty,
        afterConfirmedCreate: { ...empty, studyTasks: 1 },
        afterCleanup: empty,
      },
      businessWrites: { duringRollover: 0, confirmedAfterRollover: 1 },
      createdTask: { plannedDate: '2026-06-02', status: 'todo', source: 'ai' },
      checks: {
        oldDialogOpened: true,
        oldCandidateGenerated: true,
        oldDialogClosedAtRollover: true,
        oldCandidateDetached: true,
        oldCandidateMainWriteRejected: true,
        rolloverZeroWrite: true,
        newDialogOpened: true,
        newCandidateGenerated: true,
        requestDatesCorrect: true,
        confirmedTaskUsesNewCandidateDate: true,
        cleanupComplete: true,
      },
    },
  };
}

function makeProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-rollover-evidence-test-'));
  roots.push(root);
  return root;
}

describe('date rollover evidence', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes only the bounded five-file evidence set', () => {
    const projectRoot = makeProjectRoot();
    const evidenceDirectory = writeDateRolloverEvidence({ result: makeResult(), projectRoot });

    expect(fs.readdirSync(evidenceDirectory).sort()).toEqual([...DATE_ROLLOVER_EVIDENCE_FILES]);
    const requestLog = fs.readFileSync(path.join(evidenceDirectory, 'mock-request-log.json'), 'utf8');
    expect(requestLog).toContain('"rawBodiesArchived": false');
    expect(requestLog).toContain('"apiKeyArchived": false');
    expect(requestLog).not.toContain('minddiary-rollover-fake-key');
    expect(fs.readFileSync(path.join(evidenceDirectory, 'business-write-count.txt'), 'utf8')).toContain('during-rollover=0');
  });

  it('fails closed for an incomplete gate or unexpected evidence path', () => {
    const projectRoot = makeProjectRoot();
    const failed = makeResult();
    failed.dateRollover!.checks.rolloverZeroWrite = false;
    expect(() => writeDateRolloverEvidence({ result: failed, projectRoot })).toThrow(/failed or incomplete/);

    expect(() => writeDateRolloverEvidence({
      result: makeResult(),
      projectRoot,
      evidenceDirectory: path.join(projectRoot, 'unexpected'),
    })).toThrow(/Unexpected date rollover evidence directory/);
  });

  it('does not delete an unexpected file from the evidence directory', () => {
    const projectRoot = makeProjectRoot();
    const evidenceDirectory = writeDateRolloverEvidence({ result: makeResult(), projectRoot });
    const unexpectedPath = path.join(evidenceDirectory, 'keep-me.txt');
    fs.writeFileSync(unexpectedPath, 'unrelated evidence');

    expect(() => writeDateRolloverEvidence({ result: makeResult(), projectRoot }))
      .toThrow(/unexpected entry/);
    expect(fs.readFileSync(unexpectedPath, 'utf8')).toBe('unrelated evidence');
  });
});
