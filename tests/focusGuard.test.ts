import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as focusGuard from '../electron/focusGuard';
const { getActiveAppInfo } = focusGuard as any;

const { execFileFn } = vi.hoisted(() => ({
  execFileFn: vi.fn((...args: any[]) => (globalThis as any).currentExecFileMock(...args))
}));

(globalThis as any).currentExecFileMock = () => ({ once: vi.fn() });

vi.mock('child_process', () => {
  return {
    default: {
      execFile: execFileFn,
    },
    execFile: execFileFn,
  };
});

let globalTestTime = 1000000;

describe('focusGuard main process', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalTestTime += 100000;
    vi.setSystemTime(globalTestTime);
    vi.clearAllMocks();
    (globalThis as any).currentExecFileMock = () => ({ once: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockExecFileSuccess = (output: string) => {
    (globalThis as any).currentExecFileMock = (_cmd: any, _args: any, _options: any, callback: any) => {
      setTimeout(() => {
        if (typeof callback === 'function') {
          callback(null, output, '');
        }
      }, 50);
      return {
        once: vi.fn((event, cb) => {
          if (event === 'spawn') cb();
        }),
      };
    };
  };

  const mockExecFileTimeout = () => {
    (globalThis as any).currentExecFileMock = (_cmd: any, _args: any, _options: any, callback: any) => {
      setTimeout(() => {
        if (typeof callback === 'function') {
          const err = new Error('Command failed') as any;
          err.killed = true; // timeout typically sets killed = true in execFile
          callback(err, '', '');
        }
      }, 50);
      return {
        once: vi.fn((event, cb) => {
          if (event === 'spawn') cb();
        }),
      } as any;
    };
  };

  it('returns null on non-Windows platforms without calling execFile', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const result = await getActiveAppInfo();
    expect(result).toBeNull();
    expect(childProcess.execFile).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('on Windows', () => {
    let originalPlatform: NodeJS.Platform;

    beforeEach(() => {
      originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns ActiveAppInfo on success', async () => {
      const mockOutput = JSON.stringify({
        name: 'Test App',
        processName: 'test.exe',
        executable: 'test.exe',
        platform: 'win32'
      });
      mockExecFileSuccess(mockOutput);

      const promise = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(result).toMatchObject({
        name: 'Test App',
        processName: 'test.exe',
        executable: 'test.exe'
      });
      expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent calls (pending promise)', async () => {
      // Advance time so we start clean from cache

      
      mockExecFileSuccess(JSON.stringify({ name: 'App1' }));

      // Call it twice simultaneously
      const promise1 = getActiveAppInfo();
      const promise2 = getActiveAppInfo();

      vi.advanceTimersByTime(100);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1).toEqual(res2);
      expect(res1!.name).toBe('App1');
      // Only one execution should happen
      expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('uses cache if called within TTL', async () => {

      
      mockExecFileSuccess(JSON.stringify({ name: 'App1' }));

      const promise1 = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      await promise1;
      expect(childProcess.execFile).toHaveBeenCalledTimes(1);

      // Now call again within TTL (e.g. 200ms later)
      vi.advanceTimersByTime(200);
      mockExecFileSuccess(JSON.stringify({ name: 'App2' })); // Should not be called

      const promise2 = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      const res2 = await promise2;

      expect(res2!.name).toBe('App1');
      expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('refetches if called after cache TTL', async () => {

      
      mockExecFileSuccess(JSON.stringify({ name: 'App1' }));

      const promise1 = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      await promise1;
      expect(childProcess.execFile).toHaveBeenCalledTimes(1);

      // Advance time beyond TTL (750ms)
      vi.advanceTimersByTime(800);
      mockExecFileSuccess(JSON.stringify({ name: 'App2' }));

      const promise2 = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      const res2 = await promise2;

      expect(res2!.name).toBe('App2');
      expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    });

    it('clears pending promise even if execFile times out or fails', async () => {

      mockExecFileTimeout();

      const promise = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      
      await expect(promise).rejects.toThrow(/timed out/i);
      
      // After it rejects, the pending promise should be cleared.
      // So the next call should trigger a new execFile.
      mockExecFileSuccess(JSON.stringify({ name: 'App3' }));
      const promise2 = getActiveAppInfo();
      vi.advanceTimersByTime(100);
      const res2 = await promise2;

      expect(res2!.name).toBe('App3');
      expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    });
  });
});
