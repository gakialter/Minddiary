import React from 'react'
import { Zap, Bot, Shield } from 'lucide-react'
import Logo from './Logo'

interface WelcomeProps {
    onStart: () => void
}

export default function Welcome({ onStart }: WelcomeProps) {
    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'var(--bg-primary)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 'var(--z-overlay)',
            animation: 'page-fade-in 0.8s cubic-bezier(0.2, 0, 0, 1)'
        }}>
            <div style={{
                maxWidth: 420,
                width: '90%',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-xl)'
            }}>
                {/* Logo */}
                <div style={{ color: 'var(--accent)' }}>
                    <Logo size={48} />
                </div>

                {/* Headline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <h1 style={{
                        fontSize: 26,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        color: 'var(--text-primary)',
                        margin: 0
                    }}>
                        建立今天的学习节奏
                    </h1>
                    <p style={{
                        fontSize: 15,
                        lineHeight: 1.6,
                        color: 'var(--text-secondary)',
                        margin: 0
                    }}>
                        MindDiary 把专注、复盘和错题整理连成一个闭环，帮你持续推进而不是间歇性努力。
                    </p>
                </div>

                {/* CTA */}
                <button
                    className="button button-primary"
                    style={{
                        width: '100%',
                        fontSize: 15,
                        padding: 'var(--space) var(--space-xl)',
                        borderRadius: 'var(--radius)'
                    }}
                    onClick={onStart}
                >
                    开始使用
                </button>

                {/* Proof Items */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 'var(--space-xl)',
                    paddingTop: 'var(--space-sm)',
                    borderTop: '1px solid var(--border-light)',
                    width: '100%'
                }}>
                    <ProofItem icon={<Zap size={14} />} label="沉浸式编辑" />
                    <ProofItem icon={<Bot size={14} />} label="AI 伴学" />
                    <ProofItem icon={<Shield size={14} />} label="本地存储" />
                </div>
            </div>
        </div>
    )
}

function ProofItem({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-xs)',
            color: 'var(--text-muted)',
            fontSize: 12
        }}>
            <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
            <span>{label}</span>
        </div>
    )
}
