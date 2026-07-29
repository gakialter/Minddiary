import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import {
  assertNoUpdaterE2eSigningEnvironment,
  assertDisposableUpdaterPath,
  clearUpdaterE2eArtifactDirectory,
  configureDisposableUpdaterPublish,
  createUpdaterE2eChildEnvironment,
  validateLoopbackProviderUrl,
  writeUpdaterDiagnosticEvidence,
  writeUpdaterEvidence,
  type UpdaterDiagnostic,
  type UpdaterDiagnosticStep,
  type UpdaterEvidenceBundle,
} from '../tests/helpers/updaterE2eEvidence';
import {
  createUpdaterFailure,
  retryTransientWindowsOperation,
  runBestEffortCleanup,
} from '../tests/helpers/updaterCleanup';
import {
  createUpdaterRuntimeRoot,
  getUpdaterPlaywrightOutputDirectory,
  removeUpdaterPlaywrightOutputDirectory,
  removeUpdaterRuntimeRoot,
} from '../tests/helpers/updaterRuntimeWorkspace';
import { readUpdaterVersionPair, type UpdaterVersionPair } from '../tests/helpers/updaterVersion';

type CandidateFixture = {
  version: string;
  setupPath: string;
  blockmapPath: string;
  latestPath: string;
  appUpdatePath: string;
};

type FixtureManifest = {
  schemaVersion: 1;
  headSha: string;
  port: number;
  versions: UpdaterVersionPair;
  old: CandidateFixture;
  next: CandidateFixture;
};

type RunPhase = UpdaterDiagnostic['phase'];

class CommandFailure extends Error {
  readonly timedOut: boolean;
  readonly step: UpdaterDiagnosticStep;
  readonly processClosed: boolean;

  constructor(timedOut: boolean, step: UpdaterDiagnosticStep, processClosed: boolean) {
    super(timedOut ? `Command timed out at ${step}` : `Command failed at ${step}`);
    this.timedOut = timedOut;
    this.step = step;
    this.processClosed = processClosed;
  }
}

const projectRoot = path.resolve(__dirname, '..');
const testResultsRoot = path.join(projectRoot, 'test-results');
const stagingBundlePath = path.join(testResultsRoot, 'windows-updater-e2e-bundle.json');
const evidenceDirectory = path.join(testResultsRoot, 'windows-updater-e2e-evidence');
const diagnosticDirectory = path.join(testResultsRoot, 'windows-updater-e2e-diagnostic');
const temporaryPrefix = 'minddiary-updater-e2e-build-';
const childEnvironment = createUpdaterE2eChildEnvironment(process.env);
const nodeExecutable = process.execPath;
const npmCliPath = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function killProcessTree(pid: number | undefined): void {
  if (!pid || process.platform !== 'win32') return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 30_000,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeCommandOutput(output: string, cwd: string): string {
  let sanitized = output.replace(/\u001b\[[0-9;]*m/g, '');
  const replacements: Array<[string, string]> = [
    [cwd, '<worktree>'],
    [projectRoot, '<project-root>'],
    [os.homedir(), '<home-root>'],
    [os.tmpdir(), '<runtime-root>'],
    [os.userInfo().username, '<user>'],
  ];
  for (const [value, replacement] of replacements) {
    if (value) sanitized = sanitized.replace(new RegExp(escapeRegExp(value), 'gi'), replacement);
  }
  sanitized = sanitized
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>|]*/g, '<path>')
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'http://<credentials>@')
    .replace(
      /\b(token|password|api[_ -]?key|certificate)\b\s*[:=]\s*[^\s]+/gi,
      '$1=<redacted>',
    );
  return sanitized.slice(-32_000);
}

async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  step: UpdaterDiagnosticStep,
  environment: NodeJS.ProcessEnv = childEnvironment,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let timedOut = false;
    let boundedOutput = '';
    let hardStopTimer: NodeJS.Timeout | undefined;
    const collect = (chunk: Buffer) => {
      boundedOutput = `${boundedOutput}${chunk.toString('utf8')}`.slice(-64_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timer: NodeJS.Timeout;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      if (error) {
        const safeOutput = sanitizeCommandOutput(boundedOutput, cwd);
        process.stderr.write(
          `Updater child step=${step} failed${safeOutput ? `\n${safeOutput}\n` : '\n'}`,
        );
      }
      if (error) reject(error);
      else resolve();
    };
    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      hardStopTimer = setTimeout(
        () => finish(new CommandFailure(true, step, false)),
        30_000,
      );
    }, timeoutMs);
    child.once('error', () => finish(new CommandFailure(timedOut, step, false)));
    child.once('close', (code, signal) => {
      if (!timedOut && code === 0 && signal === null) finish();
      else finish(new CommandFailure(timedOut, step, true));
    });
  });
}

function captureGitHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  const headSha = result.status === 0 ? result.stdout.trim() : '';
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Unable to resolve exact test head SHA');
  return headSha;
}

function runNpm(
  args: string[],
  cwd: string,
  timeoutMs: number,
  step: UpdaterDiagnosticStep,
): Promise<void> {
  return runCommand(nodeExecutable, [npmCliPath, ...args], cwd, timeoutMs, step);
}

function runWorkspaceCli(
  worktree: string,
  relativeCliPath: string,
  args: string[],
  timeoutMs: number,
  step: UpdaterDiagnosticStep,
  environment: NodeJS.ProcessEnv = childEnvironment,
): Promise<void> {
  const cliPath = path.join(worktree, relativeCliPath);
  const stat = fs.lstatSync(cliPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Workspace CLI is not a physical file');
  return runCommand(nodeExecutable, [cliPath, ...args], worktree, timeoutMs, step, environment);
}

async function reservePort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    throw new Error('Unable to reserve an IPv4 loopback port');
  }
  let released = false;
  return {
    port: address.port,
    release: async () => {
      if (released) return;
      released = true;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function normalizePhysicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertTemporaryBuildPath(candidate: string, temporaryRoot: string): void {
  if (path.dirname(path.resolve(candidate)) !== path.resolve(temporaryRoot)) {
    throw new Error('Disposable build path escaped its temporary root');
  }
}

function assertPhysicalDirectory(directory: string, label: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || normalizePhysicalPath(fs.realpathSync(directory)) !== normalizePhysicalPath(directory)) {
    throw new Error(`${label} must be a physical directory`);
  }
}

function assertTemporaryRoot(temporaryRoot: string): void {
  assertPhysicalDirectory(temporaryRoot, 'Updater temporary root');
  if (normalizePhysicalPath(path.dirname(temporaryRoot)) !== normalizePhysicalPath(os.tmpdir())
    || !path.basename(temporaryRoot).startsWith(temporaryPrefix)) {
    throw new Error('Updater temporary root escaped the system temporary directory');
  }
}

function sha256FileSync(filepath: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(filepath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function stageCandidateFixture(
  source: CandidateFixture,
  runtimeRoot: string,
  workspace: 'old' | 'new',
  versions: UpdaterVersionPair,
): CandidateFixture {
  const expectedVersion = workspace === 'old' ? versions.baseVersion : versions.nextVersion;
  if (source.version !== expectedVersion) {
    throw new Error('Updater runtime candidate version does not match its workspace');
  }
  const releaseDirectory = path.join(runtimeRoot, workspace, 'release');
  const resourcesDirectory = path.join(releaseDirectory, 'win-unpacked', 'resources');
  fs.mkdirSync(resourcesDirectory, { recursive: true });
  assertPhysicalDirectory(releaseDirectory, 'Staged release directory');
  assertPhysicalDirectory(resourcesDirectory, 'Staged resources directory');
  const setupPath = path.join(releaseDirectory, `MindDiary-Setup-${source.version}.exe`);
  const staged: CandidateFixture = {
    version: source.version,
    setupPath,
    blockmapPath: `${setupPath}.blockmap`,
    latestPath: path.join(releaseDirectory, 'latest.yml'),
    appUpdatePath: path.join(resourcesDirectory, 'app-update.yml'),
  };
  for (const key of ['setupPath', 'blockmapPath', 'latestPath', 'appUpdatePath'] as const) {
    const sourcePath = source[key];
    const destinationPath = staged[key];
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()
      || normalizePhysicalPath(fs.realpathSync(sourcePath)) !== normalizePhysicalPath(sourcePath)) {
      throw new Error('Updater runtime source artifact must be a physical file');
    }
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    const destinationStat = fs.lstatSync(destinationPath);
    if (!destinationStat.isFile() || destinationStat.isSymbolicLink()
      || normalizePhysicalPath(fs.realpathSync(destinationPath)) !== normalizePhysicalPath(destinationPath)
      || sourceStat.size !== destinationStat.size
      || sha256FileSync(sourcePath) !== sha256FileSync(destinationPath)) {
      throw new Error('Updater runtime staging changed a candidate artifact');
    }
  }
  return staged;
}

function readCandidateFixture(worktree: string, expectedVersion: string): CandidateFixture {
  const releaseDirectory = path.join(worktree, 'release');
  const setupPath = path.join(releaseDirectory, `MindDiary-Setup-${expectedVersion}.exe`);
  const fixture = {
    version: expectedVersion,
    setupPath,
    blockmapPath: `${setupPath}.blockmap`,
    latestPath: path.join(releaseDirectory, 'latest.yml'),
    appUpdatePath: path.join(releaseDirectory, 'win-unpacked', 'resources', 'app-update.yml'),
  };
  for (const [label, filepath] of Object.entries(fixture).filter(([key]) => key !== 'version')) {
    const stat = fs.lstatSync(filepath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a physical build file`);
  }
  const packageVersion = JSON.parse(fs.readFileSync(path.join(worktree, 'package.json'), 'utf8')).version as string;
  if (packageVersion !== expectedVersion) throw new Error('Candidate package version is invalid');
  const latest = load(fs.readFileSync(fixture.latestPath, 'utf8')) as { version?: unknown };
  if (latest?.version !== expectedVersion) throw new Error('Generated latest.yml version does not match candidate');
  return fixture;
}

async function buildCandidate(
  worktree: string,
  version: string,
  providerUrl: string,
  reportStep: (step: UpdaterDiagnosticStep) => void,
): Promise<CandidateFixture> {
  reportStep('npm-ci');
  configureDisposableUpdaterPublish(worktree, version, providerUrl);
  await runNpm(['ci', '--prefer-offline'], worktree, 900_000, 'npm-ci');
  reportStep('build-electron');
  await runNpm(['run', 'build:electron'], worktree, 300_000, 'build-electron');
  reportStep('vite-build');
  await runWorkspaceCli(
    worktree,
    'node_modules/vite/bin/vite.js',
    ['build'],
    300_000,
    'vite-build',
  );
  reportStep('build-resources');
  await runNpm(['run', 'build:resources'], worktree, 300_000, 'build-resources');
  reportStep('rebuild-electron');
  await runNpm(['run', 'rebuild:electron'], worktree, 600_000, 'rebuild-electron');
  reportStep('verify-native');
  await runNpm(['run', 'verify:electron-native'], worktree, 180_000, 'verify-native');
  reportStep('package-nsis');
  await runWorkspaceCli(worktree, 'node_modules/electron-builder/out/cli/cli.js', [
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ], 900_000, 'package-nsis');
  const fixture = readCandidateFixture(worktree, version);
  const appUpdate = load(fs.readFileSync(fixture.appUpdatePath, 'utf8')) as {
    provider?: unknown;
    url?: unknown;
    publisherName?: unknown;
  };
  if (appUpdate.provider !== 'generic' || appUpdate.url !== providerUrl || appUpdate.publisherName !== undefined) {
    throw new Error('Generated app-update.yml does not match the disposable provider');
  }
  validateLoopbackProviderUrl(providerUrl);
  return fixture;
}

function readSafeRuntimePhase(runtimeRoot: string | undefined, fallback: RunPhase): RunPhase {
  if (!runtimeRoot) return fallback;
  try {
    const value = fs.readFileSync(path.join(runtimeRoot, 'runtime-phase.txt'), 'utf8').trim();
    if (['install-old', 'runtime', 'cleanup'].includes(value)) return value as RunPhase;
  } catch {
  }
  return fallback;
}

function readSafeRuntimeCheckpoint(
  runtimeRoot: string | undefined,
  fallback: UpdaterDiagnosticStep,
): UpdaterDiagnosticStep {
  if (!runtimeRoot) return fallback;
  try {
    const value = fs.readFileSync(
      path.join(runtimeRoot, 'runtime-checkpoint.txt'),
      'utf8',
    ).trim() as UpdaterDiagnosticStep;
    const allowed: UpdaterDiagnosticStep[] = [
      'provider-negative',
      'install-old',
      'no-update',
      'malformed-metadata',
      'wrong-sha512',
      'positive-download',
      'quit-install',
      'installer-lifecycle',
      'updated-start',
      'data-retention',
      'cleanup',
    ];
    if (allowed.includes(value)) return value;
  } catch {
  }
  return fallback;
}

function readRuntimeProfilePath(runtimeRoot: string | undefined): string | undefined {
  if (!runtimeRoot) return undefined;
  try {
    const raw = fs.readFileSync(path.join(runtimeRoot, 'runtime-profile.txt'), 'utf8');
    const value = raw.trim();
    if (raw !== `${value}\n`) return undefined;
    return assertDisposableUpdaterPath(value, 'minddiary-smoke-profile-');
  } catch {
    return undefined;
  }
}

type RuntimeCleanupReport = {
  appStopped: boolean;
  installerStopped: boolean;
  serverStopped: boolean;
  installRemoved: boolean;
  profileRemoved: boolean;
  cacheRemoved: boolean;
  cleanupFailures: string[];
};

function readRuntimeCleanup(runtimeRoot: string | undefined): Partial<RuntimeCleanupReport> {
  if (!runtimeRoot) return {};
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'runtime-cleanup.json'), 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const allowed = [
      'appStopped',
      'installerStopped',
      'serverStopped',
      'installRemoved',
      'profileRemoved',
      'cacheRemoved',
      'cleanupFailures',
    ];
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...allowed].sort())
      || !['appStopped', 'installerStopped', 'serverStopped', 'installRemoved', 'profileRemoved', 'cacheRemoved']
        .every(key => typeof record[key] === 'boolean')
      || !Array.isArray(record.cleanupFailures)
      || record.cleanupFailures.some(value =>
        typeof value !== 'string' || !/^[a-z-]{2,32}$/.test(value))) return {};
    return record as RuntimeCleanupReport;
  } catch {
    return {};
  }
}

async function stopRuntimeOwnedProcesses(runtimeRoot: string): Promise<void> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($env:MINDDIARY_UPDATER_RUNTIME_ROOT).TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
)
$prefix = $root + [System.IO.Path]::DirectorySeparatorChar
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  $owned = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    if ([string]::IsNullOrWhiteSpace([string]$_.ExecutablePath)) { return $false }
    $candidate = [System.IO.Path]::GetFullPath([string]$_.ExecutablePath)
    return $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
  })
  foreach ($item in $owned) {
    Stop-Process -Id ([int]$item.ProcessId) -Force -ErrorAction SilentlyContinue
  }
  if ($owned.Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Owned updater runtime processes remain after bounded cleanup'
`;
  await runCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    projectRoot,
    45_000,
    'cleanup',
    {
      ...childEnvironment,
      MINDDIARY_UPDATER_RUNTIME_ROOT: runtimeRoot,
    },
  );
}

async function removeWorktree(worktree: string, temporaryRoot: string): Promise<void> {
  assertTemporaryRoot(temporaryRoot);
  assertTemporaryBuildPath(worktree, temporaryRoot);
  if (!fs.existsSync(worktree)) return;
  assertPhysicalDirectory(worktree, 'Disposable updater worktree');
  try {
    await runCommand(
      'git',
      ['worktree', 'remove', '--force', worktree],
      projectRoot,
      180_000,
      'cleanup',
    );
  } catch {
    await retryTransientWindowsOperation('worktree-remove', () => {
      if (fs.existsSync(worktree)) {
        assertPhysicalDirectory(worktree, 'Disposable updater worktree');
        fs.rmSync(worktree, { recursive: true, force: false });
      }
    }, { attempts: 6, delayMs: 500 });
  }
}

function verifyVersionFilesUnchanged(
  originalPackage: Buffer,
  originalLock: Buffer,
  originalDiff: string,
  versions: UpdaterVersionPair,
): void {
  const packageBytes = fs.readFileSync(path.join(projectRoot, 'package.json'));
  const lockBytes = fs.readFileSync(path.join(projectRoot, 'package-lock.json'));
  if (!packageBytes.equals(originalPackage) || !lockBytes.equals(originalLock)) {
    throw new Error('Disposable updater version leaked into the main worktree');
  }
  const current = readUpdaterVersionPair(projectRoot);
  if (current.baseVersion !== versions.baseVersion || current.nextVersion !== versions.nextVersion) {
    throw new Error('Main worktree updater versions changed during the test');
  }
  if (captureVersionFileDiff() !== originalDiff) {
    throw new Error('Main worktree version-file diff changed during the test');
  }
}

function captureVersionFileDiff(): string {
  const result = spawnSync(
    'git',
    ['diff', '--binary', '--', 'package.json', 'package-lock.json'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) throw new Error('Unable to capture main worktree version-file diff');
  return result.stdout;
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Windows NSIS updater E2E requires Windows');
  assertNoUpdaterE2eSigningEnvironment(process.env);
  const npmCliStat = fs.lstatSync(npmCliPath);
  if (!npmCliStat.isFile() || npmCliStat.isSymbolicLink()) {
    throw new Error('Updater E2E requires the physical npm CLI bundled with the active Node runtime');
  }
  process.chdir(projectRoot);
  fs.mkdirSync(testResultsRoot, { recursive: true });
  clearUpdaterE2eArtifactDirectory(projectRoot, 'evidence');
  clearUpdaterE2eArtifactDirectory(projectRoot, 'diagnostic');
  fs.rmSync(stagingBundlePath, { force: true });
  const headSha = captureGitHead();
  const versions = readUpdaterVersionPair(projectRoot);
  const originalPackage = fs.readFileSync(path.join(projectRoot, 'package.json'));
  const originalLock = fs.readFileSync(path.join(projectRoot, 'package-lock.json'));
  const originalVersionDiff = captureVersionFileDiff();
  let phase: RunPhase = 'prepare';
  let primaryStep: UpdaterDiagnosticStep = 'prepare';
  let primaryError: unknown;
  let temporaryRoot: string | undefined;
  let runtimeRoot: string | undefined;
  let oldWorktree: string | undefined;
  let newWorktree: string | undefined;
  let portReservation: Awaited<ReturnType<typeof reservePort>> | undefined;
  const createdWorktrees: string[] = [];
  let runtimeCleanup: Partial<RuntimeCleanupReport> = {};
  let runtimeCommandClosed = true;
  let runtimeProfilePath: string | undefined;

  try {
    primaryStep = 'reserve-port';
    portReservation = await reservePort();
    const providerUrl = `http://127.0.0.1:${portReservation.port}/`;
    validateLoopbackProviderUrl(providerUrl);
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));
    assertTemporaryRoot(temporaryRoot);
    runtimeRoot = createUpdaterRuntimeRoot(projectRoot);
    oldWorktree = path.join(temporaryRoot, 'old');
    newWorktree = path.join(temporaryRoot, 'new');
    assertTemporaryBuildPath(oldWorktree, temporaryRoot);
    assertTemporaryBuildPath(newWorktree, temporaryRoot);
    primaryStep = 'worktree-add';
    await runCommand(
      'git',
      ['worktree', 'add', '--detach', oldWorktree, headSha],
      projectRoot,
      180_000,
      'worktree-add',
    );
    createdWorktrees.push(oldWorktree);
    await runCommand(
      'git',
      ['worktree', 'add', '--detach', newWorktree, headSha],
      projectRoot,
      180_000,
      'worktree-add',
    );
    createdWorktrees.push(newWorktree);
    primaryStep = 'version-bump';
    await runNpm(
      ['version', versions.nextVersion, '--no-git-tag-version'],
      newWorktree,
      120_000,
      'version-bump',
    );

    phase = 'build-old';
    process.stdout.write(`Updater E2E phase=${phase} version=${versions.baseVersion}\n`);
    const oldFixture = await buildCandidate(
      oldWorktree,
      versions.baseVersion,
      providerUrl,
      step => { primaryStep = step; },
    );
    phase = 'build-new';
    process.stdout.write(`Updater E2E phase=${phase} version=${versions.nextVersion}\n`);
    const newFixture = await buildCandidate(
      newWorktree,
      versions.nextVersion,
      providerUrl,
      step => { primaryStep = step; },
    );
    const stagedOldFixture = stageCandidateFixture(oldFixture, runtimeRoot, 'old', versions);
    const stagedNewFixture = stageCandidateFixture(newFixture, runtimeRoot, 'new', versions);
    const manifest: FixtureManifest = {
      schemaVersion: 1,
      headSha,
      port: portReservation.port,
      versions,
      old: stagedOldFixture,
      next: stagedNewFixture,
    };
    const manifestPath = path.join(runtimeRoot, 'fixture-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await portReservation.release();
    portReservation = undefined;
    phase = 'runtime';
    primaryStep = 'provider-negative';
    process.stdout.write(`Updater E2E phase=${phase}\n`);
    runtimeCommandClosed = false;
    try {
      await runWorkspaceCli(projectRoot, 'node_modules/@playwright/test/cli.js', [
        'test',
        '--config',
        'playwright.updater.config.ts',
      ], 2_700_000, 'provider-negative', {
        ...childEnvironment,
        MINDDIARY_UPDATER_FIXTURE_MANIFEST: manifestPath,
        MINDDIARY_UPDATER_RUNTIME_PHASE: path.join(runtimeRoot, 'runtime-phase.txt'),
        MINDDIARY_UPDATER_RUNTIME_CHECKPOINT: path.join(runtimeRoot, 'runtime-checkpoint.txt'),
        MINDDIARY_UPDATER_RUNTIME_CLEANUP: path.join(runtimeRoot, 'runtime-cleanup.json'),
        MINDDIARY_UPDATER_RUNTIME_PROFILE: path.join(runtimeRoot, 'runtime-profile.txt'),
      });
      runtimeCommandClosed = true;
    } catch (error) {
      runtimeCommandClosed = error instanceof CommandFailure && error.processClosed;
      throw error;
    }
  } catch (error) {
    primaryError = error;
    phase = readSafeRuntimePhase(runtimeRoot, phase);
    primaryStep = readSafeRuntimeCheckpoint(
      runtimeRoot,
      error instanceof CommandFailure ? error.step : primaryStep,
    );
    runtimeCleanup = readRuntimeCleanup(runtimeRoot);
    runtimeProfilePath = readRuntimeProfilePath(runtimeRoot);
  }
  runtimeCleanup = { ...runtimeCleanup, ...readRuntimeCleanup(runtimeRoot) };
  runtimeProfilePath = runtimeProfilePath ?? readRuntimeProfilePath(runtimeRoot);

  const runnerCleanupFailures = await runBestEffortCleanup([
    {
      label: 'port-reservation',
      run: async () => { await portReservation?.release(); },
    },
    {
      label: 'runtime-processes',
      run: async () => {
        if (!runtimeRoot || !fs.existsSync(runtimeRoot)) return;
        await stopRuntimeOwnedProcesses(runtimeRoot);
      },
    },
    {
      label: 'runtime-profile',
      run: async () => {
        if (!runtimeProfilePath || !fs.existsSync(runtimeProfilePath)) return;
        await retryTransientWindowsOperation('runtime-profile', () => {
          const stat = fs.lstatSync(runtimeProfilePath);
          if (!stat.isDirectory() || stat.isSymbolicLink()
            || normalizePhysicalPath(fs.realpathSync(runtimeProfilePath))
              !== normalizePhysicalPath(runtimeProfilePath)) {
            throw new Error('Updater runtime profile must be a physical directory');
          }
          fs.rmSync(runtimeProfilePath, { recursive: true, force: false });
        }, { attempts: 6, delayMs: 500 });
      },
    },
    ...createdWorktrees.slice().reverse().map(worktree => ({
      label: 'worktree-remove',
      run: async () => {
        if (!temporaryRoot) throw new Error('Temporary root is unavailable');
        await removeWorktree(worktree, temporaryRoot);
      },
    })),
    {
      label: 'temporary-root',
      run: async () => {
        if (!temporaryRoot || !fs.existsSync(temporaryRoot)) return;
        await retryTransientWindowsOperation('temporary-root', () => {
          assertTemporaryRoot(temporaryRoot);
          fs.rmSync(temporaryRoot, { recursive: true, force: false });
        }, { attempts: 6, delayMs: 500 });
      },
    },
    {
      label: 'worktree-prune',
      run: () => runCommand(
        'git',
        ['worktree', 'prune'],
        projectRoot,
        120_000,
        'cleanup',
      ),
    },
    {
      label: 'runtime-root',
      run: async () => {
        if (!runtimeRoot) return;
        await retryTransientWindowsOperation('runtime-root', () => {
          removeUpdaterRuntimeRoot(runtimeRoot, projectRoot);
        }, { attempts: 6, delayMs: 500 });
      },
    },
    {
      label: 'playwright-output',
      run: async () => {
        await retryTransientWindowsOperation('playwright-output', () => {
          removeUpdaterPlaywrightOutputDirectory(projectRoot);
        }, { attempts: 6, delayMs: 500 });
      },
    },
    {
      label: 'version-files',
      run: () => verifyVersionFilesUnchanged(
        originalPackage,
        originalLock,
        originalVersionDiff,
        versions,
      ),
    },
  ]);
  const cleanupFailures = [
    ...new Set([
      ...(runtimeCleanup.cleanupFailures ?? []),
      ...runnerCleanupFailures,
    ]),
  ];

  const runtimeRemoved = !cleanupFailures.includes('runtime-root')
    && (!runtimeRoot || !fs.existsSync(runtimeRoot));
  const runtimeProcessesStopped = !cleanupFailures.includes('runtime-processes');
  const resources: UpdaterDiagnostic['resources'] = {
    appStopped: runtimeProcessesStopped,
    installerStopped: runtimeProcessesStopped,
    serverStopped: runtimeCommandClosed,
    worktreesRemoved: !cleanupFailures.includes('worktree-remove')
      && !cleanupFailures.includes('worktree-prune')
      && createdWorktrees.every(worktree => !fs.existsSync(worktree)),
    installRemoved: runtimeRemoved,
    profileRemoved: !cleanupFailures.includes('runtime-profile')
      && (!runtimeProfilePath || !fs.existsSync(runtimeProfilePath)),
    cacheRemoved: runtimeRemoved,
    runtimeRemoved,
    outputRemoved: !cleanupFailures.includes('playwright-output')
      && !fs.existsSync(getUpdaterPlaywrightOutputDirectory(projectRoot)),
    versionFilesUnchanged: !cleanupFailures.includes('version-files'),
  };

  if (primaryError || cleanupFailures.length > 0) {
    const primaryFailure = primaryError instanceof CommandFailure
      ? primaryError.timedOut ? 'command-timeout' : 'command-failed'
      : primaryError ? 'runtime-failed' : 'cleanup-failed';
    const failureStep = cleanupFailures.length > 0 && !primaryError ? 'cleanup' : primaryStep;
    writeUpdaterDiagnosticEvidence(diagnosticDirectory, {
      schemaVersion: 1,
      headSha,
      result: 'failed',
      phase: cleanupFailures.length > 0 && !primaryError ? 'cleanup' : phase,
      primaryFailure,
      primaryStep: failureStep,
      cleanupFailures: [...new Set(cleanupFailures)],
      resources,
    });
    fs.rmSync(stagingBundlePath, { force: true });
    throw createUpdaterFailure(primaryFailure, failureStep, cleanupFailures);
  }

  try {
    primaryStep = 'evidence';
    if (!fs.existsSync(stagingBundlePath)) {
      throw new Error('Updater runtime did not produce its sanitized evidence bundle');
    }
    await runNpm(
      ['run', 'verify:electron-native'],
      projectRoot,
      180_000,
      'verify-native',
    );
    const bundle = JSON.parse(fs.readFileSync(stagingBundlePath, 'utf8')) as UpdaterEvidenceBundle;
    if (bundle['cleanup-result.json'].headSha !== headSha) {
      throw new Error('Updater evidence bundle is not bound to the exact head');
    }
    Object.assign(bundle['cleanup-result.json'], {
      worktreesRemoved: true,
      runtimeRemoved: true,
      outputRemoved: true,
      versionFilesUnchanged: true,
    });
    const written = writeUpdaterEvidence(evidenceDirectory, bundle, headSha);
    fs.rmSync(stagingBundlePath, { force: true });
    process.stdout.write(`Updater evidence digest=${written.digest}\n`);
  } catch {
    const evidenceCleanupFailures: string[] = [];
    try {
      clearUpdaterE2eArtifactDirectory(projectRoot, 'evidence');
    } catch {
      evidenceCleanupFailures.push('evidence-output');
    }
    writeUpdaterDiagnosticEvidence(diagnosticDirectory, {
      schemaVersion: 1,
      headSha,
      result: 'failed',
      phase: 'evidence',
      primaryFailure: 'evidence-failed',
      primaryStep: 'evidence',
      cleanupFailures: evidenceCleanupFailures,
      resources,
    });
    fs.rmSync(stagingBundlePath, { force: true });
    throw createUpdaterFailure('evidence-failed', 'evidence', evidenceCleanupFailures);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Updater E2E failed'}\n`);
  process.exitCode = 1;
});
