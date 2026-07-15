import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupSmokeDiagnosticProcess,
  runSmokeDiagnosticProcess,
  type SmokeDiagnosticProcessResult,
} from '../helpers/smokeDiagnosticRunner';

const projectRoot = path.resolve(__dirname, '..', '..');

function findPackagedExecutable(): string {
  const executablePath = process.platform === 'win32'
    ? path.join(projectRoot, 'release', 'win-unpacked', 'MindDiary.exe')
    : process.platform === 'darwin'
      ? path.join(projectRoot, 'release', 'mac-arm64', 'MindDiary.app', 'Contents', 'MacOS', 'MindDiary')
      : '';
  if (!executablePath || !fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error(`Packaged diagnostic executable does not exist: ${executablePath || '(unsupported)'}`);
  }
  return executablePath;
}

test('runs the packaged diagnostic harness without exposing secrets or paths', async () => {
  test.skip(process.platform !== 'win32' && process.platform !== 'darwin', 'Packaged diagnostics support Windows and macOS');
  let run: SmokeDiagnosticProcessResult | undefined;
  try {
    run = await runSmokeDiagnosticProcess({
      executablePath: findPackagedExecutable(),
      scenario: 'sqlite-read-write',
      expectedPackaged: true,
    });

    expect(run.result).toMatchObject({
      schemaVersion: 1,
      scenario: 'sqlite-read-write',
      applicationVersion: '1.16.0',
      electronVersion: '42.6.1',
      platform: process.platform,
      arch: process.arch,
      isPackaged: true,
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
