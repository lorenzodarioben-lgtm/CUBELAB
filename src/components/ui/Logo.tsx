/**
 * CUBELAB mark: an isometric cube drawn as three faces, the top face carrying a
 * single lit facelet — the one piece you are about to turn.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <defs>
        <linearGradient id="lm-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f1ff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#b9adff" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="lm-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8f84d8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#4b437e" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="lm-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd6e8" stopOpacity="0.45" />
          <stop offset="1" stopColor="#2c5f73" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <path d="M32 6 55 19 32 32 9 19Z" fill="url(#lm-top)" />
      <path d="M9 19 32 32v26L9 45Z" fill="url(#lm-left)" />
      <path d="M55 19 32 32v26l23-13Z" fill="url(#lm-right)" />
      <path d="M32 6 55 19v26L32 58 9 45V19Z M9 19 32 32 55 19 M32 32v26" fill="none" stroke="#eeeaff" strokeOpacity="0.55" strokeWidth="1.4" strokeLinejoin="round" />
      <path
        d="M16.67 14.67 39.67 27.67M24.33 10.33 47.33 23.33M16.67 23.33 39.67 10.33M24.33 27.67 47.33 14.67"
        stroke="#0b0c12"
        strokeOpacity="0.32"
        strokeWidth="1.1"
      />
      <path d="M24.33 27.67 32 23.33 39.67 27.67 32 32Z" fill="#7fe3f2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark />
      <span className="wordmark__text">CUBELAB</span>
    </span>
  );
}
