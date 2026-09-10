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
  return (
    <div className="today-action-trust-metric" data-accent={accent}>
      <div className="today-action-trust-metric__label">
        <span className="today-action-trust-metric__mark" aria-hidden="true" />
        {label}
      </div>
      <div className="today-action-trust-metric__value">
        {value}
      </div>
      {hint ? (
        <div className="today-action-trust-metric__hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
};
