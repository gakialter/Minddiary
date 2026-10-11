import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CountdownEventsManager from '../src/components/CountdownEventsManager'

describe('CountdownEventsManager', () => {
  it('allows a fresh user to leave the primary target date empty until they choose one', () => {
    const setExamDate = vi.fn()
    const setEvents = vi.fn()
    const onValidityChange = vi.fn()

    render(
      <CountdownEventsManager
        examDate=""
        setExamDate={setExamDate}
        events={[]}
        setEvents={setEvents}
        onValidityChange={onValidityChange}
      />,
    )

    expect(screen.getAllByLabelText('目标日期')[0]).toHaveValue('')
    expect(screen.getByText('尚未设置目标日期，可按自己的计划填写。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onValidityChange).toHaveBeenLastCalledWith(true)

    fireEvent.change(screen.getAllByLabelText('目标日期')[0]!, { target: { value: '2027-01-10' } })

    expect(setExamDate).toHaveBeenCalledWith('2027-01-10')
  })
})
