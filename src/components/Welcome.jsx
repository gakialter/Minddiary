import React from 'react'

export default function Welcome({ onStart }) {
    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'var(--bg-primary)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            animation: 'page-fade-in 0.8s cubic-bezier(0.2, 0, 0, 1)'
        }}>
            <div style={{
                maxWidth: 480, width: '90%',
                padding: 'var(--space-2xl)', borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-secondary)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border)',
                textAlign: 'center'
            }}>
                <div style={{
                    width: 80, height: 80, borderRadius: '24px', margin: '0 auto var(--space-xl)',
                    background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 36, fontWeight: 'bold',
                    boxShadow: '0 8px 16px rgba(139, 92, 246, 0.3)',
                    animation: 'logo-pulse 3s infinite ease-in-out'
                }}>考</div>

                <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 'var(--space-md)' }}>欢迎使用考研日记</h1>
                <p className="text-secondary" style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 'var(--space-2xl)' }}>
                    一款专注、极简的本地化日记应用。记录你的学习进度、整理错题，并让 AI 成为你的私人考研助手。
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', textAlign: 'left', marginBottom: 'var(--space-2xl)' }}>
                    <Feature icon="⚡️" title="沉浸式 Markdown 编辑" desc="支持快捷键和模板，让你专注于内容本身。" />
                    <Feature icon="🤖" title="AI 智能伴学" desc="连接大模型，帮你总结笔记、解答专业课疑问。" />
                    <Feature icon="🔒" title="本地数据留存" desc="所有日记和配置保存在本地 SQLite，安全无忧。" />
                </div>

                <button
                    className="button button-primary w-full"
                    style={{ fontSize: 17, padding: 'var(--space) var(--space-xl)', borderRadius: 'var(--radius)' }}
                    onClick={onStart}
                >
                    开始记录
                </button>
            </div>
        </div>
    )
}

function Feature({ icon, title, desc }) {
    return (
        <div style={{ display: 'flex', gap: 'var(--space)', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 24 }}>{icon}</div>
            <div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{title}</div>
                <div className="text-muted" style={{ fontSize: 13 }}>{desc}</div>
            </div>
        </div>
    )
}
