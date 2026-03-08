import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error,
      errorInfo
    })

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error Boundary caught an error:', error, errorInfo)
    }

    // TODO: Send error to error reporting service (e.g., Sentry)
    // reportErrorToService(error, errorInfo)
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })

    // Reload the page to reset application state
    window.location.reload()
  }

  handleReportIssue = () => {
    const { error, errorInfo } = this.state
    const issueBody = `
**错误信息：**
${error?.toString()}

**错误堆栈：**
\`\`\`
${errorInfo?.componentStack}
\`\`\`

**浏览器信息：**
- User Agent: ${navigator.userAgent}
- 时间: ${new Date().toISOString()}
    `.trim()

    const githubIssueUrl = `https://github.com/your-repo/issues/new?title=${encodeURIComponent('应用崩溃报告')}&body=${encodeURIComponent(issueBody)}`
    window.open(githubIssueUrl, '_blank')
  }

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state
      const isDevelopment = process.env.NODE_ENV === 'development'

      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          padding: 'var(--space-xl)'
        }}>
          <div style={{
            maxWidth: 600,
            width: '100%',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-xl)',
            textAlign: 'center'
          }}>
            {/* Error Icon */}
            <div style={{
              fontSize: 64,
              marginBottom: 'var(--space-lg)'
            }}>
              😵
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 'var(--space-md)',
              color: 'var(--text-primary)'
            }}>
              糟糕，应用遇到了问题
            </h1>

            {/* Description */}
            <p style={{
              fontSize: 15,
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-xl)',
              lineHeight: 1.6
            }}>
              应用运行时发生了意外错误。不用担心，你的数据都已安全保存在浏览器中。
            </p>

            {/* Error Details (Development Only) */}
            {isDevelopment && (
              <details style={{
                marginBottom: 'var(--space-xl)',
                textAlign: 'left',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius)',
                padding: 'var(--space-md)'
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                  color: 'var(--text-secondary)',
                  marginBottom: 'var(--space-sm)'
                }}>
                  开发模式：查看错误详情
                </summary>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <strong style={{ color: 'var(--error)' }}>错误：</strong>
                  <br />
                  {error?.toString()}
                  <br /><br />
                  <strong style={{ color: 'var(--warning)' }}>堆栈：</strong>
                  <br />
                  {errorInfo?.componentStack}
                </div>
              </details>
            )}

            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: 'var(--space-md)',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <button
                className="button button-primary"
                onClick={this.handleReset}
                style={{ minWidth: 140 }}
              >
                🔄 重新加载
              </button>

              {!isDevelopment && (
                <button
                  className="button button-secondary"
                  onClick={this.handleReportIssue}
                  style={{ minWidth: 140 }}
                >
                  📝 报告问题
                </button>
              )}
            </div>

            {/* Help Text */}
            <p style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 'var(--space-xl)',
              lineHeight: 1.5
            }}>
              如果问题持续出现，尝试清除浏览器缓存或检查控制台是否有错误信息。
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
