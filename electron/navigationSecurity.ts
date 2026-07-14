const DEVELOPMENT_ORIGIN = 'http://localhost:5173'

export type RendererRuntimeMode = 'development' | 'production'

export type NavigationPolicy =
  | { readonly kind: 'development' }
  | { readonly kind: 'production'; readonly appDocumentUrl: string }

export type NavigationDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'block' }

export type UrlLogDescription = {
  readonly protocol: string
  readonly origin: string | null
}

function parseAbsoluteUrl(value: string): URL | null {
  if (value.length === 0 || value.trim() !== value) return null

  try {
    return new URL(value)
  } catch {
    return null
  }
}

function hasCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0
}

function getExternalUrlFromParsed(url: URL): string | null {
  if (hasCredentials(url)) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

function isTrustedProductionDocument(url: URL, appDocumentUrl: string): boolean {
  const trustedDocument = parseAbsoluteUrl(appDocumentUrl)
  if (!trustedDocument || trustedDocument.protocol !== 'file:') return false

  const candidateWithoutHash = new URL(url.href)
  const trustedWithoutHash = new URL(trustedDocument.href)
  candidateWithoutHash.hash = ''
  trustedWithoutHash.hash = ''
  return candidateWithoutHash.href === trustedWithoutHash.href
}

export function getExternalUrl(value: string): string | null {
  const url = parseAbsoluteUrl(value)
  return url ? getExternalUrlFromParsed(url) : null
}

export function classifyNavigation(value: string, policy: NavigationPolicy): NavigationDecision {
  const url = parseAbsoluteUrl(value)
  if (!url || hasCredentials(url)) return { kind: 'block' }

  switch (policy.kind) {
    case 'development':
      if (url.origin === DEVELOPMENT_ORIGIN) return { kind: 'allow' }
      break
    case 'production':
      if (isTrustedProductionDocument(url, policy.appDocumentUrl)) return { kind: 'allow' }
      break
  }

  const externalUrl = getExternalUrlFromParsed(url)
  return externalUrl ? { kind: 'external', url: externalUrl } : { kind: 'block' }
}

export function describeUrlForLog(value: string): UrlLogDescription {
  const url = parseAbsoluteUrl(value)
  if (!url) return { protocol: 'unknown', origin: null }
  return {
    protocol: url.protocol,
    origin: url.origin === 'null' ? null : url.origin,
  }
}

export function resolveRendererRuntimeMode(
  isPackaged: boolean,
  nodeEnv: string | undefined,
): RendererRuntimeMode {
  return !isPackaged && nodeEnv !== 'production'
    ? 'development'
    : 'production'
}

export function buildContentSecurityPolicy(mode: RendererRuntimeMode): string {
  const scriptSrc = mode === 'development'
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self'"
  const connectSrc = mode === 'development'
    ? "connect-src 'self' ws://localhost:5173"
    : "connect-src 'self'"

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: file: local: blob:",
    connectSrc,
    "font-src 'self' data: https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}
