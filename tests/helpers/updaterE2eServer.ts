import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { dump, load } from 'js-yaml';

export type UpdaterServerMode = 'no-update' | 'invalid-metadata' | 'bad-checksum' | 'positive';

export type UpdaterServerRequest = {
  sequence: number;
  mode: UpdaterServerMode;
  method: 'GET' | 'HEAD' | 'OTHER';
  resource: string;
  status: number;
  queryPresent: boolean;
  rangeRequested: boolean;
  authorizationPresent: boolean;
  cookiePresent: boolean;
  loopback: boolean;
};

type LatestMetadata = {
  version: string;
  files: Array<{ url: string; sha512: string; size?: number }>;
  path: string;
  sha512: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type UpdaterServerArtifacts = {
  oldSetupPath: string;
  oldBlockmapPath: string;
  newSetupPath: string;
  newBlockmapPath: string;
  oldLatestPath: string;
  newLatestPath: string;
  releaseNotes: string;
};

export type PreparedUpdaterMetadata = {
  old: LatestMetadata;
  positive: LatestMetadata;
  badChecksum: LatestMetadata;
  invalid: string;
  oldText: string;
  positiveText: string;
  badChecksumText: string;
};

function requireMetadata(value: unknown, label: string): LatestMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const metadata = value as Partial<LatestMetadata>;
  if (typeof metadata.version !== 'string'
    || typeof metadata.path !== 'string'
    || typeof metadata.sha512 !== 'string'
    || !Array.isArray(metadata.files)
    || metadata.files.length !== 1) {
    throw new Error(`${label} does not match the Windows latest.yml contract`);
  }
  const file = metadata.files[0];
  if (!file || typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
    throw new Error(`${label} file metadata is invalid`);
  }
  for (const candidate of [metadata.path, file.url]) {
    if (path.basename(candidate) !== candidate || candidate.includes('..')) {
      throw new Error(`${label} contains a non-basename artifact path`);
    }
  }
  return metadata as LatestMetadata;
}

export function prepareUpdaterMetadata(artifacts: UpdaterServerArtifacts): PreparedUpdaterMetadata {
  const old = requireMetadata(load(readFileSync(artifacts.oldLatestPath, 'utf8')), 'old latest.yml');
  const positive = requireMetadata(load(readFileSync(artifacts.newLatestPath, 'utf8')), 'new latest.yml');
  old.releaseNotes = artifacts.releaseNotes;
  positive.releaseNotes = artifacts.releaseNotes;
  const incorrectSha512 = Buffer.alloc(64, 0x5a).toString('base64');
  const badChecksum: LatestMetadata = {
    ...positive,
    sha512: incorrectSha512,
    files: positive.files.map(file => ({ ...file, sha512: incorrectSha512 })),
  };
  return {
    old,
    positive,
    badChecksum,
    invalid: 'version: [unterminated\nfiles:\n',
    oldText: dump(old, { lineWidth: -1, noRefs: true }),
    positiveText: dump(positive, { lineWidth: -1, noRefs: true }),
    badChecksumText: dump(badChecksum, { lineWidth: -1, noRefs: true }),
  };
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function parseSingleRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) throw new Error('Unsupported range request');
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size) {
    throw new Error('Invalid range request');
  }
  return { start, end };
}

function sendText(response: ServerResponse, method: 'GET' | 'HEAD', status: number, body: string): void {
  const bytes = Buffer.byteLength(body);
  response.writeHead(status, {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Content-Length': String(bytes),
    'Cache-Control': 'no-store',
  });
  response.end(method === 'HEAD' ? undefined : body);
}

export class LoopbackUpdaterServer {
  private readonly artifacts: UpdaterServerArtifacts;
  private readonly metadata: PreparedUpdaterMetadata;
  private server: Server | null = null;
  private currentMode: UpdaterServerMode = 'no-update';
  private requestSequence = 0;
  private readonly requestLog: UpdaterServerRequest[] = [];
  private port = 0;

  constructor(artifacts: UpdaterServerArtifacts) {
    this.artifacts = artifacts;
    this.metadata = prepareUpdaterMetadata(artifacts);
  }

  get mode(): UpdaterServerMode {
    return this.currentMode;
  }

  setMode(mode: UpdaterServerMode): void {
    this.currentMode = mode;
  }

  getPort(): number {
    if (!this.server || this.port === 0) throw new Error('Updater server is not listening');
    return this.port;
  }

  getRequests(): UpdaterServerRequest[] {
    return this.requestLog.map(request => ({ ...request }));
  }

  async start(requestedPort = 0): Promise<number> {
    if (this.server) throw new Error('Updater server is already listening');
    this.server = createServer((request, response) => this.handleRequest(request, response));
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error('Updater server was not created'));
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      await this.stop();
      throw new Error('Updater server did not bind to IPv4 loopback');
    }
    this.port = address.port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }

  private record(
    request: IncomingMessage,
    method: 'GET' | 'HEAD' | 'OTHER',
    resource: string,
    status: number,
    queryPresent: boolean,
  ): void {
    this.requestLog.push({
      sequence: ++this.requestSequence,
      mode: this.currentMode,
      method,
      resource,
      status,
      queryPresent,
      rangeRequested: typeof request.headers.range === 'string',
      authorizationPresent: request.headers.authorization !== undefined,
      cookiePresent: request.headers.cookie !== undefined,
      loopback: isLoopback(request.socket.remoteAddress),
    });
  }

  private reject(
    request: IncomingMessage,
    response: ServerResponse,
    method: 'GET' | 'HEAD',
    resource: string,
    status: number,
    queryPresent: boolean,
  ): void {
    this.record(request, method, resource, status, queryPresent);
    response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end();
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') {
      this.record(request, 'OTHER', 'invalid', 405, (request.url ?? '').includes('?'));
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const rawTarget = request.url ?? '';
    const queryPresent = rawTarget.includes('?');
    const rawPath = rawTarget.split('?', 1)[0] ?? '';
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      this.reject(request, response, method, 'invalid', 400, queryPresent);
      return;
    }
    const resource = decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath;
    const expectedHost = `127.0.0.1:${this.port}`;
    if (!isLoopback(request.socket.remoteAddress)
      || request.headers.host !== expectedHost
      || request.headers.authorization !== undefined
      || request.headers.cookie !== undefined
      || queryPresent
      || !resource
      || resource.includes('/')
      || resource.includes('\\')
      || resource.includes('..')) {
      this.reject(request, response, method, 'non-allowlisted', 403, queryPresent);
      return;
    }

    if (resource === 'latest.yml') {
      const body = this.currentMode === 'no-update'
        ? this.metadata.oldText
        : this.currentMode === 'invalid-metadata'
          ? this.metadata.invalid
          : this.currentMode === 'bad-checksum'
            ? this.metadata.badChecksumText
            : this.metadata.positiveText;
      this.record(request, method, resource, 200, queryPresent);
      sendText(response, method, 200, body);
      return;
    }

    const fileByName = new Map([
      [path.basename(this.artifacts.oldSetupPath), this.artifacts.oldSetupPath],
      [path.basename(this.artifacts.oldBlockmapPath), this.artifacts.oldBlockmapPath],
      [path.basename(this.artifacts.newSetupPath), this.artifacts.newSetupPath],
      [path.basename(this.artifacts.newBlockmapPath), this.artifacts.newBlockmapPath],
    ]);
    const filepath = fileByName.get(resource);
    if (!filepath) {
      this.reject(request, response, method, 'non-allowlisted', 404, queryPresent);
      return;
    }

    const size = statSync(filepath).size;
    let range: { start: number; end: number } | null;
    try {
      range = parseSingleRange(typeof request.headers.range === 'string' ? request.headers.range : undefined, size);
    } catch {
      this.reject(request, response, method, resource, 416, queryPresent);
      return;
    }
    const status = range ? 206 : 200;
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    this.record(request, method, resource, status, queryPresent);
    response.writeHead(status, headers);
    if (method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filepath, { start, end }).pipe(response);
  }
}
