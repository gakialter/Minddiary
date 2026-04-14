import React from 'react';
import { DashboardStateConfig } from '../../hooks/useDashboardMasterState';

interface CommanderHeroProps {
    config: DashboardStateConfig;
    onActionClick: () => void;
}

export const CommanderHero: React.FC<CommanderHeroProps> = ({ config, onActionClick }) => {
    // Dynamic color hints for extreme states
    const isUrgent = config.type === 'A';
    const isCaution = config.type === 'C';
    
    let titleColor = 'text-gray-900 dark:text-white';
    if (isUrgent) titleColor = 'text-rose-600 dark:text-rose-400';
    if (isCaution) titleColor = 'text-amber-600 dark:text-amber-500';

    let btnColor = 'bg-gray-900 hover:bg-gray-800 text-white shadow-lg shadow-gray-200 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:shadow-none';
    if (isUrgent) btnColor = 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-200 dark:shadow-none';

    return (
        <div className="flex flex-col items-start max-w-2xl mb-12">
            <h1 className={`text-[40px] md:text-[48px] font-bold leading-[1.15] mb-4 tracking-tight ${titleColor}`}>
                {config.title}
            </h1>
            <p className="text-[16px] md:text-[18px] text-gray-500 dark:text-gray-400 mb-8 font-medium">
                {config.subtitle}
            </p>
            
            <button 
                onClick={onActionClick}
                className={`group flex flex-row items-center justify-center gap-3 px-8 py-4 rounded-2xl text-base font-semibold transition-all ${btnColor}`}
            >
                {config.ctaText}
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
            </button>
        </div>
    );
};
