type Props = {
  testId: string;
};

export function FieldGuideChrome({ testId }: Props) {
  return (
    <div className="er-field-guide-chrome" data-testid={testId} aria-hidden="true">
      <span className="er-chrome-compass" data-testid="chrome-compass">
        <svg viewBox="0 0 96 96" fill="none">
          <circle cx="48" cy="48" r="36" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="48" cy="48" r="22" stroke="currentColor" strokeWidth="0.8" />
          <path d="M48 8v12M48 76v12M8 48h12M76 48h12" stroke="currentColor" strokeWidth="1.2" />
          <path d="M20 20l8 8M68 20l-8 8M20 76l8-8M68 76l-8-8" stroke="currentColor" strokeWidth="1" />
          <path d="M48 18 52 48 48 78 44 48Z" fill="currentColor" opacity="0.55" />
          <path d="M18 48 48 44 78 48 48 52Z" fill="currentColor" opacity="0.28" />
        </svg>
      </span>
      <span className="er-chrome-mountain" data-testid="chrome-mountain">
        <svg viewBox="0 0 320 90" preserveAspectRatio="none">
          <path
            d="M0 90 38 46 62 64 108 18 148 54 186 28 228 66 262 40 320 90Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="er-chrome-forest" data-testid="chrome-forest">
        <svg viewBox="0 0 320 70" preserveAspectRatio="xMidYMax meet">
          <path d="M18 70 18 58 4 58 22 28 40 58 26 58 26 70Z" fill="currentColor" />
          <path d="M58 70 58 54 42 54 64 18 86 54 70 54 70 70Z" fill="currentColor" />
          <path d="M104 70 104 56 90 56 110 24 130 56 116 56 116 70Z" fill="currentColor" />
          <path d="M154 70 154 52 136 52 160 14 184 52 166 52 166 70Z" fill="currentColor" />
          <path d="M206 70 206 56 192 56 212 26 232 56 218 56 218 70Z" fill="currentColor" />
          <path d="M250 70 250 54 234 54 256 20 278 54 262 54 262 70Z" fill="currentColor" />
          <path d="M294 70 294 58 280 58 298 30 316 58 302 58 302 70Z" fill="currentColor" />
        </svg>
      </span>
      <span className="er-chrome-leaf" data-testid="chrome-leaf">
        <svg viewBox="0 0 48 72" fill="none">
          <path d="M22 70C22 46 24 28 36 8" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M24 58c-10-2-16-10-14-16 8 1 16 8 14 16Z"
            fill="currentColor"
            opacity="0.85"
          />
          <path
            d="M26 44c-9-4-12-14-8-18 8 3 14 11 8 18Z"
            fill="currentColor"
            opacity="0.75"
          />
          <path
            d="M28 30c-7-5-8-14-4-18 7 4 11 12 4 18Z"
            fill="currentColor"
            opacity="0.7"
          />
        </svg>
      </span>
      <p className="er-chrome-motto">Discover Interpret Serve</p>
    </div>
  );
}
