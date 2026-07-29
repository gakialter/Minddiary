import fs from 'node:fs';
import path from 'node:path';

export type UpdaterVersionPair = {
  baseVersion: string;
  nextVersion: string;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseStableVersion(value: unknown, label: string): ParsedVersion {
  if (typeof value !== 'string') throw new Error(`${label} must be a stable semantic version`);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`${label} must be a stable semantic version`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`${label} is outside the supported semantic version range`);
  }
  return { major, minor, patch };
}

export function deriveNextPatchVersion(baseVersion: string): string {
  const parsed = parseStableVersion(baseVersion, 'Base version');
  if (parsed.patch === Number.MAX_SAFE_INTEGER) {
    throw new Error('Base version patch cannot be incremented safely');
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function assertUpdaterVersionPair(pair: UpdaterVersionPair): void {
  parseStableVersion(pair.baseVersion, 'Base version');
  parseStableVersion(pair.nextVersion, 'Next version');
  if (deriveNextPatchVersion(pair.baseVersion) !== pair.nextVersion) {
    throw new Error('Updater candidate must be the next semantic patch version');
  }
}

export function readUpdaterVersionPair(projectRoot: string): UpdaterVersionPair {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')) as {
    version?: unknown;
    packages?: Record<string, { version?: unknown }>;
  };
  const baseVersion = packageJson.version;
  if (typeof baseVersion !== 'string') throw new Error('package.json version is unavailable');
  if (packageLock.version !== baseVersion || packageLock.packages?.['']?.version !== baseVersion) {
    throw new Error('package.json and package-lock.json root versions do not match');
  }
  const pair = { baseVersion, nextVersion: deriveNextPatchVersion(baseVersion) };
  assertUpdaterVersionPair(pair);
  return pair;
}
