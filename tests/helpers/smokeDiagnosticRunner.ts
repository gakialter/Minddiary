import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSmokeDiagnosticProfileMarker,
  type SmokeDiagnosticResult,
  type SmokeDiagnosticScenario,
} from '../../electron/smokeDiagnostics';

const profilePrefix = 'minddiary-smoke-profile-';
const resultPrefix = 'minddiary-smoke-result-';

export type SmokeDiagnosticProcessResult = {
  result: SmokeDiagnosticResult;
  profileFiles: string[];
  profilePath: string;
  outputPath: string;
  token: string;
  outputText: string;
};

export type RejectedSmokeDiagnosticProcessResult = {
  exitCode: number | null;
  outputExists: boolean;
  outputText: string;
  profileFiles: string[];
  profilePath: string;
  outputPath: string;
};

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
}

function waitForProcessClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  label: string,
  getOutput: () => string,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let killGraceTimer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      killGraceTimer = setTimeout(() => {
        reject(new Error(`${label} did not close after termination. Output:\n${getOutput()}`));
      }, 5_000);
    }, timeoutMs);
    child.once('error', error => {
      cleanup();
      reject(error);
    });
    child.once('close', code => {
      cleanup();
      if (timedOut) reject(new Error(`${label} timed out. Output:\n${getOutput()}`));
      else resolve(code);
    });
  });
}

function collectRelativeFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function assertDisposablePath(filepath: string, prefix: string): void {
  const resolved = path.resolve(filepath);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`Refusing to clean unexpected diagnostic path: ${resolved}`);
  }
}

function cleanupDisposablePaths(profilePath: string, outputPath: string): void {
  assertDisposablePath(profilePath, profilePrefix);
  assertDisposablePath(outputPath, resultPrefix);
  fs.rmSync(profilePath, { recursive: true, force: true });
  fs.rmSync(outputPath, { force: true });
}

export async function runSmokeDiagnosticProcess(options: {
  executablePath: string;
  leadingArgs?: string[];
  scenario: SmokeDiagnosticScenario;
  expectedPackaged: boolean;
}): Promise<SmokeDiagnosticProcessResult> {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), `${profilePrefix}${digest.slice(0, 16)}-`));
  const outputPath = path.join(os.tmpdir(), `${resultPrefix}${randomUUID()}.json`);
  createSmokeDiagnosticProfileMarker(profilePath, token);
  const args = [
    ...(options.leadingArgs ?? []),
    `--minddiary-smoke-scenario=${options.scenario}`,
    `--minddiary-smoke-output=${outputPath}`,
    `--user-data-dir=${profilePath}`,
  ];
  try {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      MINDDIARY_SMOKE_TOKEN: token,
    };
    delete childEnvironment.NODE_ENV;
    const child = spawn(options.executablePath, args, {
      env: childEnvironment,
      stdio: 'pipe',
      windowsHide: true,
    });
    let outputText = '';
    const capture = (chunk: Buffer) => {
      outputText = `${outputText}${chunk.toString('utf8')}`.slice(-32_000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const exitCode = await waitForProcessClose(child, 45_000, 'Diagnostic process', () => outputText);
    if (exitCode !== 0) {
      throw new Error(`Diagnostic process exited with code ${String(exitCode)}. Output:\n${outputText}`);
    }
    if (!fs.existsSync(outputPath)) throw new Error('Diagnostic result file was not created');

    const result = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as SmokeDiagnosticResult;
    if (result.isPackaged !== options.expectedPackaged) {
      throw new Error(`Diagnostic packaged state mismatch: ${String(result.isPackaged)}`);
    }
    return {
      result,
      profileFiles: collectRelativeFiles(profilePath),
      profilePath,
      outputPath,
      token,
      outputText,
    };
  } catch (error) {
    cleanupDisposablePaths(profilePath, outputPath);
    throw error;
  }
}

export function cleanupSmokeDiagnosticProcess(result: SmokeDiagnosticProcessResult): void {
  cleanupDisposablePaths(result.profilePath, result.outputPath);
}

export async function runRejectedSmokeDiagnosticProcess(options: {
  executablePath: string;
  leadingArgs?: string[];
}): Promise<RejectedSmokeDiagnosticProcessResult> {
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const outputPath = path.join(os.tmpdir(), `${resultPrefix}${randomUUID()}.json`);
  try {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      MINDDIARY_SMOKE_TOKEN: '',
    };
    delete childEnvironment.NODE_ENV;
    const child = spawn(options.executablePath, [
      ...(options.leadingArgs ?? []),
      '--minddiary-smoke-scenario=startup',
      `--minddiary-smoke-output=${outputPath}`,
      `--user-data-dir=${profilePath}`,
    ], {
      env: childEnvironment,
      stdio: 'pipe',
      windowsHide: true,
    });
    let outputText = '';
    const capture = (chunk: Buffer) => {
      outputText = `${outputText}${chunk.toString('utf8')}`.slice(-32_000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const exitCode = await waitForProcessClose(child, 20_000, 'Rejected diagnostic process', () => outputText);
    return {
      exitCode,
      outputExists: fs.existsSync(outputPath),
      outputText,
      profileFiles: collectRelativeFiles(profilePath),
      profilePath,
      outputPath,
    };
  } catch (error) {
    cleanupDisposablePaths(profilePath, outputPath);
    throw error;
  }
}

export function cleanupRejectedSmokeDiagnosticProcess(result: RejectedSmokeDiagnosticProcessResult): void {
  cleanupDisposablePaths(result.profilePath, result.outputPath);
}
