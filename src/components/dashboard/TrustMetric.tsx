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
      ? 'var(--danger)'
      : accent === 'success'
      ? 'var(--success)'
      : 'var(--text-primary)';

  return (
    <div style={{
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      padding: '20px 24px',
    }}>
      <div style={{
        fontSize: 'clamp(36px, 5vw, 56px)',
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '-0.03em',
        color: valueColor,
      }}>
        {value}
      </div>

      <div style={{
        marginTop: 'var(--space)',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color: 'var(--text-secondary)',
      }}>
        {label}
      </div>

      {hint ? (
        <div style={{
          marginTop: 'var(--space-sm)',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--text-muted)',
        }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
};
