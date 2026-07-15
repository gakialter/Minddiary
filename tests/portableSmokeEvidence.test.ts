import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PORTABLE_EVIDENCE_FILES,
  snapshotApplicationDataDirectories,
  writePortableSmokeEvidence,
  type DefaultApplicationDataSnapshot,
} from './helpers/portableSmokeEvidence';
import type { SmokeDiagnosticProcessResult } from './helpers/smokeDiagnosticRunner';

const roots: string[] = [];

function makeFixture(): {
  projectRoot: string;
  executablePath: string;
  run: SmokeDiagnosticProcessResult;
  snapshot: DefaultApplicationDataSnapshot;
} {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-portable-evidence-test-'));
  roots.push(projectRoot);
  const executablePath = path.join(projectRoot, 'MindDiary-Portable-1.16.0.exe');
  fs.writeFileSync(executablePath, 'portable-fixture');
  const run: SmokeDiagnosticProcessResult = {
    result: {
      schemaVersion: 1,
      scenario: 'portable-profile',
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
      evidence: [{ check: 'portable-wrapper', passed: true }],
    },
    profileFiles: ['minddiary.db'],
    profilePath: 'private-profile-path',
    outputPath: 'private-output-path',
    token: 'private-token',
    outputText: '',
  };
  const snapshot: DefaultApplicationDataSnapshot = [
    { label: 'roaming-user-data', exists: true, entryCount: 42, metadataSha256: 'a'.repeat(64) },
    { label: 'local-user-data', exists: false, entryCount: 0, metadataSha256: 'b'.repeat(64) },
  ];
  return { projectRoot, executablePath, run, snapshot };
}

describe('Portable smoke evidence archive', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('archives only bounded conclusions, not real path metadata fingerprints', async () => {
    const fixture = makeFixture();
    const evidenceDirectory = await writePortableSmokeEvidence({
      projectRoot: fixture.projectRoot,
      executablePath: fixture.executablePath,
      run: fixture.run,
      before: fixture.snapshot,
      after: fixture.snapshot,
    });

    expect(fs.readdirSync(evidenceDirectory).sort()).toEqual([...PORTABLE_EVIDENCE_FILES].sort());
    const archivedText = PORTABLE_EVIDENCE_FILES
      .map(name => fs.readFileSync(path.join(evidenceDirectory, name), 'utf8'))
      .join('\n');
    expect(archivedText).not.toContain('entry-count=');
    expect(archivedText).not.toContain('metadata-sha256=');
    expect(archivedText).not.toContain('a'.repeat(64));
    expect(archivedText).not.toContain('private-profile-path');
    expect(archivedText).toContain('comparison=unchanged');
  });

  it('refuses an evidence junction without deleting its target', async () => {
    const fixture = makeFixture();
    const evidenceRoot = path.join(fixture.projectRoot, 'test-results');
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-portable-evidence-victim-'));
    roots.push(victim);
    fs.mkdirSync(evidenceRoot);
    const evidencePath = path.join(evidenceRoot, 'windows-portable-smoke-evidence');
    fs.symlinkSync(victim, evidencePath, 'junction');
    const sentinel = path.join(victim, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'keep');

    await expect(writePortableSmokeEvidence({
      projectRoot: fixture.projectRoot,
      executablePath: fixture.executablePath,
      run: fixture.run,
      before: fixture.snapshot,
      after: fixture.snapshot,
    })).rejects.toThrow(/physical directory/);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
  });

  it('detects metadata changes on the application data root itself', () => {
    const fixture = makeFixture();
    const applicationDataRoot = path.join(fixture.projectRoot, 'default-user-data');
    fs.mkdirSync(applicationDataRoot);
    const locations = [{ label: 'roaming-user-data' as const, root: applicationDataRoot }];
    const before = snapshotApplicationDataDirectories(locations);
    const transient = path.join(applicationDataRoot, 'transient-file');
    fs.writeFileSync(transient, 'temporary');
    fs.unlinkSync(transient);
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(applicationDataRoot, future, future);

    const after = snapshotApplicationDataDirectories(locations);

    expect(after).not.toEqual(before);
  });
});
