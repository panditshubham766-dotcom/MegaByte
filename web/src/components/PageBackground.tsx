export default function PageBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: `
          radial-gradient(circle at 10% 12%, rgba(196, 170, 255, 0.35) 0%, transparent 45%),
          radial-gradient(circle at 90% 88%, rgba(167, 150, 255, 0.28) 0%, transparent 45%),
          linear-gradient(160deg, #F6F2FF 0%, #EDE6FF 45%, #F3EEFF 100%)
        `
      }}
    >
      {/* 3 or 4 large smooth organic wave shapes with linearGradients and 1px white highlight curves */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      >
        <defs>
          <linearGradient id="waveGrad1" x1="0%" y1="20%" x2="100%" y2="80%">
            <stop offset="0%" stopColor="#D9CCFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#A99BF5" stopOpacity="0.35" />
          </linearGradient>

          <linearGradient id="waveGrad2" x1="100%" y1="10%" x2="0%" y2="90%">
            <stop offset="0%" stopColor="#A99BF5" stopOpacity="0.50" />
            <stop offset="100%" stopColor="#D9CCFF" stopOpacity="0.38" />
          </linearGradient>

          <linearGradient id="waveGrad3" x1="0%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#D9CCFF" stopOpacity="0.60" />
            <stop offset="100%" stopColor="#A99BF5" stopOpacity="0.45" />
          </linearGradient>

          <linearGradient id="waveGrad4" x1="20%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E4DAFF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#B2A3F8" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* Wave 4 (Background deep swell) */}
        <path
          d="M 0 340 C 260 360, 520 490, 800 550 C 1080 610, 1260 630, 1440 680 L 1440 900 L 0 900 Z"
          fill="url(#waveGrad4)"
        />

        {/* Wave 1 (Large organic wave swooping from left edge across lower half) */}
        <path
          d="M 0 470 C 190 580, 460 710, 780 700 C 1060 690, 1260 670, 1440 710 L 1440 900 L 0 900 Z"
          fill="url(#waveGrad1)"
        />

        {/* Wave 1 Thin 1px white curve along the top edge (opacity .6) */}
        <path
          d="M 0 470 C 190 580, 460 710, 780 700 C 1060 690, 1260 670, 1440 710"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          strokeOpacity="0.6"
        />

        {/* Wave 2 (Large organic wave rising from lower right sweeping towards center) */}
        <path
          d="M 1440 430 C 1260 560, 1000 680, 720 780 C 460 870, 220 870, 0 880 L 0 900 L 1440 900 Z"
          fill="url(#waveGrad2)"
        />

        {/* Wave 2 Thin 1px white curve along the top edge (opacity .6) */}
        <path
          d="M 1440 430 C 1260 560, 1000 680, 720 780 C 460 870, 220 870, 0 880"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          strokeOpacity="0.6"
        />

        {/* Wave 3 (Foreground smooth organic billow) */}
        <path
          d="M 0 620 C 240 720, 540 810, 880 820 C 1140 830, 1320 840, 1440 860 L 1440 900 L 0 900 Z"
          fill="url(#waveGrad3)"
        />
      </svg>

      {/* Decorative subtle orbit ring around medium orb */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(19vh - 45px)',
          left: 'calc(8vw - 45px)',
          width: '200px',
          height: '200px',
          borderRadius: '50%',
          border: '1px solid rgba(255, 255, 255, 0.45)',
          opacity: 0.6,
          pointerEvents: 'none'
        }}
      />

      {/* Orb 1: Large circle (about 280px) at top right, partly off-screen */}
      <div
        style={{
          position: 'absolute',
          top: '15vh',
          right: '-70px',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3C9FF 32%, #CDBDFF 65%, #A99BF5 100%)',
          boxShadow: `
            16px 20px 40px rgba(110, 90, 200, 0.28),
            -6px -6px 16px rgba(255, 255, 255, 0.9),
            inset 4px 4px 8px rgba(255, 255, 255, 0.9),
            inset -8px -8px 18px rgba(100, 75, 175, 0.32)
          `,
          pointerEvents: 'none'
        }}
      />

      {/* Orb 2: Medium circle (about 110px) at the left, below the top bar */}
      <div
        style={{
          position: 'absolute',
          top: '19vh',
          left: '8vw',
          width: '110px',
          height: '110px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3C9FF 32%, #CDBDFF 65%, #A99BF5 100%)',
          boxShadow: `
            10px 14px 28px rgba(110, 90, 200, 0.26),
            -4px -4px 10px rgba(255, 255, 255, 0.95),
            inset 3px 3px 6px rgba(255, 255, 255, 0.85),
            inset -5px -5px 12px rgba(100, 75, 175, 0.30)
          `,
          pointerEvents: 'none'
        }}
      />

      {/* Orb 3: Small circle (about 60px) at the right, mid-height */}
      <div
        style={{
          position: 'absolute',
          top: '53vh',
          right: '18vw',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3C9FF 32%, #CDBDFF 65%, #A99BF5 100%)',
          boxShadow: `
            8px 10px 20px rgba(110, 90, 200, 0.24),
            -3px -3px 8px rgba(255, 255, 255, 0.95),
            inset 2px 2px 4px rgba(255, 255, 255, 0.85),
            inset -3px -3px 8px rgba(100, 75, 175, 0.28)
          `,
          pointerEvents: 'none'
        }}
      />
    </div>
  );
}
