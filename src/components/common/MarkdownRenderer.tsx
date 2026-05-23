import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import remarkTextFormatting from '../../utils/remarkTextFormatting'

interface MarkdownRendererProps {
  children: string
  className?: string
}

const components: Components = {
  p: ({ children: c, ...props }) => (
    <p style={{ marginBottom: '0.8em', lineHeight: 1.75 }} {...props}>{c}</p>
  ),
  strong: ({ children: c, ...props }) => (
    <strong style={{ color: 'var(--accent)', fontWeight: 600 }} {...props}>{c}</strong>
  ),
  code: ({ className: cls, children: c, ...props }) => {
    const isInline = !cls
    return isInline
      ? <code style={{ background: 'color-mix(in srgb, currentColor 10%, transparent)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.9em' }} {...props}>{c}</code>
      : <code className={cls} {...props}>{c}</code>
  },
  pre: ({ children: c, ...props }) => (
    <pre style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 10, overflowX: 'auto', margin: '12px 0', border: '1px solid var(--border)', fontSize: '0.9em', lineHeight: 1.6 }} {...props}>{c}</pre>
  ),
  blockquote: ({ children: c, ...props }) => (
    <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 16, margin: '12px 0', color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--bg-tertiary)', borderRadius: '0 8px 8px 0', padding: '10px 16px' }} {...props}>{c}</blockquote>
  ),
  h1: ({ children: c, ...props }) => (
    <h1 style={{ fontSize: '1.5em', fontWeight: 700, margin: '1.2em 0 0.6em', color: 'var(--text-primary)', letterSpacing: '-0.3px', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.3em' }} {...props}>{c}</h1>
  ),
  h2: ({ children: c, ...props }) => (
    <h2 style={{ fontSize: '1.3em', fontWeight: 600, margin: '1em 0 0.5em', color: 'var(--text-primary)', letterSpacing: '-0.2px' }} {...props}>{c}</h2>
  ),
  h3: ({ children: c, ...props }) => (
    <h3 style={{ fontSize: '1.1em', fontWeight: 600, margin: '0.8em 0 0.4em', color: 'var(--text-secondary)' }} {...props}>{c}</h3>
  ),
  ul: ({ children: c, ...props }) => (
    <ul style={{ paddingLeft: 24, margin: '8px 0', lineHeight: 1.8 }} {...props}>{c}</ul>
  ),
  ol: ({ children: c, ...props }) => (
    <ol style={{ paddingLeft: 24, margin: '8px 0', lineHeight: 1.8 }} {...props}>{c}</ol>
  ),
  li: ({ children: c, ...props }) => (
    <li style={{ marginBottom: '0.3em' }} {...props}>{c}</li>
  ),
  a: ({ children: c, href, ...props }) => (
    <a href={href} style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 }} target="_blank" rel="noopener noreferrer" {...props}>{c}</a>
  ),
  hr: (props) => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} {...props} />
  ),
  table: ({ children: c, ...props }) => (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }} {...props}>{c}</table>
    </div>
  ),
  th: ({ children: c, ...props }) => (
    <th style={{ borderBottom: '2px solid var(--border)', padding: '8px 12px', textAlign: 'left', fontWeight: 600 }} {...props}>{c}</th>
  ),
  td: ({ children: c, ...props }) => (
    <td style={{ borderBottom: '1px solid var(--border-light)', padding: '8px 12px' }} {...props}>{c}</td>
  ),
  // ==highlight== → <mark> with theme-aware background
  mark: ({ children: c, ...props }) => (
    <mark style={{ background: 'color-mix(in srgb, var(--warning) 30%, transparent)', color: 'inherit', padding: '1px 4px', borderRadius: 3 }} {...props}>{c}</mark>
  ),
  // ++underline++ → <u> with comfortable offset
  u: ({ children: c, ...props }) => (
    <u style={{ textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'currentColor' }} {...props}>{c}</u>
  ),
}

export default function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body content-selectable ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkTextFormatting]} components={components}>
        {children}
      </ReactMarkdown>
      <style>{`
        .markdown-body p:last-child { margin-bottom: 0; }
      `}</style>
    </div>
  )
}
