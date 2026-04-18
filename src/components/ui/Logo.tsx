/**
 * CUBELAB mark: an isometric cube in three ivory tones — lit top, mid-tone
 * left, shaded right — with the top face ruled into a 3×3 grid and its front
 * facelet left bright: the piece you are about to turn.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <path d="M32 6 55 19 32 32 9 19Z" fill="#e9e5dc" />
      <path d="M9 19 32 32v26L9 45Z" fill="#8f8b83" />
      <path d="M55 19 32 32v26l23-13Z" fill="#4c4a46" />
      <path
        d="M16.67 14.67 39.67 27.67M24.33 10.33 47.33 23.33M16.67 23.33 39.67 10.33M24.33 27.67 47.33 14.67"
        stroke="#0c0c0d"
        strokeOpacity="0.45"
        strokeWidth="1.2"
      />
      <path d="M24.33 27.67 32 23.33 39.67 27.67 32 32Z" fill="#ffffff" />
      <path d="M32 6 55 19v26L32 58 9 45V19Z M9 19 32 32 55 19 M32 32v26" fill="none" stroke="#0c0c0d" strokeOpacity="0.5" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
