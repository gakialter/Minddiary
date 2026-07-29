// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertUpdaterVersionPair,
  deriveNextPatchVersion,
  readUpdaterVersionPair,
} from './helpers/updaterVersion';

const temporaryDirectories: string[] = [];

function writeVersions(packageVersion: string, lockVersion = packageVersion, lockRootVersion = lockVersion): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-updater-version-test-'));
  temporaryDirectories.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: packageVersion }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    version: lockVersion,
    packages: { '': { version: lockRootVersion } },
  }));
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('updater semantic version derivation', () => {
  it('increments the patch without assuming a single digit', () => {
    expect(deriveNextPatchVersion('1.17.1')).toBe('1.17.2');
    expect(deriveNextPatchVersion('2.9.99')).toBe('2.9.100');
    expect(() => deriveNextPatchVersion('1.17')).toThrow(/stable semantic version/);
    expect(() => deriveNextPatchVersion('1.17.01')).toThrow(/stable semantic version/);
    expect(() => deriveNextPatchVersion('1.17.1-beta.1')).toThrow(/stable semantic version/);
  });

  it('requires package and lockfile root versions to match', () => {
    expect(readUpdaterVersionPair(writeVersions('1.17.1'))).toEqual({
      baseVersion: '1.17.1',
      nextVersion: '1.17.2',
    });
    expect(() => readUpdaterVersionPair(writeVersions('1.17.1', '1.17.0')))
      .toThrow(/root versions do not match/);
    expect(() => readUpdaterVersionPair(writeVersions('1.17.1', '1.17.1', '1.17.0')))
      .toThrow(/root versions do not match/);
  });

  it('rejects a next candidate that is not exactly one patch newer', () => {
    expect(() => assertUpdaterVersionPair({ baseVersion: '1.17.1', nextVersion: '1.18.0' }))
      .toThrow(/next semantic patch/);
  });
});
