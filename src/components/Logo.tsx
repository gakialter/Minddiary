import React from 'react';

export interface LogoProps {
  size?: number | string;      // Enforces uniform scaling
  color?: string;              // Override 'currentColor'
  className?: string;          // Pass-through utility classes
  title?: string;              // Accessibility title
}

/**
 * 绝对原点 (The Core) 
 * MindDiary Brand Logo (Zen Forest Edition)
 * Reference docs/brand.md for usage guidelines.
 */
export default function Logo({ size = '100%', color = 'currentColor', className = '', title = 'MindDiary Logo' }: LogoProps) {
  return (
    <svg 
      viewBox="0 0 100 100" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className} 
      style={{ width: size, height: size, color: color }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="50" cy="50" r="16" fill="currentColor"/>
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="butt">
        <path d="M 50 18 A 32 32 0 0 1 77.7 34" />
        <path d="M 77.7 66 A 32 32 0 0 1 22.3 66" />
        <path d="M 22.3 34 A 32 32 0 0 1 50 18" />
      </g>
    </svg>
  );
}
