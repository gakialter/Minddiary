$ErrorActionPreference = 'Stop'

function Write-JsonResult {
    param($Result)
    $Result | ConvertTo-Json -Compress
}

$result = [ordered]@{
    processName = $null
    executablePath = $null
    executablePathError = $null
    windowTitle = $null
    pid = $null
    error = $null
}

try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MindDiaryActiveWindowDiagnostics {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

    $hwnd = [MindDiaryActiveWindowDiagnostics]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
        $result.error = 'GetForegroundWindow returned 0'
        Write-JsonResult $result
        exit 0
    }

    [uint32]$foregroundProcessId = 0
    [MindDiaryActiveWindowDiagnostics]::GetWindowThreadProcessId($hwnd, [ref]$foregroundProcessId) | Out-Null
    if ($foregroundProcessId -eq 0) {
        $result.error = 'GetWindowThreadProcessId returned PID 0'
        Write-JsonResult $result
        exit 0
    }

    $result.pid = $foregroundProcessId
    $proc = Get-Process -Id $foregroundProcessId -ErrorAction Stop
    $result.processName = if ($proc.ProcessName.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
        $proc.ProcessName
    } else {
        "$($proc.ProcessName).exe"
    }
    $result.windowTitle = $proc.MainWindowTitle

    try {
        $result.executablePath = $proc.MainModule.FileName
    } catch {
        $result.executablePathError = $_.Exception.Message
    }

    Write-JsonResult $result
} catch {
    $result.error = $_.Exception.Message
    Write-JsonResult $result
    exit 0
}
