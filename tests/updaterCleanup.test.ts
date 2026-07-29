import { describe, expect, it, vi } from 'vitest';
import {
  createUpdaterFailure,
  retryTransientWindowsOperation,
  runBestEffortCleanup,
} from './helpers/updaterCleanup';

describe('updater cleanup', () => {
  it('runs every cleanup task and retains all safe failure labels', async () => {
    const calls: string[] = [];
    const failures = await runBestEffortCleanup([
      { label: 'app-process', run: () => { calls.push('app'); throw new Error('app failed'); } },
      { label: 'server-process', run: () => { calls.push('server'); } },
      { label: 'runtime-root', run: () => { calls.push('runtime'); throw new Error('runtime failed'); } },
    ]);
    expect(calls).toEqual(['app', 'server', 'runtime']);
    expect(failures).toEqual(['app-process', 'runtime-root']);
    expect(createUpdaterFailure('runtime-failed', 'installer-lifecycle', failures).message)
      .toBe(
        'Updater E2E primary failure=runtime-failed; '
        + 'primary step=installer-lifecycle; cleanup failures=app-process,runtime-root',
      );
  });

  it('retries only bounded, identified Windows filesystem errors', async () => {
    const wait = vi.fn(async () => undefined);
    const transient = Object.assign(new Error('locked'), { code: 'EBUSY' });
    let attempts = 0;
    await retryTransientWindowsOperation('runtime-root', () => {
      attempts += 1;
      if (attempts < 3) throw transient;
    }, { attempts: 3, delayMs: 5, platform: 'win32', wait });
    expect(attempts).toBe(3);
    expect(wait).toHaveBeenCalledTimes(2);

    const permanent = Object.assign(new Error('invalid'), { code: 'EINVAL' });
    attempts = 0;
    await expect(retryTransientWindowsOperation('runtime-root', () => {
      attempts += 1;
      throw permanent;
    }, { attempts: 3, delayMs: 5, platform: 'win32', wait }))
      .rejects.toThrow(/bounded cleanup retry/);
    expect(attempts).toBe(1);
  });
});
