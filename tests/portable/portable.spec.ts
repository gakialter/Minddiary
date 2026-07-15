import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  PORTABLE_EVIDENCE_FILES,
  snapshotDefaultApplicationData,
  writePortableSmokeEvidence,
} from '../helpers/portableSmokeEvidence';
import {
  cleanupSmokeDiagnosticProcess,
  runSmokeDiagnosticProcess,
  type SmokeDiagnosticProcessResult,
} from '../helpers/smokeDiagnosticRunner';

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string };

function findPortableExecutable(): string {
  const expectedName = `MindDiary-Portable-${packageJson.version}.exe`;
  const executablePath = path.join(projectRoot, 'release', expectedName);
  const stat = fs.lstatSync(executablePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('Expected a physical Windows Portable executable');
  }
  return executablePath;
}

async function sha256File(filepath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filepath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

test('runs the real Windows Portable wrapper with bounded archived evidence', async () => {
  test.skip(process.platform !== 'win32', 'Windows Portable smoke requires Windows');
  const executablePath = findPortableExecutable();
  const before = snapshotDefaultApplicationData();
  let run: SmokeDiagnosticProcessResult | undefined;
  try {
    run = await runSmokeDiagnosticProcess({
      executablePath,
      scenario: 'portable-profile',
      expectedPackaged: true,
      timeoutMs: 90_000,
    });
    const after = snapshotDefaultApplicationData();

    expect(run.result).toMatchObject({
      schemaVersion: 1,
      scenario: 'portable-profile',
      applicationVersion: packageJson.version,
      electronVersion: '42.6.1',
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      result: 'passed',
      nativeSqlite: { loaded: true, query: 1 },
    });
    expect(run.result.evidence).toEqual(expect.arrayContaining([
      { check: 'portable-wrapper', passed: true },
      { check: 'profile-data-create', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'profile-data-cleanup', passed: true },
    ]));
    expect(run.profileFiles).toContain('minddiary.db');
    expect(run.profileFiles.some(filepath => filepath.endsWith('.png'))).toBe(false);
    expect(after).toEqual(before);

    const evidenceDirectory = await writePortableSmokeEvidence({
      projectRoot,
      executablePath,
      run,
      before,
      after,
    });
    expect(fs.readdirSync(evidenceDirectory).sort()).toEqual([...PORTABLE_EVIDENCE_FILES].sort());

    const archivedText = PORTABLE_EVIDENCE_FILES
      .map(name => fs.readFileSync(path.join(evidenceDirectory, name), 'utf8'))
      .join('\n');
    for (const secret of [
      run.profilePath,
      run.outputPath,
      run.token,
      process.env.USERPROFILE,
      process.env.APPDATA,
      process.env.LOCALAPPDATA,
    ]) {
      if (secret) expect(archivedText).not.toContain(secret);
    }
    expect(archivedText).not.toMatch(/[A-Z]:\\Users\\/i);
    expect(archivedText).not.toContain('entry-count=');
    expect(archivedText).not.toContain('metadata-sha256=');

    const hashLines = fs.readFileSync(path.join(evidenceDirectory, 'hashes.txt'), 'utf8').trim().split('\n');
    const expectedHashNames = [
      path.basename(executablePath),
      ...PORTABLE_EVIDENCE_FILES.filter(name => name !== 'hashes.txt'),
    ];
    expect(hashLines).toHaveLength(expectedHashNames.length);
    for (const [index, line] of hashLines.entries()) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      expect(match?.[2]).toBe(expectedHashNames[index]);
      const target = index === 0
        ? executablePath
        : path.join(evidenceDirectory, expectedHashNames[index] as string);
      expect(match?.[1]).toBe(await sha256File(target));
    }
  } finally {
    if (run) cleanupSmokeDiagnosticProcess(run);
  }
});
