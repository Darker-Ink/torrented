import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const PlayGlyph = (props: P) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <path d="M7.5 4.6c-1-.6-2.2.1-2.2 1.3v12.2c0 1.2 1.2 1.9 2.2 1.3l10-6.1c1-.6 1-2 0-2.6z" />
  </svg>
);

export const PauseGlyph = (props: P) => (
  <svg {...base(props)} fill="currentColor" stroke="none">
    <rect x="5.5" y="4.5" width="4.5" height="15" rx="1.4" />
    <rect x="14" y="4.5" width="4.5" height="15" rx="1.4" />
  </svg>
);

const Skip = ({ forward, ...props }: P & { forward?: boolean }) => (
  <svg {...base(props)}>
    <g transform={forward ? "translate(24 0) scale(-1 1)" : undefined}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.5v3.8h3.8" />
    </g>
    <text
      x="12"
      y="15.6"
      textAnchor="middle"
      fontSize="7.2"
      fontWeight="800"
      fill="currentColor"
      stroke="none"
      fontFamily="Inter, system-ui, sans-serif"
    >
      10
    </text>
  </svg>
);

export const SkipBackGlyph = (props: P) => <Skip {...props} />;
export const SkipForwardGlyph = (props: P) => <Skip forward {...props} />;

export const VolumeGlyph = ({ level, ...props }: P & { level: number }) => (
  <svg {...base(props)}>
    <path d="M4 9.5h3l4.5-3.8v12.6L7 14.5H4z" fill="currentColor" />
    {level > 0 && <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />}
    {level > 0.5 && <path d="M17.8 7a7 7 0 0 1 0 10" />}
    {level === 0 && <path d="m16 9.5 5 5m0-5-5 5" />}
  </svg>
);

export const SubtitlesGlyph = (props: P) => (
  <svg {...base(props)}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7 13h4M13.5 13H17M7 16h7" />
  </svg>
);

export const AudioGlyph = (props: P) => (
  <svg {...base(props)}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </svg>
);

export const NextGlyph = (props: P) => (
  <svg {...base(props)}>
    <path d="M5 5.8c0-.8.9-1.3 1.6-.9l9 5.4c.7.4.7 1.4 0 1.8l-9 5.4c-.7.4-1.6-.1-1.6-.9z" fill="currentColor" />
    <path d="M19 5v14" />
  </svg>
);

export const ExpandGlyph = (props: P) => (
  <svg {...base(props)}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </svg>
);

export const CollapseGlyph = (props: P) => (
  <svg {...base(props)}>
    <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
  </svg>
);

export const InfoGlyph = (props: P) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.2" />
  </svg>
);

export const BackGlyph = (props: P) => (
  <svg {...base(props)}>
    <path d="M15 5 8 12l7 7" />
  </svg>
);
