import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMPLEMENTED_SMOKE_SCENARIOS,
  INSTALL_PROFILE_BUSINESS_TABLES,
  SMOKE_PROFILE_MARKER,
  SMOKE_PROFILE_PREFIX,
  SMOKE_RESULT_PREFIX,
  parseSmokeDiagnosticRequest,
  prepareSmokeDiagnosticDatabase,
  runSmokeDiagnostic,
  validateInstallProfileBusinessSnapshots,
  validateSmokeRuntimeProfile,
  writeSmokeDiagnosticResult,
  type SmokeDiagnosticDependencies,
  type SmokeDiagnosticRequest,
} from '../electron/smokeDiagnostics';
import type { DateRolloverDiagnosticDetails } from '../electron/dateRolloverDiagnostic';
import { CURRENT_SCHEMA_VERSION } from '../electron/databaseMigrations';

const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const tempRoots: string[] = [];

function makeRequest(
  scenario: 'startup' | 'sqlite-read-write' | 'portable-profile' | 'install-profile' | 'date-rollover' = 'startup',
): SmokeDiagnosticRequest {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-smoke-tests-'));
  tempRoots.push(tempRoot);
  const digest = createHash('sha256').update(token).digest('hex');
  const profilePath = fs.mkdtempSync(path.join(tempRoot, `${SMOKE_PROFILE_PREFIX}${digest.slice(0, 16)}-`));
  fs.writeFileSync(path.join(profilePath, SMOKE_PROFILE_MARKER), `${digest}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const outputPath = path.join(tempRoot, `${SMOKE_RESULT_PREFIX}${process.pid}-${scenario}.json`);
  const request = parseSmokeDiagnosticRequest({
    argv: [
      'electron',
      '.',
      `--minddiary-smoke-scenario=${scenario}`,
      `--minddiary-smoke-output=${outputPath}`,
      `--user-data-dir=${profilePath}`,
    ],
    env: { MINDDIARY_SMOKE_TOKEN: token },
    tempRoot,
  });
  if (!request) throw new Error('Expected a diagnostic request');
  return request;
}

function makeDependencies(request: SmokeDiagnosticRequest): SmokeDiagnosticDependencies {
  return {
    applicationVersion: '1.16.0',
    electronVersion: '42.6.1',
    nodeModuleAbi: '146',
    platform: process.platform,
    arch: process.arch,
    isPackaged: true,
    actualUserDataPath: request.profilePath,
    queryNativeSqlite: () => ({
      query: 1,
      sqliteVersion: '3.53.2',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }),
    getRendererSecurityState: async () => ({
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      productionDocument: true,
    }),
    roundTripSetting: () => ({ written: true, readBack: true, cleaned: true }),
    verifyPortableWrapper: () => true,
    runProfileRoundTrip: async () => ({
      created: true,
      readBack: true,
      localProtocol: true,
      cleaned: true,
    }),
    runInstallProfileRoundTrip: async () => ({
      phase: 'seeded',
      created: true,
      retained: true,
      readBack: true,
      localProtocol: true,
      cleaned: false,
      businessDataExact: true,
    }),
    runDateRollover: async () => makeDateRolloverDetails(),
  };
}

function makeDateRolloverDetails(): DateRolloverDiagnosticDetails {
  const empty = { entries: 0, studyTasks: 0, mistakes: 0, pomodoroSessions: 0, attachments: 0 };
  const afterCreate = { ...empty, studyTasks: 1 };
  return {
    schemaVersion: 1,
    oldDate: '2026-05-31',
    newDate: '2026-06-01',
    oldCandidateDate: '2026-06-01',
    newCandidateDate: '2026-06-02',
    eventSequence: [
      'old-dialog-opened',
      'old-candidate-generated:2026-06-01',
      'logical-midnight-crossed:2026-06-01T00:00:01-local',
      'old-dialog-closed',
      'new-dialog-opened',
      'new-candidate-generated:2026-06-02',
      'new-candidate-confirmed',
    ],
    mockRequests: [
      { sequence: 1, method: 'POST', path: '/v1/chat/completions', authorizationPresent: true, reviewDate: '2026-05-31', candidateDate: '2026-06-01' },
      { sequence: 2, method: 'POST', path: '/v1/chat/completions', authorizationPresent: true, reviewDate: '2026-06-01', candidateDate: '2026-06-02' },
    ],
    database: { beforeRollover: empty, afterRollover: empty, afterConfirmedCreate: afterCreate, afterCleanup: empty },
    businessWrites: { duringRollover: 0, confirmedAfterRollover: 1 },
    createdTask: { plannedDate: '2026-06-02', status: 'todo', source: 'ai' },
    checks: {
      oldDialogOpened: true,
      oldCandidateGenerated: true,
      oldDialogClosedAtRollover: true,
      oldCandidateDetached: true,
      oldCandidateMainWriteRejected: true,
      rolloverZeroWrite: true,
      newDialogOpened: true,
      newCandidateGenerated: true,
      requestDatesCorrect: true,
      confirmedTaskUsesNewCandidateDate: true,
      cleanupComplete: true,
    },
  };
}

describe('packaged smoke diagnostics', () => {
  it('accepts only the default-template baseline and fixed install probe delta', () => {
    const baseline = Object.fromEntries(INSTALL_PROFILE_BUSINESS_TABLES.map(table => [
      table,
      table === 'diary_templates' ? 3 : 0,
    ])) as Record<typeof INSTALL_PROFILE_BUSINESS_TABLES[number], number>;
    const seeded = { ...baseline, entries: 1, attachments: 1 };

    expect(validateInstallProfileBusinessSnapshots('seeded', baseline, seeded)).toBe(true);
    expect(validateInstallProfileBusinessSnapshots('reopened', seeded, baseline)).toBe(true);
    expect(validateInstallProfileBusinessSnapshots('seeded', { ...baseline, study_tasks: 1 }, seeded)).toBe(false);
    expect(validateInstallProfileBusinessSnapshots('reopened', seeded, { ...baseline, entries: 1 })).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('stays disabled when no diagnostic argument is present', () => {
    expect(parseSmokeDiagnosticRequest({ argv: ['electron', '.'], env: {} })).toBeNull();
    expect(parseSmokeDiagnosticRequest({
      argv: ['electron', '.'],
      env: { MINDDIARY_SMOKE_TOKEN: token },
    })).toBeNull();
  });

  it('accepts only complete requests for implemented scenarios', () => {
    const request = makeRequest();
    expect(request.scenario).toBe('startup');
    expect(IMPLEMENTED_SMOKE_SCENARIOS).toEqual([
      'startup',
      'sqlite-read-write',
      'portable-profile',
      'install-profile',
      'date-rollover',
    ]);

    expect(parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=date-rollover',
        `--minddiary-smoke-output=${path.join(request.tempRoot, `${SMOKE_RESULT_PREFIX}rollover.json`)}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })?.scenario).toBe('date-rollover');
    expect(() => parseSmokeDiagnosticRequest({
      argv: ['electron', '.', '--minddiary-smoke-scenario=startup'],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/requires output and user-data paths/);
  });

  it('rejects weak tokens, existing outputs, and non-disposable profiles', () => {
    const request = makeRequest();
    const argv = [
      'electron',
      '.',
      '--minddiary-smoke-scenario=startup',
      `--minddiary-smoke-output=${request.outputPath}`,
      `--user-data-dir=${request.profilePath}`,
    ];
    expect(() => parseSmokeDiagnosticRequest({
      argv,
      env: { MINDDIARY_SMOKE_TOKEN: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      tempRoot: request.tempRoot,
    })).toThrow(/character diversity/);

    fs.writeFileSync(request.outputPath, '{}');
    expect(() => parseSmokeDiagnosticRequest({
      argv,
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/must not already exist/);

    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=startup',
        `--minddiary-smoke-output=${path.join(request.tempRoot, `${SMOKE_RESULT_PREFIX}other.json`)}`,
        `--user-data-dir=${path.join(request.tempRoot, 'ordinary-profile')}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/required disposable prefix|does not exist/);
  });

  it('rejects profile links and runtime userData mismatches', () => {
    const request = makeRequest();
    const linkedProfile = path.join(request.tempRoot, `${SMOKE_PROFILE_PREFIX}linked`);
    fs.symlinkSync(request.profilePath, linkedProfile, 'junction');
    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=startup',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${linkedProfile}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/physical directory/);

    const otherProfile = fs.mkdtempSync(path.join(request.tempRoot, SMOKE_PROFILE_PREFIX));
    expect(() => validateSmokeRuntimeProfile(request, otherProfile)).toThrow(/does not match/);
  });

  it('requires a token-bound fresh profile and reserves a private database', () => {
    const request = makeRequest();
    const databasePath = prepareSmokeDiagnosticDatabase(request);
    const stat = fs.lstatSync(databasePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.nlink).toBe(1);
    expect(() => prepareSmokeDiagnosticDatabase(request)).toThrow(/existing application data/);

    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=startup',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/existing application data/);
  });

  it('allows only install-profile to reopen physical managed application data', () => {
    const request = makeRequest('install-profile');
    const databasePath = prepareSmokeDiagnosticDatabase(request, { allowExisting: true });
    expect(prepareSmokeDiagnosticDatabase(request, { allowExisting: true })).toBe(databasePath);
    expect(parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=install-profile',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })?.scenario).toBe('install-profile');

    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=startup',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/existing application data/);
  });

  it('rejects linked managed data when reopening an install profile', () => {
    const request = makeRequest('install-profile');
    const outside = fs.mkdtempSync(path.join(request.tempRoot, 'outside-managed-data-'));
    fs.symlinkSync(outside, path.join(request.profilePath, 'attachments'), 'junction');

    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=install-profile',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/managed link/);
  });

  it('rejects a profile whose marker does not match the activation token', () => {
    const request = makeRequest();
    fs.writeFileSync(path.join(request.profilePath, SMOKE_PROFILE_MARKER), `${'0'.repeat(64)}\n`, 'utf8');
    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=startup',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/marker does not match/);
  });

  it('runs startup diagnostics and writes a path- and token-free result atomically', async () => {
    const request = makeRequest();
    const result = await runSmokeDiagnostic(request, makeDependencies(request));
    writeSmokeDiagnosticResult(request, result);

    expect(result.result).toBe('passed');
    expect(result.nativeSqlite).toEqual({
      loaded: true,
      query: 1,
      sqliteVersion: '3.53.2',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    const serialized = fs.readFileSync(request.outputPath, 'utf8');
    expect(serialized).not.toContain(request.profilePath);
    expect(serialized).not.toContain(request.outputPath);
    expect(serialized).not.toContain(request.token);
    expect(JSON.parse(serialized)).toEqual(result);
    expect(() => writeSmokeDiagnosticResult(request, result)).toThrow(/must not already exist/);
  });

  it('uses a predefined SQLite round trip and records cleanup', async () => {
    const request = makeRequest('sqlite-read-write');
    const dependencies = makeDependencies(request);
    const roundTrip = vi.fn((_key: string, _value: string) => ({
      written: true,
      readBack: true,
      cleaned: true,
    }));
    dependencies.roundTripSetting = roundTrip;

    const result = await runSmokeDiagnostic(request, dependencies);

    expect(roundTrip).toHaveBeenCalledOnce();
    expect(roundTrip.mock.calls[0]?.[0]).toMatch(/^__minddiary_smoke_/);
    expect(roundTrip.mock.calls[0]?.[0]).not.toContain(request.token.slice(0, 16));
    expect(result.evidence).toEqual(expect.arrayContaining([
      { check: 'sqlite-write', passed: true },
      { check: 'sqlite-read-back', passed: true },
      { check: 'sqlite-cleanup', passed: true },
    ]));
    expect(result.result).toBe('passed');
  });

  it('records the fixed Portable wrapper, profile, local protocol, and cleanup checks', async () => {
    const request = makeRequest('portable-profile');
    const dependencies = makeDependencies(request);
    const profileRoundTrip = vi.fn(async () => ({
      created: true,
      readBack: true,
      localProtocol: true,
      cleaned: true,
    }));
    dependencies.runProfileRoundTrip = profileRoundTrip;

    const result = await runSmokeDiagnostic(request, dependencies);

    expect(profileRoundTrip).toHaveBeenCalledOnce();
    expect(result.evidence).toEqual(expect.arrayContaining([
      { check: 'portable-wrapper', passed: true },
      { check: 'profile-data-create', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'profile-data-cleanup', passed: true },
    ]));
    expect(result.result).toBe('passed');
  });

  it('fails the Portable scenario when the wrapper or cleanup proof fails', async () => {
    const request = makeRequest('portable-profile');
    const dependencies = makeDependencies(request);
    dependencies.verifyPortableWrapper = () => false;
    dependencies.runProfileRoundTrip = async () => ({
      created: true,
      readBack: true,
      localProtocol: true,
      cleaned: false,
    });

    const result = await runSmokeDiagnostic(request, dependencies);

    expect(result.result).toBe('failed');
    expect(result.evidence).toContainEqual({ check: 'portable-wrapper', passed: false });
    expect(result.evidence).toContainEqual({ check: 'profile-data-cleanup', passed: false });
  });

  it('records distinct seed and reopen evidence for the fixed installed profile probe', async () => {
    const request = makeRequest('install-profile');
    const dependencies = makeDependencies(request);
    const seeded = await runSmokeDiagnostic(request, dependencies);
    expect(seeded.result).toBe('passed');
    expect(seeded.evidence).toEqual(expect.arrayContaining([
      { check: 'installed-profile-seeded', passed: true },
      { check: 'profile-data-create', passed: true },
      { check: 'profile-data-read-back', passed: true },
      { check: 'local-protocol-load', passed: true },
      { check: 'install-profile-business-data-exact', passed: true },
      { check: 'install-profile-phase-consistent', passed: true },
    ]));
    expect(seeded.evidence.some(item => item.check === 'profile-data-cleanup')).toBe(false);

    dependencies.runInstallProfileRoundTrip = async () => ({
      phase: 'reopened',
      created: false,
      retained: true,
      readBack: true,
      localProtocol: true,
      cleaned: true,
      businessDataExact: true,
    });
    const reopened = await runSmokeDiagnostic(request, dependencies);
    expect(reopened.result).toBe('passed');
    expect(reopened.evidence).toEqual(expect.arrayContaining([
      { check: 'installed-profile-reopened', passed: true },
      { check: 'profile-data-retained', passed: true },
      { check: 'profile-data-cleanup', passed: true },
      { check: 'install-profile-business-data-exact', passed: true },
      { check: 'install-profile-phase-consistent', passed: true },
    ]));
    expect(reopened.evidence.some(item => item.check === 'profile-data-create')).toBe(false);
  });

  it('records the fixed local-date rollover sequence, request dates, zero-write gate, and confirmed new-date write', async () => {
    const request = makeRequest('date-rollover');
    const dependencies = makeDependencies(request);
    const details = makeDateRolloverDetails();
    const runDateRollover = vi.fn(async () => details);
    dependencies.runDateRollover = runDateRollover;

    const result = await runSmokeDiagnostic(request, dependencies);

    expect(runDateRollover).toHaveBeenCalledOnce();
    expect(result.dateRollover).toEqual(details);
    expect(result.evidence).toEqual(expect.arrayContaining([
      { check: 'date-rollover-oldDialogClosedAtRollover', passed: true },
      { check: 'date-rollover-oldCandidateDetached', passed: true },
      { check: 'date-rollover-oldCandidateMainWriteRejected', passed: true },
      { check: 'date-rollover-requestDatesCorrect', passed: true },
      { check: 'date-rollover-zero-business-write', passed: true },
      { check: 'date-rollover-confirmed-write', passed: true },
    ]));
    expect(result.result).toBe('passed');
  });
});
