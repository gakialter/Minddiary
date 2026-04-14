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
    let badgeColor = 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    
    if (isUrgent) {
      badgeText = '高危状态 / 优先处理';
      badgeColor = 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    } else if (isCaution) {
      badgeText = '复习任务积压';
      badgeColor = 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    } else if (isFatigued) {
      badgeText = '疲劳预警';
      badgeColor = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
    }

    return (
        <section className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] px-6 py-7 md:px-8 md:py-8">
            <div className="max-w-4xl">
                <div className={`mb-4 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${badgeColor}`}>
                    当前状态：{badgeText}
                </div>

                <h1 className="text-[32px] font-bold leading-[1.28] tracking-[-0.02em] text-gray-950 dark:text-white md:text-[40px]">
                    {config.title}
                </h1>

                <p className="mt-4 max-w-2xl text-[17px] font-medium leading-7 text-gray-600 dark:text-gray-400">
                    {config.subtitle}
                </p>

                <div className="mt-6">
                    <button
                        type="button"
                        onClick={onActionClick}
                        className="inline-flex h-12 items-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-semibold text-white border-0 outline-none appearance-none transition hover:bg-blue-700"
                    >
                        <span>{config.ctaText}</span>
                        <ArrowRight className="h-4 w-4 shrink-0" />
                    </button>
                </div>
            </div>
        </section>
    );
};
