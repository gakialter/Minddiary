[CmdletBinding()]
param(
    [string]$ReleaseDir = "release",
    [object]$RequireSigned = $false
)

$ErrorActionPreference = "Stop"

function Convert-ToBooleanFlag {
    param(
        [object]$Value,
        [string]$Name
    )

    if ($Value -is [bool]) {
        return $Value
    }
    if ($Value -is [System.Management.Automation.SwitchParameter]) {
        return $Value.IsPresent
    }
    if ($null -eq $Value) {
        return $false
    }

    $text = [string]$Value
    if ($text -in @("true", "True", '$true', "1")) {
        return $true
    }
    if ($text -in @("false", "False", '$false', "0", "")) {
        return $false
    }

    throw "$Name must be true or false"
}

function Add-StepSummaryLine {
    param([string]$Line)

    if ($env:GITHUB_STEP_SUMMARY) {
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $Line
    }
}

function Write-VerificationWarning {
    param([string]$Message)

    Write-Warning $Message
    if ($env:GITHUB_ACTIONS -eq "true") {
        Write-Host "::warning::$Message"
    }
}

$requireSignedFlag = Convert-ToBooleanFlag -Value $RequireSigned -Name "RequireSigned"

$resolvedReleaseDir = Resolve-Path -LiteralPath $ReleaseDir -ErrorAction SilentlyContinue
if (-not $resolvedReleaseDir) {
    throw "Release directory not found: $ReleaseDir"
}

$releasePath = $resolvedReleaseDir.Path
$exeFiles = @(Get-ChildItem -LiteralPath $releasePath -Recurse -Filter "*.exe" -File)
if ($exeFiles.Count -eq 0) {
    throw "No Windows .exe artifacts found under $releasePath"
}

$setupInstallers = @($exeFiles | Where-Object {
    $_.DirectoryName -eq $releasePath -and $_.Name -match "Setup.*\.exe$"
})

if ($setupInstallers.Count -eq 0) {
    throw "No NSIS setup installer matching *Setup*.exe found at the release directory root"
}

Add-StepSummaryLine "### Windows signing verification"
Add-StepSummaryLine ""
Add-StepSummaryLine "| Artifact | Authenticode status | Subject |"
Add-StepSummaryLine "| --- | --- | --- |"

$invalidExeFiles = @()

foreach ($file in $exeFiles) {
    $signature = Get-AuthenticodeSignature -FilePath $file.FullName
    $subject = if ($signature.SignerCertificate) {
        $signature.SignerCertificate.Subject
    } else {
        "n/a"
    }

    Add-StepSummaryLine "| $($file.Name) | $($signature.Status) | $subject |"
    Write-Host "$($file.Name): Authenticode status $($signature.Status)"

    if ($signature.Status -ne "Valid") {
        $invalidExeFiles += $file.FullName
    }
}

if ($requireSignedFlag -and $invalidExeFiles.Count -gt 0) {
    $joined = $invalidExeFiles -join ", "
    throw "Windows signing is required, but one or more Windows EXE signatures are not valid: $joined"
}

if (-not $requireSignedFlag) {
    $message = "Windows signing was not required for this run. Unsigned installers can show Unknown Publisher and SmartScreen warnings."
    Write-VerificationWarning $message
    Add-StepSummaryLine ""
    Add-StepSummaryLine "> $message"
}

if ($requireSignedFlag) {
    Add-StepSummaryLine ""
    Add-StepSummaryLine "All Windows EXE signatures are valid."
}
