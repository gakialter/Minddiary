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

export type MainWindowIpcFrame = {
  readonly url: string
}

export type MainWindowIpcWebContents = {
  readonly mainFrame: MainWindowIpcFrame
}

export type MainWindowIpcWindow = {
  readonly webContents: MainWindowIpcWebContents
  readonly isDestroyed: () => boolean
}

export type MainWindowIpcEvent = {
  readonly sender: MainWindowIpcWebContents
  readonly senderFrame: MainWindowIpcFrame
}

type ClipboardWriteHandlerOptions = {
  readonly getMainWindow: () => MainWindowIpcWindow | null
  readonly getNavigationPolicy: () => NavigationPolicy
  readonly writeText: (text: string) => void
}

type PrintWindowNavigationEvent = {
  readonly preventDefault: () => void
}

const denyWindowOpen = { action: 'deny' } as const

class ClipboardWriteRejectedError extends Error {
  readonly name = 'ClipboardWriteRejectedError'

  constructor() {
    super('Clipboard write request rejected')
  }
}

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

export function isTrustedMainWindowIpcSender(
  event: MainWindowIpcEvent,
  options: Pick<ClipboardWriteHandlerOptions, 'getMainWindow' | 'getNavigationPolicy'>,
): boolean {
  const mainWindow = options.getMainWindow()
  return Boolean(
    mainWindow !== null
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && classifyNavigation(event.senderFrame.url, options.getNavigationPolicy()).kind === 'allow',
  )
}

export function createClipboardWriteHandler(options: ClipboardWriteHandlerOptions) {
  return (event: MainWindowIpcEvent, payload: unknown): void => {
    if (!isTrustedMainWindowIpcSender(event, options) || typeof payload !== 'string') {
      throw new ClipboardWriteRejectedError()
    }
    options.writeText(payload)
  }
}

export function createPrintWindowWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    sandbox: true,
    javascript: false,
  }
}

export function createPrintWindowOpenHandler() {
  return (): typeof denyWindowOpen => denyWindowOpen
}

export function createPrintWindowNavigationHandler(documentUrl: string) {
  const policy: NavigationPolicy = { kind: 'production', appDocumentUrl: documentUrl }
  return (event: PrintWindowNavigationEvent, target: string): void => {
    if (classifyNavigation(target, policy).kind !== 'allow') event.preventDefault()
  }
}

export function createMainWindowWebPreferences(preload: string) {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    preload,
  }
}
