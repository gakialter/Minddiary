import React from 'react';
import { DashboardStateConfig } from '../../hooks/useDashboardMasterState';
import { ArrowRight } from 'lucide-react';

interface CommanderHeroProps {
    config: DashboardStateConfig;
    onActionClick: () => void;
}

export const CommanderHero: React.FC<CommanderHeroProps> = ({ config, onActionClick }) => {
    const isUrgent = config.type === 'A';
    const isCaution = config.type === 'C';
    const isFatigued = config.type === 'D';

    let badgeText = '稳定推进';
    let badgeStyle: React.CSSProperties = {
        background: 'rgba(15, 118, 110, 0.08)',
        color: 'var(--accent)',
    };

    if (isUrgent) {
        badgeText = '高危状态 / 优先处理';
        badgeStyle = {
            background: 'rgba(198, 90, 58, 0.08)',
            color: 'var(--danger)',
        };
    } else if (isCaution) {
        badgeText = '复习任务积压';
        badgeStyle = {
            background: 'rgba(217, 119, 6, 0.08)',
            color: 'var(--warning)',
        };
    } else if (isFatigued) {
        badgeText = '疲劳预警';
        badgeStyle = {
            background: 'rgba(142, 142, 147, 0.1)',
            color: 'var(--text-secondary)',
        };
    }

    return (
        <section style={{
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            padding: '28px 24px',
        }}>
            <div style={{ maxWidth: '64rem' }}>
                <div style={{
                    marginBottom: 'var(--space-md)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: '999px',
                    padding: '3px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    ...badgeStyle
                }}>
                    当前状态：{badgeText}
                </div>

                <h1 style={{
                    fontSize: 'clamp(28px, 4vw, 38px)',
                    fontWeight: 700,
                    lineHeight: 1.28,
                    letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                    margin: '0 0 var(--space-md)',
                }}>
                    {config.title}
                </h1>

                <p style={{
                    fontSize: 16,
                    fontWeight: 500,
                    lineHeight: 1.7,
                    color: 'var(--text-secondary)',
                    maxWidth: '42rem',
                    margin: 0,
                }}>
                    {config.subtitle}
                </p>

                <div style={{ marginTop: 'var(--space-lg)' }}>
                    <button
                        type="button"
                        onClick={onActionClick}
                        className="button button-primary"
                        data-testid="dashboard-cta"
                        style={{ borderRadius: 'var(--radius)', gap: 'var(--space-xs)' }}
                    >
                        <span>{config.ctaText}</span>
                        <ArrowRight size={16} style={{ flexShrink: 0 }} />
                    </button>
                </div>
            </div>
        </section>
    );
};
