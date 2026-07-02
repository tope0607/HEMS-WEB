/** Inline icon set — 1.5px strokes, sized by the `size` prop. No emoji, ever. */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const BoltIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M13.5 2 5.5 13.5h5L9 22l8-11.5h-5l1.5-8.5z" />
  </svg>
);

export const SunIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
  </svg>
);

export const MoonIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20 13.6A8.2 8.2 0 0 1 10.4 4 8.2 8.2 0 1 0 20 13.6z" />
  </svg>
);

export const LogoutIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h-8v16h8M10 12h11M17.5 8.5 21 12l-3.5 3.5" />
  </svg>
);

export const ShieldIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M12 2 4.5 5v6.1c0 4.5 3.1 8.6 7.5 9.9 4.4-1.3 7.5-5.4 7.5-9.9V5L12 2z" />
  </svg>
);

export const AlertIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5 1.9 20h20.2L12 3.5z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none" />
  </svg>
);

export const WifiOffIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M2 8.5a15 15 0 0 1 8-3.4M14.5 5.5A15 15 0 0 1 22 8.5M5.5 12.5a10 10 0 0 1 4-2M14.5 10.5a10 10 0 0 1 4 2M8.8 16.2a5 5 0 0 1 6.4 0" />
    <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
    <path d="M3 3l18 18" />
  </svg>
);

export const DownloadIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11M7.5 11.5 12 15l4.5-3.5M4.5 19.5h15" />
  </svg>
);

export const PowerIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v8" />
    <path d="M7 6.4a7.5 7.5 0 1 0 10 0" />
  </svg>
);

export const CheckIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const CircuitIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="18" cy="18" r="2.2" />
    <path d="M8.2 6H15a3 3 0 0 1 3 3v6.8M6 8.2V15a3 3 0 0 0 3 3h6.8" />
  </svg>
);
