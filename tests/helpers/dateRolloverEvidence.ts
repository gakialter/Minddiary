import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SmokeDiagnosticResult } from '../../electron/smokeDiagnostics';
import { validateDateRolloverDiagnosticDetails } from '../../electron/dateRolloverDiagnostic';

export const DATE_ROLLOVER_EVIDENCE_FILES = [
  'business-write-count.txt',
  'database-before-after.json',
  'date-rollover-result.json',
  'mock-request-log.json',
  'ui-event-sequence.json',
] as const;

function writeNewFile(filepath: string, content: string): void {
  fs.writeFileSync(filepath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function assertEvidenceDirectory(directory: string, projectRoot: string): void {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const projectRootStat = fs.lstatSync(resolvedProjectRoot);
  if (projectRootStat.isSymbolicLink() || !projectRootStat.isDirectory()) {
    throw new Error('Date rollover project root must be a physical directory');
  }
  const testResultsRoot = path.resolve(resolvedProjectRoot, 'test-results');
  const expected = path.resolve(testResultsRoot, 'date-rollover-evidence');
  if (path.dirname(expected) !== testResultsRoot) throw new Error('Date rollover evidence directory escaped test-results');
  if (path.resolve(directory) !== expected) throw new Error('Unexpected date rollover evidence directory');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const testResultsStat = fs.lstatSync(testResultsRoot);
  if (testResultsStat.isSymbolicLink() || !testResultsStat.isDirectory()) {
    throw new Error('Date rollover evidence root must be a physical directory');
  }
  if (fs.existsSync(expected)) {
    const stat = fs.lstatSync(expected);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Date rollover evidence path must be a physical directory');
    const entries = fs.readdirSync(expected);
    if (entries.some(entry => !DATE_ROLLOVER_EVIDENCE_FILES.includes(entry as typeof DATE_ROLLOVER_EVIDENCE_FILES[number]))) {
      throw new Error('Date rollover evidence directory contains an unexpected entry');
    }
    for (const entry of entries) {
      const filepath = path.join(expected, entry);
      const entryStat = fs.lstatSync(filepath);
      if (entryStat.isSymbolicLink() || !entryStat.isFile()) throw new Error('Date rollover evidence directory contains an unsafe entry');
      fs.unlinkSync(filepath);
    }
    fs.rmdirSync(expected);
  }
  fs.mkdirSync(expected);
}

export function writeDateRolloverEvidence(options: {
  result: SmokeDiagnosticResult;
  projectRoot: string;
  evidenceDirectory?: string;
}): string {
  const details = options.result.dateRollover;
  if (options.result.scenario !== 'date-rollover'
    || options.result.result !== 'passed'
    || !details
    || !validateDateRolloverDiagnosticDetails(details)) {
    throw new Error('Refusing to archive failed or incomplete date rollover evidence');
  }
  const evidenceDirectory = options.evidenceDirectory
    ?? path.join(options.projectRoot, 'test-results', 'date-rollover-evidence');
  assertEvidenceDirectory(evidenceDirectory, options.projectRoot);
  writeNewFile(path.join(evidenceDirectory, 'ui-event-sequence.json'), `${JSON.stringify({
    schemaVersion: 1,
    oldDate: details.oldDate,
    newDate: details.newDate,
    events: details.eventSequence,
  }, null, 2)}\n`);
  writeNewFile(path.join(evidenceDirectory, 'mock-request-log.json'), `${JSON.stringify({
    schemaVersion: 1,
    requests: details.mockRequests,
    rawBodiesArchived: false,
    apiKeyArchived: false,
  }, null, 2)}\n`);
  writeNewFile(path.join(evidenceDirectory, 'database-before-after.json'), `${JSON.stringify({
    schemaVersion: 1,
    snapshots: details.database,
    rowContentsArchived: false,
  }, null, 2)}\n`);
  writeNewFile(path.join(evidenceDirectory, 'business-write-count.txt'), [
    'schema-version=1',
    `during-rollover=${details.businessWrites.duringRollover}`,
    `confirmed-after-rollover=${details.businessWrites.confirmedAfterRollover}`,
    `confirmed-task-planned-date=${details.createdTask.plannedDate}`,
    `confirmed-task-status=${details.createdTask.status}`,
    `confirmed-task-source=${details.createdTask.source}`,
    '',
  ].join('\n'));
  const boundedResult = {
    schemaVersion: 1,
    scenario: options.result.scenario,
    applicationVersion: options.result.applicationVersion,
    electronVersion: options.result.electronVersion,
    platform: options.result.platform,
    arch: options.result.arch,
    isPackaged: options.result.isPackaged,
    result: options.result.result,
    checks: details.checks,
    evidenceDigest: createHash('sha256').update(JSON.stringify(details)).digest('hex'),
  };
  writeNewFile(path.join(evidenceDirectory, 'date-rollover-result.json'), `${JSON.stringify(boundedResult, null, 2)}\n`);
  const files = fs.readdirSync(evidenceDirectory).sort();
  if (JSON.stringify(files) !== JSON.stringify([...DATE_ROLLOVER_EVIDENCE_FILES])) {
    throw new Error('Date rollover evidence file set is not exact');
  }
  return evidenceDirectory;
}
