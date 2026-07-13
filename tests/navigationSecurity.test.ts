import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  classifyNavigation,
  describeUrlForLog,
  getExternalUrl,
} from '../electron/navigationSecurity'

const rejectedProtocols = [
  'file:///C:/Windows/System32/calc.exe',
  'local://attachments/image.png',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'blob:https://example.com/id',
  'mailto:test@example.com',
  'tel:+123456789',
  'ftp://example.com/file',
  'about:blank',
  'chrome://settings',
  'chrome-extension://extension-id/page.html',
  'devtools://devtools/bundled/inspector.html',
  'view-source:https://example.com',
  'ws://example.com/socket',
  'wss://example.com/socket',
  'custom://example.com/path',
] as const

describe('external URL policy', () => {
  it.each([
    ['https://example.com/path?query=value#fragment', 'https://example.com/path?query=value#fragment'],
    ['http://localhost:8080/path', 'http://localhost:8080/path'],
    ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
  ])('accepts an absolute HTTP(S) URL: %s', (input, expected) => {
    expect(getExternalUrl(input)).toBe(expected)
  })

  it.each(rejectedProtocols)('rejects unsupported protocol input: %s', (input) => {
    expect(getExternalUrl(input)).toBeNull()
  })

  it.each([
    '',
    '   ',
    ' https://example.com',
    'https://example.com ',
    'https://user@example.com',
    'https://user:password@example.com',
    '/relative/path',
    '//example.com/path',
    'http://[::1',
    'javascript:https://example.com',
    'not-https://example.com',
  ])('rejects unsafe or malformed input: %s', (input) => {
    expect(getExternalUrl(input)).toBeNull()
  })

  it('describes a URL without leaking credentials, path, query, or fragment', () => {
    const description = describeUrlForLog('https://user:secret@example.com/private?token=secret#fragment')

    expect(description).toEqual({ protocol: 'https:', origin: 'https://example.com' })
    expect(JSON.stringify(description)).not.toContain('user')
    expect(JSON.stringify(description)).not.toContain('secret')
    expect(JSON.stringify(description)).not.toContain('token')
    expect(JSON.stringify(description)).not.toContain('private')
  })
})

describe('top-level navigation policy', () => {
  const productionDocumentUrl = pathToFileURL('C:\\MindDiary\\dist\\index.html').href

  it.each([
    'http://localhost:5173/',
    'http://localhost:5173/settings?tab=general#section',
  ])('allows the exact Vite development origin: %s', (target) => {
    expect(classifyNavigation(target, { kind: 'development' })).toEqual({ kind: 'allow' })
  })

  it.each([
    'http://localhost:5174/',
    'http://127.0.0.1:5173/',
    'https://localhost:5173/',
    'http://localhost.example.com:5173/',
  ])('treats development-origin spoofing as external HTTP(S): %s', (target) => {
    expect(classifyNavigation(target, { kind: 'development' })).toEqual({
      kind: 'external',
      url: target,
    })
  })

  it.each([
    'http://localhost:5173.evil.example/',
    'http://localhost:5173@evil.example/',
  ])('blocks malformed or credential-based development-origin spoofing: %s', (target) => {
    expect(classifyNavigation(target, { kind: 'development' })).toEqual({ kind: 'block' })
  })

  it('allows only the canonical production document and its hash navigation', () => {
    const policy = { kind: 'production', appDocumentUrl: productionDocumentUrl } as const

    expect(classifyNavigation(productionDocumentUrl, policy)).toEqual({ kind: 'allow' })
    expect(classifyNavigation(`${productionDocumentUrl}#settings`, policy)).toEqual({ kind: 'allow' })
    expect(classifyNavigation(`${productionDocumentUrl}?redirect=https://example.com`, policy)).toEqual({ kind: 'block' })
    expect(classifyNavigation(pathToFileURL('C:\\MindDiary\\dist\\other.html').href, policy)).toEqual({ kind: 'block' })
  })

  it('routes only valid external HTTP(S) navigation to the system browser', () => {
    expect(classifyNavigation('https://example.com/path', { kind: 'development' })).toEqual({
      kind: 'external',
      url: 'https://example.com/path',
    })
    expect(classifyNavigation('local://attachments/image.png', { kind: 'development' })).toEqual({ kind: 'block' })
    expect(classifyNavigation('javascript:alert(1)', { kind: 'development' })).toEqual({ kind: 'block' })
  })
})

describe('Content Security Policy', () => {
  it('keeps the production policy strict', () => {
    const csp = buildContentSecurityPolicy(false)

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).not.toContain('https://*')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain("script-src 'self' 'unsafe-eval'")
  })

  it('limits development connections to the exact Vite origin and HMR socket', () => {
    const csp = buildContentSecurityPolicy(true)
    const connectDirective = csp.split('; ').find(directive => directive.startsWith('connect-src'))

    expect(connectDirective).toBe("connect-src 'self' ws://localhost:5173")
  })
})
