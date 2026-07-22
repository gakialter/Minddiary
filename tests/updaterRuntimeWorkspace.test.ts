import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import updaterPlaywrightConfig from '../playwright.updater.config';
import {
  createUpdaterRuntimeRoot,
  getUpdaterPlaywrightOutputDirectory,
  getUpdaterTestResultsRoot,
  removeUpdaterPlaywrightOutputDirectory,
  removeUpdaterRuntimeRoot,
  UPDATER_RUNTIME_PREFIX,
} from './helpers/updaterRuntimeWorkspace';

const fixtureContainers: string[] = [];

function createFixture(): { container: string; projectRoot: string } {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-updater-runtime-test-'));
  const projectRoot = path.join(container, 'project');
  fs.mkdirSync(projectRoot);
  fixtureContainers.push(container);
  return { container, projectRoot };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const container of fixtureContainers.splice(0)) {
    if (path.dirname(path.resolve(container)) !== path.resolve(os.tmpdir())
      || !path.basename(container).startsWith('minddiary-updater-runtime-test-')) {
      throw new Error('Updater runtime test fixture escaped the system temporary directory');
    }
    fs.rmSync(container, { recursive: true, force: true });
  }
});

describe('updater runtime workspace cleanup', () => {
  it('keeps the runtime sibling when Playwright cleans its independent output directory', () => {
    const { projectRoot } = createFixture();
    const runtimeRoot = createUpdaterRuntimeRoot(projectRoot);
    const outputDirectory = getUpdaterPlaywrightOutputDirectory(projectRoot);
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(path.join(runtimeRoot, 'runtime-marker'), 'runtime');
    fs.writeFileSync(path.join(outputDirectory, 'playwright-marker'), 'playwright');

    expect(path.dirname(runtimeRoot)).toBe(path.dirname(outputDirectory));
    expect(path.resolve(runtimeRoot)).not.toBe(path.resolve(outputDirectory));
    expect(path.resolve(updaterPlaywrightConfig.outputDir ?? '')).toBe(
      getUpdaterPlaywrightOutputDirectory(process.cwd()),
    );

    fs.rmSync(outputDirectory, { recursive: true, force: false });

    expect(fs.existsSync(path.join(runtimeRoot, 'runtime-marker'))).toBe(true);
    expect(fs.existsSync(outputDirectory)).toBe(false);
    removeUpdaterRuntimeRoot(runtimeRoot, projectRoot);
    removeUpdaterPlaywrightOutputDirectory(projectRoot);
    expect(fs.existsSync(runtimeRoot)).toBe(false);
    expect(fs.existsSync(outputDirectory)).toBe(false);
  });

  it('treats a missing in-bound runtime root as already cleaned', () => {
    const { projectRoot } = createFixture();
    fs.mkdirSync(getUpdaterTestResultsRoot(projectRoot));
    const runtimeRoot = path.join(
      getUpdaterTestResultsRoot(projectRoot),
      `${UPDATER_RUNTIME_PREFIX}missing`,
    );

    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot)).not.toThrow();
    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot)).not.toThrow();
  });

  it('still rejects a linked runtime root when the target exists', () => {
    const { projectRoot } = createFixture();
    const runtimeRoot = createUpdaterRuntimeRoot(projectRoot);
    const linkedTarget = path.join(projectRoot, 'linked-target');
    fs.mkdirSync(linkedTarget);
    removeUpdaterRuntimeRoot(runtimeRoot, projectRoot);
    fs.symlinkSync(linkedTarget, runtimeRoot, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot))
      .toThrow('Updater runtime root must be a physical directory');
    expect(fs.existsSync(linkedTarget)).toBe(true);
  });

  it('rejects outside, protected, and unverifiable runtime cleanup targets', () => {
    const { projectRoot } = createFixture();
    const runtimeRoot = createUpdaterRuntimeRoot(projectRoot);
    const outsideRoot = path.join(projectRoot, `${UPDATER_RUNTIME_PREFIX}outside`);
    fs.mkdirSync(outsideRoot);

    expect(() => removeUpdaterRuntimeRoot(outsideRoot, projectRoot))
      .toThrow('Updater runtime root escaped its workspace parent');
    for (const protectedRoot of [
      projectRoot,
      getUpdaterTestResultsRoot(projectRoot),
      os.homedir(),
      os.tmpdir(),
      path.parse(projectRoot).root,
    ]) {
      expect(() => removeUpdaterRuntimeRoot(protectedRoot, projectRoot)).toThrow();
    }

    const accessDenied = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => { throw accessDenied; });
    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot)).toThrow(accessDenied);
    lstatSpy.mockRestore();

    const realpathSpy = vi.spyOn(fs, 'realpathSync').mockImplementationOnce(() => { throw accessDenied; });
    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot)).toThrow(accessDenied);
    realpathSpy.mockRestore();

    const permissionDenied = Object.assign(new Error('permission denied'), { code: 'EPERM' });
    const removalSpy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw permissionDenied; });
    expect(() => removeUpdaterRuntimeRoot(runtimeRoot, projectRoot)).toThrow(permissionDenied);
    removalSpy.mockRestore();

    expect(fs.existsSync(runtimeRoot)).toBe(true);
    expect(fs.existsSync(outsideRoot)).toBe(true);
  });
});
