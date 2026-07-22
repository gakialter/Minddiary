import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import {
  assertNoUpdaterE2eSigningEnvironment,
  configureDisposableUpdaterPublish,
  createUpdaterE2eChildEnvironment,
  validateLoopbackProviderUrl,
  writeUpdaterEvidence,
  type UpdaterEvidenceBundle,
} from '../tests/helpers/updaterE2eEvidence';
import {
  createUpdaterRuntimeRoot,
  removeUpdaterPlaywrightOutputDirectory,
  removeUpdaterRuntimeRoot,
} from '../tests/helpers/updaterRuntimeWorkspace';

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
  old: CandidateFixture;
  next: CandidateFixture;
};

const projectRoot = path.resolve(__dirname, '..');
const stagingBundlePath = path.join(projectRoot, 'test-results', 'windows-updater-e2e-bundle.json');
const evidenceDirectory = path.join(projectRoot, 'test-results', 'windows-updater-e2e-evidence');
const temporaryPrefix = 'minddiary-updater-e2e-build-';
const childEnvironment = createUpdaterE2eChildEnvironment(process.env);
const nodeExecutable = process.execPath;
const npmCliPath = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(
  executable: string,
  args: string[],
  cwd: string,
  timeout: number,
  env: NodeJS.ProcessEnv = childEnvironment,
): void {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${executable} terminated with signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`${executable} exited with code ${String(result.status)}`);
}

function capture(executable: string, args: string[], cwd: string): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function runNpm(args: string[], cwd: string, timeout: number): void {
  run(nodeExecutable, [npmCliPath, ...args], cwd, timeout);
}

function runWorkspaceCli(
  worktree: string,
  relativeCliPath: string,
  args: string[],
  timeout: number,
  environment: NodeJS.ProcessEnv = childEnvironment,
): void {
  const cliPath = path.join(worktree, relativeCliPath);
  const stat = fs.lstatSync(cliPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Workspace CLI is not a physical file');
  run(nodeExecutable, [cliPath, ...args], worktree, timeout, environment);
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve loopback port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function assertTemporaryBuildPath(candidate: string, temporaryRoot: string): void {
  const resolved = path.resolve(candidate);
  if (path.dirname(resolved) !== path.resolve(temporaryRoot)) {
    throw new Error('Disposable build path escaped its temporary root');
  }
}

function normalizePhysicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
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
): CandidateFixture {
  if (source.version !== (workspace === 'old' ? '1.16.0' : '1.16.1')) {
    throw new Error('Updater runtime candidate version does not match its fixed workspace');
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
  const blockmapPath = `${setupPath}.blockmap`;
  const latestPath = path.join(releaseDirectory, 'latest.yml');
  const appUpdatePath = path.join(releaseDirectory, 'win-unpacked', 'resources', 'app-update.yml');
  for (const [label, filepath] of Object.entries({ setupPath, blockmapPath, latestPath, appUpdatePath })) {
    const stat = fs.lstatSync(filepath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a physical build file`);
  }
  const packageVersion = JSON.parse(fs.readFileSync(path.join(worktree, 'package.json'), 'utf8')).version as string;
  if (packageVersion !== expectedVersion) throw new Error(`Candidate package version is ${packageVersion}`);
  const latest = load(fs.readFileSync(latestPath, 'utf8')) as { version?: unknown };
  if (latest?.version !== expectedVersion) throw new Error('Generated latest.yml version does not match candidate');
  return { version: expectedVersion, setupPath, blockmapPath, latestPath, appUpdatePath };
}

function buildCandidate(worktree: string, version: string, providerUrl: string): CandidateFixture {
  configureDisposableUpdaterPublish(worktree, version, providerUrl);
  runNpm(['ci'], worktree, 600_000);
  runNpm(['run', 'build:electron'], worktree, 300_000);
  runWorkspaceCli(worktree, 'node_modules/vite/bin/vite.js', ['build'], 300_000);
  runNpm(['run', 'build:resources'], worktree, 300_000);
  runNpm(['run', 'rebuild:electron'], worktree, 600_000);
  runNpm(['run', 'verify:electron-native'], worktree, 180_000);
  runWorkspaceCli(worktree, 'node_modules/electron-builder/out/cli/cli.js', [
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ], 900_000);
  const fixture = readCandidateFixture(worktree, version);
  const appUpdate = load(fs.readFileSync(fixture.appUpdatePath, 'utf8')) as {
    provider?: unknown;
    url?: unknown;
    publisherName?: unknown;
  };
  if (appUpdate.provider !== 'generic' || appUpdate.url !== providerUrl) {
    throw new Error('Generated app-update.yml does not use the expected generic loopback provider');
  }
  if (appUpdate.publisherName !== undefined) {
    throw new Error('Unsigned updater E2E candidate unexpectedly declares publisherName');
  }
  validateLoopbackProviderUrl(providerUrl);
  return fixture;
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Windows NSIS updater E2E requires Windows');
  assertNoUpdaterE2eSigningEnvironment(process.env);
  const npmCliStat = fs.lstatSync(npmCliPath);
  if (!npmCliStat.isFile() || npmCliStat.isSymbolicLink()) {
    throw new Error('Updater E2E requires the physical npm CLI bundled with the active Node runtime');
  }
  process.chdir(projectRoot);
  fs.mkdirSync(path.dirname(stagingBundlePath), { recursive: true });
  fs.rmSync(stagingBundlePath, { force: true });
  const headSha = capture('git', ['rev-parse', 'HEAD'], projectRoot);
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Unable to resolve exact test head SHA');
  const port = await reservePort();
  const providerUrl = `http://127.0.0.1:${port}/`;
  validateLoopbackProviderUrl(providerUrl);
  let temporaryRoot: string | undefined;
  let runtimeRoot: string | undefined;
  let oldWorktree: string | undefined;
  let newWorktree: string | undefined;
  const createdWorktrees: string[] = [];
  let runtimePassed = false;

  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));
    assertTemporaryRoot(temporaryRoot);
    runtimeRoot = createUpdaterRuntimeRoot(projectRoot);
    oldWorktree = path.join(temporaryRoot, 'old');
    newWorktree = path.join(temporaryRoot, 'new');
    assertTemporaryBuildPath(oldWorktree, temporaryRoot);
    assertTemporaryBuildPath(newWorktree, temporaryRoot);
    run('git', ['worktree', 'add', '--detach', oldWorktree, headSha], projectRoot, 180_000);
    createdWorktrees.push(oldWorktree);
    run('git', ['worktree', 'add', '--detach', newWorktree, headSha], projectRoot, 180_000);
    createdWorktrees.push(newWorktree);
    runNpm(['version', '1.16.1', '--no-git-tag-version'], newWorktree, 120_000);
    const oldFixture = buildCandidate(oldWorktree, '1.16.0', providerUrl);
    const newFixture = buildCandidate(newWorktree, '1.16.1', providerUrl);
    const stagedOldFixture = stageCandidateFixture(oldFixture, runtimeRoot, 'old');
    const stagedNewFixture = stageCandidateFixture(newFixture, runtimeRoot, 'new');
    const manifest: FixtureManifest = {
      schemaVersion: 1,
      headSha,
      port,
      old: stagedOldFixture,
      next: stagedNewFixture,
    };
    const manifestPath = path.join(runtimeRoot, 'fixture-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    runWorkspaceCli(projectRoot, 'node_modules/@playwright/test/cli.js', [
      'test',
      '--config',
      'playwright.updater.config.ts',
    ], 4_500_000, {
      ...childEnvironment,
      MINDDIARY_UPDATER_FIXTURE_MANIFEST: manifestPath,
    });
    runtimePassed = true;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (temporaryRoot) {
      for (const worktree of [...createdWorktrees].reverse()) {
        try {
          assertTemporaryRoot(temporaryRoot);
          assertTemporaryBuildPath(worktree, temporaryRoot);
          if (fs.existsSync(worktree)) {
            assertPhysicalDirectory(worktree, 'Disposable updater worktree');
            const removal = spawnSync('git', ['worktree', 'remove', '--force', worktree], {
              cwd: projectRoot,
              encoding: 'utf8',
              windowsHide: true,
              timeout: 180_000,
            });
            if (removal.status !== 0 && fs.existsSync(worktree)) {
              assertPhysicalDirectory(worktree, 'Disposable updater worktree');
              fs.rmSync(worktree, { recursive: true, force: true });
            }
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        assertTemporaryRoot(temporaryRoot);
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      run('git', ['worktree', 'prune'], projectRoot, 120_000);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (runtimeRoot) {
      try {
        removeUpdaterRuntimeRoot(runtimeRoot, projectRoot);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      removeUpdaterPlaywrightOutputDirectory(projectRoot);
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const cleanupPath of [oldWorktree, newWorktree, temporaryRoot]) {
      if (cleanupPath && fs.existsSync(cleanupPath)) {
        cleanupErrors.push(new Error('Disposable updater cleanup left a bounded path behind'));
      }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Disposable updater cleanup failed (${cleanupErrors.length} bounded errors)`);
    }
  }

  if (!runtimePassed || !fs.existsSync(stagingBundlePath)) {
    throw new Error('Updater runtime did not produce its sanitized evidence bundle');
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string };
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };
  if (packageJson.version !== '1.16.0'
    || packageLock.version !== '1.16.0'
    || packageLock.packages['']?.version !== '1.16.0') {
    throw new Error('Temporary 1.16.1 version leaked into the main worktree');
  }
  run('git', ['diff', '--exit-code', '--', 'package.json', 'package-lock.json'], projectRoot, 120_000);
  runNpm(['run', 'verify:electron-native'], projectRoot, 180_000);

  const bundle = JSON.parse(fs.readFileSync(stagingBundlePath, 'utf8')) as UpdaterEvidenceBundle;
  if (bundle['cleanup-result.json'].headSha !== headSha) {
    throw new Error('Updater evidence bundle is not bound to the exact head');
  }
  bundle['cleanup-result.json'].worktreesRemoved = true;
  const written = writeUpdaterEvidence(evidenceDirectory, bundle, headSha);
  fs.rmSync(stagingBundlePath, { force: true });
  process.stdout.write(`Updater evidence digest: ${written.digest}\n`);
}

main().catch(error => {
  fs.rmSync(stagingBundlePath, { force: true });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
