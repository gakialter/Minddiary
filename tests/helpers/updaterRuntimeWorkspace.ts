import fs, { type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const UPDATER_RUNTIME_PREFIX = 'windows-updater-e2e-runtime-';
export const UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY = './test-results/windows-updater-e2e-playwright-output';

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function lstatIfPresent(directory: string): Stats | undefined {
  try {
    return fs.lstatSync(directory);
  } catch (error) {
    if (isPathNotFound(error)) return undefined;
    throw error;
  }
}

function assertNotCriticalRoot(directory: string, projectRoot: string, label: string): void {
  const normalized = normalizePath(directory);
  const forbidden = [
    projectRoot,
    os.homedir(),
    os.tmpdir(),
    path.parse(path.resolve(directory)).root,
  ].map(normalizePath);
  if (forbidden.includes(normalized)) {
    throw new Error(`${label} resolved to a protected root`);
  }
}

function assertPhysicalDirectory(directory: string, label: string, stat?: Stats): void {
  const directoryStat = stat ?? fs.lstatSync(directory);
  if (!directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || normalizePath(fs.realpathSync(directory)) !== normalizePath(directory)) {
    throw new Error(`${label} must be a physical directory`);
  }
}

export function getUpdaterTestResultsRoot(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), 'test-results');
}

export function getUpdaterPlaywrightOutputDirectory(projectRoot: string): string {
  return path.resolve(projectRoot, UPDATER_PLAYWRIGHT_OUTPUT_DIRECTORY);
}

function assertRuntimeRootLocation(runtimeRoot: string, projectRoot: string): string {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const expectedParent = getUpdaterTestResultsRoot(projectRoot);
  const basename = path.basename(resolvedRuntimeRoot);
  if (normalizePath(path.dirname(resolvedRuntimeRoot)) !== normalizePath(expectedParent)
    || !basename.startsWith(UPDATER_RUNTIME_PREFIX)
    || basename.length === UPDATER_RUNTIME_PREFIX.length) {
    throw new Error('Updater runtime root escaped its workspace parent');
  }
  assertNotCriticalRoot(resolvedRuntimeRoot, projectRoot, 'Updater runtime root');
  return resolvedRuntimeRoot;
}

function assertRuntimeRoot(runtimeRoot: string, projectRoot: string, stat: Stats): string {
  const resolvedRuntimeRoot = assertRuntimeRootLocation(runtimeRoot, projectRoot);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const expectedParent = getUpdaterTestResultsRoot(resolvedProjectRoot);
  assertPhysicalDirectory(resolvedProjectRoot, 'Project root');
  assertPhysicalDirectory(expectedParent, 'Updater runtime parent');
  assertPhysicalDirectory(resolvedRuntimeRoot, 'Updater runtime root', stat);
  return resolvedRuntimeRoot;
}

function assertPlaywrightOutputLocation(outputDirectory: string, projectRoot: string): string {
  const resolvedOutput = path.resolve(outputDirectory);
  const expectedOutput = getUpdaterPlaywrightOutputDirectory(projectRoot);
  if (normalizePath(resolvedOutput) !== normalizePath(expectedOutput)) {
    throw new Error('Updater Playwright output escaped its fixed workspace path');
  }
  assertNotCriticalRoot(resolvedOutput, projectRoot, 'Updater Playwright output');
  return resolvedOutput;
}

function assertPlaywrightOutput(outputDirectory: string, projectRoot: string, stat: Stats): string {
  const resolvedOutput = assertPlaywrightOutputLocation(outputDirectory, projectRoot);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const expectedParent = getUpdaterTestResultsRoot(resolvedProjectRoot);
  assertPhysicalDirectory(resolvedProjectRoot, 'Project root');
  assertPhysicalDirectory(expectedParent, 'Updater Playwright output parent');
  assertPhysicalDirectory(resolvedOutput, 'Updater Playwright output', stat);
  return resolvedOutput;
}

function removeVerifiedDirectory(
  directory: string,
  projectRoot: string,
  assertLocation: (candidate: string, root: string) => string,
  assertExisting: (candidate: string, root: string, stat: Stats) => string,
): void {
  const resolved = assertLocation(directory, projectRoot);
  const initialStat = lstatIfPresent(resolved);
  if (!initialStat) return;
  assertExisting(resolved, projectRoot, initialStat);

  const finalStat = lstatIfPresent(resolved);
  if (!finalStat) return;
  assertExisting(resolved, projectRoot, finalStat);
  if (initialStat.dev !== finalStat.dev || initialStat.ino !== finalStat.ino) {
    throw new Error('Updater cleanup target changed during validation');
  }

  try {
    fs.rmSync(resolved, { recursive: true, force: false });
  } catch (error) {
    if (!isPathNotFound(error)) throw error;
  }
  if (lstatIfPresent(resolved)) {
    throw new Error('Updater cleanup left its validated directory behind');
  }
}

export function createUpdaterRuntimeRoot(projectRoot: string): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const testResultsRoot = getUpdaterTestResultsRoot(resolvedProjectRoot);
  assertPhysicalDirectory(resolvedProjectRoot, 'Project root');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  assertPhysicalDirectory(testResultsRoot, 'Updater runtime parent');
  let runtimeRoot: string | undefined;
  try {
    runtimeRoot = fs.mkdtempSync(path.join(testResultsRoot, UPDATER_RUNTIME_PREFIX));
    const stat = fs.lstatSync(runtimeRoot);
    assertRuntimeRoot(runtimeRoot, resolvedProjectRoot, stat);
    return runtimeRoot;
  } catch (error) {
    if (runtimeRoot) {
      try {
        removeUpdaterRuntimeRoot(runtimeRoot, resolvedProjectRoot);
      } catch (cleanupError) {
        throw new Error(`Updater runtime root creation and cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
    throw error;
  }
}

export function removeUpdaterRuntimeRoot(runtimeRoot: string, projectRoot: string): void {
  removeVerifiedDirectory(runtimeRoot, projectRoot, assertRuntimeRootLocation, assertRuntimeRoot);
}

export function removeUpdaterPlaywrightOutputDirectory(projectRoot: string): void {
  const outputDirectory = getUpdaterPlaywrightOutputDirectory(projectRoot);
  removeVerifiedDirectory(
    outputDirectory,
    projectRoot,
    assertPlaywrightOutputLocation,
    assertPlaywrightOutput,
  );
}
