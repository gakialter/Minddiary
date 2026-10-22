import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showToast, ToastContainer } from '../src/components/Toast'
import { useModalFocus } from '../src/hooks/useModalFocus'

function Modal() {
  const ref = useModalFocus(() => {})
  return <div ref={ref} role="dialog" aria-modal="true"><button>弹窗操作</button></div>
}

describe('Toast feedback', () => {
  let transitionDuration: string

  beforeEach(() => {
    vi.useFakeTimers()
    transitionDuration = '0.17s'
    const getStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      const style = getStyle(element)
      Object.defineProperty(style, 'transitionDuration', { value: transitionDuration })
      return style
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('announces additions through one persistent region per urgency, without live dismiss controls', () => {
    render(<div className="app-container"><ToastContainer /></div>)
    expect(document.querySelector('.toast-container')?.parentElement).toBe(document.body)
    const status = screen.getByRole('status')
    const alert = screen.getByRole('alert')
    expect(status).toBeEmptyDOMElement()
    expect(alert).toBeEmptyDOMElement()

    act(() => {
      showToast('已保存')
      showToast('正在处理', 'info')
      showToast('保存失败', 'error')
    })

    expect(status.children).toHaveLength(2)
    expect(alert.children).toHaveLength(1)
    expect(status).toHaveTextContent('已保存正在处理')
    expect(alert).toHaveTextContent('保存失败')
    expect(status).toHaveAttribute('aria-relevant', 'additions')
    expect(alert).not.toHaveAttribute('aria-live')
    expect(status.querySelector('button')).toBeNull()
    expect(document.querySelector('.toast__message')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: '关闭通知：已保存' })).toBeEnabled()
  })

  it('keeps simultaneous calls independent, including identical messages', () => {
    render(<ToastContainer />)
    let first = 0
    let second = 0
    act(() => {
      first = showToast('已保存')
      second = showToast('已保存')
    })
    expect(first).not.toBe(second)
    expect(document.querySelectorAll('.toast')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '关闭通知：已保存' })[0]!)
    act(() => vi.advanceTimersByTime(170))
    expect(document.querySelectorAll('.toast')).toHaveLength(1)
    expect(screen.getByRole('status').children).toHaveLength(1)
  })

  it('keeps global feedback out of modal isolation while the rest of the shell stays inert', () => {
    const { container } = render(<><button>主界面操作</button><ToastContainer /><Modal /></>)
    act(() => { showToast('保存失败', 'error') })
    expect(container.querySelector('button')).toHaveProperty('inert', true)
    for (const region of document.querySelectorAll('[data-toast-region]')) {
      expect(region).not.toHaveProperty('inert', true)
      expect(region.closest('[inert]')).toBeNull()
    }
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '弹窗操作' }))
  })

  it('preserves the requested display duration, then removes after the CSS exit duration', () => {
    render(<ToastContainer />)
    act(() => { showToast('已保存', 'success', 1000) })
    const toast = document.querySelector('.toast')!
    act(() => vi.advanceTimersByTime(999))
    expect(toast).toHaveAttribute('data-leaving', 'false')
    act(() => vi.advanceTimersByTime(1))
    expect(toast).toHaveAttribute('data-leaving', 'true')
    act(() => vi.advanceTimersByTime(169))
    expect(toast).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(toast).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not restart exit or retain the auto timer after repeated manual dismissal', () => {
    render(<ToastContainer />)
    act(() => { showToast('已保存', 'success', 1000) })
    act(() => vi.advanceTimersByTime(900))
    const close = screen.getByRole('button', { name: '关闭通知：已保存' })
    fireEvent.click(close)
    act(() => vi.advanceTimersByTime(100))
    fireEvent.click(close)
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.advanceTimersByTime(70))
    expect(document.querySelector('.toast')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a shorter computed exit duration and clears the fallback on transition completion', () => {
    transitionDuration = '70ms'
    render(<ToastContainer />)
    act(() => { showToast('已保存') })
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：已保存' }))
    act(() => vi.advanceTimersByTime(69))
    expect(document.querySelector('.toast')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('.toast')).toBeNull()

    act(() => { showToast('保存失败', 'error') })
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：保存失败' }))
    const end = new Event('transitionend', { bubbles: true })
    Object.defineProperty(end, 'propertyName', { value: 'opacity' })
    fireEvent(document.querySelector('.toast')!, end)
    expect(document.querySelector('.toast')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans both display and exit timers and subscriptions on unmount in StrictMode', () => {
    const { unmount } = render(<StrictMode><ToastContainer /></StrictMode>)
    act(() => {
      showToast('已保存')
      showToast('保存失败', 'error')
    })
    expect(document.querySelectorAll('.toast')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：已保存' }))
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { showToast('卸载后') })
    expect(vi.getTimerCount()).toBe(0)
  })
})
