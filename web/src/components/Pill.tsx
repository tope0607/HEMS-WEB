import type { ReactNode } from 'react';

export type PillTone = 'green' | 'amber' | 'red' | 'blue' | 'magenta' | 'neutral';

interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  title?: string;
}

/** Status pill: small coloured glyph + optical padding (image 8). */
export function Pill({ tone = 'neutral', children, dot = true, pulse = false, icon, title }: PillProps) {
  const toneClass = tone === 'neutral' ? '' : ` pill--${tone}`;
  return (
    <span className={`pill${toneClass}${!dot && !icon ? ' pill--plain' : ''}`} title={title}>
      {icon}
      {dot && !icon && <span className={`pill-dot${pulse ? ' pill-dot--pulse' : ''}`} />}
      {children}
    </span>
  );
}
