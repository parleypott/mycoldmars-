// Newpress Deck — shared primitives

const Chrome = ({ num, total, section = "NEWPRESS · FUNDRAISING 2026", right = "CONFIDENTIAL" }) => (
  <div className="slide-chrome">
    <div className="slide-chrome__top">
      <div className="slide-chrome__brand">
        <img src="assets/icons/Newpress_Icon_Black.png" className="brand-icon" alt="" />
        <span>newpress</span>
      </div>
      <div>{right}</div>
    </div>
    <div className="slide-chrome__bottom">
      <div className="slide-chrome__bottom-left">
        <span>{section}</span>
      </div>
      <div className="slide-chrome__folio">
        <span className="num">{String(num).padStart(2,'0')}</span>
        <span style={{opacity:0.4, margin:'0 8px'}}>/</span>
        <span className="num" style={{opacity:0.5}}>{String(total).padStart(2,'0')}</span>
      </div>
    </div>
  </div>
);

// Ink-theme variant of chrome uses white icon
const ChromeInk = ({ num, total, section = "NEWPRESS · FUNDRAISING 2026", right = "CONFIDENTIAL" }) => (
  <div className="slide-chrome">
    <div className="slide-chrome__top">
      <div className="slide-chrome__brand">
        <img src="assets/icons/Newpress_Icon_White.png" className="brand-icon" alt="" />
        <span>newpress</span>
      </div>
      <div>{right}</div>
    </div>
    <div className="slide-chrome__bottom">
      <div className="slide-chrome__bottom-left">
        <span>{section}</span>
      </div>
      <div className="slide-chrome__folio">
        <span className="num">{String(num).padStart(2,'0')}</span>
        <span style={{opacity:0.4, margin:'0 8px'}}>/</span>
        <span className="num" style={{opacity:0.5}}>{String(total).padStart(2,'0')}</span>
      </div>
    </div>
  </div>
);

const Eyebrow = ({ children, color="red", style }) => (
  <div className={`eyebrow eyebrow--${color}`} style={style}>{children}</div>
);

// A labelled placeholder box (for creator headshots, thumbnails, etc.)
const PH = ({ label = "Image", sub, style, dark=false, neutral=false, w, h }) => (
  <div className={`ph ${dark ? 'ph--dark' : ''} ${neutral ? 'ph--neutral' : ''}`} style={{width: w, height: h, ...style}}>
    <div style={{textAlign:'center', padding: 12}}>
      <div>{label}</div>
      {sub && <div style={{fontSize: 11, opacity: 0.7, marginTop: 6, letterSpacing:'0.14em'}}>{sub}</div>}
    </div>
  </div>
);

// Stylized growth line chart
const GrowthChart = ({ stroke = "#121118", accent = "#DD2C1E", bg = "transparent", labelColor = "#121118", years = ["'21","'22","'23","'24","'25"] }) => {
  // baseline up-and-to-the-right with accelerating tail
  const points = [
    [60, 420], [170, 405], [280, 385], [390, 355], [500, 318],
    [610, 270], [720, 215], [830, 160], [940, 110], [1040, 68]
  ];
  const polyPts = points.map(p => p.join(',')).join(' ');
  const areaPts = `60,460 ${polyPts} 1040,460`;

  return (
    <svg viewBox="0 0 1280 480" className="chart-svg" style={{width:'100%', height:'auto', background: bg}}>
      {/* gridlines */}
      {[0, 100, 200, 300, 400].map((y, i) => (
        <line key={i} x1="60" x2="1040" y1={60 + y * 0.9} y2={60 + y * 0.9}
              stroke={stroke} strokeWidth="1" opacity="0.15" />
      ))}
      {/* Y labels */}
      {[
        {y: 68,  t: "15M"},
        {y: 158, t: "10M"},
        {y: 248, t: "5M"},
        {y: 338, t: "1M"},
        {y: 440, t: "0"},
      ].map((d, i) => (
        <text key={i} x="40" y={d.y + 4} textAnchor="end"
          fontFamily="JetBrains Mono, monospace" fontSize="16" fill={labelColor} opacity="0.65">{d.t}</text>
      ))}
      {/* X labels */}
      {years.map((y, i) => {
        const x = 60 + (i * (980 / (years.length - 1)));
        return (
          <text key={i} x={x} y="472" textAnchor="middle"
            fontFamily="JetBrains Mono, monospace" fontSize="16" fill={labelColor} opacity="0.65">{y}</text>
        );
      })}
      {/* area fill */}
      <polygon points={areaPts} fill={accent} opacity="0.08" />
      {/* line */}
      <polyline points={polyPts} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={accent} />
      ))}
      {/* terminal marker */}
      <circle cx="1040" cy="68" r="10" fill="none" stroke={accent} strokeWidth="2" />
      <text x="1058" y="48" fontFamily="PP Editorial New, Gloock, serif" fontSize="34" fill={accent}>15M</text>
      <text x="1058" y="72" fontFamily="JetBrains Mono, monospace" fontSize="13" fill={labelColor} opacity="0.7" letterSpacing="2">SUBSCRIBERS</text>
    </svg>
  );
};

// A single channel growth mini-chart (for playbook slide)
const ChannelChart = ({ stroke = "#121118", accent = "#DD2C1E", ramp = "slow", label, compact = false }) => {
  // Slow ramp vs fast ramp
  const points = ramp === "slow" ? [
    [20, 220], [60, 212], [100, 200], [150, 185], [200, 165], [260, 140], [320, 110], [380, 75], [440, 40]
  ] : [
    [20, 220], [60, 195], [100, 160], [150, 118], [200, 80], [260, 55], [320, 38], [380, 28], [440, 20]
  ];
  const polyPts = points.map(p => p.join(',')).join(' ');
  return (
    <svg viewBox="0 0 460 260" style={{width:'100%', display:'block'}}>
      <line x1="20" x2="440" y1="240" y2="240" stroke={stroke} strokeWidth="1" opacity="0.25" />
      <line x1="20" x2="20" y1="20" y2="240" stroke={stroke} strokeWidth="1" opacity="0.25" />
      <polyline points={polyPts} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={accent} />
      ))}
      {label && (
        <text x="440" y={points[points.length-1][1] - 12} textAnchor="end"
          fontFamily="JetBrains Mono, monospace" fontSize="13" fill={accent}>{label}</text>
      )}
    </svg>
  );
};

// Stacked-date element (vertical)
const DateStamp = ({ date = "APR 2026", time = "FUNDRAISING" }) => (
  <div className="rail-left" style={{color: 'var(--np-blue)'}}>
    <span>{date} · {time}</span>
  </div>
);

Object.assign(window, { Chrome, ChromeInk, Eyebrow, PH, GrowthChart, ChannelChart, DateStamp });
