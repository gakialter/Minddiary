// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  canQuitAndInstall,
  classifyUpdaterError,
  transitionUpdaterStatus,
  type UpdaterStatus,
} from '../electron/updaterState';

describe('updater state machine', () => {
  it('accepts the real check, download, and install-ready sequence', () => {
    let state: UpdaterStatus = { status: 'idle' };
    state = transitionUpdaterStatus(state, { type: 'checking' });
    state = transitionUpdaterStatus(state, {
      type: 'available',
      version: '1.16.1',
      releaseNotes: 'Updater E2E fixture',
      releaseDate: '2026-07-16T00:00:00.000Z',
    });
    state = transitionUpdaterStatus(state, {
      type: 'download-progress',
      percent: 37.6,
      bytesPerSecond: 2048,
      transferred: 38,
      total: 100,
    });
    state = transitionUpdaterStatus(state, { type: 'downloaded', version: '1.16.1' });

    expect(state).toMatchObject({
      status: 'downloaded',
      version: '1.16.1',
      releaseNotes: 'Updater E2E fixture',
      releaseDate: '2026-07-16T00:00:00.000Z',
    });
    expect(canQuitAndInstall(state)).toBe(true);
  });

  it.each<UpdaterStatus>([
    { status: 'idle' },
    { status: 'checking' },
    { status: 'available', version: '1.16.1' },
    { status: 'downloading', version: '1.16.1' },
    { status: 'not-available' },
    { status: 'error', message: 'safe' },
  ])('rejects quitAndInstall before a download is complete: $status', state => {
    expect(canQuitAndInstall(state)).toBe(false);
  });

  it('rejects impossible event ordering', () => {
    expect(() => transitionUpdaterStatus(
      { status: 'checking' },
      { type: 'downloaded', version: '1.16.1' },
    )).toThrow(/Invalid updater transition/);
  });

  it('bounds progress values and preserves release details', () => {
    const state = transitionUpdaterStatus(
      { status: 'available', version: '1.16.1', releaseNotes: 'notes' },
      {
        type: 'download-progress',
        percent: 140,
        bytesPerSecond: -1,
        transferred: 200,
        total: 100,
      },
    );
    expect(state).toEqual({
      status: 'downloading',
      version: '1.16.1',
      releaseNotes: 'notes',
      percent: 100,
      bytesPerSecond: 0,
      transferred: 100,
      total: 100,
    });
  });

  it('maps metadata and checksum failures to fixed non-sensitive messages', () => {
    expect(classifyUpdaterError(Object.assign(new Error('raw metadata and path'), {
      code: 'ERR_UPDATER_INVALID_UPDATE_INFO',
    }))).toEqual({ message: '更新元数据无效', errorCode: 'invalid-metadata' });
    expect(classifyUpdaterError(new Error('sha512 checksum mismatch at C:\\private\\file.exe')))
      .toEqual({ message: '更新文件校验失败', errorCode: 'checksum-mismatch' });
  });
});
