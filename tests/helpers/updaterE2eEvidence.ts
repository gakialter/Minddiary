import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CURRENT_SCHEMA_VERSION } from '../../electron/databaseMigrations';
import { assertUpdaterVersionPair, type UpdaterVersionPair } from './updaterVersion';

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
  'provider-negative-cases.json',
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

export const UPDATER_DIAGNOSTIC_FILES = ['diagnostic.json', 'hashes.txt'] as const;
export type UpdaterArtifactKind = 'evidence' | 'diagnostic';

export type UpdaterDiagnosticStep =
  | 'prepare'
  | 'reserve-port'
  | 'worktree-add'
  | 'version-bump'
  | 'npm-ci'
  | 'build-electron'
  | 'vite-build'
  | 'build-resources'
  | 'rebuild-electron'
  | 'verify-native'
  | 'package-nsis'
  | 'provider-negative'
  | 'install-old'
  | 'no-update'
  | 'malformed-metadata'
  | 'wrong-sha512'
  | 'positive-download'
  | 'quit-install'
  | 'installer-lifecycle'
  | 'updated-start'
  | 'data-retention'
  | 'cleanup'
  | 'evidence';

export type UpdaterDiagnostic = {
  schemaVersion: 1;
  headSha: string;
  result: 'failed';
  phase: 'prepare' | 'build-old' | 'build-new' | 'install-old' | 'runtime' | 'cleanup' | 'evidence';
  primaryFailure: 'command-failed' | 'command-timeout' | 'runtime-failed' | 'cleanup-failed' | 'evidence-failed';
  primaryStep: UpdaterDiagnosticStep;
  cleanupFailures: string[];
  resources: {
    appStopped: boolean;
    installerStopped: boolean;
    serverStopped: boolean;
    worktreesRemoved: boolean;
    installRemoved: boolean;
    profileRemoved: boolean;
    cacheRemoved: boolean;
    runtimeRemoved: boolean;
    outputRemoved: boolean;
    versionFilesUnchanged: boolean;
  };
};

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
  'update-server-log.json': ['requests', 'installedProvider', 'observedProviderRequestsAllLoopback', 'observedProviderRequestsNoCredentials', 'observedOnlyUpdaterCacheBustQueries'],
  'update-downloaded.json': ['version', 'metadataSha512', 'installerSha256', 'checksumVerified', 'blockmapRequested', 'downloadMode'],
  'install-transition.json': ['quitAndInstallAfterDownloaded', 'oldProcessExited', 'installerProcessObserved', 'installerExited', 'silentInstallRequested', 'installedVersion', 'autoRestartObserved'],
  'new-version-start.json': ['applicationVersion', 'electronVersion', 'electronAbi', 'sqliteSchemaVersion', 'isPackaged', 'sandbox'],
  'data-retention.json': ['profileReused', 'entryRetained', 'attachmentRetained', 'localProtocolRead', 'markerCleaned', 'businessDataExact', 'dataDigest'],
  'negative-no-update.json': ['eventObserved', 'downloadAttempted', 'installAttempted', 'dataUnchanged'],
  'negative-metadata.json': ['safeErrorCode', 'downloadAttempted', 'installAttempted', 'oldVersionPreserved', 'dataUnchanged'],
  'negative-checksum.json': ['safeErrorCode', 'updateDownloadedObserved', 'quitAndInstallCalled', 'installerProcessObserved', 'oldAppRestarted', 'dataUnchanged'],
  'provider-negative-cases.json': ['cases'],
  'cleanup-result.json': ['serverClosed', 'processesExited', 'installRemoved', 'profileRemoved', 'cacheRemoved', 'worktreesRemoved', 'portReleased', 'defaultAppDataUnchanged', 'runtimeRemoved', 'outputRemoved', 'versionFilesUnchanged'],
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

function validateUpdaterEvidenceSemantics(
  filename: UpdaterJsonEvidenceFile,
  record: Record<string, unknown>,
  versions: UpdaterVersionPair,
): void {
  if (filename === 'old-build-manifest.json') {
    if (record.candidateVersion !== versions.baseVersion) {
      throw new Error('Old updater candidate must match the base version');
    }
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
    if (record.candidateVersion !== versions.nextVersion || record.latestVersion !== versions.nextVersion) {
      throw new Error('New updater candidate and metadata must match the next patch version');
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
    const expectedVersion = filename === 'old-version-start.json'
      ? versions.baseVersion
      : versions.nextVersion;
    if (record.applicationVersion !== expectedVersion
      || typeof record.electronVersion !== 'string'
      || record.electronVersion.length === 0
      || typeof record.electronAbi !== 'string'
      || !/^\d+$/.test(record.electronAbi)
      || record.sqliteSchemaVersion !== CURRENT_SCHEMA_VERSION) {
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
      || record.availableVersion !== versions.nextVersion) {
      throw new Error('Updater event sequence is incomplete or out of order');
    }
    requireBoolean(record, 'releaseNotesMatched', true);
    requireBoolean(record, 'progressBounded', true);
  }
  if (filename === 'update-server-log.json') {
    const allowedResources = new Set([
      'latest.yml',
      `MindDiary-Setup-${versions.baseVersion}.exe`,
      `MindDiary-Setup-${versions.baseVersion}.exe.blockmap`,
      `MindDiary-Setup-${versions.nextVersion}.exe`,
      `MindDiary-Setup-${versions.nextVersion}.exe.blockmap`,
      'invalid',
      'non-allowlisted',
    ]);
    const requests = record.requests;
    if (!Array.isArray(requests) || requests.length === 0 || requests.some(request => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return true;
      const entry = request as Record<string, unknown>;
      const expectedKeys = [
        'authorizationPresent',
        'cacheBustAccepted',
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
        || typeof entry.cacheBustAccepted !== 'boolean'
        || entry.loopback !== true
        || entry.authorizationPresent !== false
        || entry.cookiePresent !== false
        || typeof entry.queryPresent !== 'boolean'
        || entry.queryPresent !== entry.cacheBustAccepted
        || (entry.cacheBustAccepted === true && entry.resource !== 'latest.yml');
    })) {
      throw new Error('Updater server request evidence is incomplete or unsafe');
    }
    if (record.installedProvider !== 'generic-loopback') throw new Error('Installed updater provider evidence is invalid');
    requireBoolean(record, 'observedProviderRequestsAllLoopback', true);
    requireBoolean(record, 'observedProviderRequestsNoCredentials', true);
    requireBoolean(record, 'observedOnlyUpdaterCacheBustQueries', true);
  }
  if (filename === 'update-downloaded.json') {
    if (record.version !== versions.nextVersion) throw new Error('Downloaded updater version is invalid');
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
    requireBoolean(record, 'silentInstallRequested', true);
    requireBoolean(record, 'autoRestartObserved', true);
    if (record.installedVersion !== versions.nextVersion) {
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
  if (filename === 'provider-negative-cases.json') {
    const expected = [
      { case: 'non-allowlisted', status: 404 },
      { case: 'traversal', status: 403 },
      { case: 'query', status: 403 },
      { case: 'credentials', status: 403 },
      { case: 'cookie', status: 403 },
      { case: 'host', status: 403 },
      { case: 'method', status: 405 },
      { case: 'directory', status: 403 },
    ];
    if (JSON.stringify(record.cases) !== JSON.stringify(expected)) {
      throw new Error('Updater provider negative-case evidence is incomplete');
    }
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

export function configureDisposableUpdaterBuild(
  worktree: string,
  expectedVersion: string,
  providerUrl: string,
  autoRestartProfilePath: string,
): void {
  validateLoopbackProviderUrl(providerUrl);
  if (!path.isAbsolute(autoRestartProfilePath)
    || path.basename(autoRestartProfilePath) !== 'auto-restart-profile'
    || /[\r\n"$]/.test(autoRestartProfilePath)) {
    throw new Error('Updater E2E auto-restart profile path is invalid');
  }
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
  if (!build.nsis || typeof build.nsis !== 'object' || Array.isArray(build.nsis)) {
    throw new Error('Updater build requires the reviewed production NSIS configuration');
  }
  const nsis = build.nsis as Record<string, unknown>;
  if ('include' in nsis
    || nsis.oneClick !== false
    || nsis.createStartMenuShortcut !== true
    || nsis.shortcutName !== 'MindDiary') {
    throw new Error('Updater build refuses an unexpected production NSIS configuration');
  }
  const includeRelativePath = 'build/updater-e2e-installer.nsh';
  const includePath = path.join(worktree, ...includeRelativePath.split('/'));
  const includeParent = path.dirname(includePath);
  try {
    fs.mkdirSync(includeParent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const includeParentStat = fs.lstatSync(includeParent);
  if (!includeParentStat.isDirectory() || includeParentStat.isSymbolicLink()) {
    throw new Error('Updater E2E NSIS include parent must be a physical directory');
  }
  if (normalizeRealPath(fs.realpathSync(includeParent)) !== normalizeRealPath(path.join(worktree, 'build'))) {
    throw new Error('Updater E2E NSIS include parent escaped its physical worktree');
  }
  const windowsProfilePath = autoRestartProfilePath.replace(/\//g, '\\');
  const includeText = [
    '!macro customInstall',
    `  CreateShortCut "$newStartMenuLink" "$appExe" "--user-data-dir=${windowsProfilePath}" "$appExe" 0 "" "" "\${APP_DESCRIPTION}"`,
    '  StrCpy $launchLink "$newStartMenuLink"',
    '!macroend',
    '',
  ].join('\n');
  fs.writeFileSync(includePath, includeText, { encoding: 'utf8', flag: 'wx' });
  nsis.include = includeRelativePath;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, { encoding: 'utf8' });
  const configured = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
    build?: { publish?: unknown; nsis?: { include?: unknown } };
  };
  if (JSON.stringify(configured.build?.publish) !== JSON.stringify(build.publish)
    || configured.build?.nsis?.include !== includeRelativePath
    || fs.readFileSync(includePath, 'utf8') !== includeText) {
    throw new Error('Updater disposable build configuration did not persist exactly');
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

export function clearUpdaterE2eArtifactDirectory(
  projectRoot: string,
  kind: UpdaterArtifactKind,
): void {
  const root = path.resolve(projectRoot);
  const parent = path.join(root, 'test-results');
  const name = kind === 'evidence'
    ? 'windows-updater-e2e-evidence'
    : 'windows-updater-e2e-diagnostic';
  const allowlist: readonly string[] = kind === 'evidence'
    ? UPDATER_EVIDENCE_FILES
    : UPDATER_DIAGNOSTIC_FILES;
  const directory = path.join(parent, name);
  if (!fs.existsSync(directory)) return;
  for (const [candidate, label] of [
    [root, 'project root'],
    [parent, 'test-results root'],
    [directory, `${kind} directory`],
  ] as const) {
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory()
      || stat.isSymbolicLink()
      || fs.realpathSync(candidate) !== candidate) {
      throw new Error(`Updater ${label} must be a physical directory`);
    }
  }
  const names = fs.readdirSync(directory);
  if (names.some(filename => !allowlist.includes(filename))) {
    throw new Error(`Updater ${kind} directory contains a non-allowlisted entry`);
  }
  for (const filename of names) {
    const filepath = path.join(directory, filename);
    const stat = fs.lstatSync(filepath);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filepath) !== filepath) {
      throw new Error(`Updater ${kind} directory contains a non-physical file`);
    }
    fs.unlinkSync(filepath);
  }
  fs.rmdirSync(directory);
}

export function validateUpdaterEvidenceRecord(
  filename: UpdaterJsonEvidenceFile,
  value: unknown,
  versions: UpdaterVersionPair,
): asserts value is UpdaterEvidenceRecord {
  assertUpdaterVersionPair(versions);
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
  validateUpdaterEvidenceSemantics(filename, record, versions);
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

function prepareDiagnosticDirectory(diagnosticDirectory: string): void {
  const resolved = path.resolve(diagnosticDirectory);
  const projectRoot = path.resolve(process.cwd());
  const expectedParent = path.resolve(projectRoot, 'test-results');
  if (path.dirname(resolved) !== expectedParent || path.basename(resolved) !== 'windows-updater-e2e-diagnostic') {
    throw new Error('Updater diagnostic directory is outside the fixed test-results boundary');
  }
  fs.mkdirSync(expectedParent, { recursive: true });
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(resolved) !== resolved) {
      throw new Error('Updater diagnostic path must be a physical directory');
    }
    const names = fs.readdirSync(resolved);
    if (names.some(name => !UPDATER_DIAGNOSTIC_FILES.includes(name as typeof UPDATER_DIAGNOSTIC_FILES[number]))) {
      throw new Error('Updater diagnostic directory contains a non-allowlisted entry');
    }
    for (const name of names) fs.unlinkSync(path.join(resolved, name));
    fs.rmdirSync(resolved);
  }
  fs.mkdirSync(resolved);
}

export function writeUpdaterDiagnosticEvidence(
  diagnosticDirectory: string,
  diagnostic: UpdaterDiagnostic,
  realUsername = os.userInfo().username,
): { files: string[]; digest: string } {
  assertSha(diagnostic.headSha, 'updater diagnostic headSha');
  const resourceKeys = [
    'appStopped',
    'cacheRemoved',
    'installRemoved',
    'installerStopped',
    'outputRemoved',
    'profileRemoved',
    'runtimeRemoved',
    'serverStopped',
    'versionFilesUnchanged',
    'worktreesRemoved',
  ];
  const phases = ['prepare', 'build-old', 'build-new', 'install-old', 'runtime', 'cleanup', 'evidence'];
  const primaryFailures = ['command-failed', 'command-timeout', 'runtime-failed', 'cleanup-failed', 'evidence-failed'];
  const primarySteps: UpdaterDiagnosticStep[] = [
    'prepare',
    'reserve-port',
    'worktree-add',
    'version-bump',
    'npm-ci',
    'build-electron',
    'vite-build',
    'build-resources',
    'rebuild-electron',
    'verify-native',
    'package-nsis',
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
    'evidence',
  ];
  if (diagnostic.schemaVersion !== 1
    || diagnostic.result !== 'failed'
    || !phases.includes(diagnostic.phase)
    || !primaryFailures.includes(diagnostic.primaryFailure)
    || !primarySteps.includes(diagnostic.primaryStep)
    || JSON.stringify(Object.keys(diagnostic).sort()) !== JSON.stringify([
      'cleanupFailures',
      'headSha',
      'phase',
      'primaryFailure',
      'primaryStep',
      'resources',
      'result',
      'schemaVersion',
    ])
    || JSON.stringify(Object.keys(diagnostic.resources).sort()) !== JSON.stringify(resourceKeys)
    || !Object.values(diagnostic.resources).every(value => typeof value === 'boolean')
    || !Array.isArray(diagnostic.cleanupFailures)
    || diagnostic.cleanupFailures.some(value => typeof value !== 'string' || !/^[a-z-]{2,32}$/.test(value))) {
    throw new Error('Updater diagnostic does not match its fixed schema');
  }
  const serialized = `${JSON.stringify(diagnostic, null, 2)}\n`;
  scanUpdaterEvidencePrivacy(serialized, realUsername);
  prepareDiagnosticDirectory(diagnosticDirectory);
  fs.writeFileSync(path.join(diagnosticDirectory, 'diagnostic.json'), serialized, { encoding: 'utf8', flag: 'wx' });
  const digest = createHash('sha256').update(Buffer.from(serialized)).digest('hex');
  const hashesText = `${digest}  diagnostic.json\n`;
  scanUpdaterEvidencePrivacy(hashesText, realUsername);
  fs.writeFileSync(path.join(diagnosticDirectory, 'hashes.txt'), hashesText, { encoding: 'utf8', flag: 'wx' });
  return { files: [...UPDATER_DIAGNOSTIC_FILES], digest };
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
  const baseVersion = bundle['old-build-manifest.json'].candidateVersion;
  const nextVersion = bundle['new-build-manifest.json'].candidateVersion;
  if (typeof baseVersion !== 'string' || typeof nextVersion !== 'string') {
    throw new Error('Updater evidence candidate versions are unavailable');
  }
  const versions: UpdaterVersionPair = { baseVersion, nextVersion };
  assertUpdaterVersionPair(versions);
  const oldRuntime = bundle['old-version-start.json'];
  const newRuntime = bundle['new-version-start.json'];
  if (oldRuntime.electronVersion !== newRuntime.electronVersion
    || oldRuntime.electronAbi !== newRuntime.electronAbi
    || oldRuntime.sqliteSchemaVersion !== newRuntime.sqliteSchemaVersion) {
    throw new Error('Updater evidence runtime invariants drifted across the update');
  }
  const serializedByFile = new Map<UpdaterJsonEvidenceFile, string>();
  for (const filename of expectedJsonFiles) {
    const record = bundle[filename];
    validateUpdaterEvidenceRecord(filename, record, versions);
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
