export type UpdaterCleanupTask = {
  label: string;
  run: () => void | Promise<void>;
};

export type TransientRetryOptions = {
  attempts: number;
  delayMs: number;
  platform?: NodeJS.Platform;
  wait?: (delayMs: number) => Promise<void>;
};

const TRANSIENT_WINDOWS_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

function isTransientWindowsError(error: unknown, platform: NodeJS.Platform): boolean {
  return platform === 'win32'
    && typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && TRANSIENT_WINDOWS_CODES.has(error.code);
}

export async function retryTransientWindowsOperation(
  label: string,
  operation: () => void | Promise<void>,
  options: TransientRetryOptions,
): Promise<void> {
  if (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 10) {
    throw new Error('Updater cleanup retry attempts are invalid');
  }
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < 0 || options.delayMs > 5_000) {
    throw new Error('Updater cleanup retry delay is invalid');
  }
  const platform = options.platform ?? process.platform;
  const wait = options.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt === options.attempts || !isTransientWindowsError(error, platform)) break;
      await wait(options.delayMs);
    }
  }
  throw new Error(`${label} failed after bounded cleanup retry`);
}

export async function runBestEffortCleanup(tasks: readonly UpdaterCleanupTask[]): Promise<string[]> {
  const failures: string[] = [];
  for (const task of tasks) {
    if (!/^[a-z-]{2,32}$/.test(task.label)) throw new Error('Updater cleanup label is invalid');
    try {
      await task.run();
    } catch {
      failures.push(task.label);
    }
  }
  return failures;
}

export function createUpdaterFailure(
  primaryFailure: string,
  primaryStep: string,
  cleanupFailures: readonly string[],
): Error {
  const cleanup = cleanupFailures.length === 0 ? 'none' : cleanupFailures.join(',');
  return new Error(
    `Updater E2E primary failure=${primaryFailure}; primary step=${primaryStep}; cleanup failures=${cleanup}`,
  );
}
