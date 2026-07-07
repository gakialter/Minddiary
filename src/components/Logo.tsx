import React from 'react';

export interface LogoProps {
  size?: number | string;      // Enforces uniform scaling
  color?: string;              // Override 'currentColor'
  className?: string;          // Pass-through utility classes
  title?: string;              // Accessibility title
}

/**
 * Quiet Orbit
 * MindDiary Brand Logo (Zen Forest Edition)
 *
 * A stable focus core held by three calm learning cycles.
 * The mark preserves the original Core identity while improving
 * small-size legibility, balance, and long-term brand distinctiveness.
 */
export default function Logo({ size = '100%', color = 'currentColor', className = '', title = 'MindDiary Logo' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ width: size, height: size, color }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="50" cy="50" r="13.5" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 50 16.5 A 33.5 33.5 0 0 1 79 33.25" />
        <path d="M 79 66.75 A 33.5 33.5 0 0 1 21 66.75" />
        <path d="M 21 33.25 A 33.5 33.5 0 0 1 50 16.5" />
      </g>
    </svg>
  );
}
