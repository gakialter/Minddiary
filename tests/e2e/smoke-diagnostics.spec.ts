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

test.describe.configure({ timeout: 60_000 });

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
