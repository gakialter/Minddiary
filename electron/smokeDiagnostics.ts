import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { DateRolloverDiagnosticDetails } from './dateRolloverDiagnostic';

export const SMOKE_PROFILE_PREFIX = 'minddiary-smoke-profile-';
export const SMOKE_RESULT_PREFIX = 'minddiary-smoke-result-';
export const SMOKE_PROFILE_MARKER = '.minddiary-smoke-profile';

export const IMPLEMENTED_SMOKE_SCENARIOS = [
    'startup',
    'sqlite-read-write',
    'portable-profile',
    'install-profile',
    'date-rollover',
] as const;

export const PLANNED_SMOKE_SCENARIOS = [
    ...IMPLEMENTED_SMOKE_SCENARIOS,
    'settings-redaction',
    'attachment-local-protocol',
    'window-security',
    'clipboard-ipc',
    'pdf-export',
    'updater-status',
] as const;

export type SmokeDiagnosticScenario = typeof IMPLEMENTED_SMOKE_SCENARIOS[number];

export type SmokeDiagnosticRequest = {
    scenario: SmokeDiagnosticScenario;
    outputPath: string;
    profilePath: string;
    token: string;
    tempRoot: string;
    profileIdentity: {
        device: string;
        inode: string;
    };
};

export type SmokeEvidence = {
    check: string;
    passed: boolean;
};

export type SmokeDiagnosticResult = {
    schemaVersion: 1;
    scenario: SmokeDiagnosticScenario;
    applicationVersion: string;
    electronVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    isPackaged: boolean;
    sandbox: boolean;
    contextIsolation: boolean;
    preloadAvailable: boolean;
    nativeSqlite: {
        loaded: boolean;
        query: number;
        sqliteVersion: string;
    };
    result: 'passed' | 'failed';
    evidence: SmokeEvidence[];
    dateRollover?: DateRolloverDiagnosticDetails;
};

export type SmokeDiagnosticDependencies = {
    applicationVersion: string;
    electronVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    isPackaged: boolean;
    actualUserDataPath: string;
    queryNativeSqlite: () => { query: number; sqliteVersion: string };
    getRendererSecurityState: () => Promise<{
        sandbox: boolean;
        contextIsolation: boolean;
        preloadAvailable: boolean;
        productionDocument: boolean;
    }>;
    roundTripSetting: (key: string, value: string) => {
        written: boolean;
        readBack: boolean;
        cleaned: boolean;
    };
    verifyPortableWrapper: () => boolean;
    runProfileRoundTrip: () => Promise<{
        created: boolean;
        readBack: boolean;
        localProtocol: boolean;
        cleaned: boolean;
    }>;
    runInstallProfileRoundTrip: () => Promise<{
        phase: 'seeded' | 'reopened';
        created: boolean;
        retained: boolean;
        readBack: boolean;
        localProtocol: boolean;
        cleaned: boolean;
    }>;
    runDateRollover: () => Promise<DateRolloverDiagnosticDetails>;
};

function getUniqueValueArgument(argv: readonly string[], name: string): string | undefined {
    const prefix = `${name}=`;
    const matches = argv.filter(argument => argument.startsWith(prefix));
    if (matches.length > 1) throw new Error(`Duplicate diagnostic argument: ${name}`);
    return matches[0]?.slice(prefix.length);
}

function assertPhysicalDirectory(filepath: string, label: string): void {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(filepath);
    } catch {
        throw new Error(`${label} does not exist`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a physical directory`);
    }
}

function assertDirectTempChild(
    candidate: string,
    tempRoot: string,
    prefix: string,
    label: string,
): string {
    if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute`);
    const resolvedCandidate = path.resolve(candidate);
    const resolvedTempRoot = path.resolve(tempRoot);
    if (path.dirname(resolvedCandidate) !== resolvedTempRoot) {
        throw new Error(`${label} must be a direct child of the temporary directory`);
    }
    if (!path.basename(resolvedCandidate).startsWith(prefix)) {
        throw new Error(`${label} must use the required disposable prefix`);
    }
    assertPhysicalDirectory(resolvedTempRoot, 'Temporary directory');
    if (fs.realpathSync(resolvedTempRoot) !== fs.realpathSync(path.dirname(resolvedCandidate))) {
        throw new Error(`${label} parent must resolve to the temporary directory`);
    }
    return resolvedCandidate;
}

function validateToken(token: string | undefined): string {
    if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('MINDDIARY_SMOKE_TOKEN must be a 32-128 character URL-safe token');
    }
    if (new Set(token).size < 12) {
        throw new Error('MINDDIARY_SMOKE_TOKEN does not have enough character diversity');
    }
    return token;
}

function tokenDigest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function getDirectoryIdentity(filepath: string): SmokeDiagnosticRequest['profileIdentity'] {
    const stat = fs.lstatSync(filepath, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Diagnostic profile must be a physical directory');
    }
    return { device: stat.dev.toString(), inode: stat.ino.toString() };
}

function assertProfileMarker(profilePath: string, token: string): void {
    const markerPath = path.join(profilePath, SMOKE_PROFILE_MARKER);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(markerPath);
    } catch {
        throw new Error('Diagnostic profile marker does not exist');
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        throw new Error('Diagnostic profile marker must be a private physical file');
    }
    const expected = `${tokenDigest(token)}\n`;
    if (stat.size !== Buffer.byteLength(expected) || fs.readFileSync(markerPath, 'utf8') !== expected) {
        throw new Error('Diagnostic profile marker does not match the activation token');
    }
}

function assertNoExistingApplicationData(profilePath: string): void {
    const entries = new Set(fs.readdirSync(profilePath).map(name => name.toLowerCase()));
    if ([...entries].some(name => name.startsWith('minddiary.db'))
        || entries.has('attachments')
        || entries.has('mistake_images')) {
        throw new Error('Diagnostic profile must not contain existing application data');
    }
}

function assertPhysicalManagedTree(filepath: string): void {
    const stat = fs.lstatSync(filepath);
    if (stat.isSymbolicLink()) throw new Error('Initialized diagnostic profile contains a managed link');
    if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error('Initialized diagnostic profile contains a linked managed file');
        return;
    }
    if (!stat.isDirectory()) throw new Error('Initialized diagnostic profile contains unsupported managed data');
    for (const name of fs.readdirSync(filepath)) {
        assertPhysicalManagedTree(path.join(filepath, name));
    }
}

function assertInitializedApplicationDataSafe(profilePath: string): void {
    for (const name of ['minddiary.db', 'attachments', 'mistake_images']) {
        const filepath = path.join(profilePath, name);
        if (fs.existsSync(filepath)) assertPhysicalManagedTree(filepath);
    }
}

export function createSmokeDiagnosticProfileMarker(profilePath: string, token: string): void {
    assertPhysicalDirectory(profilePath, 'Diagnostic profile');
    const validatedToken = validateToken(token);
    fs.writeFileSync(path.join(profilePath, SMOKE_PROFILE_MARKER), `${tokenDigest(validatedToken)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
}

export function hasSmokeDiagnosticArguments(argv: readonly string[]): boolean {
    return argv.some(argument => argument.startsWith('--minddiary-smoke-'));
}

export function parseSmokeDiagnosticRequest(options: {
    argv: readonly string[];
    env: NodeJS.ProcessEnv;
    tempRoot?: string;
}): SmokeDiagnosticRequest | null {
    if (!hasSmokeDiagnosticArguments(options.argv)) return null;

    const token = validateToken(options.env.MINDDIARY_SMOKE_TOKEN);

    const allowedPrefixes = [
        '--minddiary-smoke-scenario=',
        '--minddiary-smoke-output=',
    ];
    const diagnosticArguments = options.argv.filter(argument => argument.startsWith('--minddiary-smoke-'));
    if (diagnosticArguments.some(argument => !allowedPrefixes.some(prefix => argument.startsWith(prefix)))) {
        throw new Error('Unknown or malformed diagnostic argument');
    }

    const scenarioValue = getUniqueValueArgument(options.argv, '--minddiary-smoke-scenario');
    if (!IMPLEMENTED_SMOKE_SCENARIOS.includes(scenarioValue as SmokeDiagnosticScenario)) {
        throw new Error('Unsupported diagnostic scenario');
    }
    const outputValue = getUniqueValueArgument(options.argv, '--minddiary-smoke-output');
    const profileValue = getUniqueValueArgument(options.argv, '--user-data-dir');
    if (!outputValue || !profileValue) {
        throw new Error('Diagnostic mode requires output and user-data paths');
    }

    const tempRoot = path.resolve(options.tempRoot ?? tmpdir());
    const profilePath = assertDirectTempChild(
        profileValue,
        tempRoot,
        SMOKE_PROFILE_PREFIX,
        'Diagnostic profile',
    );
    assertPhysicalDirectory(profilePath, 'Diagnostic profile');
    const expectedProfilePrefix = `${SMOKE_PROFILE_PREFIX}${tokenDigest(token).slice(0, 16)}-`;
    if (!path.basename(profilePath).startsWith(expectedProfilePrefix)) {
        throw new Error('Diagnostic profile name does not match the activation token');
    }
    const profileRealpath = fs.realpathSync(profilePath);
    if (path.dirname(profileRealpath) !== fs.realpathSync(tempRoot)
        || path.basename(profileRealpath) !== path.basename(profilePath)) {
        throw new Error('Diagnostic profile must remain inside the temporary directory');
    }
    assertProfileMarker(profilePath, token);
    if (scenarioValue === 'install-profile') assertInitializedApplicationDataSafe(profilePath);
    else assertNoExistingApplicationData(profilePath);

    const outputPath = assertDirectTempChild(
        outputValue,
        tempRoot,
        SMOKE_RESULT_PREFIX,
        'Diagnostic output',
    );
    if (path.extname(outputPath).toLowerCase() !== '.json') {
        throw new Error('Diagnostic output must be a JSON file');
    }
    if (fs.existsSync(outputPath)) throw new Error('Diagnostic output must not already exist');

    return {
        scenario: scenarioValue as SmokeDiagnosticScenario,
        outputPath,
        profilePath,
        token,
        tempRoot,
        profileIdentity: getDirectoryIdentity(profilePath),
    };
}

export function validateSmokeRuntimeProfile(
    request: SmokeDiagnosticRequest,
    actualUserDataPath: string,
    options: { allowInitializedProfile?: boolean } = {},
): void {
    assertPhysicalDirectory(request.profilePath, 'Diagnostic profile');
    const requestedRealpath = fs.realpathSync(request.profilePath);
    let actualRealpath: string;
    try {
        actualRealpath = fs.realpathSync(actualUserDataPath);
    } catch {
        throw new Error('Electron userData path does not exist');
    }
    if (requestedRealpath !== actualRealpath) {
        throw new Error('Electron userData path does not match the disposable diagnostic profile');
    }
    const identity = getDirectoryIdentity(request.profilePath);
    if (identity.device !== request.profileIdentity.device || identity.inode !== request.profileIdentity.inode) {
        throw new Error('Diagnostic profile identity changed after activation');
    }
    assertProfileMarker(request.profilePath, request.token);
    if (!options.allowInitializedProfile) assertNoExistingApplicationData(request.profilePath);
}

export function prepareSmokeDiagnosticDatabase(
    request: SmokeDiagnosticRequest,
    options: { allowExisting?: boolean } = {},
): string {
    validateSmokeRuntimeProfile(request, request.profilePath, {
        allowInitializedProfile: options.allowExisting,
    });
    const databasePath = path.join(request.profilePath, 'minddiary.db');
    if (options.allowExisting && fs.existsSync(databasePath)) {
        assertInitializedApplicationDataSafe(request.profilePath);
        const stat = fs.lstatSync(databasePath);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
            throw new Error('Existing diagnostic database must be a private physical file');
        }
        return databasePath;
    }
    const descriptor = fs.openSync(databasePath, 'wx', 0o600);
    fs.closeSync(descriptor);
    validateSmokeRuntimeProfile(request, request.profilePath, { allowInitializedProfile: true });
    const stat = fs.lstatSync(databasePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
        throw new Error('Diagnostic database reservation is not a private physical file');
    }
    return databasePath;
}

export async function runSmokeDiagnostic(
    request: SmokeDiagnosticRequest,
    dependencies: SmokeDiagnosticDependencies,
): Promise<SmokeDiagnosticResult> {
    validateSmokeRuntimeProfile(request, dependencies.actualUserDataPath, { allowInitializedProfile: true });
    const renderer = await dependencies.getRendererSecurityState();
    const nativeSqlite = dependencies.queryNativeSqlite();
    const evidence: SmokeEvidence[] = [
        { check: 'disposable-profile', passed: true },
        { check: 'renderer-sandbox', passed: renderer.sandbox },
        { check: 'renderer-context-isolation', passed: renderer.contextIsolation },
        { check: 'preload-api', passed: renderer.preloadAvailable },
        { check: 'production-renderer-document', passed: renderer.productionDocument },
        { check: 'native-sqlite-query', passed: nativeSqlite.query === 1 },
    ];

    if (request.scenario === 'sqlite-read-write') {
        const key = `__minddiary_smoke_${tokenDigest(request.token).slice(0, 16)}`;
        const roundTrip = dependencies.roundTripSetting(key, 'diagnostic-value');
        evidence.push(
            { check: 'sqlite-write', passed: roundTrip.written },
            { check: 'sqlite-read-back', passed: roundTrip.readBack },
            { check: 'sqlite-cleanup', passed: roundTrip.cleaned },
        );
    }

    if (request.scenario === 'portable-profile') {
        const profileRoundTrip = await dependencies.runProfileRoundTrip();
        evidence.push(
            { check: 'portable-wrapper', passed: dependencies.verifyPortableWrapper() },
            { check: 'profile-data-create', passed: profileRoundTrip.created },
            { check: 'profile-data-read-back', passed: profileRoundTrip.readBack },
            { check: 'local-protocol-load', passed: profileRoundTrip.localProtocol },
            { check: 'profile-data-cleanup', passed: profileRoundTrip.cleaned },
        );
    }

    if (request.scenario === 'install-profile') {
        const profileRoundTrip = await dependencies.runInstallProfileRoundTrip();
        const expectedPhaseChecksPassed = profileRoundTrip.phase === 'seeded'
            ? profileRoundTrip.created && profileRoundTrip.retained && !profileRoundTrip.cleaned
            : !profileRoundTrip.created && profileRoundTrip.retained && profileRoundTrip.cleaned;
        evidence.push(
            {
                check: profileRoundTrip.phase === 'seeded'
                    ? 'installed-profile-seeded'
                    : 'installed-profile-reopened',
                passed: true,
            },
            ...(profileRoundTrip.phase === 'seeded'
                ? [{ check: 'profile-data-create', passed: profileRoundTrip.created }]
                : [{ check: 'profile-data-retained', passed: profileRoundTrip.retained }]),
            { check: 'profile-data-read-back', passed: profileRoundTrip.readBack },
            { check: 'local-protocol-load', passed: profileRoundTrip.localProtocol },
            ...(profileRoundTrip.phase === 'reopened'
                ? [{ check: 'profile-data-cleanup', passed: profileRoundTrip.cleaned }]
                : []),
            { check: 'install-profile-phase-consistent', passed: expectedPhaseChecksPassed },
        );
    }

    let dateRollover: DateRolloverDiagnosticDetails | undefined;
    if (request.scenario === 'date-rollover') {
        dateRollover = await dependencies.runDateRollover();
        evidence.push(
            ...Object.entries(dateRollover.checks).map(([check, passed]) => ({
                check: `date-rollover-${check}`,
                passed,
            })),
            { check: 'date-rollover-zero-business-write', passed: dateRollover.businessWrites.duringRollover === 0 },
            { check: 'date-rollover-confirmed-write', passed: dateRollover.businessWrites.confirmedAfterRollover === 1 },
        );
    }

    const passed = evidence.every(item => item.passed);
    return {
        schemaVersion: 1,
        scenario: request.scenario,
        applicationVersion: dependencies.applicationVersion,
        electronVersion: dependencies.electronVersion,
        platform: dependencies.platform,
        arch: dependencies.arch,
        isPackaged: dependencies.isPackaged,
        sandbox: renderer.sandbox,
        contextIsolation: renderer.contextIsolation,
        preloadAvailable: renderer.preloadAvailable,
        nativeSqlite: {
            loaded: nativeSqlite.query === 1,
            query: nativeSqlite.query,
            sqliteVersion: nativeSqlite.sqliteVersion,
        },
        result: passed ? 'passed' : 'failed',
        evidence,
        ...(dateRollover ? { dateRollover } : {}),
    };
}

export function createFailedSmokeDiagnosticResult(
    request: SmokeDiagnosticRequest,
    dependencies: Pick<SmokeDiagnosticDependencies, 'applicationVersion' | 'electronVersion' | 'platform' | 'arch' | 'isPackaged'>,
): SmokeDiagnosticResult {
    return {
        schemaVersion: 1,
        scenario: request.scenario,
        applicationVersion: dependencies.applicationVersion,
        electronVersion: dependencies.electronVersion,
        platform: dependencies.platform,
        arch: dependencies.arch,
        isPackaged: dependencies.isPackaged,
        sandbox: false,
        contextIsolation: false,
        preloadAvailable: false,
        nativeSqlite: { loaded: false, query: 0, sqliteVersion: '' },
        result: 'failed',
        evidence: [{ check: 'diagnostic-run', passed: false }],
    };
}

export function writeSmokeDiagnosticResult(
    request: SmokeDiagnosticRequest,
    result: SmokeDiagnosticResult,
): void {
    const outputPath = assertDirectTempChild(
        request.outputPath,
        request.tempRoot,
        SMOKE_RESULT_PREFIX,
        'Diagnostic output',
    );
    if (fs.existsSync(outputPath)) throw new Error('Diagnostic output must not already exist');
    const temporaryPath = `${outputPath}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        fs.renameSync(temporaryPath, outputPath);
    } finally {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch {
        }
    }
}
