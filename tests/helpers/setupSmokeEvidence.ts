import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SmokeDiagnosticProcessResult } from './smokeDiagnosticRunner';
import type { DefaultApplicationDataSnapshot } from './portableSmokeEvidence';

export const SETUP_EVIDENCE_FILES = [
  'setup-sha256.txt',
  'install-command.txt',
  'install-tree.txt',
  'shortcut-before-after.txt',
  'registry-before-after.txt',
  'process-before-after.txt',
  'diagnostic-result.json',
  'uninstall-result.json',
  'retention-result.json',
] as const;

export type ShortcutSnapshot = {
  desktop: boolean;
  startMenu: boolean;
};

export type RegistrySnapshot = Array<{
  hive: string;
  displayNameMatches: boolean;
  uninstallTargetMatches: boolean;
  uninstallCommandPresent: boolean;
  displayVersionMatches: boolean;
}>;

type RawRegistrySnapshot = Array<Omit<RegistrySnapshot[number], 'uninstallTargetMatches' | 'uninstallCommandPresent'> & {
  uninstallCommand: string;
}>;

export type ProcessSnapshot = {
  mindDiaryProcessCount: number;
};

export type SetupProcessResult = {
  exitCode: number | null;
  outputText: string;
};

export type SetupSmokeEvidenceInput = {
  projectRoot: string;
  setupPath: string;
  installTree: string[];
  firstInstall: SetupProcessResult;
  reinstall: SetupProcessResult;
  uninstall: SetupProcessResult;
  finalUninstall: SetupProcessResult;
  shortcuts: {
    before: ShortcutSnapshot;
    afterInstall: ShortcutSnapshot;
    afterUninstall: ShortcutSnapshot;
    afterReinstall: ShortcutSnapshot;
    final: ShortcutSnapshot;
  };
  registry: {
    before: RegistrySnapshot;
    afterInstall: RegistrySnapshot;
    afterUninstall: RegistrySnapshot;
    afterReinstall: RegistrySnapshot;
    final: RegistrySnapshot;
  };
  processes: {
    before: ProcessSnapshot;
    afterInstall: ProcessSnapshot;
    afterDiagnostic: ProcessSnapshot;
    afterUninstall: ProcessSnapshot;
    final: ProcessSnapshot;
  };
  seededRun: SmokeDiagnosticProcessResult;
  reopenedRun: SmokeDiagnosticProcessResult;
  defaultApplicationData: {
    before: DefaultApplicationDataSnapshot;
    after: DefaultApplicationDataSnapshot;
  };
  deleteAppDataOnUninstall: false;
  installDirectoryRemoved: boolean;
  finalInstallDirectoryRemoved: boolean;
  profileRetainedAfterUninstall: boolean;
  profileReopened: boolean;
  profileCleaned: boolean;
};

const registrySnapshotScript = String.raw`
$ErrorActionPreference = 'Stop'
$roots = @(
  @{ label = 'hkcu-native'; path = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall' },
  @{ label = 'hkcu-wow6432'; path = 'Registry::HKEY_CURRENT_USER\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' },
  @{ label = 'hklm-native'; path = 'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall' },
  @{ label = 'hklm-wow6432'; path = 'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' }
)
$expected = [System.IO.Path]::GetFullPath($env:MINDDIARY_EXPECTED_INSTALL_ROOT).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$entries = @()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root.path)) { continue }
  foreach ($key in Get-ChildItem -LiteralPath $root.path -ErrorAction SilentlyContinue) {
    $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $item) { continue }
    $uninstallCommand = [string]$item.UninstallString
    $displayNameMatches = [string]$item.DisplayName -eq $env:MINDDIARY_EXPECTED_DISPLAY_NAME
    $uninstallTargetMatchesLexically = $uninstallCommand.IndexOf($expected, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $displayNameMatches -and -not $uninstallTargetMatchesLexically) { continue }
    $entries += [pscustomobject]@{
      hive = $root.label
      displayNameMatches = $displayNameMatches
      uninstallCommand = $uninstallCommand
      displayVersionMatches = [string]$item.DisplayVersion -eq $env:MINDDIARY_EXPECTED_VERSION
    }
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($entries) -Compress -Depth 4))
`;

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filepath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filepath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

export function findSetupExecutable(projectRoot: string, version: string): string {
  const setupPath = path.join(path.resolve(projectRoot), 'release', `MindDiary-Setup-${version}.exe`);
  const stat = fs.lstatSync(setupPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('Expected a physical root Windows Setup executable');
  }
  return setupPath;
}

export function createDisposableInstallPath(): string {
  const installPath = path.join(os.tmpdir(), `minddiary-setup-install-${randomUUID()}`);
  if (fs.existsSync(installPath)) throw new Error('Disposable install path already exists');
  return installPath;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

export async function runSetupProcess(
  executablePath: string,
  args: string[],
  label: string,
  timeoutMs = 180_000,
): Promise<SetupProcessResult> {
  const child = spawn(executablePath, args, {
    env: { ...process.env },
    stdio: 'ignore',
    windowsHide: true,
  });
  let exitObserved = false;
  let closeObserved = false;
  child.once('exit', () => { exitObserved = true; });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const exitCode = child.exitCode;
      killProcessTree(child);
      reject(new Error(
        `${label} timed out `
        + `(exitObserved=${exitObserved}; closeObserved=${closeObserved}; exitCode=${exitCode ?? 'null'})`,
      ));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', exitCode => {
      closeObserved = true;
      clearTimeout(timer);
      resolve({ exitCode, outputText: '' });
    });
  });
}

export async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function snapshotShortcuts(): ShortcutSnapshot {
  if (!process.env.USERPROFILE || !process.env.APPDATA) {
    throw new Error('Windows shortcut roots are unavailable');
  }
  return {
    desktop: fs.existsSync(path.join(process.env.USERPROFILE, 'Desktop', 'MindDiary.lnk')),
    startMenu: fs.existsSync(path.join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'MindDiary.lnk',
    )),
  };
}

export function snapshotMindDiaryProcesses(): ProcessSnapshot {
  const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq MindDiary.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error('Unable to snapshot MindDiary processes');
  }
  return {
    mindDiaryProcessCount: result.stdout
      .split(/\r?\n/)
      .filter(line => /^"MindDiary\.exe"/i.test(line.trim())).length,
  };
}

export function uninstallCommandTargetsPhysicalFile(installPath: string, uninstallCommand: string): boolean {
  const commandMatch = /^"([^"]+)"(?:\s|$)/.exec(uninstallCommand.trim());
  try {
    if (!commandMatch?.[1]) return false;
    const expectedUninstaller = path.join(installPath, 'Uninstall MindDiary.exe');
    const registeredUninstaller = commandMatch[1];
    const expectedStat = fs.lstatSync(expectedUninstaller);
    const registeredStat = fs.lstatSync(registeredUninstaller);
    return expectedStat.isFile()
      && registeredStat.isFile()
      && !expectedStat.isSymbolicLink()
      && !registeredStat.isSymbolicLink()
      && expectedStat.nlink === 1
      && registeredStat.nlink === 1
      && fs.realpathSync.native(expectedUninstaller).toLowerCase()
        === fs.realpathSync.native(registeredUninstaller).toLowerCase();
  } catch {
    return false;
  }
}

export function snapshotUninstallRegistry(installPath: string, version: string): RegistrySnapshot {
  const env = {
    ...process.env,
    MINDDIARY_EXPECTED_INSTALL_ROOT: installPath,
    MINDDIARY_EXPECTED_DISPLAY_NAME: `MindDiary ${version}`,
    MINDDIARY_EXPECTED_VERSION: version,
  };
  let result = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', registrySnapshotScript], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', registrySnapshotScript], {
      encoding: 'utf8',
      env,
      windowsHide: true,
    });
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to snapshot uninstall registry: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout || '[]') as RawRegistrySnapshot).map(entry => {
    return {
      hive: entry.hive,
      displayNameMatches: entry.displayNameMatches,
      uninstallTargetMatches: uninstallCommandTargetsPhysicalFile(installPath, entry.uninstallCommand),
      uninstallCommandPresent: entry.uninstallCommand.trim().length > 0,
      displayVersionMatches: entry.displayVersionMatches,
    };
  });
}

function resolvesAsDirectPhysicalChild(filepath: string): boolean {
  const resolved = path.resolve(filepath);
  const canonicalParent = fs.realpathSync.native(path.dirname(resolved));
  const canonicalPath = fs.realpathSync.native(resolved);
  const expectedPath = path.join(canonicalParent, path.basename(resolved));
  return process.platform === 'win32'
    ? canonicalPath.toLowerCase() === expectedPath.toLowerCase()
    : canonicalPath === expectedPath;
}

export function collectPhysicalInstallTree(installPath: string): string[] {
  const rootStat = fs.lstatSync(installPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !resolvesAsDirectPhysicalChild(installPath)) {
    throw new Error('Installed application root must be a physical directory');
  }
  const records: string[] = [];
  const pending = [{ absolute: installPath, relative: '.' }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current.absolute, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current.absolute, entry.name);
      const relative = path.posix.join(current.relative, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('Installed application tree contains a link');
      if (stat.isDirectory()) {
        records.push(`directory|${relative}`);
        pending.push({ absolute, relative });
      } else if (stat.isFile()) {
        records.push(`file|${relative}|${stat.size}`);
      } else {
        throw new Error('Installed application tree contains an unsupported entry');
      }
    }
  }
  return records.sort();
}

function writeNewFile(filepath: string, contents: string): void {
  fs.writeFileSync(filepath, contents, { encoding: 'utf8', flag: 'wx' });
}

function prepareEvidenceDirectory(projectRoot: string): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const projectRootStat = fs.lstatSync(resolvedProjectRoot);
  if (projectRootStat.isSymbolicLink() || !projectRootStat.isDirectory()
    || !resolvesAsDirectPhysicalChild(resolvedProjectRoot)) {
    throw new Error('Setup evidence project root must be a physical directory');
  }
  const testResultsRoot = path.join(resolvedProjectRoot, 'test-results');
  const evidenceDirectory = path.join(testResultsRoot, 'windows-setup-smoke-evidence');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const rootStat = fs.lstatSync(testResultsRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
    || !resolvesAsDirectPhysicalChild(testResultsRoot)) {
    throw new Error('Setup evidence root must be a physical test-results directory');
  }
  if (fs.existsSync(evidenceDirectory)) {
    const stat = fs.lstatSync(evidenceDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Setup evidence path must be a physical directory');
    }
    const names = fs.readdirSync(evidenceDirectory);
    if (names.some(name => !SETUP_EVIDENCE_FILES.includes(name as typeof SETUP_EVIDENCE_FILES[number]))) {
      throw new Error('Setup evidence directory contains an unexpected entry');
    }
    for (const name of names) {
      const filepath = path.join(evidenceDirectory, name);
      const fileStat = fs.lstatSync(filepath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('Setup evidence directory contains a non-physical file');
      }
      fs.unlinkSync(filepath);
    }
    fs.rmdirSync(evidenceDirectory);
  }
  fs.mkdirSync(evidenceDirectory);
  return evidenceDirectory;
}

function formatSnapshot<T>(label: string, snapshots: Record<string, T>): string {
  return `${JSON.stringify({ schemaVersion: 1, label, snapshots }, null, 2)}\n`;
}

function hasValidRegistryEntry(snapshot: RegistrySnapshot): boolean {
  const entry = snapshot[0];
  return snapshot.length === 1
    && entry !== undefined
    && entry.displayNameMatches
    && entry.uninstallTargetMatches
    && entry.uninstallCommandPresent
    && entry.displayVersionMatches;
}

function validateSetupSmokeEvidence(options: SetupSmokeEvidenceInput): void {
  const shortcutsAbsent = (snapshot: ShortcutSnapshot) => !snapshot.desktop && !snapshot.startMenu;
  const shortcutsPresent = (snapshot: ShortcutSnapshot) => snapshot.desktop && snapshot.startMenu;
  const failures = [
    ...([options.firstInstall, options.reinstall, options.uninstall, options.finalUninstall]
      .every(result => result.exitCode === 0) ? [] : ['setup-process-exit-code']),
    ...(shortcutsAbsent(options.shortcuts.before)
      && shortcutsPresent(options.shortcuts.afterInstall)
      && shortcutsAbsent(options.shortcuts.afterUninstall)
      && shortcutsPresent(options.shortcuts.afterReinstall)
      && shortcutsAbsent(options.shortcuts.final) ? [] : ['shortcut-state']),
    ...(options.registry.before.length === 0
      && hasValidRegistryEntry(options.registry.afterInstall)
      && options.registry.afterUninstall.length === 0
      && hasValidRegistryEntry(options.registry.afterReinstall)
      && options.registry.final.length === 0 ? [] : ['uninstall-registry-state']),
    ...(Object.values(options.processes).every(snapshot => snapshot.mindDiaryProcessCount === 0)
      ? [] : ['minddiary-process-state']),
    ...(options.seededRun.result.result === 'passed' && options.reopenedRun.result.result === 'passed'
      ? [] : ['diagnostic-result']),
    ...(JSON.stringify(options.seededRun.profileFilesBeforeRun) === JSON.stringify(['.minddiary-smoke-profile'])
      ? [] : ['disposable-profile-baseline']),
    ...(options.installDirectoryRemoved && options.finalInstallDirectoryRemoved
      ? [] : ['install-directory-removal']),
    ...(options.profileRetainedAfterUninstall && options.profileReopened && options.profileCleaned
      ? [] : ['retention-round-trip']),
    ...(options.deleteAppDataOnUninstall === false ? [] : ['uninstall-data-policy']),
    ...(JSON.stringify(options.defaultApplicationData.before) === JSON.stringify(options.defaultApplicationData.after)
      ? [] : ['default-application-data']),
  ];
  if (failures.length > 0) {
    throw new Error(`Refusing to archive failed Setup smoke evidence: ${failures.join(', ')}`);
  }
}

export async function writeSetupSmokeEvidence(options: SetupSmokeEvidenceInput): Promise<string> {
  validateSetupSmokeEvidence(options);
  const evidenceDirectory = prepareEvidenceDirectory(options.projectRoot);
  const setupStat = fs.lstatSync(options.setupPath);
  const setupHash = await sha256File(options.setupPath);
  const defaultApplicationDataUnchanged = JSON.stringify(options.defaultApplicationData.before)
    === JSON.stringify(options.defaultApplicationData.after);

  writeNewFile(path.join(evidenceDirectory, 'setup-sha256.txt'), `${[
    'schema-version=1',
    `artifact-name=${path.basename(options.setupPath)}`,
    `sha256=${setupHash}`,
    `size-bytes=${setupStat.size}`,
    '',
  ].join('\n')}`);
  writeNewFile(path.join(evidenceDirectory, 'install-command.txt'), `${[
    'schema-version=1',
    'installer-arguments=/S /D=<disposable-install-path>',
    'installer-custom-directory-argument-position=last',
    'uninstaller-arguments=/S',
    `first-install-exit-code=${String(options.firstInstall.exitCode)}`,
    `reinstall-exit-code=${String(options.reinstall.exitCode)}`,
    `uninstall-exit-code=${String(options.uninstall.exitCode)}`,
    `final-uninstall-exit-code=${String(options.finalUninstall.exitCode)}`,
    'raw-output-archived=false',
    `combined-output-sha256=${sha256Text([
      options.firstInstall.outputText,
      options.reinstall.outputText,
      options.uninstall.outputText,
      options.finalUninstall.outputText,
    ].join('\n'))}`,
    '',
  ].join('\n')}`);
  writeNewFile(path.join(evidenceDirectory, 'install-tree.txt'), `${[
    'schema-version=1',
    'paths=relative-to-disposable-install-root',
    ...options.installTree,
    '',
  ].join('\n')}`);
  writeNewFile(
    path.join(evidenceDirectory, 'shortcut-before-after.txt'),
    formatSnapshot('shortcut-state', options.shortcuts),
  );
  writeNewFile(
    path.join(evidenceDirectory, 'registry-before-after.txt'),
    formatSnapshot('uninstall-registry-state', options.registry),
  );
  writeNewFile(
    path.join(evidenceDirectory, 'process-before-after.txt'),
    formatSnapshot('minddiary-process-state', options.processes),
  );
  writeNewFile(path.join(evidenceDirectory, 'diagnostic-result.json'), `${JSON.stringify({
    schemaVersion: 1,
    seeded: options.seededRun.result,
    reopened: options.reopenedRun.result,
  }, null, 2)}\n`);
  writeNewFile(path.join(evidenceDirectory, 'uninstall-result.json'), `${JSON.stringify({
    schemaVersion: 1,
    firstUninstallExitCode: options.uninstall.exitCode,
    finalUninstallExitCode: options.finalUninstall.exitCode,
    firstInstallDirectoryRemoved: options.installDirectoryRemoved,
    finalInstallDirectoryRemoved: options.finalInstallDirectoryRemoved,
    shortcutsRemoved: !options.shortcuts.afterUninstall.desktop
      && !options.shortcuts.afterUninstall.startMenu
      && !options.shortcuts.final.desktop
      && !options.shortcuts.final.startMenu,
    registryRemoved: options.registry.afterUninstall.length === 0 && options.registry.final.length === 0,
    processesStopped: options.processes.afterUninstall.mindDiaryProcessCount === 0
      && options.processes.final.mindDiaryProcessCount === 0,
    result: 'passed',
  }, null, 2)}\n`);
  writeNewFile(path.join(evidenceDirectory, 'retention-result.json'), `${JSON.stringify({
    schemaVersion: 1,
    configuredDeleteAppDataOnUninstall: options.deleteAppDataOnUninstall,
    runtimeProbeScope: 'token-bound-disposable-diagnostic-profile',
    disposableProfileApplicationDataAbsentBeforeSeed: true,
    defaultApplicationDataBaselineCaptured: true,
    profileRetainedAfterUninstall: options.profileRetainedAfterUninstall,
    retainedDataReopenedAfterReinstall: options.profileReopened,
    fakeDataCleanedAfterVerification: options.profileCleaned,
    defaultApplicationDataUnchanged,
    rawPathsArchived: false,
    databaseContentsArchived: false,
    attachmentContentsArchived: false,
    result: 'passed',
  }, null, 2)}\n`);
  return evidenceDirectory;
}
