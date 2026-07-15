import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SmokeDiagnosticProcessResult } from './smokeDiagnosticRunner';

export const PORTABLE_EVIDENCE_FILES = [
  'manifest.json',
  'hashes.txt',
  'diagnostic-result.json',
  'process-log.txt',
  'paths-before.txt',
  'paths-after.txt',
] as const;

export type DefaultApplicationDataSnapshot = Array<{
  label: 'roaming-user-data' | 'local-user-data';
  exists: boolean;
  entryCount: number;
  metadataSha256: string;
}>;

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotDirectory(root: string): Omit<DefaultApplicationDataSnapshot[number], 'label'> {
  if (!fs.existsSync(root)) {
    return { exists: false, entryCount: 0, metadataSha256: sha256Text('missing') };
  }
  try {
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error('unsupported default application data path');
    }
    const records: string[] = [
      `directory|.|${rootStat.size}|${rootStat.mtimeMs}|${rootStat.ctimeMs}`,
    ];
    const pending = [{ absolute: root, relative: '.' }];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolute = path.join(current.absolute, entry.name);
        const relative = path.posix.join(current.relative, entry.name);
        const stat = fs.lstatSync(absolute);
        const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file';
        records.push(`${type}|${relative}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`);
        if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push({ absolute, relative });
      }
    }
    records.sort();
    return {
      exists: true,
      entryCount: records.length,
      metadataSha256: sha256Text(records.join('\n')),
    };
  } catch {
    throw new Error('Unable to snapshot default application data');
  }
}

export function snapshotDefaultApplicationData(): DefaultApplicationDataSnapshot {
  if (process.platform !== 'win32' || !process.env.APPDATA || !process.env.LOCALAPPDATA) {
    throw new Error('Windows application data roots are unavailable');
  }
  return snapshotApplicationDataDirectories([
    { label: 'roaming-user-data', root: path.join(process.env.APPDATA, 'minddiary') },
    { label: 'local-user-data', root: path.join(process.env.LOCALAPPDATA, 'minddiary') },
  ]);
}

export function snapshotApplicationDataDirectories(
  locations: Array<{ label: DefaultApplicationDataSnapshot[number]['label']; root: string }>,
): DefaultApplicationDataSnapshot {
  return locations.map(location => ({ label: location.label, ...snapshotDirectory(location.root) }));
}

function formatPathSnapshot(phase: 'before' | 'after', unchanged: boolean): string {
  return `${[
    'schema-version=1',
    'scope=default-application-data',
    `snapshot=${phase}`,
    'locations=roaming-user-data,local-user-data',
    'raw-paths-archived=false',
    'existence-and-counts-archived=false',
    'metadata-fingerprints-archived=false',
    `comparison=${unchanged ? 'unchanged' : 'changed'}`,
    '',
  ].join('\n')}`;
}

async function sha256File(filepath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filepath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function writeNewFile(filepath: string, contents: string): void {
  fs.writeFileSync(filepath, contents, { encoding: 'utf8', flag: 'wx' });
}

export async function writePortableSmokeEvidence(options: {
  projectRoot: string;
  executablePath: string;
  run: SmokeDiagnosticProcessResult;
  before: DefaultApplicationDataSnapshot;
  after: DefaultApplicationDataSnapshot;
}): Promise<string> {
  const resolvedProjectRoot = path.resolve(options.projectRoot);
  const projectRootStat = fs.lstatSync(resolvedProjectRoot);
  if (projectRootStat.isSymbolicLink() || !projectRootStat.isDirectory()
    || fs.realpathSync(resolvedProjectRoot) !== resolvedProjectRoot) {
    throw new Error('Portable evidence project root must be a physical directory');
  }
  const testResultsRoot = path.resolve(resolvedProjectRoot, 'test-results');
  const evidenceDirectory = path.resolve(testResultsRoot, 'windows-portable-smoke-evidence');
  if (path.dirname(evidenceDirectory) !== testResultsRoot) {
    throw new Error('Portable evidence directory escaped test-results');
  }
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const testResultsStat = fs.lstatSync(testResultsRoot);
  if (testResultsStat.isSymbolicLink() || !testResultsStat.isDirectory()
    || fs.realpathSync(testResultsRoot) !== testResultsRoot) {
    throw new Error('Portable evidence root must be a physical test-results directory');
  }
  if (fs.existsSync(evidenceDirectory)) {
    const evidenceStat = fs.lstatSync(evidenceDirectory);
    if (evidenceStat.isSymbolicLink() || !evidenceStat.isDirectory()) {
      throw new Error('Portable evidence path must be a physical directory');
    }
    const existingNames = fs.readdirSync(evidenceDirectory);
    if (existingNames.some(name => !PORTABLE_EVIDENCE_FILES.includes(name as typeof PORTABLE_EVIDENCE_FILES[number]))) {
      throw new Error('Portable evidence directory contains an unexpected entry');
    }
    for (const name of existingNames) {
      const existingPath = path.join(evidenceDirectory, name);
      const existingStat = fs.lstatSync(existingPath);
      if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
        throw new Error('Portable evidence directory contains a non-physical file');
      }
      fs.unlinkSync(existingPath);
    }
    fs.rmdirSync(evidenceDirectory);
  }
  fs.mkdirSync(evidenceDirectory);

  const executableStat = fs.lstatSync(options.executablePath);
  const executableSha256 = await sha256File(options.executablePath);
  const diagnostic = `${JSON.stringify(options.run.result, null, 2)}\n`;
  const outputBytes = Buffer.byteLength(options.run.outputText);
  const defaultApplicationDataUnchanged = JSON.stringify(options.before) === JSON.stringify(options.after);
  const processLog = [
    'schema-version=1',
    'process=windows-portable-wrapper',
    'exit-code=0',
    `captured-output-bytes=${outputBytes}`,
    `captured-output-sha256=${sha256Text(options.run.outputText)}`,
    'raw-output-archived=false',
    'portable-wrapper-evidence=true',
    '',
  ].join('\n');
  const manifest = {
    schemaVersion: 1,
    evidenceType: 'windows-portable-packaged-smoke',
    artifact: {
      name: path.basename(options.executablePath),
      sha256: executableSha256,
      sizeBytes: executableStat.size,
    },
    runtime: {
      applicationVersion: options.run.result.applicationVersion,
      electronVersion: options.run.result.electronVersion,
      platform: options.run.result.platform,
      arch: options.run.result.arch,
      isPackaged: options.run.result.isPackaged,
    },
    checks: {
      result: options.run.result.result,
      defaultApplicationDataUnchanged,
      disposableProfile: true,
      processExitCode: 0,
    },
    archivedFiles: [...PORTABLE_EVIDENCE_FILES],
  };

  writeNewFile(path.join(evidenceDirectory, 'diagnostic-result.json'), diagnostic);
  writeNewFile(path.join(evidenceDirectory, 'process-log.txt'), processLog);
  writeNewFile(
    path.join(evidenceDirectory, 'paths-before.txt'),
    formatPathSnapshot('before', defaultApplicationDataUnchanged),
  );
  writeNewFile(
    path.join(evidenceDirectory, 'paths-after.txt'),
    formatPathSnapshot('after', defaultApplicationDataUnchanged),
  );
  writeNewFile(path.join(evidenceDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const hashTargets = [
    options.executablePath,
    ...PORTABLE_EVIDENCE_FILES
      .filter(name => name !== 'hashes.txt')
      .map(name => path.join(evidenceDirectory, name)),
  ];
  const hashLines: string[] = [];
  for (const filepath of hashTargets) {
    hashLines.push(`${await sha256File(filepath)}  ${path.basename(filepath)}`);
  }
  writeNewFile(path.join(evidenceDirectory, 'hashes.txt'), `${hashLines.join('\n')}\n`);
  return evidenceDirectory;
}
