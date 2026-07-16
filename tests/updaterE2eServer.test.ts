// @vitest-environment node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dump } from 'js-yaml';
import {
  LoopbackUpdaterServer,
  prepareUpdaterMetadata,
  type UpdaterServerArtifacts,
} from './helpers/updaterE2eServer';

const temporaryDirectories: string[] = [];

function sha512(value: Buffer): string {
  return createHash('sha512').update(value).digest('base64');
}

function createArtifacts(): UpdaterServerArtifacts {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-updater-server-test-'));
  temporaryDirectories.push(root);
  const oldSetupPath = path.join(root, 'MindDiary-Setup-1.16.0.exe');
  const oldBlockmapPath = `${oldSetupPath}.blockmap`;
  const newSetupPath = path.join(root, 'MindDiary-Setup-1.16.1.exe');
  const newBlockmapPath = `${newSetupPath}.blockmap`;
  const oldBytes = Buffer.from('old-installer');
  const newBytes = Buffer.from('new-installer');
  fs.writeFileSync(oldSetupPath, oldBytes);
  fs.writeFileSync(oldBlockmapPath, 'old-blockmap');
  fs.writeFileSync(newSetupPath, newBytes);
  fs.writeFileSync(newBlockmapPath, 'new-blockmap');
  const writeLatest = (version: string, setupPath: string, bytes: Buffer) => {
    const name = path.basename(setupPath);
    const body = dump({
      version,
      files: [{ url: name, sha512: sha512(bytes), size: bytes.length }],
      path: name,
      sha512: sha512(bytes),
      releaseDate: '2026-07-16T00:00:00.000Z',
    });
    const latestPath = path.join(root, `latest-${version}.yml`);
    fs.writeFileSync(latestPath, body);
    return latestPath;
  };
  return {
    oldSetupPath,
    oldBlockmapPath,
    newSetupPath,
    newBlockmapPath,
    oldLatestPath: writeLatest('1.16.0', oldSetupPath, oldBytes),
    newLatestPath: writeLatest('1.16.1', newSetupPath, newBytes),
    releaseNotes: 'MindDiary updater E2E fixture',
  };
}

function requestStatus(port: number, method: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: '/latest.yml', method, headers }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('loopback updater server', () => {
  it('serves only allowlisted metadata and files over IPv4 loopback', async () => {
    const artifacts = createArtifacts();
    const server = new LoopbackUpdaterServer(artifacts);
    const port = await server.start();
    try {
      const latest = await fetch(`http://127.0.0.1:${port}/latest.yml`);
      expect(latest.status).toBe(200);
      expect(await latest.text()).toContain('version: 1.16.0');

      server.setMode('positive');
      const range = await fetch(`http://127.0.0.1:${port}/${path.basename(artifacts.newSetupPath)}`, {
        headers: { Range: 'bytes=0-2' },
      });
      expect(range.status).toBe(206);
      expect(await range.text()).toBe('new');

      const traversal = await fetch(`http://127.0.0.1:${port}/%2e%2e/secret`);
      expect([403, 404]).toContain(traversal.status);
      const missing = await fetch(`http://127.0.0.1:${port}/directory`);
      expect(missing.status).toBe(404);

      expect(await requestStatus(port, 'POST')).toBe(405);
      expect(await requestStatus(port, 'GET', { Host: `localhost:${port}` })).toBe(403);
      expect(await requestStatus(port, 'GET', { Authorization: 'Bearer test-only-value' })).toBe(403);

      expect(server.getRequests().every(request => request.loopback)).toBe(true);
      expect(server.getRequests().some(request => request.method === 'OTHER' && request.status === 405)).toBe(true);
      expect(server.getRequests().some(request => request.authorizationPresent && request.status === 403)).toBe(true);
      expect(server.getRequests().filter(request => request.status === 403 || request.status === 404)
        .every(request => request.resource === 'non-allowlisted')).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('produces an independently invalid checksum metadata case', () => {
    const metadata = prepareUpdaterMetadata(createArtifacts());
    expect(metadata.badChecksum.version).toBe('1.16.1');
    expect(metadata.badChecksum.sha512).not.toBe(metadata.positive.sha512);
    expect(metadata.badChecksum.files[0]?.sha512).toBe(metadata.badChecksum.sha512);
    expect(metadata.invalid).toMatch(/unterminated/);
  });
});
