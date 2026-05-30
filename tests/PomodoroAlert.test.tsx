import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PomodoroAlert from '../src/components/PomodoroAlert'

describe('PomodoroAlert settlement actions', () => {
  it('shows lightweight settlement actions after a focus session', () => {
    const onClose = vi.fn()
    const onWriteDiary = vi.fn()
    const onAddMistake = vi.fn()

    render(
      <PomodoroAlert
        visible={true}
        isWorkComplete={true}
        duration={25}
        todayTotal={50}
        showSettlementActions={true}
        onClose={onClose}
        onWriteDiary={onWriteDiary}
        onAddMistake={onAddMistake}
      />,
    )

    fireEvent.click(screen.getByTestId('pomodoro-alert-write-diary'))
    expect(onWriteDiary).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('pomodoro-alert-add-mistake'))
    expect(onAddMistake).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('pomodoro-alert-save-only'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the legacy single action for break completion', () => {
    render(
      <PomodoroAlert
        visible={true}
        isWorkComplete={false}
        duration={5}
        todayTotal={50}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('pomodoro-alert-write-diary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pomodoro-alert-add-mistake')).not.toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-alert-primary-action')).toBeInTheDocument()
  })
})
