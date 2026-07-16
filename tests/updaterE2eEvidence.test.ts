// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfiguration } from 'app-builder-lib/out/util/config/config';
import { DebugLogger } from 'builder-util/out/DebugLogger';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UPDATER_EVIDENCE_FILES,
  assertNoUpdaterE2eSigningEnvironment,
  configureDisposableUpdaterPublish,
  createUpdaterE2eChildEnvironment,
  scanUpdaterEvidencePrivacy,
  validateLoopbackProviderUrl,
  validateUpdaterEvidenceRecord,
  writeUpdaterEvidence,
  type UpdaterEvidenceBundle,
  type UpdaterJsonEvidenceFile,
} from './helpers/updaterE2eEvidence';

const evidenceDirectory = path.resolve('test-results', 'windows-updater-e2e-evidence');
const disposableBuildDirectories: string[] = [];

afterEach(() => {
  fs.rmSync(evidenceDirectory, { recursive: true, force: true });
  for (const directory of disposableBuildDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createDisposableBuildPackage(version = '1.16.0'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-updater-config-'));
  disposableBuildDirectories.push(directory);
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as Record<string, unknown>;
  packageJson.version = version;
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  return directory;
}

function makeRecord(filename: UpdaterJsonEvidenceFile): Record<string, unknown> {
  const common = {
    schemaVersion: 1,
    headSha: 'a'.repeat(40),
    result: 'passed',
  };
  const fields: Record<UpdaterJsonEvidenceFile, Record<string, unknown>> = {
    'old-build-manifest.json': { candidateVersion: '1.16.0', setupSha256: 'a'.repeat(64), setupSize: 1, blockmapSha256: 'b'.repeat(64), provider: { kind: 'generic', host: 'ipv4-loopback', credentials: false } },
    'new-build-manifest.json': { candidateVersion: '1.16.1', setupSha256: 'a'.repeat(64), setupSize: 1, blockmapSha256: 'b'.repeat(64), latestVersion: '1.16.1', latestPath: 'MindDiary-Setup-1.16.1.exe', latestFiles: ['MindDiary-Setup-1.16.1.exe'], metadataSha512: `${'A'.repeat(86)}==` },
    'old-version-start.json': { applicationVersion: '1.16.0', electronVersion: '42.6.1', electronAbi: '146', sqliteSchemaVersion: 5, isPackaged: true, sandbox: true, profileVerified: true },
    'updater-event-log.json': { sequence: ['checking', 'available', 'downloading', 'downloaded'], availableVersion: '1.16.1', releaseNotesMatched: true, progressBounded: true },
    'update-server-log.json': { requests: [{ sequence: 1, mode: 'positive', method: 'GET', resource: 'latest.yml', status: 200, queryPresent: false, rangeRequested: false, authorizationPresent: false, cookiePresent: false, loopback: true }], installedProvider: 'generic-loopback', observedProviderRequestsAllLoopback: true, observedProviderRequestsNoCredentials: true },
    'update-downloaded.json': { version: '1.16.1', metadataSha512: `${'A'.repeat(86)}==`, installerSha256: 'b'.repeat(64), checksumVerified: true, blockmapRequested: true, downloadMode: 'blockmap-requested' },
    'install-transition.json': { quitAndInstallAfterDownloaded: true, oldProcessExited: true, installerProcessObserved: true, installerExited: true, assistedFinishHandled: true, installedVersion: '1.16.1', autoRestartObserved: true },
    'new-version-start.json': { applicationVersion: '1.16.1', electronVersion: '42.6.1', electronAbi: '146', sqliteSchemaVersion: 5, isPackaged: true, sandbox: true },
    'data-retention.json': { profileReused: true, entryRetained: true, attachmentRetained: true, localProtocolRead: true, markerCleaned: true, businessDataExact: true, dataDigest: 'c'.repeat(64) },
    'negative-no-update.json': { eventObserved: true, downloadAttempted: false, installAttempted: false, dataUnchanged: true },
    'negative-metadata.json': { safeErrorCode: 'invalid-metadata', downloadAttempted: false, installAttempted: false, oldVersionPreserved: true, dataUnchanged: true },
    'negative-checksum.json': { safeErrorCode: 'checksum-mismatch', updateDownloadedObserved: false, quitAndInstallCalled: false, installerProcessObserved: false, oldAppRestarted: true, dataUnchanged: true },
    'cleanup-result.json': { serverClosed: true, processesExited: true, installRemoved: true, profileRemoved: true, cacheRemoved: true, worktreesRemoved: true, portReleased: true, defaultAppDataUnchanged: true },
  };
  return { ...common, ...fields[filename] };
}

function makeBundle(): UpdaterEvidenceBundle {
  const bundle = {} as UpdaterEvidenceBundle;
  for (const filename of UPDATER_EVIDENCE_FILES) {
    if (filename !== 'hashes.txt') bundle[filename] = makeRecord(filename) as UpdaterEvidenceBundle[typeof filename];
  }
  return bundle;
}

describe('updater E2E evidence', () => {
  it('rejects signing credentials and scrubs sensitive child environment values', () => {
    expect(() => assertNoUpdaterE2eSigningEnvironment({ CSC_LINK: 'certificate' })).toThrow(/signing credentials/);
    const scrubbed = createUpdaterE2eChildEnvironment({
      PATH: 'tools',
      GITHUB_TOKEN: 'secret',
      OPENAI_API_KEY: 'secret',
      CSC_LINK: 'certificate',
      AWS_SHARED_CREDENTIALS_FILE: 'credential-file',
      GOOGLE_APPLICATION_CREDENTIALS: 'credential-file',
      NPM_CONFIG_USERCONFIG: 'credential-file',
      DOCKER_CONFIG: 'credential-directory',
      KUBECONFIG: 'credential-file',
      CLOUD_ACCESS_KEY: 'secret',
      UNRECOGNIZED_VALUE: 'not-required',
    });
    expect(scrubbed).toMatchObject({ PATH: 'tools', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
    expect(scrubbed.GITHUB_TOKEN).toBeUndefined();
    expect(scrubbed.OPENAI_API_KEY).toBeUndefined();
    expect(scrubbed.CSC_LINK).toBeUndefined();
    expect(scrubbed.AWS_SHARED_CREDENTIALS_FILE).toBeUndefined();
    expect(scrubbed.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(scrubbed.NPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(scrubbed.DOCKER_CONFIG).toBeUndefined();
    expect(scrubbed.KUBECONFIG).toBeUndefined();
    expect(scrubbed.CLOUD_ACCESS_KEY).toBeUndefined();
    expect(scrubbed.UNRECOGNIZED_VALUE).toBeUndefined();
  });

  it('accepts only credential-free loopback provider URLs', () => {
    expect(validateLoopbackProviderUrl('http://127.0.0.1:43123/').hostname).toBe('127.0.0.1');
    expect(() => validateLoopbackProviderUrl('https://github.com/releases')).toThrow(/loopback/);
    expect(() => validateLoopbackProviderUrl('http://127.0.0.1:43123/?key=secret')).toThrow(/loopback/);
    expect(() => validateLoopbackProviderUrl('http://user:pass@127.0.0.1:43123/')).toThrow(/loopback/);
  });

  it('writes a schema-valid generic provider only inside a disposable package', async () => {
    const directory = createDisposableBuildPackage();
    configureDisposableUpdaterPublish(directory, '1.16.0', 'http://127.0.0.1:43123/');
    const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as {
      version: string;
      build: Record<string, unknown>;
    };
    expect(packageJson.version).toBe('1.16.0');
    expect(packageJson.build.publish).toEqual([{
      provider: 'generic',
      url: 'http://127.0.0.1:43123/',
      useMultipleRangeRequest: false,
    }]);
    await expect(validateConfiguration(packageJson.build, new DebugLogger(false))).resolves.toBeUndefined();
  });

  it('refuses remote providers, unexpected versions, and altered production publishing', () => {
    const remote = createDisposableBuildPackage();
    expect(() => configureDisposableUpdaterPublish(remote, '1.16.0', 'https://github.com/releases/')).toThrow(/loopback/);

    const wrongVersion = createDisposableBuildPackage();
    expect(() => configureDisposableUpdaterPublish(wrongVersion, '1.16.1', 'http://127.0.0.1:43123/')).toThrow(/version/);

    const altered = createDisposableBuildPackage();
    const packagePath = path.join(altered, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { build: { publish: unknown } };
    packageJson.build.publish = [{ provider: 'generic', url: 'http://127.0.0.1:43123/' }];
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    expect(() => configureDisposableUpdaterPublish(altered, '1.16.0', 'http://127.0.0.1:43123/')).toThrow(/production publish/);
  });

  it('rejects path, secret, query, and database-content leakage', () => {
    for (const leaked of [
      String.raw`C:\Users\private\minddiary.db`,
      '/tmp/minddiary/profile',
      'https://example.test/file?key=value',
      'Authorization: Bearer abcdefghijklmnop',
      'api_key=secret',
      '"token": "secret-value"',
      '"environmentVariables": {"CUSTOM_SECRET":"value"}',
      '"databaseRows": [{"title":"private"}]',
      'MindDiary install smoke',
    ]) {
      expect(() => scanUpdaterEvidencePrivacy(leaked, 'definitely-not-present')).toThrow(/privacy scan/);
    }
    expect(() => scanUpdaterEvidencePrivacy('installerSha256 and blockmapSha256', 'definitely-not-present')).not.toThrow();
  });

  it('writes and revalidates the exact evidence allowlist', () => {
    const bundle = makeBundle();
    for (const [filename, record] of Object.entries(bundle)) {
      validateUpdaterEvidenceRecord(filename as UpdaterJsonEvidenceFile, record);
    }
    const written = writeUpdaterEvidence(evidenceDirectory, bundle, 'a'.repeat(40), 'definitely-not-present');
    expect(written.files).toEqual([...UPDATER_EVIDENCE_FILES].sort());
    expect(written.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an incomplete bundle before writing files', () => {
    const bundle = makeBundle();
    delete (bundle as Partial<UpdaterEvidenceBundle>)['negative-checksum.json'];
    expect(() => writeUpdaterEvidence(evidenceDirectory, bundle, 'a'.repeat(40), 'definitely-not-present'))
      .toThrow(/allowlist/);
    expect(fs.existsSync(evidenceDirectory)).toBe(false);
  });

  it('rejects extra fields, open nested records, and mixed heads', () => {
    const extraFieldBundle = makeBundle();
    extraFieldBundle['data-retention.json'].unexpected = true;
    expect(() => writeUpdaterEvidence(evidenceDirectory, extraFieldBundle, 'a'.repeat(40), 'definitely-not-present'))
      .toThrow(/fixed schema/);

    const nestedFieldBundle = makeBundle();
    const requests = nestedFieldBundle['update-server-log.json'].requests as Array<Record<string, unknown>>;
    requests[0]!.databaseRows = [];
    expect(() => writeUpdaterEvidence(evidenceDirectory, nestedFieldBundle, 'a'.repeat(40), 'definitely-not-present'))
      .toThrow(/request evidence/);

    const mixedHeadBundle = makeBundle();
    mixedHeadBundle['new-version-start.json'].headSha = 'b'.repeat(40);
    expect(() => writeUpdaterEvidence(evidenceDirectory, mixedHeadBundle, 'a'.repeat(40), 'definitely-not-present'))
      .toThrow(/exact runtime HEAD/);
  });

  it('rejects a linked evidence directory without modifying its target', () => {
    const linkedTarget = fs.mkdtempSync(path.join(path.dirname(evidenceDirectory), 'updater-evidence-target-'));
    const sentinel = path.join(linkedTarget, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'preserve');
    fs.symlinkSync(linkedTarget, evidenceDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(() => writeUpdaterEvidence(evidenceDirectory, makeBundle(), 'a'.repeat(40), 'definitely-not-present'))
        .toThrow(/physical directory/);
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('preserve');
    } finally {
      fs.unlinkSync(evidenceDirectory);
      fs.rmSync(linkedTarget, { recursive: true, force: true });
    }
  });
});
