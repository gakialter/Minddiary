import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Settings from '../src/components/Settings'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

function setupMocks(platform: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = {
    window: {
      platform,
      titlebarMode: platform === 'darwin' ? 'native' : 'custom',
    },
    updater: {
      check: vi.fn().mockResolvedValue({ success: true }),
      install: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
      onStatusChange: vi.fn(() => vi.fn()),
    },
    settings: {
      selectBackupFolder: vi.fn().mockResolvedValue(null),
    },
    focusGuard: {
      getActiveApp: vi.fn().mockResolvedValue(null),
    },
  }

  mockUseDiary.mockReturnValue({
    settings: {
      getAll: vi.fn().mockResolvedValue({
        examDate: '2026-12-25',
        aiEndpoint: '',
        aiApiKeyMasked: null,
        aiApiKeyPresent: false,
        aiModel: '',
        autoSave: false,
        pomodoroMinutes: 25,
        autoBackup: false,
        backupPath: '',
        pomodoroSound: true,
        pomodoroAlert: true,
        focusGuardEnabled: true,
        focusGuardIntervalSec: 5,
        focusWhitelist: [],
        countdownEvents: [],
      }),
      updateGeneral: vi.fn().mockResolvedValue({ success: true }),
      updateAI: vi.fn().mockResolvedValue({ success: true }),
      updateBackup: vi.fn().mockResolvedValue({ success: true }),
    },
    theme: 'system',
    changeTheme: vi.fn(),
    entries: { getAll: vi.fn().mockResolvedValue([]) },
    tags: { getAll: vi.fn().mockResolvedValue([]) },
    subjects: { getAll: vi.fn().mockResolvedValue([]) },
    mistakes: { getAll: vi.fn().mockResolvedValue([]) },
    pomodoro: { getRange: vi.fn().mockResolvedValue([]) },
  })
}

describe('Focus Guard platform hint', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('on Windows (win32)', () => {
    beforeEach(() => {
      setupMocks('win32')
    })

    it('does not show unsupported platform hint', async () => {
      await act(async () => {
        render(<Settings />)
      })

      expect(screen.queryByTestId('focus-guard-platform-hint')).not.toBeInTheDocument()
    })

    it('enables the "添加当前应用" button', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const addCurrentAppBtn = screen.getByRole('button', { name: /添加当前应用/ })
      expect(addCurrentAppBtn).not.toBeDisabled()
    })
  })

  describe('on macOS (darwin)', () => {
    beforeEach(() => {
      setupMocks('darwin')
    })

    it('shows unsupported platform hint', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const hint = screen.getByTestId('focus-guard-platform-hint')
      expect(hint).toBeInTheDocument()
      expect(hint.textContent).toContain('当前平台暂未完整支持前台应用检测')
      expect(hint.textContent).toContain('Windows 版本支持更完整的专注提醒')
    })

    it('disables the "添加当前应用" button', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const addCurrentAppBtn = screen.getByRole('button', { name: /添加当前应用/ })
      expect(addCurrentAppBtn).toBeDisabled()
    })

    it('shows explanatory feedback when "添加当前应用" is clicked despite disabled state', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const addCurrentAppBtn = screen.getByRole('button', { name: /添加当前应用/ })
      expect(addCurrentAppBtn).toHaveAttribute('title', '当前平台暂不支持自动捕获前台应用')
    })

    it('still allows manual whitelist entry', async () => {
      vi.useFakeTimers()
      await act(async () => {
        render(<Settings />)
      })

      const manualInput = screen.getByLabelText('应用名称或进程名')
      const manualAddBtn = screen.getByRole('button', { name: '手动添加' })

      await act(async () => {
        fireEvent.change(manualInput, { target: { value: 'firefox.exe' } })
        fireEvent.click(manualAddBtn)
      })

      expect(screen.getAllByText('firefox.exe').length).toBeGreaterThan(0)
    })
  })

  describe('on Linux', () => {
    beforeEach(() => {
      setupMocks('linux')
    })

    it('shows unsupported platform hint', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const hint = screen.getByTestId('focus-guard-platform-hint')
      expect(hint).toBeInTheDocument()
      expect(hint.textContent).toContain('当前平台暂未完整支持前台应用检测')
    })

    it('disables the "添加当前应用" button', async () => {
      await act(async () => {
        render(<Settings />)
      })

      const addCurrentAppBtn = screen.getByRole('button', { name: /添加当前应用/ })
      expect(addCurrentAppBtn).toBeDisabled()
    })
  })
})
