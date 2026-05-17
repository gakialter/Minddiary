import { execFile } from 'child_process';
const path = require('path');

import type { ActiveAppInfo } from '../src/types/index';
import type { ExecFileException } from 'child_process';

const POWERSHELL_TIMEOUT_MS = 3000;
const POWERSHELL_EXECUTABLE = 'powershell.exe';
const POWERSHELL_ARGS_PREFIX = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

interface PowerShellRunResult {
    stdout: string;
    stderr: string;
    code: string | number | null;
    signal: NodeJS.Signals | null;
    started: boolean;
    pid?: number;
    timedOut: boolean;
    errorMessage?: string;
}

function asText(value: unknown, maxLength = 240): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function basenameOnly(value: string): string {
    return path.basename(value.replace(/\//g, path.sep)).slice(0, 160);
}

function getPowerShellErrorDetails(error: Error | null): Pick<PowerShellRunResult, 'code' | 'signal' | 'timedOut' | 'errorMessage'> {
    if (!error) {
        return { code: 0, signal: null, timedOut: false };
    }
    const execError = error as ExecFileException & { killed?: boolean };
    return {
        code: execError.code ?? null,
        signal: execError.signal ?? null,
        timedOut: Boolean(execError.killed) || /timed out/i.test(execError.message),
        errorMessage: execError.message,
    };
}

function runPowerShell(script: string): Promise<PowerShellRunResult> {
    const args = [...POWERSHELL_ARGS_PREFIX, script];

    return new Promise((resolve) => {
        let started = false;
        let pid: number | undefined;
        const child = execFile(
            POWERSHELL_EXECUTABLE,
            args,
            { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 },
            (error: Error | null, stdout: string, stderr: string) => {
                const errorDetails = getPowerShellErrorDetails(error);
                const result: PowerShellRunResult = {
                    stdout,
                    stderr,
                    started,
                    ...(pid ? { pid } : {}),
                    ...errorDetails,
                };
                resolve(result);
            },
        );

        child.once('spawn', () => {
            started = true;
            pid = child.pid;
        });
    });
}

async function getWindowsActiveAppInfo(): Promise<ActiveAppInfo | null> {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MindDiaryForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [MindDiaryForegroundWindow]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { 'null'; exit 0 }
[uint32]$foregroundProcessId = 0
[MindDiaryForegroundWindow]::GetWindowThreadProcessId($hwnd, [ref]$foregroundProcessId) | Out-Null
if ($foregroundProcessId -eq 0) { 'null'; exit 0 }
$proc = Get-Process -Id $foregroundProcessId -ErrorAction Stop
$exePath = $null
$description = $null
$executablePathError = $null
try {
  $exePath = $proc.MainModule.FileName
  $description = $proc.MainModule.FileVersionInfo.FileDescription
} catch {
  $executablePathError = $_.Exception.Message
}
$processName = if ($proc.ProcessName.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { $proc.ProcessName } else { "$($proc.ProcessName).exe" }
$executable = if ($exePath) { [System.IO.Path]::GetFileName($exePath) } else { $processName }
[pscustomobject]@{
  name = if ($description) { $description } else { $proc.ProcessName }
  processName = $processName
  executable = $executable
  title = $proc.MainWindowTitle
  pid = $foregroundProcessId
  platform = 'win32'
} | ConvertTo-Json -Compress
`;

    const run = await runPowerShell(script);
    if (run.errorMessage) {
        const message = run.timedOut
            ? 'PowerShell active-app detection timed out'
            : 'PowerShell active-app detection failed';
        const error = new Error(message);
        (error as Error & { details?: PowerShellRunResult }).details = run;
        throw error;
    }

    const output = run.stdout.trim();
    if (!output) {
        if (run.stderr.trim()) {
            throw new Error('PowerShell active-app detection returned no output');
        }
        return null;
    }
    if (output === 'null') return null;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(output) as Record<string, unknown>;
    } catch (error) {
        throw new Error('PowerShell active-app detection returned invalid JSON');
    }

    const name = asText(parsed.name) || asText(parsed.processName) || asText(parsed.executable);
    if (!name) return null;
    const processName = asText(parsed.processName, 160);
    const executable = asText(parsed.executable, 260);

    return {
        name: name.slice(0, 160),
        ...(processName ? { processName } : {}),
        ...(executable ? { executable: basenameOnly(executable) } : {}),
        ...(asText(parsed.title) ? { title: asText(parsed.title) } : {}),
        platform: 'win32',
    };
}

let pendingActiveAppInfoPromise: Promise<ActiveAppInfo | null> | null = null;
let cachedActiveAppInfo: ActiveAppInfo | null = null;
let cachedActiveAppInfoAt: number = 0;
const CACHE_TTL_MS = 750;

async function getActiveAppInfo(): Promise<ActiveAppInfo | null> {
    if (process.platform !== 'win32') return null;

    const now = Date.now();
    if (cachedActiveAppInfo && now - cachedActiveAppInfoAt < CACHE_TTL_MS) {
        return cachedActiveAppInfo;
    }

    if (pendingActiveAppInfoPromise) {
        return pendingActiveAppInfoPromise;
    }

    pendingActiveAppInfoPromise = (async () => {
        try {
            const result = await getWindowsActiveAppInfo();
            if (result) {
                cachedActiveAppInfo = result;
                cachedActiveAppInfoAt = Date.now();
            }
            return result;
        } finally {
            pendingActiveAppInfoPromise = null;
        }
    })();

    return pendingActiveAppInfoPromise;
}

module.exports = { getActiveAppInfo };
