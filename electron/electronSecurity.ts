import {
  classifyNavigation,
  describeUrlForLog,
  getExternalUrl,
  type NavigationDecision,
  type NavigationPolicy,
} from './navigationSecurity'

type SecurityLogger = {
  readonly warn: (...args: unknown[]) => void
  readonly error: (...args: unknown[]) => void
}

type OpenExternal = (url: string) => Promise<unknown>

type SecurityHandlerOptions = {
  readonly openExternal: OpenExternal
  readonly logger: SecurityLogger
}

type NavigationHandlerOptions = SecurityHandlerOptions & {
  readonly policy: NavigationPolicy
}

type NavigationEvent = {
  readonly preventDefault: () => void
}

type WindowOpenDetails = {
  readonly url: string
}

const denyWindowOpen = { action: 'deny' } as const

function assertNever(value: never): never {
  throw new Error(`Unexpected navigation decision: ${JSON.stringify(value)}`)
}

function logExternalOpenFailure(url: string, error: unknown, logger: SecurityLogger): void {
  logger.error(
    '[navigation] Failed to open external URL',
    describeUrlForLog(url),
    { errorType: error instanceof Error ? error.name : 'UnknownError' },
  )
}

function openExternalSafely(url: string, options: SecurityHandlerOptions): void {
  try {
    void options.openExternal(url).catch((error: unknown) => {
      logExternalOpenFailure(url, error, options.logger)
    })
  } catch (error: unknown) {
    const normalizedError = error instanceof Error
      ? error
      : new Error('Non-Error external open failure')
    logExternalOpenFailure(url, normalizedError, options.logger)
  }
}

function handleNavigationDecision(
  event: NavigationEvent,
  target: string,
  decision: NavigationDecision,
  options: SecurityHandlerOptions,
): void {
  switch (decision.kind) {
    case 'allow':
      return
    case 'external':
      event.preventDefault()
      openExternalSafely(decision.url, options)
      return
    case 'block':
      event.preventDefault()
      options.logger.warn('[navigation] Blocked navigation target', describeUrlForLog(target))
      return
    default:
      assertNever(decision)
  }
}

export function createWindowOpenHandler(options: SecurityHandlerOptions) {
  return (details: WindowOpenDetails): typeof denyWindowOpen => {
    const externalUrl = getExternalUrl(details.url)
    if (externalUrl) {
      openExternalSafely(externalUrl, options)
    } else {
      options.logger.warn('[navigation] Blocked window-open target', describeUrlForLog(details.url))
    }
    return denyWindowOpen
  }
}

export function createNavigationHandler(options: NavigationHandlerOptions) {
  return (event: NavigationEvent, target: string): void => {
    const decision = classifyNavigation(target, options.policy)
    handleNavigationDecision(event, target, decision, options)
  }
}

export function denyPermissionRequest(
  _webContents: unknown,
  _permission: string,
  callback: (granted: boolean) => void,
): void {
  callback(false)
}

export function denyPermissionCheck(_webContents: unknown, _permission: string): boolean {
  return false
}

export function createMainWindowWebPreferences(preload: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    preload,
  }
}
