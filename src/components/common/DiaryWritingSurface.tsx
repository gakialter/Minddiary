import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands'
import { activeFormats, diaryMarkdown, formatTransaction, previewField, rangeField } from './diaryEditorState'
import FormatToolbar from './FormatToolbar'
import type { DiaryFormat, MarkdownColorKey } from '../../utils/markdownDialect'
import './DiaryWritingSurface.css'
import { useDiaryPolish } from './useDiaryPolish'
import DiaryPolishPopover from './DiaryPolishPopover'
import { polishActions, type PolishAction } from '../../utils/diaryPolish'
import type { AIMessage, AIResponse } from '../../types'

export type DiaryFormatState = ReturnType<typeof activeFormats>
export interface DiaryWritingHandle {
  format: (kind: DiaryFormat, color?: MarkdownColorKey | null) => void
  append: (text: string, onApplied: () => void) => () => void
  replace: (text: string) => void
}
interface Props {
  identity?: string
  polishChat?: (messages: AIMessage[]) => Promise<AIResponse>
  value: string
  onChange: (value: string) => void
  onFormatState: (state: DiaryFormatState) => void
}
const externalSync = Annotation.define<boolean>()

/** React owns canonical text; CM owns selection/history. Prop echoes do nothing.
 * Diary date is the component key: switching resets history/queued work, whereas
 * the first save assigning a database id does not move the cursor or reset undo.
 */
const DiaryWritingSurface = forwardRef<DiaryWritingHandle, Props>(function DiaryWritingSurface(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>()
  const latest = useRef(props)
  latest.current = props
  const queued = useRef<Array<() => void>>([])
  const queueFrame = useRef(0)
  const toolbarDismissed = useRef(false)
  const [formats, setFormats] = useState<DiaryFormatState>({ bold: false, underline: false, highlight: false, color: undefined })
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [polishMenu, setPolishMenu] = useState(false)
  const polish = useDiaryPolish(viewRef, props.identity ?? '', props.polishChat)
  const polishRef = useRef(polish)
  polishRef.current = polish
  useEffect(() => {
    if (!polishMenu) return
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.diary-selection-toolbar')) setPolishMenu(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('focusin', dismiss)
    }
  }, [polishMenu])

  const afterComposition = (run: () => void) => {
    let cancelled = false
    const cancel = () => { cancelled = true }
    if (!viewRef.current?.compositionStarted && queued.current.length === 0) { run(); return cancel }
    queued.current.push(() => { if (!cancelled) run() })
    if (queueFrame.current) return cancel
    const drain = () => {
      queueFrame.current = 0
      if (!viewRef.current) return
      // Use the public composition state for DOM IME and Chromium EditContext.
      if (viewRef.current.compositionStarted) { queueFrame.current = requestAnimationFrame(drain); return }
      queued.current.splice(0).forEach(edit => edit())
    }
    queueFrame.current = requestAnimationFrame(drain)
    return cancel
  }

  const format = (kind: DiaryFormat, color?: MarkdownColorKey | null) => {
    const view = viewRef.current
    if (!view || view.compositionStarted) return
    const transaction = formatTransaction(view.state, kind, color)
    if (transaction) {
      view.dispatch(transaction)
      setNotice('')
    } else setNotice('请在同一段纯文本或完整格式内选择；复杂交叉格式可直接编辑 Markdown。')
    view.focus()
  }

  const edit = (transform: (text: string) => string, onApplied?: () => void) => {
    const run = () => {
      const view = viewRef.current
      if (!view) return
      const next = transform(view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: next.length }, scrollIntoView: true,
        annotations: [Transaction.userEvent.of('input.external'), isolateHistory.of('full')] })
      view.focus()
      onApplied?.()
    }
    return afterComposition(run)
  }
  useImperativeHandle(ref, () => ({ format,
    append: (text, onApplied) => edit(current => current.trim() ? `${current.trimEnd()}\n\n${text}\n` : `${text}\n`, onApplied),
    replace: text => edit(() => text),
  }))

  useLayoutEffect(() => {
    let frame = 0
    let disposed = false
    const locate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (disposed) return
        const selection = view.state.selection.main
        const ownsFocus = view.hasFocus || !!document.activeElement?.closest('[data-diary-format]')
        if (selection.empty || view.compositionStarted || !ownsFocus || toolbarDismissed.current) { setPosition(null); return }
        const start = view.coordsAtPos(selection.from)
        const end = view.coordsAtPos(selection.to)
        const bounds = view.scrollDOM.getBoundingClientRect()
        // Reserve space above for the compact toolbar and its color popover.
        if (!start || !end || start.top < Math.max(150, bounds.top) || end.bottom > Math.min(innerHeight - 8, bounds.bottom)) {
          setPosition(null); return
        }
        setPosition({ left: Math.max(8, Math.min(start.left, innerWidth - 240)), top: start.top - 44 })
      })
    }
    const publishState = (state: EditorState) => {
      const next = activeFormats(state)
      setFormats(next)
      latest.current.onFormatState(next)
    }
    const view = new EditorView({ parent: host.current!, state: EditorState.create({
      doc: latest.current.value,
      extensions: [diaryMarkdown, history(), rangeField, previewField,
        EditorView.lineWrapping, placeholder('写下今天的考研日记…'),
        EditorView.contentAttributes.of({ id: 'editor-diary-content', 'aria-label': '日记正文',
          'aria-multiline': 'true', 'data-testid': 'diary-content-input', spellcheck: 'false' }),
        keymap.of([
          { key: 'Mod-b', run: () => { format('bold'); return true } },
          { key: 'Mod-u', run: () => { format('underline'); return true } },
          { key: 'Mod-Shift-h', run: () => { format('highlight'); return true } },
          ...historyKeymap, ...defaultKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged || (update.selectionSet && !update.startState.selection.eq(update.state.selection))) {
            polishRef.current.invalidate()
            setPolishMenu(false)
          }
          if (update.docChanged && update.transactions.some(tr => tr.docChanged && !tr.annotation(externalSync))) {
            latest.current.onChange(update.state.doc.toString())
          }
          if (update.docChanged || update.selectionSet) {
            toolbarDismissed.current = false
            publishState(update.state)
          }
          locate()
        }),
        EditorView.domEventObservers({
          compositionstart: () => { setPosition(null); polishRef.current.invalidate(); setPolishMenu(false) },
          compositionend: locate,
        }),
      ],
    }) })
    viewRef.current = view
    publishState(view.state)
    window.addEventListener('resize', locate)
    window.addEventListener('scroll', locate, true)
    document.addEventListener('focusin', locate)
    return () => {
      disposed = true
      cancelAnimationFrame(queueFrame.current)
      queueFrame.current = 0
      cancelAnimationFrame(frame)
      queued.current = []
      window.removeEventListener('resize', locate)
      window.removeEventListener('scroll', locate, true)
      document.removeEventListener('focusin', locate)
      view.destroy()
      viewRef.current = undefined
    }
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === props.value) return
    const value = props.value
    const sync = () => {
      if (!viewRef.current) return
      const current = view.state.doc.toString()
      if (current === value) return
      let from = 0
      while (from < current.length && from < value.length && current[from] === value[from]) from++
      let oldEnd = current.length, newEnd = value.length
      while (oldEnd > from && newEnd > from && current[oldEnd - 1] === value[newEnd - 1]) { oldEnd--; newEnd-- }
      view.dispatch({ changes: { from, to: oldEnd, insert: value.slice(from, newEnd) },
        annotations: [Transaction.addToHistory.of(false), externalSync.of(true)] })
    }
    return afterComposition(sync)
  }, [props.value])

  return <>
    <div ref={host} className="diary-live-preview" />
    <span className="editor-visually-hidden" role="status">{notice}</span>
    {position && createPortal(<div className="diary-selection-toolbar" data-diary-format="true"
      style={position} onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          toolbarDismissed.current = true
          setPolishMenu(false)
          setPosition(null)
          viewRef.current?.focus()
        }
      }}>
      {!polishMenu && <FormatToolbar active={formats} onBold={() => format('bold')} onUnderline={() => format('underline')}
        onHighlight={() => format('highlight')} onColor={color => format('color', color)} onClearColor={() => format('color', null)} />
      }
      <button type="button" className="format-toolbar__button" aria-label="AI 润色" aria-expanded={polishMenu}
        onMouseDown={e => e.preventDefault()} onClick={() => setPolishMenu(open => !open)}>AI</button>
      {polishMenu && <div className="diary-polish-menu" role="group" aria-label="选择润色动作"
        style={{ position: 'fixed', left: position.left, top: Math.min(position.top + 38, innerHeight - 176) }}>
        {(Object.keys(polishActions) as PolishAction[]).map(action => <button key={action} type="button"
          onMouseDown={e => e.preventDefault()} onClick={() => { setPolishMenu(false); void polish.run(action) }}>{polishActions[action].label}</button>)}
      </div>}
    </div>, document.body)}
    {polish.review && createPortal(<DiaryPolishPopover review={polish.review}
      onClose={() => { polish.close(); viewRef.current?.focus() }} onApply={polish.apply}
      onRegenerate={() => { if (polish.review?.target) void polish.run(polish.review.action, polish.review.target) }} />, document.body)}
  </>
})
export default DiaryWritingSurface
