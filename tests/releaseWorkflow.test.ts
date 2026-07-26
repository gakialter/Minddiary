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

describe('release workflow Windows signing policy', () => {
  const workflow = readRepoFile('.github/workflows/release.yml')
  const ciWorkflow = readRepoFile('.github/workflows/ci.yml')
  const releaseNotes = readRepoFile('RELEASE_NOTES.md')
  const packageJson = JSON.parse(readRepoFile('package.json')) as { version: string }
  const packageLock = JSON.parse(readRepoFile('package-lock.json')) as {
    version: string
    packages: Record<string, { version?: string }>
  }

  it('locks every current release version surface to v1.17.0', () => {
    expect(packageJson.version).toBe('1.17.0')
    expect(packageLock.version).toBe('1.17.0')
    expect(packageLock.packages['']?.version).toBe('1.17.0')
    expect(releaseNotes.split(/\r?\n/, 1)[0]).toBe('# MindDiary v1.17.0')
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
    expect(releaseNotes).toContain('Windows 自动更新的完整下载、安装、重启端到端链路尚未完成最终验收')
    expect(releaseNotes).toContain('PR #144（Windows NSIS updater E2E）不包含在 v1.17.0')
    expect(releaseNotes).toContain('建议从 GitHub Release 手动下载安装包')
    expect(releaseNotes).toContain('未进行 Apple notarization')
    expect(releaseNotes).toContain('本版本不支持 Intel macOS')
    expect(releaseNotes).not.toContain('v1.17.0 已发布')
    expect(releaseNotes).not.toContain('自动更新已完全可靠')
    expect(releaseNotes).not.toContain('Windows 已签名')
    expect(releaseNotes).not.toContain('macOS 已 notarize')
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
    expect(releaseNotes).toContain('## Windows 安装包说明')
    expect(releaseNotes).toContain('未配置签名凭据时，workflow 会明确生成 unsigned Windows assets')
    expect(releaseNotes).toContain('Unknown Publisher')
    expect(releaseNotes).toContain('Windows SmartScreen')
    expect(releaseNotes).toContain('代码签名不等于已经建立 SmartScreen reputation')
  })

  it('keeps published release notes free of release-prep-only state', () => {
    expect(releaseNotes).toContain('Tag-triggered Release workflow 生成 ARM64 DMG、ZIP 和 update metadata')
    expect(releaseNotes).toContain('使用 ad-hoc signing，不是 Developer ID 签名，也未进行 Apple notarization')
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
