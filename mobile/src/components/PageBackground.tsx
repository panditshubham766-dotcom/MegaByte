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
      {/* Soft organic wave shapes adapted for 390x844 phone screen */}
      <svg
        viewBox="0 0 390 844"
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
          <linearGradient id="mWaveGrad1" x1="0%" y1="20%" x2="100%" y2="80%">
            <stop offset="0%" stopColor="#D9CCFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#A99BF5" stopOpacity="0.38" />
          </linearGradient>

          <linearGradient id="mWaveGrad2" x1="100%" y1="10%" x2="0%" y2="90%">
            <stop offset="0%" stopColor="#A99BF5" stopOpacity="0.50" />
            <stop offset="100%" stopColor="#D9CCFF" stopOpacity="0.35" />
          </linearGradient>

          <linearGradient id="mWaveGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D9CCFF" stopOpacity="0.60" />
            <stop offset="100%" stopColor="#A99BF5" stopOpacity="0.42" />
          </linearGradient>
        </defs>

        {/* Wave 1: Gentle organic wave swooping from left across lower half */}
        <path
          d="M 0 460 C 80 530, 190 620, 290 610 C 340 605, 370 615, 390 630 L 390 844 L 0 844 Z"
          fill="url(#mWaveGrad1)"
        />

        {/* Wave 1 Crest highlight curve */}
        <path
          d="M 0 460 C 80 530, 190 620, 290 610 C 340 605, 370 615, 390 630"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1"
          strokeOpacity="0.6"
        />

        {/* Wave 2: Rising billow from lower right sweeping towards left */}
        <path
          d="M 390 530 C 310 610, 210 690, 120 740 C 60 775, 25 790, 0 800 L 0 844 L 390 844 Z"
          fill="url(#mWaveGrad2)"
        />

        {/* Wave 2 Crest highlight curve */}
        <path
          d="M 390 530 C 310 610, 210 690, 120 740 C 60 775, 25 790, 0 800"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1"
          strokeOpacity="0.6"
        />

        {/* Wave 3: Foreground smooth bottom billow */}
        <path
          d="M 0 680 C 110 740, 230 780, 390 770 L 390 844 L 0 844 Z"
          fill="url(#mWaveGrad3)"
        />
      </svg>

      {/* Orb 1: Large circle (about 200px) at top right, partly off-screen */}
      <div
        style={{
          position: 'absolute',
          top: '8vh',
          right: '-55px',
          width: '200px',
          height: '200px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3C9FF 32%, #CDBDFF 65%, #A99BF5 100%)',
          boxShadow: `
            12px 14px 28px rgba(110, 90, 200, 0.25),
            -4px -4px 10px rgba(255, 255, 255, 0.9),
            inset 3px 3px 6px rgba(255, 255, 255, 0.9),
            inset -5px -5px 12px rgba(100, 75, 175, 0.30)
          `,
          pointerEvents: 'none'
        }}
      />

      {/* Orb 2: Small circle (about 60px) at lower left */}
      <div
        style={{
          position: 'absolute',
          bottom: '15vh',
          left: '6vw',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3C9FF 32%, #CDBDFF 65%, #A99BF5 100%)',
          boxShadow: `
            8px 10px 20px rgba(110, 90, 200, 0.22),
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
