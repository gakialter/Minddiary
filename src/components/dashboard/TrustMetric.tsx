import React from 'react';

export type TrustMetricProps = {
  value: string | number;
  label: string;
  hint?: string;
  accent?: 'default' | 'danger' | 'success';
};

export const TrustMetric: React.FC<TrustMetricProps> = ({
  value,
  label,
  hint,
  accent = 'default',
}) => {
  const valueColor =
    accent === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : accent === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-gray-950 dark:text-gray-100';

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-5 md:px-6 md:py-6">
      <div className={`text-[44px] font-bold leading-none tracking-[-0.03em] md:text-[56px] ${valueColor}`}>
        {value}
      </div>

      <div className="mt-3 text-[13px] font-medium tracking-[0.01em] text-gray-500 dark:text-gray-400">
        {label}
      </div>

      {hint ? (
        <div className="mt-2 text-xs leading-5 text-gray-400 dark:text-gray-500">
          {hint}
        </div>
      ) : null}
    </div>
  );
};
