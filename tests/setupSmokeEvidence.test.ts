import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SmokeDiagnosticProcessResult } from './helpers/smokeDiagnosticRunner';
import {
  SETUP_EVIDENCE_FILES,
  collectPhysicalInstallTree,
  uninstallCommandTargetsPhysicalFile,
  writeSetupSmokeEvidence,
  type SetupSmokeEvidenceInput,
} from './helpers/setupSmokeEvidence';

const roots: string[] = [];

function makeRun(phase: 'seeded' | 'reopened'): SmokeDiagnosticProcessResult {
  return {
    result: {
      schemaVersion: 1,
      scenario: 'install-profile',
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
      evidence: [{
        check: phase === 'seeded' ? 'installed-profile-seeded' : 'installed-profile-reopened',
        passed: true,
      }],
    },
    profileFilesBeforeRun: phase === 'seeded'
      ? ['.minddiary-smoke-profile']
      : ['.minddiary-smoke-profile', 'minddiary.db', 'attachments/install-smoke.png'],
    profileFiles: ['minddiary.db'],
    profilePath: 'C:\\Users\\private\\profile',
    outputPath: 'C:\\Users\\private\\result.json',
    token: 'secret-token-not-for-evidence',
    outputText: 'private raw output',
  };
}

function makeFixture(): SetupSmokeEvidenceInput {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-setup-evidence-'));
  roots.push(projectRoot);
  const release = path.join(projectRoot, 'release');
  fs.mkdirSync(release);
  const setupPath = path.join(release, 'MindDiary-Setup-1.16.0.exe');
  fs.writeFileSync(setupPath, 'setup-candidate');
  const emptyProcess = { mindDiaryProcessCount: 0 };
  const shortcutAbsent = { desktop: false, startMenu: false };
  const registryEntry = [{
    hive: 'hkcu-native',
    displayNameMatches: true,
    uninstallTargetMatches: true,
    uninstallCommandPresent: true,
    displayVersionMatches: true,
  }];
  return {
    projectRoot,
    setupPath,
    installTree: ['file|MindDiary.exe|42', 'file|resources/app.asar|84'],
    firstInstall: { exitCode: 0, outputText: '' },
    reinstall: { exitCode: 0, outputText: '' },
    uninstall: { exitCode: 0, outputText: '' },
    finalUninstall: { exitCode: 0, outputText: '' },
    shortcuts: {
      before: shortcutAbsent,
      afterInstall: { desktop: true, startMenu: true },
      afterUninstall: shortcutAbsent,
      afterReinstall: { desktop: true, startMenu: true },
      final: shortcutAbsent,
    },
    registry: {
      before: [],
      afterInstall: registryEntry,
      afterUninstall: [],
      afterReinstall: registryEntry,
      final: [],
    },
    processes: {
      before: emptyProcess,
      afterInstall: emptyProcess,
      afterDiagnostic: emptyProcess,
      afterUninstall: emptyProcess,
      final: emptyProcess,
    },
    seededRun: makeRun('seeded'),
    reopenedRun: makeRun('reopened'),
    defaultApplicationData: {
      before: [
        { label: 'roaming-user-data', exists: false, entryCount: 0, metadataSha256: 'a'.repeat(64) },
        { label: 'local-user-data', exists: false, entryCount: 0, metadataSha256: 'b'.repeat(64) },
      ],
      after: [
        { label: 'roaming-user-data', exists: false, entryCount: 0, metadataSha256: 'a'.repeat(64) },
        { label: 'local-user-data', exists: false, entryCount: 0, metadataSha256: 'b'.repeat(64) },
      ],
    },
    deleteAppDataOnUninstall: false,
    installDirectoryRemoved: true,
    finalInstallDirectoryRemoved: true,
    profileRetainedAfterUninstall: true,
    profileReopened: true,
    profileCleaned: true,
  };
}

describe('Windows Setup smoke evidence', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes exactly the bounded nine-file archive without raw paths or secrets', async () => {
    const fixture = makeFixture();
    const evidenceDirectory = await writeSetupSmokeEvidence(fixture);
    expect(fs.readdirSync(evidenceDirectory).sort()).toEqual([...SETUP_EVIDENCE_FILES].sort());
    const archived = SETUP_EVIDENCE_FILES
      .map(name => fs.readFileSync(path.join(evidenceDirectory, name), 'utf8'))
      .join('\n');
    expect(archived).not.toContain(fixture.seededRun.profilePath);
    expect(archived).not.toContain(fixture.seededRun.outputPath);
    expect(archived).not.toContain(fixture.seededRun.token);
    expect(archived).not.toContain(fixture.seededRun.outputText);
    expect(archived).not.toMatch(/[A-Z]:\\Users\\/i);
    expect(archived).toContain('installer-arguments=/S /D=<disposable-install-path>');
    expect(archived).toContain('"configuredDeleteAppDataOnUninstall": false');
    expect(archived).toContain('token-bound-disposable-diagnostic-profile');
  });

  it('refuses to archive a passing result when any required gate is false', async () => {
    const fixture = makeFixture();
    fixture.profileCleaned = false;

    await expect(writeSetupSmokeEvidence(fixture)).rejects.toThrow(/retention-round-trip/);
    expect(fs.existsSync(path.join(
      fixture.projectRoot,
      'test-results',
      'windows-setup-smoke-evidence',
    ))).toBe(false);
  });

  it('refuses a junction evidence directory without touching its target', async () => {
    const fixture = makeFixture();
    const evidenceRoot = path.join(fixture.projectRoot, 'test-results');
    fs.mkdirSync(evidenceRoot);
    const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-setup-evidence-victim-'));
    roots.push(victim);
    fs.writeFileSync(path.join(victim, 'sentinel.txt'), 'keep');
    fs.symlinkSync(victim, path.join(evidenceRoot, 'windows-setup-smoke-evidence'), 'junction');

    await expect(writeSetupSmokeEvidence(fixture)).rejects.toThrow(/physical directory/);
    expect(fs.readFileSync(path.join(victim, 'sentinel.txt'), 'utf8')).toBe('keep');
  });

  it('rejects links in the installed application tree', () => {
    const fixture = makeFixture();
    const installRoot = path.join(fixture.projectRoot, 'installed');
    const outside = path.join(fixture.projectRoot, 'outside');
    fs.mkdirSync(installRoot);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(installRoot, 'linked'), 'junction');
    expect(() => collectPhysicalInstallTree(installRoot)).toThrow(/contains a link/);
  });

  it('binds the uninstall registry command to the installed physical uninstaller', () => {
    const fixture = makeFixture();
    const installRoot = path.join(fixture.projectRoot, 'installed command');
    const otherRoot = path.join(fixture.projectRoot, 'other command');
    fs.mkdirSync(installRoot);
    fs.mkdirSync(otherRoot);
    const uninstaller = path.join(installRoot, 'Uninstall MindDiary.exe');
    const otherUninstaller = path.join(otherRoot, 'Uninstall MindDiary.exe');
    fs.writeFileSync(uninstaller, 'expected uninstaller');
    fs.writeFileSync(otherUninstaller, 'other uninstaller');

    expect(uninstallCommandTargetsPhysicalFile(installRoot, `"${uninstaller}" /currentuser`)).toBe(true);
    expect(uninstallCommandTargetsPhysicalFile(installRoot, `"${otherUninstaller}" /currentuser`)).toBe(false);
    expect(uninstallCommandTargetsPhysicalFile(installRoot, `${uninstaller} /currentuser`)).toBe(false);
  });
});
