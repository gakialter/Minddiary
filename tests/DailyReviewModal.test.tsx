import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DailyReviewModal from '../src/components/DailyReviewModal'
import { createDailyReviewApi } from '../src/contexts/api/dailyReviewApi'
import type { Mistake, Subject } from '../src/types'
import type { DailyReviewAPI } from '../src/types/dailyReview'

const mocks = vi.hoisted(() => ({ api: undefined as unknown as DailyReviewAPI, review: vi.fn(), date: '2026-09-10' }))
vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: () => ({ dailyReview: mocks.api, mistakes: { review: mocks.review } }) }))
vi.mock('../src/utils/apiAdapter', () => ({ IS_ELECTRON: false }))
vi.mock('../src/utils/dateKey', async importOriginal => ({ ...await importOriginal<typeof import('../src/utils/dateKey')>(), getLocalDateKey: () => mocks.date }))

describe('DailyReviewModal', () => {
    const subjects = [{ id: 1, name: '数学' }, { id: 2, name: '英语' }] as Subject[]
    const mistakes = { current: [1, 2, 3].map(id => ({ id, subject_id: 1, question: `题目 ${id}`, answer: `答案 ${id}`, notes: '**备注内容**', image_path: 'question.png', answer_image_path: '["answer.png"]', mastered: true })) as Mistake[] }
    beforeEach(() => {
        localStorage.clear()
        mocks.date = '2026-09-10'
        mocks.review.mockClear()
        mocks.api = createDailyReviewApi(mistakes, { current: subjects })
    })
    const open = () => render(<StrictMode><DailyReviewModal subjects={subjects} onClose={vi.fn()} /></StrictMode>)
    const setupRound = async (quota = '1') => {
        await screen.findByText(/本科目共 3 题/)
        fireEvent.change(screen.getByLabelText('每日题量'), { target: { value: quota } })
        fireEvent.click(screen.getByRole('button', { name: '保存' }))
        fireEvent.click(await screen.findByRole('button', { name: '开始本轮' }))
        await screen.findByRole('button', { name: '查看答案' })
    }

    it('selects asynchronously arriving subjects, keeps valid user selection and recovers when it disappears', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<DailyReviewModal subjects={[]} subjectId={1} onClose={onClose} />)
        await waitFor(() => expect(screen.getByLabelText('科目')).toHaveValue('0'))
        expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
        rerender(<DailyReviewModal subjects={subjects} subjectId={1} onClose={onClose} />)
        await screen.findByText(/本科目共 3 题/)
        expect(screen.getByLabelText('科目')).toHaveValue('1')
        fireEvent.click(screen.getByRole('button', { name: '保存' }))
        await screen.findByRole('button', { name: '开始本轮' })
        fireEvent.change(screen.getByLabelText('科目'), { target: { value: '2' } })
        await screen.findByText(/本科目共 0 题/)
        rerender(<DailyReviewModal subjects={[...subjects].reverse()} subjectId={1} onClose={onClose} />)
        expect(screen.getByLabelText('科目')).toHaveValue('2')
        rerender(<DailyReviewModal subjects={[subjects[0]!]} subjectId={1} onClose={onClose} />)
        await screen.findByRole('button', { name: '开始本轮' })
        expect(screen.getByLabelText('科目')).toHaveValue('1')
        rerender(<DailyReviewModal subjects={[]} subjectId={1} onClose={onClose} />)
        await waitFor(() => expect(screen.getByLabelText('科目')).toHaveValue('0'))
        expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })

    it('reveals content and images, consumes once on rapid clicks, and stops at the daily goal with no scoring UI', async () => {
        open()
        await setupRound()
        expect(screen.getByAltText('题目图片 1')).toBeInTheDocument()
        expect(screen.queryByAltText('答案图片 1')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: '查看答案' }))
        expect(screen.getByAltText('答案图片 1')).toBeInTheDocument()
        expect(screen.getByText('备注内容')).toBeInTheDocument()
        expect(screen.queryByText(/掌握|较难|较易|下次复习|评分/)).not.toBeInTheDocument()
        const button = screen.getByRole('button', { name: '完成本题 / 下一题' })
        act(() => { fireEvent.click(button); fireEvent.click(button) })
        await screen.findByText('今日目标已完成，明天从本轮剩余题目继续。')
        expect(screen.getByText('今日：1 / 1')).toBeInTheDocument()
        expect(screen.getByText('本轮：1 / 3')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '结束今日复盘' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '完成本题 / 下一题' })).not.toBeInTheDocument()
        expect(mocks.review).not.toHaveBeenCalled()
    })

    it('shows round completion and requires an explicit next-round action', async () => {
        open()
        await setupRound('5')
        for (let i = 0; i < 3; i++) {
            fireEvent.click(await screen.findByRole('button', { name: '查看答案' }))
            fireEvent.click(screen.getByRole('button', { name: '完成本题 / 下一题' }))
        }
        const startNext = await screen.findByRole('button', { name: '开始下一轮' })
        expect(screen.getByText(/本轮已完成 · 3 \/ 3/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '查看答案' })).not.toBeInTheDocument()
        fireEvent.click(startNext)
        await screen.findByRole('button', { name: '查看答案' })
        expect(screen.getByText('今日：3 / 5')).toBeInTheDocument()
        expect(screen.getByText('本轮：0 / 3')).toBeInTheDocument()
    })

    it('refreshes at the next day, retains the round position, and switches to separate subject configuration', async () => {
        open()
        await setupRound()
        fireEvent.click(screen.getByRole('button', { name: '查看答案' }))
        fireEvent.click(screen.getByRole('button', { name: '完成本题 / 下一题' }))
        await screen.findByRole('button', { name: '结束今日复盘' })
        mocks.date = '2026-09-11'
        fireEvent(window, new Event('focus'))
        await screen.findByRole('button', { name: '查看答案' })
        expect(screen.getByText('今日：0 / 1')).toBeInTheDocument()
        expect(screen.getByText('本轮：1 / 3')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('科目'), { target: { value: '2' } })
        await screen.findByText(/本科目共 0 题/)
        expect(screen.getByText(/设置每日题量/)).toBeInTheDocument()
    })

    it('shows persistence failures and rereads state before allowing another completion', async () => {
        open()
        await setupRound()
        fireEvent.click(screen.getByRole('button', { name: '查看答案' }))
        vi.spyOn(mocks.api, 'execute').mockRejectedValueOnce(new Error('保存失败'))
        fireEvent.click(screen.getByRole('button', { name: '完成本题 / 下一题' }))
        await screen.findByRole('alert')
        expect(screen.getByRole('button', { name: '完成本题 / 下一题' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: '重新读取进度' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        expect(screen.getByText('今日：0 / 1')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '查看答案' })).toBeInTheDocument()
    })
})
