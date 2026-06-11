import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PomodoroAlert from '../src/components/PomodoroAlert'

describe('PomodoroAlert', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the natural focus completion copy and settlement actions', () => {
    render(
      <PomodoroAlert
        visible
        isWorkComplete
        completionKind="completed"
        duration={25}
        todayTotal={75}
        showSettlementActions
        onClose={vi.fn()}
        onWriteDiary={vi.fn()}
        onAddMistake={vi.fn()}
      />,
    )

    expect(screen.getByText('专注完成！')).toBeInTheDocument()
    expect(screen.getByText('干得漂亮，休息几分钟再继续吧～')).toBeInTheDocument()
    expect(screen.getByText('25min')).toBeInTheDocument()
    expect(screen.getByText('1h 15m')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-alert-write-diary')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-alert-add-mistake')).toBeInTheDocument()
  })

  it('uses interrupted focus copy while keeping settlement actions available', () => {
    render(
      <PomodoroAlert
        visible
        isWorkComplete
        completionKind="interrupted"
        duration={19}
        todayTotal={44}
        showSettlementActions
        onClose={vi.fn()}
        onWriteDiary={vi.fn()}
        onAddMistake={vi.fn()}
      />,
    )

    expect(screen.getByText('专注已保存')).toBeInTheDocument()
    expect(screen.getByText('本次提前结束，实际专注时长已计入统计。')).toBeInTheDocument()
    expect(screen.getByText('19min')).toBeInTheDocument()
    expect(screen.getByText('0h 44m')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-alert-write-diary')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-alert-add-mistake')).toBeInTheDocument()
    expect(screen.queryByText(/开始休息/)).not.toBeInTheDocument()
  })

  it('keeps break completion behavior', () => {
    const onClose = vi.fn()
    render(
      <PomodoroAlert
        visible
        isWorkComplete={false}
        duration={5}
        todayTotal={25}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('休息结束！')).toBeInTheDocument()
    expect(screen.getByText('精力充沛，继续加油！')).toBeInTheDocument()
    const primaryAction = screen.getByTestId('pomodoro-alert-primary-action')
    expect(primaryAction).toHaveTextContent('继续专注')

    fireEvent.click(primaryAction)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
