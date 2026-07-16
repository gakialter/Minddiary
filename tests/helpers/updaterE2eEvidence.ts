import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const UPDATER_EVIDENCE_FILES = [
  'old-build-manifest.json',
  'new-build-manifest.json',
  'old-version-start.json',
  'updater-event-log.json',
  'update-server-log.json',
  'update-downloaded.json',
  'install-transition.json',
  'new-version-start.json',
  'data-retention.json',
  'negative-no-update.json',
  'negative-metadata.json',
  'negative-checksum.json',
  'cleanup-result.json',
  'hashes.txt',
] as const;

export type UpdaterEvidenceFile = typeof UPDATER_EVIDENCE_FILES[number];
export type UpdaterJsonEvidenceFile = Exclude<UpdaterEvidenceFile, 'hashes.txt'>;
export type UpdaterEvidenceRecord = Record<string, unknown> & {
  schemaVersion: 1;
  headSha: string;
  result: 'passed';
};

export type UpdaterEvidenceBundle = Record<UpdaterJsonEvidenceFile, UpdaterEvidenceRecord>;

const SIGNING_ENVIRONMENT_KEYS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'] as const;

export function assertNoUpdaterE2eSigningEnvironment(environment: NodeJS.ProcessEnv): void {
  const configured = SIGNING_ENVIRONMENT_KEYS.filter(key => Boolean(environment[key]));
  if (configured.length > 0) throw new Error('Updater E2E refuses ambient signing credentials');
}

export function createUpdaterE2eChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowedNames = new Set([
    'APPDATA',
    'CI',
    'COMSPEC',
    'ELECTRON_BUILDER_CACHE',
    'ELECTRON_CACHE',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'NPM_CONFIG_CACHE',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
    'PROCESSOR_LEVEL',
    'PROCESSOR_REVISION',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'RUNNER_ARCH',
    'RUNNER_OS',
    'RUNNER_TEMP',
    'RUNNER_TOOL_CACHE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'WINDIR',
  ]);
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && allowedNames.has(key.toUpperCase())) scrubbed[key] = value;
  }
  scrubbed.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  return scrubbed;
}

const REQUIRED_FIELDS: Record<UpdaterJsonEvidenceFile, readonly string[]> = {
  'old-build-manifest.json': ['candidateVersion', 'setupSha256', 'setupSize', 'blockmapSha256', 'provider'],
  'new-build-manifest.json': ['candidateVersion', 'setupSha256', 'setupSize', 'blockmapSha256', 'latestVersion', 'latestPath', 'latestFiles', 'metadataSha512'],
  'old-version-start.json': ['applicationVersion', 'electronVersion', 'electronAbi', 'sqliteSchemaVersion', 'isPackaged', 'sandbox', 'profileVerified'],
  'updater-event-log.json': ['sequence', 'availableVersion', 'releaseNotesMatched', 'progressBounded'],
  'update-server-log.json': ['requests', 'installedProvider', 'observedProviderRequestsAllLoopback', 'observedProviderRequestsNoCredentials'],
  'update-downloaded.json': ['version', 'metadataSha512', 'installerSha256', 'checksumVerified', 'blockmapRequested', 'downloadMode'],
  'install-transition.json': ['quitAndInstallAfterDownloaded', 'oldProcessExited', 'installerProcessObserved', 'installerExited', 'assistedFinishHandled', 'installedVersion', 'autoRestartObserved'],
  'new-version-start.json': ['applicationVersion', 'electronVersion', 'electronAbi', 'sqliteSchemaVersion', 'isPackaged', 'sandbox'],
  'data-retention.json': ['profileReused', 'entryRetained', 'attachmentRetained', 'localProtocolRead', 'markerCleaned', 'businessDataExact', 'dataDigest'],
  'negative-no-update.json': ['eventObserved', 'downloadAttempted', 'installAttempted', 'dataUnchanged'],
  'negative-metadata.json': ['safeErrorCode', 'downloadAttempted', 'installAttempted', 'oldVersionPreserved', 'dataUnchanged'],
  'negative-checksum.json': ['safeErrorCode', 'updateDownloadedObserved', 'quitAndInstallCalled', 'installerProcessObserved', 'oldAppRestarted', 'dataUnchanged'],
  'cleanup-result.json': ['serverClosed', 'processesExited', 'installRemoved', 'profileRemoved', 'cacheRemoved', 'worktreesRemoved', 'portReleased', 'defaultAppDataUnchanged'],
};

function assertSha(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA`);
  }
}

function requireBoolean(record: Record<string, unknown>, field: string, expected: boolean): void {
  if (record[field] !== expected) throw new Error(`Updater evidence requires ${field}=${String(expected)}`);
}

function requireHexDigest(record: Record<string, unknown>, field: string): void {
  if (typeof record[field] !== 'string' || !/^[a-f0-9]{64}$/.test(record[field])) {
    throw new Error(`Updater evidence requires a SHA-256 ${field}`);
  }
}

function requireBase64Sha512(record: Record<string, unknown>, field: string): void {
  if (typeof record[field] !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(record[field])) {
    throw new Error(`Updater evidence requires a base64 SHA-512 ${field}`);
  }
}

function validateUpdaterEvidenceSemantics(filename: UpdaterJsonEvidenceFile, record: Record<string, unknown>): void {
  if (filename === 'old-build-manifest.json') {
    if (record.candidateVersion !== '1.16.0') throw new Error('Old updater candidate must remain 1.16.0');
    const provider = record.provider;
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw new Error('Old updater provider evidence is invalid');
    }
    const providerRecord = provider as Record<string, unknown>;
    if (JSON.stringify(Object.keys(providerRecord).sort()) !== JSON.stringify(['credentials', 'host', 'kind'])
      || providerRecord.kind !== 'generic'
      || providerRecord.host !== 'ipv4-loopback'
      || providerRecord.credentials !== false) {
      throw new Error('Old updater candidate must use credential-free generic loopback');
    }
    requireHexDigest(record, 'setupSha256');
    requireHexDigest(record, 'blockmapSha256');
    if (typeof record.setupSize !== 'number' || !Number.isSafeInteger(record.setupSize) || record.setupSize <= 0) {
      throw new Error('Old updater setup size is invalid');
    }
  }
  if (filename === 'new-build-manifest.json') {
    if (record.candidateVersion !== '1.16.1' || record.latestVersion !== '1.16.1') {
      throw new Error('New updater candidate and metadata must be 1.16.1');
    }
    const latestFiles = record.latestFiles;
    if (typeof record.latestPath !== 'string'
      || path.basename(record.latestPath) !== record.latestPath
      || !Array.isArray(latestFiles)
      || latestFiles.length !== 1
      || typeof latestFiles[0] !== 'string'
      || path.basename(latestFiles[0]) !== latestFiles[0]) {
      throw new Error('New updater latest.yml artifact names are invalid');
    }
    requireHexDigest(record, 'setupSha256');
    requireHexDigest(record, 'blockmapSha256');
    requireBase64Sha512(record, 'metadataSha512');
    if (typeof record.setupSize !== 'number' || !Number.isSafeInteger(record.setupSize) || record.setupSize <= 0) {
      throw new Error('New updater setup size is invalid');
    }
  }
  if (filename === 'old-version-start.json' || filename === 'new-version-start.json') {
    const expectedVersion = filename === 'old-version-start.json' ? '1.16.0' : '1.16.1';
    if (record.applicationVersion !== expectedVersion
      || record.electronVersion !== '42.6.1'
      || record.electronAbi !== '146'
      || record.sqliteSchemaVersion !== 5) {
      throw new Error(`${filename} has a runtime version mismatch`);
    }
    requireBoolean(record, 'isPackaged', true);
    requireBoolean(record, 'sandbox', true);
    if (filename === 'old-version-start.json') requireBoolean(record, 'profileVerified', true);
  }
  if (filename === 'updater-event-log.json') {
    const sequence = record.sequence;
    if (!Array.isArray(sequence)
      || sequence[0] !== 'checking'
      || sequence.indexOf('available') < 1
      || sequence.indexOf('downloading') <= sequence.indexOf('available')
      || sequence[sequence.length - 1] !== 'downloaded'
      || record.availableVersion !== '1.16.1') {
      throw new Error('Updater event sequence is incomplete or out of order');
    }
    requireBoolean(record, 'releaseNotesMatched', true);
    requireBoolean(record, 'progressBounded', true);
  }
  if (filename === 'update-server-log.json') {
    const allowedResources = new Set([
      'latest.yml',
      'MindDiary-Setup-1.16.0.exe',
      'MindDiary-Setup-1.16.0.exe.blockmap',
      'MindDiary-Setup-1.16.1.exe',
      'MindDiary-Setup-1.16.1.exe.blockmap',
      'invalid',
      'non-allowlisted',
    ]);
    const requests = record.requests;
    if (!Array.isArray(requests) || requests.length === 0 || requests.some(request => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return true;
      const entry = request as Record<string, unknown>;
      const expectedKeys = [
        'authorizationPresent',
        'cookiePresent',
        'loopback',
        'method',
        'mode',
        'queryPresent',
        'rangeRequested',
        'resource',
        'sequence',
        'status',
      ];
      return JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(expectedKeys)
        || !Number.isSafeInteger(entry.sequence)
        || typeof entry.resource !== 'string'
        || !allowedResources.has(entry.resource)
        || !['GET', 'HEAD'].includes(String(entry.method))
        || !['no-update', 'invalid-metadata', 'bad-checksum', 'positive'].includes(String(entry.mode))
        || !Number.isInteger(entry.status)
        || typeof entry.rangeRequested !== 'boolean'
        || entry.loopback !== true
        || entry.authorizationPresent !== false
        || entry.cookiePresent !== false
        || entry.queryPresent !== false;
    })) {
      throw new Error('Updater server request evidence is incomplete or unsafe');
    }
    if (record.installedProvider !== 'generic-loopback') throw new Error('Installed updater provider evidence is invalid');
    requireBoolean(record, 'observedProviderRequestsAllLoopback', true);
    requireBoolean(record, 'observedProviderRequestsNoCredentials', true);
  }
  if (filename === 'update-downloaded.json') {
    if (record.version !== '1.16.1') throw new Error('Downloaded updater version is invalid');
    requireBoolean(record, 'checksumVerified', true);
    const expectedMode = record.blockmapRequested === true ? 'blockmap-requested' : 'full';
    if (record.downloadMode !== expectedMode) throw new Error('Updater download mode evidence is inconsistent');
    requireHexDigest(record, 'installerSha256');
    requireBase64Sha512(record, 'metadataSha512');
  }
  if (filename === 'install-transition.json') {
    requireBoolean(record, 'quitAndInstallAfterDownloaded', true);
    requireBoolean(record, 'oldProcessExited', true);
    requireBoolean(record, 'installerProcessObserved', true);
    requireBoolean(record, 'installerExited', true);
    requireBoolean(record, 'assistedFinishHandled', true);
    if (record.installedVersion !== '1.16.1' || typeof record.autoRestartObserved !== 'boolean') {
      throw new Error('Installed updater transition is invalid');
    }
  }
  if (filename === 'data-retention.json') {
    for (const field of ['profileReused', 'entryRetained', 'attachmentRetained', 'localProtocolRead', 'markerCleaned', 'businessDataExact']) {
      requireBoolean(record, field, true);
    }
    requireHexDigest(record, 'dataDigest');
  }
  if (filename === 'negative-no-update.json') {
    requireBoolean(record, 'eventObserved', true);
    requireBoolean(record, 'downloadAttempted', false);
    requireBoolean(record, 'installAttempted', false);
    requireBoolean(record, 'dataUnchanged', true);
  }
  if (filename === 'negative-metadata.json') {
    if (record.safeErrorCode !== 'invalid-metadata') throw new Error('Invalid metadata error was not safely classified');
    requireBoolean(record, 'downloadAttempted', false);
    requireBoolean(record, 'installAttempted', false);
    requireBoolean(record, 'oldVersionPreserved', true);
    requireBoolean(record, 'dataUnchanged', true);
  }
  if (filename === 'negative-checksum.json') {
    if (record.safeErrorCode !== 'checksum-mismatch') throw new Error('Checksum error was not safely classified');
    requireBoolean(record, 'updateDownloadedObserved', false);
    requireBoolean(record, 'quitAndInstallCalled', false);
    requireBoolean(record, 'installerProcessObserved', false);
    requireBoolean(record, 'oldAppRestarted', true);
    requireBoolean(record, 'dataUnchanged', true);
  }
  if (filename === 'cleanup-result.json') {
    for (const field of REQUIRED_FIELDS[filename]) requireBoolean(record, field, true);
  }
}

export function validateLoopbackProviderUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')
    || !url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Updater provider must be credential-free loopback HTTP with an explicit port');
  }
  return url;
}

export function configureDisposableUpdaterPublish(
  worktree: string,
  expectedVersion: string,
  providerUrl: string,
): void {
  validateLoopbackProviderUrl(providerUrl);
  const worktreeStat = fs.lstatSync(worktree);
  if (!worktreeStat.isDirectory() || worktreeStat.isSymbolicLink()) {
    throw new Error('Updater build worktree must be a physical directory');
  }
  const packagePath = path.join(worktree, 'package.json');
  const packageStat = fs.lstatSync(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
    throw new Error('Updater build package.json must be a physical file');
  }
  const normalizeRealPath = (value: string): string => {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const realWorktree = normalizeRealPath(fs.realpathSync(worktree));
  const realPackageParent = normalizeRealPath(path.dirname(fs.realpathSync(packagePath)));
  if (realPackageParent !== realWorktree) {
    throw new Error('Updater build package.json escaped its physical worktree');
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  if (packageJson.version !== expectedVersion) {
    throw new Error('Updater build package version does not match the disposable candidate');
  }
  if (!packageJson.build || typeof packageJson.build !== 'object' || Array.isArray(packageJson.build)) {
    throw new Error('Updater build configuration is unavailable');
  }
  const build = packageJson.build as Record<string, unknown>;
  const publish = build.publish;
  if (!Array.isArray(publish)
    || publish.length !== 1
    || !publish[0]
    || typeof publish[0] !== 'object'
    || Array.isArray(publish[0])) {
    throw new Error('Updater build requires the reviewed production publish configuration');
  }
  const productionProvider = publish[0] as Record<string, unknown>;
  if (productionProvider.provider !== 'github'
    || productionProvider.owner !== 'gakialter'
    || productionProvider.repo !== 'Minddiary'
    || 'token' in productionProvider) {
    throw new Error('Updater build refuses an unexpected production publish configuration');
  }
  build.publish = [{
    provider: 'generic',
    url: providerUrl,
    useMultipleRangeRequest: false,
  }];
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, { encoding: 'utf8' });
  const configured = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
    build?: { publish?: unknown };
  };
  if (JSON.stringify(configured.build?.publish) !== JSON.stringify(build.publish)) {
    throw new Error('Updater build publish configuration did not persist exactly');
  }
}

export function assertDisposableUpdaterPath(candidate: string, prefix: string): string {
  const resolved = path.resolve(candidate);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Updater E2E path is outside the direct disposable temporary boundary');
  }
  return resolved;
}

export function validateUpdaterEvidenceRecord(
  filename: UpdaterJsonEvidenceFile,
  value: unknown,
): asserts value is UpdaterEvidenceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filename} must contain one JSON object`);
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.result !== 'passed') {
    throw new Error(`${filename} has an invalid envelope`);
  }
  assertSha(record.headSha, `${filename} headSha`);
  const expectedKeys = ['headSha', 'result', 'schemaVersion', ...REQUIRED_FIELDS[filename]].sort();
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${filename} does not match its fixed schema`);
  }
  for (const field of REQUIRED_FIELDS[filename]) {
    if (!(field in record)) throw new Error(`${filename} is missing ${field}`);
  }
  validateUpdaterEvidenceSemantics(filename, record);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scanUpdaterEvidencePrivacy(text: string, realUsername = os.userInfo().username): void {
  const patterns: Array<[string, RegExp]> = [
    ['Windows absolute path', /\b[A-Za-z]:[\\/](?:[^\s"']+)/],
    ['Unix absolute path', /\/(?:Users|home|tmp|private|var|mnt|opt)\/(?:[^\s"']+)/i],
    ['URL query', /https?:\/\/[^\s"']+\?[^\s"']*/i],
    ['Authorization', /\bauthorization\b\s*[:=]/i],
    ['Bearer credential', /\bbearer\s+[A-Za-z0-9._~+\/-]{8,}/i],
    ['API key label', /\bapi[_ -]?key\b\s*[:=]/i],
    ['token label', /["']?\btoken\b["']?\s*[:=]/i],
    ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['GitHub token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/i],
    ['environment variable', /\b(?:USERPROFILE|APPDATA|LOCALAPPDATA|MINDDIARY_SMOKE_TOKEN|GITHUB_TOKEN)\b/],
    ['environment container', /["']?\b(?:env|environment|environmentVariables)\b["']?\s*[:=]/i],
    ['request body', /\brequest[_ -]?body\b\s*[:=]/i],
    ['database rows', /["']?\b(?:database|db)[_-]?(?:rows?|content)\b["']?\s*[:=]/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['certificate body', /-----BEGIN CERTIFICATE-----/],
    ['fake database content', /MindDiary install smoke|Disposable installed profile retention probe/i],
  ];
  if (realUsername) {
    patterns.push(['real username', new RegExp(`\\b${escapeRegExp(realUsername)}\\b`, 'i')]);
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) throw new Error(`Updater evidence privacy scan rejected ${label}`);
  }
}

function prepareEvidenceDirectory(evidenceDirectory: string): void {
  const resolved = path.resolve(evidenceDirectory);
  const projectRoot = path.resolve(process.cwd());
  const projectRootStat = fs.lstatSync(projectRoot);
  if (projectRootStat.isSymbolicLink()
    || !projectRootStat.isDirectory()
    || fs.realpathSync(projectRoot) !== projectRoot) {
    throw new Error('Updater evidence project root must be a physical directory');
  }
  const expectedParent = path.resolve(projectRoot, 'test-results');
  if (path.dirname(resolved) !== expectedParent || path.basename(resolved) !== 'windows-updater-e2e-evidence') {
    throw new Error('Updater evidence directory is outside the fixed test-results boundary');
  }
  fs.mkdirSync(expectedParent, { recursive: true });
  const parentStat = fs.lstatSync(expectedParent);
  if (parentStat.isSymbolicLink()
    || !parentStat.isDirectory()
    || fs.realpathSync(expectedParent) !== expectedParent) {
    throw new Error('Updater evidence root must be a physical test-results directory');
  }
  if (fs.existsSync(resolved)) {
    const directoryStat = fs.lstatSync(resolved);
    if (directoryStat.isSymbolicLink()
      || !directoryStat.isDirectory()
      || fs.realpathSync(resolved) !== resolved) {
      throw new Error('Updater evidence path must be a physical directory');
    }
    const existingNames = fs.readdirSync(resolved);
    if (existingNames.some(name => !UPDATER_EVIDENCE_FILES.includes(name as UpdaterEvidenceFile))) {
      throw new Error('Updater evidence directory contains a non-allowlisted entry');
    }
    for (const name of existingNames) {
      const filepath = path.join(resolved, name);
      const fileStat = fs.lstatSync(filepath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error('Updater evidence directory contains a non-physical file');
      }
      fs.unlinkSync(filepath);
    }
    fs.rmdirSync(resolved);
  }
  fs.mkdirSync(resolved);
}

export function writeUpdaterEvidence(
  evidenceDirectory: string,
  bundle: UpdaterEvidenceBundle,
  expectedHeadSha: string,
  realUsername = os.userInfo().username,
): { files: string[]; digest: string } {
  assertSha(expectedHeadSha, 'expected updater evidence headSha');
  const expectedJsonFiles = UPDATER_EVIDENCE_FILES.filter(
    (filename): filename is UpdaterJsonEvidenceFile => filename !== 'hashes.txt',
  );
  const suppliedFiles = Object.keys(bundle).sort();
  if (JSON.stringify(suppliedFiles) !== JSON.stringify([...expectedJsonFiles].sort())) {
    throw new Error('Updater evidence bundle does not match the fixed allowlist');
  }
  const serializedByFile = new Map<UpdaterJsonEvidenceFile, string>();
  for (const filename of expectedJsonFiles) {
    const record = bundle[filename];
    validateUpdaterEvidenceRecord(filename, record);
    if (record.headSha !== expectedHeadSha) throw new Error(`${filename} is not bound to the exact runtime HEAD`);
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    scanUpdaterEvidencePrivacy(serialized, realUsername);
    serializedByFile.set(filename, serialized);
  }
  prepareEvidenceDirectory(evidenceDirectory);
  for (const filename of expectedJsonFiles) {
    const serialized = serializedByFile.get(filename);
    if (serialized === undefined) throw new Error(`${filename} serialization is unavailable`);
    fs.writeFileSync(path.join(evidenceDirectory, filename), serialized, { encoding: 'utf8', flag: 'wx' });
  }

  const hashLines = expectedJsonFiles.map(filename => {
    const bytes = fs.readFileSync(path.join(evidenceDirectory, filename));
    return `${createHash('sha256').update(bytes).digest('hex')}  ${filename}`;
  });
  const hashesText = `${hashLines.join('\n')}\n`;
  scanUpdaterEvidencePrivacy(hashesText, realUsername);
  fs.writeFileSync(path.join(evidenceDirectory, 'hashes.txt'), hashesText, { encoding: 'utf8', flag: 'wx' });

  const actualFiles = fs.readdirSync(evidenceDirectory).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify([...UPDATER_EVIDENCE_FILES].sort())) {
    throw new Error('Updater evidence directory contains a non-allowlisted file');
  }
  const aggregate = actualFiles.map(filename => fs.readFileSync(path.join(evidenceDirectory, filename)));
  const digest = createHash('sha256').update(Buffer.concat(aggregate)).digest('hex');
  return { files: actualFiles, digest };
}
