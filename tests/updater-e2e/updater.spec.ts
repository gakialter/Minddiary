import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import {
  cleanupSmokeDiagnosticProcess,
  rerunSmokeDiagnosticProcess,
  runSmokeDiagnosticProcess,
  type SmokeDiagnosticProcessResult,
} from '../helpers/smokeDiagnosticRunner';
import { snapshotDefaultApplicationData } from '../helpers/portableSmokeEvidence';
import {
  createDisposableInstallPath,
  runSetupProcess,
  waitForCondition,
} from '../helpers/setupSmokeEvidence';
import {
  LoopbackUpdaterServer,
  type UpdaterServerRequest,
} from '../helpers/updaterE2eServer';
import {
  validateLoopbackProviderUrl,
  type UpdaterEvidenceBundle,
  type UpdaterEvidenceRecord,
} from '../helpers/updaterE2eEvidence';

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

type AppSession = {
  browser: Browser;
  child: ChildProcessWithoutNullStreams;
  page: Page;
  output: () => string;
};

type RendererUpdaterStatus = {
  status: string;
  version?: string;
  releaseNotes?: string;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
  errorCode?: string;
};

type SeenProcess = { pid: number; name: string; firstSeenAt: number };
type LiveProcess = { pid: number; parentPid: number; name: string; executablePath: string };
type ProcessOwnership = { roots: string[]; files: string[] };

const projectRoot = path.resolve(__dirname, '..', '..');
const stagingBundlePath = path.join(projectRoot, 'test-results', 'windows-updater-e2e-bundle.json');
const releaseNotes = 'MindDiary Windows NSIS updater E2E candidate';

function readManifest(): FixtureManifest {
  const manifestPath = process.env.MINDDIARY_UPDATER_FIXTURE_MANIFEST;
  if (!manifestPath || !path.isAbsolute(manifestPath)) throw new Error('Updater fixture manifest is unavailable');
  const resolvedManifestPath = path.resolve(manifestPath);
  const temporaryRoot = path.dirname(resolvedManifestPath);
  if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir())
    || !path.basename(temporaryRoot).startsWith('minddiary-updater-e2e-build-')
    || path.basename(resolvedManifestPath) !== 'fixture-manifest.json') {
    throw new Error('Updater fixture manifest escaped its direct disposable temporary root');
  }
  for (const [label, directory] of Object.entries({ temporaryRoot, old: path.join(temporaryRoot, 'old'), next: path.join(temporaryRoot, 'new') })) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) {
      throw new Error(`Updater fixture ${label} must be a physical directory`);
    }
  }
  const manifestStat = fs.lstatSync(resolvedManifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || fs.realpathSync(resolvedManifestPath) !== resolvedManifestPath) {
    throw new Error('Updater fixture manifest must be a physical file');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FixtureManifest;
  const expectedCandidate = (workspace: 'old' | 'new', version: '1.16.0' | '1.16.1'): CandidateFixture => {
    const releaseDirectory = path.join(temporaryRoot, workspace, 'release');
    const setupPath = path.join(releaseDirectory, `MindDiary-Setup-${version}.exe`);
    return {
      version,
      setupPath,
      blockmapPath: `${setupPath}.blockmap`,
      latestPath: path.join(releaseDirectory, 'latest.yml'),
      appUpdatePath: path.join(releaseDirectory, 'win-unpacked', 'resources', 'app-update.yml'),
    };
  };
  const expectedOld = expectedCandidate('old', '1.16.0');
  const expectedNew = expectedCandidate('new', '1.16.1');
  if (manifest.schemaVersion !== 1
    || !/^[a-f0-9]{40}$/.test(manifest.headSha)
    || manifest.old.version !== '1.16.0'
    || manifest.next.version !== '1.16.1'
    || !Number.isInteger(manifest.port)
    || manifest.port < 1
    || manifest.port > 65535) {
    throw new Error('Updater fixture manifest is invalid');
  }
  if (JSON.stringify(manifest.old) !== JSON.stringify(expectedOld)
    || JSON.stringify(manifest.next) !== JSON.stringify(expectedNew)) {
    throw new Error('Updater fixture paths do not match the fixed disposable build layout');
  }
  for (const filepath of [
    expectedOld.setupPath,
    expectedOld.blockmapPath,
    expectedOld.latestPath,
    expectedOld.appUpdatePath,
    expectedNew.setupPath,
    expectedNew.blockmapPath,
    expectedNew.latestPath,
    expectedNew.appUpdatePath,
  ]) {
    const stat = fs.lstatSync(filepath);
    if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(filepath) !== filepath) {
      throw new Error('Updater fixture contains a non-physical build artifact');
    }
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (head.status !== 0 || head.stdout.trim() !== manifest.headSha) {
    throw new Error('Updater fixture manifest is not bound to the checked-out HEAD');
  }
  return manifest;
}

function sha256File(filepath: string): string {
  return createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

function sha512File(filepath: string): string {
  return createHash('sha512').update(fs.readFileSync(filepath)).digest('base64');
}

function evidenceRecord(headSha: string, fields: Record<string, unknown>): UpdaterEvidenceRecord {
  return { schemaVersion: 1, headSha, result: 'passed', ...fields };
}

function listProcesses(names: ReadonlySet<string>): Array<{ pid: number; name: string }> {
  const result = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error('Unable to enumerate Windows processes');
  const processes: Array<{ pid: number; name: string }> = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line);
    if (!match || !match[1] || !match[2] || !names.has(match[1].toLowerCase())) continue;
    processes.push({ pid: Number(match[2]), name: match[1] });
  }
  return processes;
}

function createProcessWatcher(names: ReadonlySet<string>): {
  seen: Map<number, SeenProcess>;
  start: () => void;
  stop: () => void;
  sample: () => void;
} {
  const seen = new Map<number, SeenProcess>();
  const sample = () => {
    const now = Date.now();
    for (const processInfo of listProcesses(names)) {
      if (!seen.has(processInfo.pid)) {
        seen.set(processInfo.pid, { ...processInfo, firstSeenAt: now });
      }
    }
  };
  let timer: NodeJS.Timeout | undefined;
  const start = () => {
    if (timer) throw new Error('Process watcher already started');
    sample();
    timer = setInterval(sample, 250);
  };
  return {
    seen,
    sample,
    start,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

function listLiveProcesses(): LiveProcess[] {
  const script = `$items = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    parentPid = [int]$_.ParentProcessId
    name = [string]$_.Name
    executablePath = [string]$_.ExecutablePath
  }
})
[Console]::Out.Write((ConvertTo-Json -InputObject $items -Compress))`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error('Unable to inspect Windows process ownership');
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Windows process ownership result is invalid');
  return parsed.filter((value): value is LiveProcess => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const processInfo = value as Record<string, unknown>;
    return Number.isInteger(processInfo.pid)
      && Number.isInteger(processInfo.parentPid)
      && typeof processInfo.name === 'string'
      && typeof processInfo.executablePath === 'string';
  });
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isOwnedProcess(processInfo: LiveProcess, ownership: ProcessOwnership): boolean {
  if (!processInfo.executablePath) return false;
  const executablePath = path.resolve(processInfo.executablePath);
  return ownership.files.some(file => executablePath.toLowerCase() === path.resolve(file).toLowerCase())
    || ownership.roots.some(root => isPathInside(root, executablePath));
}

function ownedLiveProcesses(ownership: ProcessOwnership): LiveProcess[] {
  return listLiveProcesses().filter(processInfo => isOwnedProcess(processInfo, ownership));
}

function terminateOwnedProcesses(ownership: ProcessOwnership, allowedPids?: ReadonlySet<number>): number[] {
  const terminated: number[] = [];
  for (const processInfo of ownedLiveProcesses(ownership)) {
    if (allowedPids && !allowedPids.has(processInfo.pid)) continue;
    spawnSync('taskkill.exe', ['/PID', String(processInfo.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 30_000,
    });
    terminated.push(processInfo.pid);
  }
  return terminated;
}

async function waitForOwnedInstaller(
  watcher: ReturnType<typeof createProcessWatcher>,
  ownership: ProcessOwnership,
  installerName: string,
  startedAt: number,
): Promise<number[]> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    watcher.sample();
    const candidates = new Set([...watcher.seen.values()]
      .filter(processInfo => processInfo.firstSeenAt >= startedAt && processInfo.name.toLowerCase() === installerName)
      .map(processInfo => processInfo.pid));
    const owned = ownedLiveProcesses(ownership).filter(processInfo => candidates.has(processInfo.pid));
    if (owned.length > 0) return owned.map(processInfo => processInfo.pid);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Owned NSIS updater process was not observed');
}

function clickAssistedInstallerFinish(installerPids: readonly number[], ownership: ProcessOwnership): boolean {
  const allowed = new Set(installerPids);
  const currentPids = ownedLiveProcesses(ownership)
    .filter(processInfo => allowed.has(processInfo.pid))
    .map(processInfo => processInfo.pid);
  if (currentPids.length === 0) return false;
  const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MindDiaryUpdaterWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
$clicked = $false
foreach ($id in ($env:MINDDIARY_E2E_OWNED_PIDS -split ',')) {
  $process = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.MainWindowHandle -eq 0) { continue }
  $button = [MindDiaryUpdaterWindow]::GetDlgItem($process.MainWindowHandle, 1)
  if ($button -eq [IntPtr]::Zero) { continue }
  [void][MindDiaryUpdaterWindow]::SendMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  $clicked = $true
}
[Console]::Out.Write($(if ($clicked) { 'clicked' } else { 'not-clicked' }))`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MINDDIARY_E2E_OWNED_PIDS: currentPids.join(',') },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error('Unable to drive the owned NSIS Finish control');
  return result.stdout.trim() === 'clicked';
}

async function completeAssistedInstaller(
  installerName: string,
  ownership: ProcessOwnership,
): Promise<void> {
  const finishDeadline = Date.now() + 60_000;
  let clicked = false;
  while (Date.now() < finishDeadline && !clicked) {
    const installerPids = ownedLiveProcesses(ownership)
      .filter(processInfo => processInfo.name.toLowerCase() === installerName)
      .map(processInfo => processInfo.pid);
    clicked = clickAssistedInstallerFinish(installerPids, ownership);
    if (!clicked) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!clicked) throw new Error('Owned NSIS updater Finish control was not invoked');
  const exitDeadline = Date.now() + 120_000;
  while (Date.now() < exitDeadline) {
    if (!ownedLiveProcesses(ownership).some(processInfo => processInfo.name.toLowerCase() === installerName)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Owned NSIS updater did not exit after Finish');
}

async function settleOwnedRestart(
  watcher: ReturnType<typeof createProcessWatcher>,
  ownership: ProcessOwnership,
  installedExecutable: string,
  oldPid: number | undefined,
  startedAt: number,
): Promise<boolean> {
  const observed = new Set<number>();
  const deadline = Date.now() + 45_000;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    watcher.sample();
    const candidatePids = new Set([...watcher.seen.values()]
      .filter(processInfo => processInfo.firstSeenAt >= startedAt
        && processInfo.name.toLowerCase() === 'minddiary.exe'
        && processInfo.pid !== oldPid)
      .map(processInfo => processInfo.pid));
    const ownedRestartPids = ownedLiveProcesses(ownership)
      .filter(processInfo => candidatePids.has(processInfo.pid)
        && path.resolve(processInfo.executablePath).toLowerCase() === path.resolve(installedExecutable).toLowerCase())
      .map(processInfo => processInfo.pid);
    let foundNew = false;
    for (const pid of ownedRestartPids) {
      if (!observed.has(pid)) {
        observed.add(pid);
        foundNew = true;
      }
    }
    if (foundNew) stableSince = Date.now();
    terminateOwnedProcesses(ownership, new Set(ownedRestartPids));
    if (Date.now() - stableSince >= 10_000
      && !ownedLiveProcesses(ownership).some(processInfo => candidatePids.has(processInfo.pid))) {
      return observed.size > 0;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error('Owned updated application restart did not reach a stable exit state');
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function launchInstalledApp(
  executablePath: string,
  profilePath: string,
  ambientRoot: string,
): Promise<AppSession> {
  const child = spawn(executablePath, [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
  ], {
    env: {
      ...process.env,
      APPDATA: path.join(ambientRoot, 'roaming'),
      LOCALAPPDATA: path.join(ambientRoot, 'local'),
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
    windowsHide: true,
  });
  let combinedOutput = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Installed app CDP startup timed out\n${combinedOutput}`)), 45_000);
    const inspect = (chunk: Buffer) => {
      combinedOutput = `${combinedOutput}${chunk.toString('utf8')}`.slice(-32_000);
      const match = combinedOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match?.[1]) return;
      const url = new URL(match[1]);
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        clearTimeout(timer);
        reject(new Error('Installed app CDP endpoint is not loopback'));
        return;
      }
      clearTimeout(timer);
      resolve(url.href);
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Installed app exited before CDP was ready: ${String(code)}`));
    });
  });
  try {
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Installed app exposed no browser context');
    const page = await waitForConditionResult(
      () => context.pages().find(candidate => candidate.url().startsWith('file:')),
      'installed application page',
      30_000,
    );
    await page.waitForLoadState('load');
    return { browser, child, page, output: () => combinedOutput };
  } catch (error) {
    if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(child, 5_000);
    throw error;
  }
}

async function closeInstalledApp(session: AppSession): Promise<void> {
  try {
    if (!session.page.isClosed()) {
      await session.page.evaluate(() => window.api.window.close()).catch(() => undefined);
    }
    await waitForExit(session.child, 8_000);
  } finally {
    await session.browser.close().catch(() => undefined);
    if (!await waitForExit(session.child, 3_000) && session.child.pid) {
      spawnSync('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 30_000,
      });
    }
    if (!await waitForExit(session.child, 5_000)) throw new Error('Installed app did not exit');
  }
}

async function waitForConditionResult<T>(
  read: () => T | undefined,
  label: string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForUpdaterStatus(
  page: Page,
  expected: string,
  timeoutMs: number,
): Promise<RendererUpdaterStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => window.api.updater.getStatus()) as RendererUpdaterStatus;
    if (status.status === expected) return status;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const status = await page.evaluate(() => window.api.updater.getStatus()) as RendererUpdaterStatus;
  throw new Error(`Timed out waiting for updater status ${expected}; current=${status.status}`);
}

async function openSettingsAndCaptureEvents(page: Page): Promise<void> {
  const startButton = page.getByRole('button', { name: '开始使用', exact: true });
  if (await startButton.isVisible().catch(() => false)) await startButton.click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('update-check-btn')).toBeVisible();
  await page.evaluate(() => {
    const events: RendererUpdaterStatus[] = [];
    Reflect.set(globalThis, '__minddiaryUpdaterE2eEvents', events);
    window.api.updater.onStatusChange(status => {
      const store = Reflect.get(globalThis, '__minddiaryUpdaterE2eEvents');
      if (Array.isArray(store)) store.push({ ...status });
    });
  });
}

async function clearUpdaterEvents(page: Page): Promise<void> {
  await page.evaluate(() => Reflect.set(globalThis, '__minddiaryUpdaterE2eEvents', []));
}

async function readUpdaterEvents(page: Page): Promise<RendererUpdaterStatus[]> {
  return page.evaluate(() => {
    const events = Reflect.get(globalThis, '__minddiaryUpdaterE2eEvents');
    return Array.isArray(events) ? events : [];
  }) as Promise<RendererUpdaterStatus[]>;
}

async function readSeededDataFingerprint(page: Page): Promise<{
  present: boolean;
  digest: string;
}> {
  const data = await page.evaluate(async () => {
    const entries = (await window.api.entries.getAll({})).filter(entry =>
      entry.date === '2099-12-30' && entry.title === 'MindDiary install smoke');
    if (entries.length !== 1 || !entries[0]) return null;
    const attachments = await window.api.attachments.getByEntry(entries[0].id);
    if (attachments.length !== 1 || !attachments[0]) return null;
    return {
      entryId: entries[0].id,
      attachmentId: attachments[0].id,
      attachmentFile: attachments[0].filepath,
    };
  });
  if (!data) return { present: false, digest: '' };
  return {
    present: true,
    digest: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}

function requestsAfter(requests: UpdaterServerRequest[], sequence: number): UpdaterServerRequest[] {
  return requests.filter(request => request.sequence > sequence);
}

function lastRequestSequence(requests: UpdaterServerRequest[]): number {
  return requests.length > 0 ? requests[requests.length - 1]?.sequence ?? 0 : 0;
}

function attemptedInstallerDownload(requests: UpdaterServerRequest[], setupName: string): boolean {
  return requests.some(request => request.resource === setupName && request.status >= 200 && request.status < 300);
}

function attemptedUpdateArtifactDownload(requests: UpdaterServerRequest[]): boolean {
  return requests.some(request => request.resource !== 'latest.yml');
}

function readProductVersion(filepath: string): string {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-Item -LiteralPath $env:MINDDIARY_E2E_FILE).VersionInfo.ProductVersion',
  ], {
    env: { ...process.env, MINDDIARY_E2E_FILE: filepath },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error('Unable to read installed application version');
  return result.stdout.trim().replace(/\.0$/, '');
}

async function waitForProductVersion(filepath: string, version: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (readProductVersion(filepath) === version) return;
    } catch {
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Installed application did not reach version ${version}`);
}

async function verifyPortReleased(port: number): Promise<boolean> {
  const probe = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    await new Promise<void>(resolve => probe.close(() => resolve()));
  }
}

test('updates a real installed NSIS application through electron-updater and preserves disposable data', async () => {
  test.skip(process.platform !== 'win32', 'Windows NSIS updater E2E requires Windows');
  const manifest = readManifest();
  const installPath = createDisposableInstallPath();
  const ambientRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-updater-e2e-ambient-'));
  fs.mkdirSync(path.join(ambientRoot, 'roaming'), { recursive: true });
  fs.mkdirSync(path.join(ambientRoot, 'local'), { recursive: true });
  const installedExecutable = path.join(installPath, 'MindDiary.exe');
  const installedUninstaller = path.join(installPath, 'Uninstall MindDiary.exe');
  const ownership: ProcessOwnership = {
    roots: [installPath, ambientRoot],
    files: [manifest.old.setupPath, manifest.next.setupPath],
  };
  const trackedNames = new Set([
    'minddiary.exe',
    path.basename(manifest.old.setupPath).toLowerCase(),
    path.basename(manifest.next.setupPath).toLowerCase(),
    'uninstall minddiary.exe',
  ]);
  expect(listProcesses(trackedNames)).toEqual([]);
  const watcher = createProcessWatcher(trackedNames);
  const beforeDefaultApplicationData = snapshotDefaultApplicationData();
  const server = new LoopbackUpdaterServer({
    oldSetupPath: manifest.old.setupPath,
    oldBlockmapPath: manifest.old.blockmapPath,
    newSetupPath: manifest.next.setupPath,
    newBlockmapPath: manifest.next.blockmapPath,
    oldLatestPath: manifest.old.latestPath,
    newLatestPath: manifest.next.latestPath,
    releaseNotes,
  });
  let seededRun: SmokeDiagnosticProcessResult | undefined;
  let reopenedRun: SmokeDiagnosticProcessResult | undefined;
  let session: AppSession | undefined;
  let finalSession: AppSession | undefined;
  let serverClosed = false;
  let installRemoved = false;
  let profileRemoved = false;
  let cacheRemoved = false;
  let portReleased = false;
  let processesExited = false;
  let defaultAppDataUnchanged = false;
  let evidenceBundle: UpdaterEvidenceBundle | undefined;
  let installedVersionAfterUpdate = '';

  try {
    expect(await server.start(manifest.port)).toBe(manifest.port);
    server.setMode('no-update');
    let install: Awaited<ReturnType<typeof runSetupProcess>>;
    try {
      install = await runSetupProcess(
        manifest.old.setupPath,
        ['/S', `/D=${installPath}`],
        'Windows updater E2E old candidate install',
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Windows updater E2E old candidate install timed out')) {
        throw new Error(
          `${error.message}; installedExecutablePresent=${fs.existsSync(installedExecutable)}; `
          + `installedUninstallerPresent=${fs.existsSync(installedUninstaller)}`,
        );
      }
      throw error;
    }
    expect(install.exitCode).toBe(0);
    await waitForCondition(
      () => fs.existsSync(installedExecutable) && fs.existsSync(installedUninstaller),
      'updater E2E installed files',
    );
    expect(readProductVersion(installedExecutable)).toBe('1.16.0');
    watcher.start();

    const installedAppUpdatePath = path.join(installPath, 'resources', 'app-update.yml');
    const installedAppUpdate = load(fs.readFileSync(installedAppUpdatePath, 'utf8')) as {
      provider?: unknown;
      url?: unknown;
      publisherName?: unknown;
    };
    expect(installedAppUpdate.provider).toBe('generic');
    expect(installedAppUpdate.publisherName).toBeUndefined();
    const providerUrl = validateLoopbackProviderUrl(String(installedAppUpdate.url));
    expect(providerUrl.port).toBe(String(manifest.port));

    seededRun = await runSmokeDiagnosticProcess({
      executablePath: installedExecutable,
      scenario: 'install-profile',
      expectedPackaged: true,
      timeoutMs: 120_000,
    });
    expect(seededRun.result).toMatchObject({
      applicationVersion: '1.16.0',
      electronVersion: '42.6.1',
      nodeModuleAbi: '146',
      isPackaged: true,
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      nativeSqlite: { loaded: true, query: 1, schemaVersion: 5 },
      result: 'passed',
    });

    session = await launchInstalledApp(installedExecutable, seededRun.profilePath, ambientRoot);
    await openSettingsAndCaptureEvents(session.page);
    await waitForUpdaterStatus(session.page, 'not-available', 30_000);
    const seededData = await readSeededDataFingerprint(session.page);
    expect(seededData.present).toBe(true);

    let requestMarker = lastRequestSequence(server.getRequests());
    const noUpdateProcessMarker = Date.now();
    await clearUpdaterEvents(session.page);
    const noUpdateCheck = await session.page.evaluate(() => window.api.updater.check());
    expect(noUpdateCheck.success).toBe(true);
    await waitForUpdaterStatus(session.page, 'not-available', 30_000);
    const noUpdateEvents = await readUpdaterEvents(session.page);
    const noUpdateRequests = requestsAfter(server.getRequests(), requestMarker);
    const rejectedInstall = await session.page.evaluate(() => window.api.updater.install());
    expect(rejectedInstall.success).toBe(false);
    watcher.sample();
    const noUpdateInstallAttempted = [...watcher.seen.values()].some(processInfo =>
      processInfo.firstSeenAt >= noUpdateProcessMarker
      && processInfo.name.toLowerCase() === path.basename(manifest.next.setupPath).toLowerCase());
    expect(noUpdateInstallAttempted).toBe(false);
    expect((await readSeededDataFingerprint(session.page)).digest).toBe(seededData.digest);

    requestMarker = lastRequestSequence(server.getRequests());
    const invalidProcessMarker = Date.now();
    server.setMode('invalid-metadata');
    await clearUpdaterEvents(session.page);
    const invalidCheck = await session.page.evaluate(() => window.api.updater.check());
    expect(invalidCheck.success).toBe(false);
    const invalidStatus = await waitForUpdaterStatus(session.page, 'error', 30_000);
    expect(invalidStatus).toMatchObject({ errorCode: 'invalid-metadata', message: '更新元数据无效' });
    const invalidRequests = requestsAfter(server.getRequests(), requestMarker);
    const invalidOldVersionPreserved = readProductVersion(installedExecutable) === '1.16.0';
    watcher.sample();
    const invalidInstallAttempted = [...watcher.seen.values()].some(processInfo =>
      processInfo.firstSeenAt >= invalidProcessMarker
      && processInfo.name.toLowerCase() === path.basename(manifest.next.setupPath).toLowerCase());
    expect(invalidOldVersionPreserved).toBe(true);
    expect(invalidInstallAttempted).toBe(false);
    expect((await readSeededDataFingerprint(session.page)).digest).toBe(seededData.digest);

    requestMarker = lastRequestSequence(server.getRequests());
    server.setMode('bad-checksum');
    await clearUpdaterEvents(session.page);
    const checksumProcessMarker = Date.now();
    const checksumCheck = await session.page.evaluate(() => window.api.updater.check());
    expect(checksumCheck.success).toBe(true);
    const checksumStatus = await waitForUpdaterStatus(session.page, 'error', 240_000);
    expect(checksumStatus).toMatchObject({ errorCode: 'checksum-mismatch', message: '更新文件校验失败' });
    const checksumEvents = await readUpdaterEvents(session.page);
    const checksumRequests = requestsAfter(server.getRequests(), requestMarker);
    expect(checksumEvents.some(event => event.status === 'downloaded')).toBe(false);
    expect(attemptedInstallerDownload(checksumRequests, path.basename(manifest.next.setupPath))).toBe(true);
    expect((await session.page.evaluate(() => window.api.updater.install())).success).toBe(false);
    watcher.sample();
    expect([...watcher.seen.values()].some(processInfo =>
      processInfo.firstSeenAt >= checksumProcessMarker
      && processInfo.name.toLowerCase() === path.basename(manifest.next.setupPath).toLowerCase())).toBe(false);
    expect((await readSeededDataFingerprint(session.page)).digest).toBe(seededData.digest);

    await closeInstalledApp(session);
    session = undefined;
    server.setMode('no-update');
    session = await launchInstalledApp(installedExecutable, seededRun.profilePath, ambientRoot);
    await openSettingsAndCaptureEvents(session.page);
    await waitForUpdaterStatus(session.page, 'not-available', 30_000);
    const checksumOldAppRestarted = readProductVersion(installedExecutable) === '1.16.0'
      && (await readSeededDataFingerprint(session.page)).digest === seededData.digest;
    expect(checksumOldAppRestarted).toBe(true);

    requestMarker = lastRequestSequence(server.getRequests());
    server.setMode('positive');
    await clearUpdaterEvents(session.page);
    await session.page.getByTestId('update-check-btn').click();
    const downloadedStatus = await waitForUpdaterStatus(session.page, 'downloaded', 300_000);
    expect(downloadedStatus.version).toBe('1.16.1');
    expect(downloadedStatus.releaseNotes).toBe(releaseNotes);
    await expect(session.page.getByTestId('remote-release-notes')).toContainText(releaseNotes);
    const positiveEvents = await readUpdaterEvents(session.page);
    const positiveSequence = positiveEvents.map(event => event.status);
    expect(positiveSequence[0]).toBe('checking');
    expect(positiveSequence).toContain('available');
    expect(positiveSequence).toContain('downloading');
    expect(positiveSequence[positiveSequence.length - 1]).toBe('downloaded');
    const progressEvents = positiveEvents.filter(event => event.status === 'downloading');
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.every(event =>
      typeof event.percent === 'number'
      && event.percent >= 0
      && event.percent <= 100
      && typeof event.transferred === 'number'
      && typeof event.total === 'number'
      && event.transferred >= 0
      && event.transferred <= event.total)).toBe(true);
    const positiveRequests = requestsAfter(server.getRequests(), requestMarker);
    expect(attemptedInstallerDownload(positiveRequests, path.basename(manifest.next.setupPath))).toBe(true);

    const installStartedAt = Date.now();
    const oldPid = session.child.pid;
    await session.page.getByTestId('update-install-btn').click();
    expect(await waitForExit(session.child, 60_000)).toBe(true);
    await session.browser.close().catch(() => undefined);
    session = undefined;
    const ownedInstallerPids = await waitForOwnedInstaller(
      watcher,
      ownership,
      path.basename(manifest.next.setupPath).toLowerCase(),
      installStartedAt,
    );
    await waitForProductVersion(installedExecutable, '1.16.1', 180_000);
    installedVersionAfterUpdate = readProductVersion(installedExecutable);
    const installerProcessObserved = ownedInstallerPids.length > 0;
    const installerName = path.basename(manifest.next.setupPath).toLowerCase();
    await completeAssistedInstaller(installerName, ownership);
    const installerExited = !ownedLiveProcesses(ownership)
      .some(processInfo => processInfo.name.toLowerCase() === installerName);
    expect(installerExited).toBe(true);
    const autoRestartObserved = await settleOwnedRestart(
      watcher,
      ownership,
      installedExecutable,
      oldPid,
      installStartedAt,
    );

    reopenedRun = await rerunSmokeDiagnosticProcess({
      previous: seededRun,
      executablePath: installedExecutable,
      scenario: 'install-profile',
      expectedPackaged: true,
      timeoutMs: 120_000,
    });
    expect(reopenedRun.result).toMatchObject({
      applicationVersion: '1.16.1',
      electronVersion: '42.6.1',
      nodeModuleAbi: '146',
      isPackaged: true,
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      nativeSqlite: { loaded: true, query: 1, schemaVersion: 5 },
      result: 'passed',
    });
    expect(reopenedRun.result.evidence).toEqual(expect.arrayContaining([
      { check: 'installed-profile-reopened', passed: true },
      { check: 'profile-data-retained', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'profile-data-cleanup', passed: true },
      { check: 'install-profile-business-data-exact', passed: true },
      { check: 'sqlite-schema-current', passed: true },
    ]));

    server.setMode('no-update');
    finalSession = await launchInstalledApp(installedExecutable, reopenedRun.profilePath, ambientRoot);
    await openSettingsAndCaptureEvents(finalSession.page);
    const cleanUpdaterStatus = await waitForUpdaterStatus(finalSession.page, 'not-available', 30_000);
    expect(cleanUpdaterStatus.status).toBe('not-available');
    expect((await readSeededDataFingerprint(finalSession.page)).present).toBe(false);
    await closeInstalledApp(finalSession);
    finalSession = undefined;

    const uninstall = await runSetupProcess(installedUninstaller, ['/S'], 'Windows updater E2E final uninstall');
    expect(uninstall.exitCode).toBe(0);
    await waitForCondition(() => !fs.existsSync(installPath), 'updater E2E install removal');

    const allRequests = server.getRequests();
    expect(allRequests.length).toBeGreaterThan(0);
    expect(allRequests.every(request => request.loopback)).toBe(true);
    expect(allRequests.every(request => !request.authorizationPresent && !request.cookiePresent)).toBe(true);

    const positiveLatest = load(fs.readFileSync(manifest.next.latestPath, 'utf8')) as {
      sha512: string;
      path: string;
      files: Array<{ url: string; sha512: string }>;
    };
    const metadataSha512 = positiveLatest.files[0]?.sha512 ?? positiveLatest.sha512;
    expect(metadataSha512).toBe(sha512File(manifest.next.setupPath));
    expect(sha256File(manifest.next.setupPath)).toMatch(/^[a-f0-9]{64}$/);

    evidenceBundle = {
      'old-build-manifest.json': evidenceRecord(manifest.headSha, {
        candidateVersion: '1.16.0',
        setupSha256: sha256File(manifest.old.setupPath),
        setupSize: fs.statSync(manifest.old.setupPath).size,
        blockmapSha256: sha256File(manifest.old.blockmapPath),
        provider: { kind: 'generic', host: 'ipv4-loopback', credentials: false },
      }),
      'new-build-manifest.json': evidenceRecord(manifest.headSha, {
        candidateVersion: '1.16.1',
        setupSha256: sha256File(manifest.next.setupPath),
        setupSize: fs.statSync(manifest.next.setupPath).size,
        blockmapSha256: sha256File(manifest.next.blockmapPath),
        latestVersion: '1.16.1',
        latestPath: positiveLatest.path,
        latestFiles: positiveLatest.files.map(file => file.url),
        metadataSha512,
      }),
      'old-version-start.json': evidenceRecord(manifest.headSha, {
        applicationVersion: seededRun.result.applicationVersion,
        electronVersion: seededRun.result.electronVersion,
        electronAbi: seededRun.result.nodeModuleAbi,
        sqliteSchemaVersion: seededRun.result.nativeSqlite.schemaVersion,
        isPackaged: seededRun.result.isPackaged,
        sandbox: seededRun.result.sandbox,
        profileVerified: seededRun.result.evidence.some(item => item.check === 'disposable-profile' && item.passed),
      }),
      'updater-event-log.json': evidenceRecord(manifest.headSha, {
        sequence: positiveSequence,
        availableVersion: downloadedStatus.version,
        releaseNotesMatched: downloadedStatus.releaseNotes === releaseNotes,
        progressBounded: true,
      }),
      'update-server-log.json': evidenceRecord(manifest.headSha, {
        requests: allRequests,
        installedProvider: 'generic-loopback',
        observedProviderRequestsAllLoopback: true,
        observedProviderRequestsNoCredentials: true,
      }),
      'update-downloaded.json': evidenceRecord(manifest.headSha, {
        version: downloadedStatus.version,
        metadataSha512,
        installerSha256: sha256File(manifest.next.setupPath),
        checksumVerified: metadataSha512 === sha512File(manifest.next.setupPath),
        blockmapRequested: positiveRequests.some(request => request.resource.endsWith('.blockmap')),
        downloadMode: positiveRequests.some(request => request.resource.endsWith('.blockmap'))
          ? 'blockmap-requested'
          : 'full',
      }),
      'install-transition.json': evidenceRecord(manifest.headSha, {
        quitAndInstallAfterDownloaded: positiveSequence[positiveSequence.length - 1] === 'downloaded',
        oldProcessExited: true,
        installerProcessObserved,
        installerExited,
        assistedFinishHandled: true,
        installedVersion: installedVersionAfterUpdate,
        autoRestartObserved,
      }),
      'new-version-start.json': evidenceRecord(manifest.headSha, {
        applicationVersion: reopenedRun.result.applicationVersion,
        electronVersion: reopenedRun.result.electronVersion,
        electronAbi: reopenedRun.result.nodeModuleAbi,
        sqliteSchemaVersion: reopenedRun.result.nativeSqlite.schemaVersion,
        isPackaged: reopenedRun.result.isPackaged,
        sandbox: reopenedRun.result.sandbox,
      }),
      'data-retention.json': evidenceRecord(manifest.headSha, {
        profileReused: reopenedRun.profilePath === seededRun.profilePath,
        entryRetained: reopenedRun.result.evidence.some(item => item.check === 'profile-data-retained' && item.passed),
        attachmentRetained: reopenedRun.result.evidence.some(item => item.check === 'profile-data-read-back' && item.passed),
        localProtocolRead: reopenedRun.result.evidence.some(item => item.check === 'local-protocol-load' && item.passed),
        markerCleaned: reopenedRun.result.evidence.some(item => item.check === 'profile-data-cleanup' && item.passed),
        businessDataExact: reopenedRun.result.evidence.some(item => item.check === 'install-profile-business-data-exact' && item.passed),
        dataDigest: seededData.digest,
      }),
      'negative-no-update.json': evidenceRecord(manifest.headSha, {
        eventObserved: noUpdateEvents.some(event => event.status === 'not-available'),
        downloadAttempted: attemptedUpdateArtifactDownload(noUpdateRequests),
        installAttempted: noUpdateInstallAttempted,
        dataUnchanged: true,
      }),
      'negative-metadata.json': evidenceRecord(manifest.headSha, {
        safeErrorCode: invalidStatus.errorCode,
        downloadAttempted: attemptedUpdateArtifactDownload(invalidRequests),
        installAttempted: invalidInstallAttempted,
        oldVersionPreserved: invalidOldVersionPreserved,
        dataUnchanged: true,
      }),
      'negative-checksum.json': evidenceRecord(manifest.headSha, {
        safeErrorCode: checksumStatus.errorCode,
        updateDownloadedObserved: checksumEvents.some(event => event.status === 'downloaded'),
        quitAndInstallCalled: false,
        installerProcessObserved: false,
        oldAppRestarted: checksumOldAppRestarted,
        dataUnchanged: true,
      }),
      'cleanup-result.json': evidenceRecord(manifest.headSha, {
        serverClosed: false,
        processesExited: false,
        installRemoved: false,
        profileRemoved: false,
        cacheRemoved: false,
        worktreesRemoved: false,
        portReleased: false,
        defaultAppDataUnchanged: false,
      }),
    };
  } finally {
    if (session) await closeInstalledApp(session).catch(() => undefined);
    if (finalSession) await closeInstalledApp(finalSession).catch(() => undefined);
    await server.stop().then(() => { serverClosed = true; }).catch(() => undefined);
    try { terminateOwnedProcesses(ownership); } catch {
    }
    if (fs.existsSync(installedUninstaller)) {
      await runSetupProcess(installedUninstaller, ['/S'], 'Windows updater E2E failure uninstall').catch(() => undefined);
    }
    try { watcher.stop(); } catch {
    }
    try { watcher.sample(); } catch {
    }
    try { terminateOwnedProcesses(ownership); } catch {
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
    try { processesExited = ownedLiveProcesses(ownership).length === 0; } catch {
      processesExited = false;
    }
    try {
      if (fs.existsSync(installPath)) fs.rmSync(installPath, { recursive: true, force: true });
    } catch {
    }
    installRemoved = !fs.existsSync(installPath);
    try { if (reopenedRun) cleanupSmokeDiagnosticProcess(reopenedRun); } catch {
    }
    try { if (seededRun) cleanupSmokeDiagnosticProcess(seededRun); } catch {
    }
    profileRemoved = !seededRun || !fs.existsSync(seededRun.profilePath);
    try { fs.rmSync(ambientRoot, { recursive: true, force: true }); } catch {
    }
    cacheRemoved = !fs.existsSync(ambientRoot);
    portReleased = await verifyPortReleased(manifest.port).catch(() => false);
    try {
      defaultAppDataUnchanged = JSON.stringify(snapshotDefaultApplicationData()) === JSON.stringify(beforeDefaultApplicationData);
    } catch {
      defaultAppDataUnchanged = false;
    }
  }

  expect(evidenceBundle).toBeDefined();
  expect(serverClosed).toBe(true);
  expect(processesExited).toBe(true);
  expect(installRemoved).toBe(true);
  expect(profileRemoved).toBe(true);
  expect(cacheRemoved).toBe(true);
  expect(portReleased).toBe(true);
  expect(defaultAppDataUnchanged).toBe(true);
  if (!evidenceBundle) throw new Error('Updater evidence bundle was not created');
  evidenceBundle['cleanup-result.json'] = evidenceRecord(manifest.headSha, {
    serverClosed,
    processesExited,
    installRemoved,
    profileRemoved,
    cacheRemoved,
    worktreesRemoved: false,
    portReleased,
    defaultAppDataUnchanged,
  });
  fs.mkdirSync(path.dirname(stagingBundlePath), { recursive: true });
  fs.rmSync(stagingBundlePath, { force: true });
  fs.writeFileSync(stagingBundlePath, `${JSON.stringify(evidenceBundle, null, 2)}\n`, { flag: 'wx' });
});
