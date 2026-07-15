import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupSmokeDiagnosticProcess,
  rerunSmokeDiagnosticProcess,
  runSmokeDiagnosticProcess,
  type SmokeDiagnosticProcessResult,
} from '../helpers/smokeDiagnosticRunner';
import { snapshotDefaultApplicationData } from '../helpers/portableSmokeEvidence';
import {
  SETUP_EVIDENCE_FILES,
  collectPhysicalInstallTree,
  createDisposableInstallPath,
  findSetupExecutable,
  runSetupProcess,
  snapshotMindDiaryProcesses,
  snapshotShortcuts,
  snapshotUninstallRegistry,
  waitForCondition,
  writeSetupSmokeEvidence,
  type SetupProcessResult,
} from '../helpers/setupSmokeEvidence';

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  version: string;
  build: { nsis: { deleteAppDataOnUninstall: false } };
};

function assertPhysicalFile(filepath: string, label: string): void {
  const stat = fs.lstatSync(filepath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${label} must be a physical file`);
  }
}

async function waitForInstalledFiles(installPath: string): Promise<{ executable: string; uninstaller: string }> {
  const executable = path.join(installPath, 'MindDiary.exe');
  const uninstaller = path.join(installPath, 'Uninstall MindDiary.exe');
  await waitForCondition(
    () => fs.existsSync(executable) && fs.existsSync(uninstaller),
    'installed executable and uninstaller',
  );
  assertPhysicalFile(executable, 'Installed executable');
  assertPhysicalFile(uninstaller, 'Uninstaller');
  return { executable, uninstaller };
}

async function uninstallAndWait(uninstaller: string, installPath: string, label: string): Promise<SetupProcessResult> {
  const result = await runSetupProcess(uninstaller, ['/S'], label);
  expect(result.exitCode).toBe(0);
  await waitForCondition(() => !fs.existsSync(installPath), `${label} installation-directory removal`);
  return result;
}

async function waitForUninstallCleanup(installPath: string, version: string, label: string): Promise<{
  shortcuts: ReturnType<typeof snapshotShortcuts>;
  registry: ReturnType<typeof snapshotUninstallRegistry>;
  processes: ReturnType<typeof snapshotMindDiaryProcesses>;
}> {
  await waitForCondition(() => {
    const shortcuts = snapshotShortcuts();
    const registry = snapshotUninstallRegistry(installPath, version);
    const processes = snapshotMindDiaryProcesses();
    return !shortcuts.desktop
      && !shortcuts.startMenu
      && registry.length === 0
      && processes.mindDiaryProcessCount === 0;
  }, `${label} shortcut, registry, and process cleanup`);
  return {
    shortcuts: snapshotShortcuts(),
    registry: snapshotUninstallRegistry(installPath, version),
    processes: snapshotMindDiaryProcesses(),
  };
}

test('installs, launches, retains fake data, reopens it, and uninstalls Windows Setup', async () => {
  test.skip(process.platform !== 'win32', 'Windows Setup smoke requires Windows');
  const setupPath = findSetupExecutable(projectRoot, packageJson.version);
  const installPath = createDisposableInstallPath();
  const installArgs = ['/S', `/D=${installPath}`];
  const beforeDefaultApplicationData = snapshotDefaultApplicationData();
  const shortcutsBefore = snapshotShortcuts();
  const registryBefore = snapshotUninstallRegistry(installPath, packageJson.version);
  const processesBefore = snapshotMindDiaryProcesses();
  let installedFiles: { executable: string; uninstaller: string } | undefined;
  let seededRun: SmokeDiagnosticProcessResult | undefined;
  let reopenedRun: SmokeDiagnosticProcessResult | undefined;
  let firstInstall: SetupProcessResult | undefined;
  let reinstall: SetupProcessResult | undefined;
  let uninstall: SetupProcessResult | undefined;
  let finalUninstall: SetupProcessResult | undefined;

  expect(fs.existsSync(installPath)).toBe(false);
  expect(shortcutsBefore).toEqual({ desktop: false, startMenu: false });
  expect(registryBefore).toEqual([]);
  expect(processesBefore).toEqual({ mindDiaryProcessCount: 0 });

  try {
    firstInstall = await runSetupProcess(setupPath, installArgs, 'Windows Setup silent install');
    expect(firstInstall.exitCode).toBe(0);
    installedFiles = await waitForInstalledFiles(installPath);
    const installTree = collectPhysicalInstallTree(installPath);
    expect(installTree.some(record => record.startsWith('file|MindDiary.exe|'))).toBe(true);
    expect(installTree.some(record => record.startsWith('file|Uninstall MindDiary.exe|'))).toBe(true);

    const shortcutsAfterInstall = snapshotShortcuts();
    const registryAfterInstall = snapshotUninstallRegistry(installPath, packageJson.version);
    const processesAfterInstall = snapshotMindDiaryProcesses();
    expect(shortcutsAfterInstall).toEqual({ desktop: true, startMenu: true });
    expect(registryAfterInstall).toHaveLength(1);
    expect(registryAfterInstall[0]).toEqual({
      hive: expect.any(String),
      displayNameMatches: true,
      uninstallTargetMatches: true,
      uninstallCommandPresent: true,
      displayVersionMatches: true,
    });
    expect(processesAfterInstall).toEqual({ mindDiaryProcessCount: 0 });

    seededRun = await runSmokeDiagnosticProcess({
      executablePath: installedFiles.executable,
      scenario: 'install-profile',
      expectedPackaged: true,
      timeoutMs: 90_000,
    });
    expect(seededRun.result).toMatchObject({
      schemaVersion: 1,
      scenario: 'install-profile',
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
    expect(seededRun.result.evidence).toEqual(expect.arrayContaining([
      { check: 'installed-profile-seeded', passed: true },
      { check: 'profile-data-create', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'install-profile-phase-consistent', passed: true },
    ]));
    expect(seededRun.profileFilesBeforeRun).toEqual(['.minddiary-smoke-profile']);
    expect(seededRun.profileFiles).toContain('minddiary.db');
    expect(seededRun.profileFiles.some(filepath => filepath.endsWith('.png'))).toBe(true);
    await waitForCondition(
      () => snapshotMindDiaryProcesses().mindDiaryProcessCount === 0,
      'installed diagnostic process exit',
    );
    const processesAfterDiagnostic = snapshotMindDiaryProcesses();
    expect(processesAfterDiagnostic).toEqual({ mindDiaryProcessCount: 0 });

    uninstall = await uninstallAndWait(installedFiles.uninstaller, installPath, 'Windows Setup uninstall');
    installedFiles = undefined;
    const firstCleanup = await waitForUninstallCleanup(installPath, packageJson.version, 'Windows Setup uninstall');
    const shortcutsAfterUninstall = firstCleanup.shortcuts;
    const registryAfterUninstall = firstCleanup.registry;
    const processesAfterUninstall = firstCleanup.processes;
    expect(shortcutsAfterUninstall).toEqual({ desktop: false, startMenu: false });
    expect(registryAfterUninstall).toEqual([]);
    expect(processesAfterUninstall).toEqual({ mindDiaryProcessCount: 0 });
    const profileRetainedAfterUninstall = fs.existsSync(path.join(seededRun.profilePath, 'minddiary.db'))
      && seededRun.profileFiles.some(filepath => filepath.endsWith('.png'));
    const installDirectoryRemoved = !fs.existsSync(installPath);
    expect(profileRetainedAfterUninstall).toBe(true);
    expect(installDirectoryRemoved).toBe(true);

    reinstall = await runSetupProcess(setupPath, installArgs, 'Windows Setup silent reinstall');
    expect(reinstall.exitCode).toBe(0);
    installedFiles = await waitForInstalledFiles(installPath);
    const shortcutsAfterReinstall = snapshotShortcuts();
    const registryAfterReinstall = snapshotUninstallRegistry(installPath, packageJson.version);
    expect(shortcutsAfterReinstall).toEqual({ desktop: true, startMenu: true });
    expect(registryAfterReinstall).toHaveLength(1);

    reopenedRun = await rerunSmokeDiagnosticProcess({
      previous: seededRun,
      executablePath: installedFiles.executable,
      scenario: 'install-profile',
      expectedPackaged: true,
      timeoutMs: 90_000,
    });
    expect(reopenedRun.result.result).toBe('passed');
    expect(reopenedRun.result.evidence).toEqual(expect.arrayContaining([
      { check: 'installed-profile-reopened', passed: true },
      { check: 'profile-data-retained', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'profile-data-cleanup', passed: true },
      { check: 'install-profile-phase-consistent', passed: true },
    ]));
    expect(reopenedRun.profileFiles).toContain('minddiary.db');
    expect(reopenedRun.profileFiles.some(filepath => filepath.endsWith('.png'))).toBe(false);
    const reopenedChecks = new Map(reopenedRun.result.evidence.map(evidence => [evidence.check, evidence.passed]));
    const profileReopened = reopenedRun.result.result === 'passed'
      && reopenedChecks.get('installed-profile-reopened') === true
      && reopenedChecks.get('profile-data-retained') === true
      && reopenedChecks.get('profile-data-read-back') === true;
    const profileCleaned = reopenedChecks.get('profile-data-cleanup') === true
      && !reopenedRun.profileFiles.some(filepath => filepath.endsWith('.png'));
    expect(profileReopened).toBe(true);
    expect(profileCleaned).toBe(true);

    finalUninstall = await uninstallAndWait(
      installedFiles.uninstaller,
      installPath,
      'Windows Setup final uninstall',
    );
    installedFiles = undefined;
    const finalCleanup = await waitForUninstallCleanup(
      installPath,
      packageJson.version,
      'Windows Setup final uninstall',
    );
    const shortcutsFinal = finalCleanup.shortcuts;
    const registryFinal = finalCleanup.registry;
    const processesFinal = finalCleanup.processes;
    const afterDefaultApplicationData = snapshotDefaultApplicationData();
    expect(shortcutsFinal).toEqual({ desktop: false, startMenu: false });
    expect(registryFinal).toEqual([]);
    expect(processesFinal).toEqual({ mindDiaryProcessCount: 0 });
    expect(afterDefaultApplicationData).toEqual(beforeDefaultApplicationData);
    const finalInstallDirectoryRemoved = !fs.existsSync(installPath);
    expect(finalInstallDirectoryRemoved).toBe(true);

    const evidenceDirectory = await writeSetupSmokeEvidence({
      projectRoot,
      setupPath,
      installTree,
      firstInstall,
      reinstall,
      uninstall,
      finalUninstall,
      shortcuts: {
        before: shortcutsBefore,
        afterInstall: shortcutsAfterInstall,
        afterUninstall: shortcutsAfterUninstall,
        afterReinstall: shortcutsAfterReinstall,
        final: shortcutsFinal,
      },
      registry: {
        before: registryBefore,
        afterInstall: registryAfterInstall,
        afterUninstall: registryAfterUninstall,
        afterReinstall: registryAfterReinstall,
        final: registryFinal,
      },
      processes: {
        before: processesBefore,
        afterInstall: processesAfterInstall,
        afterDiagnostic: processesAfterDiagnostic,
        afterUninstall: processesAfterUninstall,
        final: processesFinal,
      },
      seededRun,
      reopenedRun,
      defaultApplicationData: { before: beforeDefaultApplicationData, after: afterDefaultApplicationData },
      deleteAppDataOnUninstall: packageJson.build.nsis.deleteAppDataOnUninstall,
      installDirectoryRemoved,
      finalInstallDirectoryRemoved,
      profileRetainedAfterUninstall,
      profileReopened,
      profileCleaned,
    });
    expect(fs.readdirSync(evidenceDirectory).sort()).toEqual([...SETUP_EVIDENCE_FILES].sort());
    const archivedText = SETUP_EVIDENCE_FILES
      .map(name => fs.readFileSync(path.join(evidenceDirectory, name), 'utf8'))
      .join('\n');
    for (const secret of [
      installPath,
      seededRun.profilePath,
      seededRun.outputPath,
      reopenedRun.outputPath,
      seededRun.token,
      process.env.USERPROFILE,
      process.env.APPDATA,
      process.env.LOCALAPPDATA,
    ]) {
      if (secret) expect(archivedText).not.toContain(secret);
    }
    expect(archivedText).not.toMatch(/[A-Z]:\\Users\\/i);
  } finally {
    if (installedFiles && fs.existsSync(installedFiles.uninstaller)) {
      try {
        await uninstallAndWait(installedFiles.uninstaller, installPath, 'Windows Setup failure cleanup');
      } catch {
      }
    }
    if (reopenedRun) cleanupSmokeDiagnosticProcess(reopenedRun);
    if (seededRun) cleanupSmokeDiagnosticProcess(seededRun);
  }
});
