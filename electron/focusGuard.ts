const { execFile } = require('child_process');
const path = require('path');
const { logger } = require('./logger');

import type { ActiveAppInfo } from '../src/types/index';

const POWERSHELL_TIMEOUT_MS = 3000;

function asText(value: unknown, maxLength = 240): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function basenameOnly(value: string): string {
    return path.basename(value.replace(/\//g, path.sep)).slice(0, 160);
}

function runPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 },
            (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (stderr && stderr.trim()) {
                    logger.warn('[focusGuard] PowerShell stderr:', stderr.trim());
                }
                resolve(stdout.trim());
            },
        );
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
[uint32]$pid = 0
[MindDiaryForegroundWindow]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
if ($pid -eq 0) { 'null'; exit 0 }
$proc = Get-Process -Id $pid -ErrorAction Stop
$exePath = $null
$description = $null
try {
  $exePath = $proc.MainModule.FileName
  $description = $proc.MainModule.FileVersionInfo.FileDescription
} catch {}
$processName = if ($proc.ProcessName.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { $proc.ProcessName } else { "$($proc.ProcessName).exe" }
$executable = if ($exePath) { [System.IO.Path]::GetFileName($exePath) } else { $processName }
[pscustomobject]@{
  name = if ($description) { $description } else { $proc.ProcessName }
  processName = $processName
  executable = $executable
  title = $proc.MainWindowTitle
  platform = 'win32'
} | ConvertTo-Json -Compress
`;

    const output = await runPowerShell(script);
    if (!output || output === 'null') return null;

    const parsed = JSON.parse(output) as Record<string, unknown>;
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

async function getActiveAppInfo(): Promise<ActiveAppInfo | null> {
    try {
        if (process.platform !== 'win32') return null;
        return await getWindowsActiveAppInfo();
    } catch (error) {
        logger.warn('[focusGuard] Failed to detect active app:', error instanceof Error ? error.message : String(error));
        return null;
    }
}

module.exports = { getActiveAppInfo };
