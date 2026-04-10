import React from 'react'
import '../index.css'

interface SkeletonProps {
    width?: string | number
    height?: string | number
    borderRadius?: string | number
    style?: React.CSSProperties
}

function Skeleton({ width = '100%', height = '100%', borderRadius = 'var(--radius)', style = {} }: SkeletonProps) {
    return (
        <div
            className="skeleton-shimmer"
            style={{
                width,
                height,
                borderRadius,
                background: 'var(--bg-tertiary)',
                ...style
            }}
        />
    )
}

interface SkeletonTextProps {
    lines?: number
    gap?: number
}

function SkeletonText({ lines = 3, gap = 12 }: SkeletonTextProps) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    width={i === lines - 1 ? '60%' : '100%'}
                    height={16}
                    borderRadius={4}
                />
            ))}
        </div>
    )
}

export default React.memo(Skeleton)
export const SkeletonTextMemo = React.memo(SkeletonText)
export { SkeletonTextMemo as SkeletonText }
