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

  it('renders task settlement controls and submits the one-line review', () => {
    const onSettleTask = vi.fn().mockResolvedValue(true)
    render(
      <PomodoroAlert
        visible
        isWorkComplete
        duration={25}
        todayTotal={50}
        showSettlementActions
        taskSettlement={{
          id: 7,
          title: 'Finish algebra',
          subjectName: 'Math',
          status: 'doing',
          duration: 25,
        }}
        onClose={vi.fn()}
        onSettleTask={onSettleTask}
        onAddMistake={vi.fn()}
      />,
    )

    expect(screen.getByTestId('pomodoro-task-settlement')).toHaveTextContent('Finish algebra')
    fireEvent.change(screen.getByTestId('pomodoro-focus-review-input'), {
      target: { value: 'Worked through the hardest example.' },
    })
    fireEvent.click(screen.getByTestId('pomodoro-settle-complete'))

    expect(onSettleTask).toHaveBeenCalledWith({
      completeTask: true,
      reviewText: 'Worked through the hardest example.',
    })
    expect(screen.queryByTestId('pomodoro-alert-write-diary')).not.toBeInTheDocument()
  })

  it('renders in-app diary creation choices while review creation is pending', () => {
    const onResolveReviewEntryCreation = vi.fn().mockResolvedValue(true)
    render(
      <PomodoroAlert
        visible
        isWorkComplete
        duration={25}
        todayTotal={50}
        showSettlementActions
        taskSettlement={{
          id: 7,
          title: 'Finish algebra',
          subjectName: 'Math',
          status: 'done',
          duration: 25,
        }}
        pendingReviewEntryCreation={{ reviewText: 'Reflection text' }}
        onClose={vi.fn()}
        onResolveReviewEntryCreation={onResolveReviewEntryCreation}
        onAddMistake={vi.fn()}
      />,
    )

    expect(screen.getByTestId('pomodoro-review-entry-prompt')).toHaveTextContent(
      '本次专注对应日期还没有日记',
    )
    expect(screen.getByTestId('pomodoro-review-entry-prompt')).toHaveTextContent(
      '专注和任务结算已保存。是否创建对应日期的日记并写入这条复盘？',
    )
    expect(screen.queryByTestId('pomodoro-focus-review-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pomodoro-settle-complete')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('pomodoro-review-create-entry'))
    expect(onResolveReviewEntryCreation).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByTestId('pomodoro-review-skip-entry'))
    expect(onResolveReviewEntryCreation).toHaveBeenCalledWith(false)
  })
})
