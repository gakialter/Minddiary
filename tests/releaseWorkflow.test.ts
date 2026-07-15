// @vitest-environment node

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
}

describe('release workflow Windows signing policy', () => {
  const workflow = readRepoFile('.github/workflows/release.yml')
  const ciWorkflow = readRepoFile('.github/workflows/ci.yml')
  const releaseNotes = readRepoFile('RELEASE_NOTES.md')

  it('uses Node 24 action majors without changing the project Node version', () => {
    expect(workflow).toContain('actions/checkout@v5')
    expect(workflow).toContain('actions/setup-node@v5')
    expect(workflow).toContain('actions/upload-artifact@v6')
    expect(workflow).toContain('actions/download-artifact@v7')
    expect(workflow).toContain("pattern: '*-release'")
    expect(workflow).toContain('softprops/action-gh-release@v3')
    expect(ciWorkflow).toContain('actions/checkout@v5')
    expect(ciWorkflow).toContain('actions/setup-node@v5')
    expect(`${workflow}\n${ciWorkflow}`).not.toMatch(/@(v4|v2)\b/)
    expect(workflow).toContain('node-version: 22')
  })

  it('runs and archives bounded Windows Portable smoke without publishing that evidence', () => {
    expect(workflow).toContain('run: npm run test:e2e:portable-smoke')
    expect(workflow).toContain('name: windows-portable-smoke-evidence')
    expect(workflow).toContain('path: test-results/windows-portable-smoke-evidence/*')
    expect(workflow).toContain("pattern: '*-release'")
  })

  it('requires valid Windows signatures when both signing secrets are configured', () => {
    expect(workflow).toContain("HAS_CSC_LINK: ${{ secrets.CSC_LINK != '' }}")
    expect(workflow).toContain("HAS_CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD != '' }}")
    expect(workflow).toContain(
      "if ($env:HAS_CSC_LINK -eq 'true' -and $env:HAS_CSC_KEY_PASSWORD -eq 'true')",
    )
    expect(workflow).toContain('WINDOWS_REQUIRE_SIGNED=true')
  })

  it('allows unsigned Windows artifacts only when both signing secrets are absent', () => {
    expect(workflow).toContain(
      "elseif ($env:HAS_CSC_LINK -eq 'false' -and $env:HAS_CSC_KEY_PASSWORD -eq 'false')",
    )
    expect(workflow).toContain('WINDOWS_REQUIRE_SIGNED=false')
    expect(workflow).toContain('::warning::Windows signing secrets are not configured')
  })

  it('fails incomplete signing secret configuration before packaging', () => {
    expect(workflow).toContain('Signing secrets configured: partial')
    expect(workflow).toContain(
      'CSC_LINK and CSC_KEY_PASSWORD must be configured together, or both omitted for an unsigned Windows release.',
    )
  })

  it('passes the computed signing policy into the Authenticode verifier', () => {
    expect(workflow).toContain('$requireSigned = [System.Convert]::ToBoolean($env:WINDOWS_REQUIRE_SIGNED)')
    expect(workflow).toContain(
      './scripts/verify-windows-signing.ps1 -ReleaseDir release -RequireSigned:$requireSigned',
    )
  })

  it('keeps the unsigned Windows installer warning in release notes', () => {
    expect(releaseNotes).toContain('## Windows 安装包说明')
    expect(releaseNotes).toContain('Unknown Publisher')
    expect(releaseNotes).toContain('Windows SmartScreen')
  })
})
