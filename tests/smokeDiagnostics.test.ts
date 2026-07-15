import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMPLEMENTED_SMOKE_SCENARIOS,
  SMOKE_PROFILE_MARKER,
  SMOKE_PROFILE_PREFIX,
  SMOKE_RESULT_PREFIX,
  parseSmokeDiagnosticRequest,
  prepareSmokeDiagnosticDatabase,
  runSmokeDiagnostic,
  validateSmokeRuntimeProfile,
  writeSmokeDiagnosticResult,
  type SmokeDiagnosticDependencies,
  type SmokeDiagnosticRequest,
} from '../electron/smokeDiagnostics';

const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const tempRoots: string[] = [];

function makeRequest(scenario: 'startup' | 'sqlite-read-write' = 'startup'): SmokeDiagnosticRequest {
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
    platform: process.platform,
    arch: process.arch,
    isPackaged: true,
    actualUserDataPath: request.profilePath,
    queryNativeSqlite: () => ({ query: 1, sqliteVersion: '3.53.2' }),
    getRendererSecurityState: async () => ({
      sandbox: true,
      contextIsolation: true,
      preloadAvailable: true,
      productionDocument: true,
    }),
    roundTripSetting: () => ({ written: true, readBack: true, cleaned: true }),
  };
}

describe('packaged smoke diagnostics', () => {
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
    expect(IMPLEMENTED_SMOKE_SCENARIOS).toEqual(['startup', 'sqlite-read-write']);

    expect(() => parseSmokeDiagnosticRequest({
      argv: [
        'electron',
        '.',
        '--minddiary-smoke-scenario=portable-profile',
        `--minddiary-smoke-output=${request.outputPath}`,
        `--user-data-dir=${request.profilePath}`,
      ],
      env: { MINDDIARY_SMOKE_TOKEN: token },
      tempRoot: request.tempRoot,
    })).toThrow(/Unsupported diagnostic scenario/);
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
    expect(result.nativeSqlite).toEqual({ loaded: true, query: 1, sqliteVersion: '3.53.2' });
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
});
