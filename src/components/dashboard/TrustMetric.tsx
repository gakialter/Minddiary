import React from 'react';

interface TrustMetricProps {
    value: string | number;
    label: string;
    trend?: string; // Optional e.g., '+9% 较上周'
    color?: string; // e.g., 'text-indigo-600' or default to 'text-gray-900 dark:text-white'
}

export const TrustMetric: React.FC<TrustMetricProps> = ({ value, label, trend, color = 'text-gray-900 dark:text-white' }) => {
    return (
        <div className="flex flex-col items-start">
            <div className={`text-[64px] font-bold font-sans tracking-tighter leading-none mb-1 ${color}`}>
                {value}
            </div>
            <div className="text-gray-500 dark:text-gray-400 text-[13px] font-medium tracking-wide">
                {label}
            </div>
            {trend && (
                <div className="text-gray-400 dark:text-gray-500 text-[11px] mt-1">
                    {trend}
                </div>
            )}
        </div>
    );
};
