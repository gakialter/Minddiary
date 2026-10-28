// @vitest-environment node

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { parseSimpleYaml } from '../scripts/verify-release-metadata'

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`)
  }
  return value as Record<string, unknown>
}

function expectInstallationSafetyNotes(notes: string): void {
  const installation = notes.split(/^## 安装说明\r?\n/m)[1]?.split(/^## /m)[0] ?? ''
  expect(installation).toMatch(/未配置签名凭据时[^。\n]*未签名[^。\n]*Unknown Publisher[^。\n]*SmartScreen/)
  expect(installation).toMatch(/Windows 安装版[^。\n]*(?:updater|自动更新)/)
  // Either describe the bounded CI coverage, or explicitly withhold published-channel verification.
  // Keep the disclaimer and its subject together; scattered keywords do not establish a limitation.
  expect(installation).toMatch(
    /(?:CI[^。\n]*但不等于[^。\n]*生产签名[^。\n]*SmartScreen reputation[^。\n]*真实用户环境|(?:本地构建|候选构建|CI)[^。\n]*不等于[^。\n]*正式发布通道[^。\n]*端到端更新验证)/,
  )
  if (/Windows 安装版[^。\n]*支持自动更新/.test(installation)) {
    expect(installation).toMatch(/Windows 安装版[^。\n]*Portable 不作为自动更新目标/)
  }
  expect(installation).toMatch(/macOS[^。\n]*Apple silicon[^。\n]*不支持 Intel macOS/)
  expect(installation).toMatch(/ad-hoc 签名[^。\n]*未进行 Apple notarization[^。\n]*Gatekeeper/)
  expect(notes).not.toMatch(/自动更新已完全可靠|Windows 已签名|macOS 已 notarize/)
}

// Installation section from 034ceeb7386881aee398c1f2175c67efc5b0d7cc (v1.22 candidate).
// Its revised updater wording caused the historical CI failure despite preserving the boundary.
const candidateInstallationNotes = `## 安装说明

- Windows 提供 Setup 和 Portable。未配置签名凭据时安装包未签名，可能出现 Unknown Publisher 或 SmartScreen 提示。
- Windows 安装版支持自动更新，Portable 不作为自动更新目标。本地构建和元数据检查不等于正式发布通道的端到端更新验证。
- macOS 安装包面向 Apple silicon，最低 macOS 12.0，不支持 Intel macOS；采用 ad-hoc 签名，未进行 Apple notarization，可能受到 Gatekeeper 限制。
`

describe('release workflow Windows signing policy', () => {
  const workflow = readRepoFile('.github/workflows/release.yml')
  const ciWorkflow = readRepoFile('.github/workflows/ci.yml')
  const releaseNotes = readRepoFile('RELEASE_NOTES.md')
  const packageJson = JSON.parse(readRepoFile('package.json')) as { version: string }
  const packageLock = JSON.parse(readRepoFile('package-lock.json')) as {
    version: string
    packages: Record<string, { version?: string }>
  }

  it('aligns every current release version surface with the package version', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(packageLock.version).toBe(packageJson.version)
    expect(packageLock.packages['']?.version).toBe(packageJson.version)
    expect(releaseNotes.split(/\r?\n/, 1)[0]).toBe(`# MindDiary v${packageJson.version}`)
  })

  it('keeps the tag, package version, notes title, and publish contract aligned', () => {
    const parsedWorkflow = parseSimpleYaml(workflow)
    const triggers = expectRecord(parsedWorkflow.on, 'release workflow on')
    expect(Object.keys(triggers)).toEqual(['push'])
    expect(expectRecord(triggers.push, 'release workflow on.push')).toEqual({
      tags: ['v*'],
    })

    const jobs = expectRecord(parsedWorkflow.jobs, 'release workflow jobs')
    const publishJob = expectRecord(jobs.publish, 'release workflow publish job')
    expect(publishJob.needs).toEqual(['build-windows', 'build-mac'])
    if (!Array.isArray(publishJob.steps)) {
      throw new Error('release workflow publish steps must be an array')
    }
    const releaseStep = publishJob.steps
      .map((step, index) => expectRecord(step, `release workflow publish step ${index}`))
      .find(step => step.uses === 'softprops/action-gh-release@v3')
    if (!releaseStep) {
      throw new Error('release workflow must publish through softprops/action-gh-release@v3')
    }
    expect(expectRecord(releaseStep.with, 'release workflow release inputs')).toMatchObject({
      draft: false,
      prerelease: false,
      make_latest: true,
      fail_on_unmatched_files: true,
      body_path: 'RELEASE_NOTES.md',
      files: 'release-artifacts/*',
    })

    expect(workflow.match(/Release tag .* does not match package\.json version/g)).toHaveLength(3)
    expect(workflow.match(/does not match # MindDiary/g)).toHaveLength(3)
  })

  it('records updater, signing, notarization, and platform limitations without claiming completion', () => {
    expectInstallationSafetyNotes(releaseNotes)
    expect(releaseNotes).not.toContain('v1.19.1 已发布')
  })

  it('accepts the candidate wording that distinguishes local checks from published-channel validation', () => {
    expectInstallationSafetyNotes(candidateInstallationNotes)
  })

  it.each([
    ['missing updater disclaimer', /本地构建和元数据检查不等于正式发布通道的端到端更新验证。/, ''],
    ['reversed updater disclaimer', /不等于正式发布通道/, '等于正式发布通道'],
    ['claimed Windows signing', /安装包未签名/, '安装包已签名'],
    ['claimed notarization', /未进行 Apple notarization/, '已进行 Apple notarization'],
    ['claimed Intel support', /不支持 Intel macOS/, '支持 Intel macOS'],
    ['claimed Portable updater support', /Portable 不作为自动更新目标/, 'Portable 也作为自动更新目标'],
  ] as const)('rejects %s even when the remaining safety vocabulary is present', (_name, pattern, replacement) => {
    expect(() => expectInstallationSafetyNotes(candidateInstallationNotes.replace(pattern, replacement))).toThrow()
  })

  it('records the unchanged schema and JSON backup limitations', () => {
    expect(releaseNotes).toContain('CURRENT_SCHEMA_VERSION = 8')
    expect(releaseNotes).toContain('不新增数据库迁移')
    expect(releaseNotes).toContain('整次导入不支持自动回滚')
    expect(releaseNotes).toContain('再次导入会继续新增错题')
    expect(releaseNotes).toContain('不能替代完整 ZIP 备份')
    expect(releaseNotes).not.toContain('计划作为')
    expect(releaseNotes).not.toContain('release-prep')
    expect(releaseNotes).not.toContain('30192295231')
    expect(releaseNotes).not.toContain('0e3ae25501b74cdea3c242509017e269d3bcd440')
  })

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

  it('runs installed updater coverage only in CI and always preserves sanitized evidence', () => {
    expect(ciWorkflow).toContain('run: npm run test:e2e:updater')
    expect(ciWorkflow).toContain('if: always() && matrix.os == \'windows-latest\' && hashFiles(\'test-results/windows-updater-e2e-evidence/hashes.txt\') != \'\' && hashFiles(\'test-results/windows-updater-e2e-diagnostic/diagnostic.json\') == \'\'')
    expect(ciWorkflow).toContain('if: always() && matrix.os == \'windows-latest\' && hashFiles(\'test-results/windows-updater-e2e-diagnostic/hashes.txt\') != \'\'')
    expect(ciWorkflow).toContain(
      'name: windows-updater-e2e-diagnostic-${{ github.event.pull_request.head.sha || github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
    )
    expect(workflow).not.toContain('windows-updater-e2e')
    expect(workflow).not.toContain('test:e2e:updater')
  })

  it('runs and archives bounded Windows Portable smoke without publishing that evidence', () => {
    expect(workflow).toContain('run: npm run test:e2e:portable-smoke')
    expect(workflow).toContain('name: windows-portable-smoke-evidence')
    expect(workflow).toContain('path: test-results/windows-portable-smoke-evidence/*')
    expect(workflow).toContain("pattern: '*-release'")
  })

  it('runs and archives bounded Windows Setup smoke without publishing that evidence', () => {
    expect(workflow).toContain('run: npm run test:e2e:setup-smoke')
    expect(workflow).toContain('name: windows-setup-smoke-evidence')
    expect(workflow).toContain('path: test-results/windows-setup-smoke-evidence/*')
    expect(workflow).toContain("pattern: '*-release'")
  })

  it('archives bounded Windows date-rollover evidence without publishing it', () => {
    expect(workflow).toContain('name: windows-date-rollover-evidence')
    expect(workflow).toContain('path: test-results/date-rollover-evidence/*')
    expect(workflow).toContain("pattern: '*-release'")
    expect(workflow).not.toContain('name: windows-date-rollover-evidence-release')
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
    expect(releaseNotes).toContain('## 安装说明')
    expect(releaseNotes).toContain('未配置签名凭据时安装包未签名')
    expect(releaseNotes).toContain('Unknown Publisher')
    expect(releaseNotes).toContain('SmartScreen 提示')
    expect(releaseNotes).not.toContain('Windows 已签名')
  })

  it('keeps published release notes free of release-prep-only state', () => {
    expect(releaseNotes).toContain('macOS 安装包面向 Apple silicon')
    expect(releaseNotes).toContain('采用 ad-hoc 签名，未进行 Apple notarization')
    expect(releaseNotes).not.toContain('PR exact-head CI 门槛将在')
    expect(releaseNotes).not.toContain('release-prep exact-head CI 将在')
    expect(releaseNotes).not.toContain('本文件仅记录 release-prep 状态')
    expect(releaseNotes).not.toContain('后续获授权的 tag-triggered')
    expect(releaseNotes).not.toContain('本轮 Windows 开发机')
    expect(releaseNotes).not.toContain('CSC_LINK')
    expect(releaseNotes).not.toContain('CSC_KEY_PASSWORD')
    expect(releaseNotes).not.toMatch(/\b[0-9a-f]{40}\b/)
  })
})
