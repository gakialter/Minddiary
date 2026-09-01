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
    let badgeTone = 'steady';

    if (isUrgent) {
        badgeText = '高危状态 / 优先处理';
        badgeTone = 'danger';
    } else if (isCaution) {
        badgeText = '复习任务积压';
        badgeTone = 'warning';
    } else if (isFatigued) {
        badgeText = '疲劳预警';
        badgeTone = 'neutral';
    }

    return (
        <section
            className="today-action-commander"
            data-state={config.type}
            aria-labelledby="today-action-commander-title"
        >
            <div className="today-action-commander__copy">
                <p className="today-action-commander__status" data-tone={badgeTone}>
                    <span className="today-action-commander__status-mark" aria-hidden="true" />
                    当前状态：{badgeText}
                </p>

                <h2 id="today-action-commander-title" className="today-action-commander__title">
                    {config.title}
                </h2>

                <p id="today-action-commander-description" className="today-action-commander__subtitle">
                    {config.subtitle}
                </p>
            </div>

            <button
                type="button"
                onClick={onActionClick}
                className="button button-secondary today-action-commander__action"
                data-testid="dashboard-cta"
                aria-describedby="today-action-commander-description"
            >
                <span>{config.ctaText}</span>
                <ArrowRight size={16} aria-hidden="true" />
            </button>
        </section>
    );
};
