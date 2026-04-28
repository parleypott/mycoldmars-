// Slides 1–8

// ======================================================================
// SLIDE 1 — COVER (variants A, B, C)
// ======================================================================
const Slide01_CoverA = ({ num, total }) =>
<section className="slide" data-theme="paper">
    <Chrome num={num} total={total} right="FUNDRAISING · SPRING 2026" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: '1fr auto', paddingLeft: 48 }}>
      <div style={{ alignSelf: 'center', display: 'grid', gridTemplateColumns: '1fr auto', gap: 80, alignItems: 'center', paddingRight: 48 }}>
        <div>
          <img src="assets/logo/Newpress_Logo_Black.png" alt="newpress" style={{ width: 1000, maxWidth: '100%', height: 'auto', display: 'block', margin: 0 }} />
          <div style={{ marginTop: 40, display: 'flex', gap: 32, alignItems: 'center' }}>
            <div className="display-s serif"><em className="italic" style={{ color: 'var(--np-red)' }}>Reimagining</em> <em className="italic" style={{ color: 'var(--np-ink)' }}>journalism.</em></div>
          </div>
        </div>
        <figure style={{ margin: 0, width: 560 }}>
          <div style={{ width: 560, aspectRatio: '16 / 9', overflow: 'hidden', border: '1px solid var(--np-ink)' }}>
            <img src="assets/creators/creator-portrait.gif" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        </figure>
      </div>
      <div style={{ paddingBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 32, borderTop: '1px solid var(--np-ink)', paddingTop: 20 }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--np-blue)', marginBottom: 8 }}>Vol.</div>
          <div className="mono body">Series A · 2026</div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: 'var(--np-blue)', marginBottom: 8 }}>Verticals</div>
          <div className="mono body">News, Analysis, Culture, Sports</div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: 'var(--np-blue)', marginBottom: 8 }}>Audience</div>
          <div className="mono body">14,000,000+</div>
        </div>
      </div>
    </div>
  </section>;
const Slide01_CoverB = ({ num, total }) =>
<section className="slide" data-theme="ink" style={{ padding: 0 }}>
    <ChromeInk num={num} total={total} right="FUNDRAISING · SPRING 2026" />
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'stretch' }}>
      <div style={{ padding: '120px 72px 72px 96px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <img src="assets/logo/Newpress_Logo_Black.png" alt="newpress" style={{ width: 820, height: 'auto', display: 'block', marginTop: 32, filter: 'invert(1)' }} />
        </div>
        <div>
          <div style={{ borderTop: '2px solid var(--np-warm-white)', paddingTop: 24, maxWidth: 720 }}>
            <div className="display-m serif italic">"Reimagining journalism."</div>
            <div className="eyebrow" style={{ marginTop: 24, color: 'var(--np-warm-white)', opacity: 0.6 }}>Series B · Confidential · 2026</div>
          </div>
        </div>
      </div>
      <div style={{ background: 'var(--np-burgundy)', borderLeft: '1px solid var(--np-warm-white)', padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="mono" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 14, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--np-yellow)' }}>
            FOR STRATEGIC PARTNERS · APR 2026
          </div>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <img src="assets/icons/Newpress_Icon_Burgundy-Yellow.png" style={{ width: 360, height: 'auto' }} alt="" />
        </div>
        <div className="mono body-sm" style={{ color: 'var(--np-warm-white)', opacity: 0.8, maxWidth: 440 }}>
          A movement to rebuild trust, transparency, and collaboration in journalism.
        </div>
      </div>
    </div>
  </section>;


const Slide01_CoverC = ({ num, total }) =>
<section className="slide" data-theme="paper" style={{ padding: 0 }}>
    <Chrome num={num} total={total} right="FUNDRAISING · SPRING 2026" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
      <div style={{ borderBottom: '1px solid var(--np-ink)', padding: '80px 96px 28px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <div className="mono caps" style={{ fontSize: 14, letterSpacing: '0.28em' }}>Vol. 01 — The Pitch</div>
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow eyebrow--red">Fundraising Edition</div>
        </div>
        <div className="mono caps" style={{ fontSize: 14, letterSpacing: '0.28em', textAlign: 'right' }}>April 2026</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 80, textAlign: 'center' }}>
        <img src="assets/logo/Newpress_Logo_Black.png" alt="newpress" style={{ width: 'min(1500px, 90%)', height: 'auto', display: 'block', margin: 0 }} />
        <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 80, borderTop: '1px solid var(--np-ink)' }} />
          <div className="display-s serif" style={{ fontStyle: 'italic' }}>Reimagining journalism.</div>
          <div style={{ width: 80, borderTop: '1px solid var(--np-ink)' }} />
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--np-ink)', padding: '28px 96px 80px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 48 }}>
        <div>
          <div className="eyebrow eyebrow--blue" style={{ marginBottom: 10 }}>The Problem</div>
          <div className="mono body-sm">Trust in institutions is broken.</div>
        </div>
        <div>
          <div className="eyebrow eyebrow--blue" style={{ marginBottom: 10 }}>The Solution</div>
          <div className="mono body-sm">A newsroom built around creators.</div>
        </div>
        <div>
          <div className="eyebrow eyebrow--blue" style={{ marginBottom: 10 }}>The Traction</div>
          <div className="mono body-sm">15M+ subscribers, capital-efficient.</div>
        </div>
      </div>
    </div>
  </section>;


// ======================================================================
// SLIDE 2 — PROBLEM (variants)
// ======================================================================
const Slide02_ProblemA = ({ num, total }) =>
<section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="01 · THE PROBLEM" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 48, paddingLeft: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, paddingTop: 40 }}>
        <div className="slide-num-hero" style={{ fontSize: 180, color: 'var(--np-red)', opacity: 0.9 }}>№01</div>
        <div>
          <Eyebrow>The Problem</Eyebrow>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 80, alignItems: 'start', borderTop: '1px solid var(--np-ink)', paddingTop: 48 }}>
        <div>
          <h2 className="serif" style={{ fontSize: 108, lineHeight: 0.98, letterSpacing: '-0.025em', margin: 0 }}>
            People no longer trust <em className="italic" style={{ color: 'var(--np-red)', paddingRight: '0.15em' }}>institutions.</em><br />
            They trust <em className="italic" style={{ paddingRight: '0.15em' }}>people.</em>
          </h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ borderTop: '4px solid var(--np-red)', paddingTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div className="serif" style={{ fontSize: 200, lineHeight: 0.86, letterSpacing: '-0.04em', color: 'var(--np-red)', margin: 0 }}>28<span style={{ fontSize: '0.6em', verticalAlign: 'top', letterSpacing: '-0.05em' }}>%</span></div>
            <div className="mono body" style={{ marginTop: 24, maxWidth: 560, fontSize: 24, lineHeight: 1.35 }}>of Americans have confidence in mass media — a record low.</div>
            <div className="eyebrow" style={{ marginTop: 16, opacity: 0.55 }}>GALLUP, 2025</div>
          </div>
        </div>
      </div>
    </div>
  </section>;


const Slide02_ProblemB = ({ num, total }) =>
<section className="slide" data-theme="burgundy">
    <ChromeInk num={num} total={total} section="01 · THE PROBLEM" />
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', paddingLeft: 48 }}>
      <div style={{ maxWidth: 1500, textAlign: 'center' }}>
        <Eyebrow color="yellow">The Problem</Eyebrow>
        <h2 className="serif" style={{ fontSize: 180, lineHeight: 0.92, letterSpacing: '-0.03em', margin: '40px 0 0', color: 'var(--np-warm-white)' }}>
          People no longer trust<br />
          <em className="italic" style={{ color: 'var(--np-yellow)' }}>institutions.</em><br />
          They trust <em className="italic">people.</em>
        </h2>
        <div style={{ marginTop: 64, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 64, borderTop: '1px solid var(--np-warm-white)', paddingTop: 40 }}>
          <div>
            <div className="display-l serif" style={{ color: 'var(--np-yellow)' }}>32%</div>
            <div className="mono body-sm" style={{ opacity: 0.85, marginTop: 8 }}>trust mass media (all-time low)</div>
          </div>
          <div>
            <div className="display-l serif" style={{ color: 'var(--np-yellow)' }}>61%</div>
            <div className="mono body-sm" style={{ opacity: 0.85, marginTop: 8 }}>trust a creator more than an outlet</div>
          </div>
          <div>
            <div className="display-l serif" style={{ color: 'var(--np-yellow)' }}>2×</div>
            <div className="mono body-sm" style={{ opacity: 0.85, marginTop: 8 }}>creator engagement vs. institutional</div>
          </div>
        </div>
      </div>
    </div>
  </section>;


// ======================================================================
// SLIDE 3 — IMPACT
// ======================================================================
const Slide03_Impact = ({ num, total }) =>
<section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="02 · THE IMPACT" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 48, paddingLeft: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, paddingTop: 40 }}>
        <div className="slide-num-hero" style={{ fontSize: 180, color: 'var(--np-red)', opacity: 0.9 }}>№02</div>
        <div>
          <Eyebrow>The Impact</Eyebrow>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 72, alignItems: 'start', borderTop: '1px solid var(--np-ink)', paddingTop: 56 }}>
        <div>
          <h2 className="serif" style={{ fontSize: 112, lineHeight: 0.95, letterSpacing: '-0.02em', margin: 0 }}>
            The audience moved to <em className="italic" style={{ color: 'var(--np-red)' }}>creators.</em> Media hasn’t caught{' '}up.
          </h2>
          <div className="density-only-dense density-only-medium" style={{ marginTop: 40, borderTop: '1px solid var(--np-rule-faint)', paddingTop: 24 }}>
            <blockquote className="serif italic" style={{ fontSize: 32, lineHeight: 1.2, margin: 0, borderLeft: '4px solid var(--np-red)', paddingLeft: 24, maxWidth: 720 }}>
              "Print circulation has fallen by more than 50% since 2005, and editorial headcount with it."
            </blockquote>
            <div className="eyebrow" style={{ marginTop: 12, opacity: 0.5 }}>SOURCE · [TK]</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32, justifyContent: 'center' }}>
          <div style={{ borderTop: '4px solid var(--np-red)', paddingTop: 20 }}>
            <div className="display-xl serif" style={{ color: 'var(--np-red)' }}>54%</div>
            <div className="mono body-sm" style={{ marginTop: 8, opacity: 0.8 }}>of Americans now access news via social or video networks, surpassing TV (50%) and news websites/apps (48%) for the first time.</div>
            <div className="eyebrow" style={{ marginTop: 12, opacity: 0.5 }}>REUTERS INSTITUTE DIGITAL NEWS REPORT, 2025</div>
          </div>
          <div style={{ borderTop: '1px solid var(--np-ink)', paddingTop: 20 }}>
            <div className="display-xl serif">70%</div>
            <div className="mono body-sm" style={{ marginTop: 8, opacity: 0.8 }}>of news executives say creators are taking audience attention away from publishers.</div>
            <div className="eyebrow" style={{ marginTop: 12, opacity: 0.5 }}>NIEMAN JOURNALISM LAB / REUTERS INSTITUTE TRENDS REPORT</div>
          </div>
        </div>
      </div>
    </div>
  </section>;


// ======================================================================
// SLIDE 4 — SOLUTION
// ======================================================================
const Slide04_Solution = ({ num, total }) =>
<section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="03 · THE SOLUTION" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 40, paddingLeft: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, paddingTop: 40 }}>
        <div className="slide-num-hero" style={{ fontSize: 180, color: 'var(--np-red)', opacity: 0.9 }}>№03</div>
        <div>
          <Eyebrow>The Solution</Eyebrow>
        </div>
      </div>
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 1200 }}>
          <div className="mono caps" style={{ fontSize: 22, letterSpacing: '0.3em', color: 'var(--np-blue)', marginBottom: 48 }}>Introducing</div>
          <img src="assets/logo/Newpress_Logo_Black.png" alt="newpress" style={{ width: 780, height: 'auto', display: 'block', margin: '0 auto' }} />
          <div style={{ marginTop: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
            <div style={{ width: 48, borderTop: '1px solid var(--np-ink)', opacity: 0.4 }} />
            <div className="serif italic" style={{ fontSize: 48, lineHeight: 1.1, letterSpacing: '-0.015em', color: 'var(--np-red)' }}>
              Creator-led Media
            </div>
            <div style={{ width: 48, borderTop: '1px solid var(--np-ink)', opacity: 0.4 }} />
          </div>
        </div>
      </div>
    </div>
  </section>;


// ======================================================================
// SLIDE 5 — HOW IT WORKS
// ======================================================================
const Slide05_HowItWorks = ({ num, total }) => {
  const pillars = [
  {
    tag: "01",
    title: "Creator-Led",
    body: "We build shows around world-class journalists, reflecting their unique voice and journalistic style. Newpress owns all IP and the creator participates in a revenue share once the channel becomes profitable.",
    color: "var(--np-red)",
    kicker: "The Byline"
  },
  {
    tag: "02",
    title: "Editorial Standards",
    body: "Newpress provides creators with all the editorial support you would find in a traditional newsroom: reporting, fact-checking, story editing, and production supervision. This results in shows that are consistently high quality and high trust.",
    color: "var(--np-blue)",
    kicker: "The Rigor"
  },
  {
    tag: "03",
    title: "Quality Over Quantity",
    body: "In a media world built on speed, outrage, and volume — we slow down to connect the dots. Our work helps audiences see the bigger picture and understand the systems, context, and forces that shape the news they encounter every day. This approach, combined with balance and rigor, wins both the algorithm and the audience.",
    color: "var(--np-burgundy)",
    kicker: "The Edit"
  },
  {
    tag: "04",
    title: "Digitally Native",
    body: "Newpress content is built by internet natives, for internet platforms. We come to the table with deep expertise and knowledge of how people consume media online. Every show is video-first, visually stunning, and built for the platforms where people increasingly consume information.",
    color: "var(--np-green)",
    kicker: "The Platform"
  }];

  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="04 · HOW IT WORKS" />
      <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: 40, paddingLeft: 48 }}>
        <div style={{ paddingTop: 40 }}>
          <Eyebrow>How It Works</Eyebrow>
        </div>
        <h2 className="serif" style={{ fontSize: 92, lineHeight: 0.98, letterSpacing: '-0.02em', margin: 0, maxWidth: 1600 }}>
          A new model for trusted media, built on four pillars.
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32, alignSelf: 'center' }}>
          {pillars.map((p, i) =>
          <div key={i} style={{ borderTop: `4px solid ${p.color}`, paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 420 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span className="mono caps" style={{ fontSize: 13, letterSpacing: '0.24em', color: p.color }}>{p.tag} · {p.kicker}</span>
              </div>
              <h3 className="serif" style={{ fontSize: 48, lineHeight: 1.02, letterSpacing: '-0.015em', margin: 0, minHeight: 'calc(48px * 1.02 * 3)' }}>{p.title}</h3>
              <p className="mono body" style={{ opacity: 0.8 }}>{p.body}</p>
            </div>
          )}
        </div>
      </div>
    </section>);

};

// ======================================================================
// SLIDE 6 — REIMAGINING THE NEWSROOM
// ======================================================================
const Slide06_Reimagining = ({ num, total }) => {
  const creators = [
  {
    name: "Johnny Harris",
    photo: "assets/creators/johnny-harris.png",
    show: "The Proof of Concept",
    topic: "Premium documentary, examining the systems that run our world through the voices most affected by them.",
    audience: "13M",
    accent: "var(--np-red)",
    icon: (s, c) =>
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="16" cy="16" r="12" />
          <ellipse cx="16" cy="16" rx="5" ry="12" />
          <path d="M4 16h24" />
          <path d="M6 10h20M6 22h20" />
        </svg>

  },
  {
    name: "Sam Ellis",
    photo: "assets/creators/sam-ellis.png",
    show: "Search Party",
    topic: "Exploring the hidden connections between sports, geopolitics, and power.",
    audience: "1M",
    accent: "var(--np-blue)",
    icon: (s, c) =>
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="16" cy="16" r="12" />
          <path d="M16 6 L18.5 13.5 L16 16 L13.5 13.5 Z" fill={c} stroke="none" />
          <path d="M16 26 L13.5 18.5 L16 16 L18.5 18.5 Z" />
          <circle cx="16" cy="16" r="1.2" fill={c} stroke="none" />
        </svg>

  },
  {
    name: "Christophe Haubursin",
    photo: "assets/creators/christophe.png",
    show: "Tunnel Vision",
    topic: "Investigating the forces shaping the Internet, culture, and technology.",
    audience: "330K",
    accent: "var(--np-burgundy)",
    icon: (s, c) =>
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13" cy="13" r="8" />
          <circle cx="13" cy="13" r="3.5" />
          <path d="M19 19 L27 27" />
        </svg>

  },
  {
    name: "Max Fisher",
    photo: "assets/creators/max-fisher.png",
    show: "The Bigger Picture",
    topic: "Connecting the global forces — geopolitics, technology, and power — that shape the modern world.",
    audience: "250K",
    accent: "var(--np-green)",
    icon: (s, c) =>
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="16" cy="16" r="5" />
          <ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(-20 16 16)" />
          <circle cx="27.5" cy="11.8" r="1.4" fill={c} stroke="none" />
        </svg>

  }];

  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="05 · OUR SHOWS" />
      <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 32, paddingLeft: 64, paddingRight: 64 }}>
        {/* Header */}
        <div style={{ paddingTop: 40, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 48, borderBottom: '1px solid var(--np-ink)', paddingBottom: 24 }}>
          <div>
            <h2 className="serif" style={{ fontSize: 104, lineHeight: 0.96, letterSpacing: '-0.025em', margin: '12px 0 0' }}>
              Our <em className="italic" style={{ color: 'var(--np-red)' }}>shows</em> — led by world-class journalists.
            </h2>
          </div>
        </div>

        {/* Ticker strip — 4 portraits in a row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 56, alignContent: 'center' }}>
          {creators.map((c, i) =>
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Portrait — smaller */}
              <div style={{ position: 'relative', aspectRatio: '1/1', background: 'var(--np-cool-neutral)', overflow: 'hidden', border: '1px solid var(--np-ink)', width: '62%' }}>
                <img src={c.photo + '?v=3'} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              {/* Show eyebrow */}
              <div style={{ borderTop: `2px solid ${c.accent}`, paddingTop: 14 }}>
                {/* Name */}
                <div className="serif" style={{ fontSize: 30, lineHeight: 1, letterSpacing: '-0.012em' }}>{c.name}</div>
                {/* Topic — reserved height so audience aligns across columns */}
                <div className="serif" style={{ fontSize: 15, lineHeight: 1.4, marginTop: 12, opacity: 0.8, fontStyle: 'italic', minHeight: 'calc(15px * 1.4 * 4)' }}>{c.topic}</div>
                {/* Audience — label first, big number after */}
                <div style={{ marginTop: 20 }}>
                  <div className="mono caps" style={{ fontSize: 11, letterSpacing: '0.24em', opacity: 0.6, marginBottom: 6 }}>Audience:</div>
                  <div className="serif" style={{ fontSize: 88, lineHeight: 0.88, color: c.accent, letterSpacing: '-0.03em' }}>{c.audience}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Anchor — just the newpress wordmark */}
        <div style={{ borderTop: '1px solid var(--np-ink)', paddingTop: 20, paddingBottom: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div className="mono caps" style={{ fontSize: 11, letterSpacing: '0.3em', color: 'var(--np-blue)' }}>One Network</div>
          <img src="assets/logo/Newpress_Logo_Black.png" alt="newpress" style={{ width: 220, height: 'auto', display: 'block' }} />
        </div>
      </div>
    </section>);

};

// ======================================================================
// SLIDE 7 — IT'S WORKING (divider)
// ======================================================================
const Slide07_ItsWorking = ({ num, total }) =>
<section className="slide" data-theme="ink">
    <ChromeInk num={num} total={total} section="" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto', alignItems: 'center', paddingLeft: 80, paddingRight: 80, paddingTop: 56, paddingBottom: 40, gap: 24 }}>
      {/* Top band — creators reel (full width) */}
      <div style={{ borderTop: '1px solid var(--np-warm-white)', borderBottom: '1px solid var(--np-warm-white)', padding: '14px 0' }}>
        <div style={{ height: 220, overflow: 'hidden' }}>
          <img
            src="assets/creators/creators.gif"
            alt="Newpress creators"
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        </div>
      </div>

      {/* Hero headline */}
      <div style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div style={{ maxWidth: 1700 }}>
          <Eyebrow color="yellow">Part Two</Eyebrow>
          <h2 className="serif italic" style={{ fontSize: 280, lineHeight: 0.9, letterSpacing: '-0.035em', margin: '20px 0 0', color: 'var(--np-warm-white)' }}>
            It's working.
          </h2>
        </div>
      </div>

      {/* Bottom rule + section labels */}
      <div style={{ borderTop: '1px solid var(--np-warm-white)', paddingTop: 22, display: 'flex', justifyContent: 'space-around' }}>
        <div className="mono caps" style={{ fontSize: 14, letterSpacing: '0.3em', opacity: 0.7 }}>Audience</div>
        <div className="mono caps" style={{ fontSize: 14, letterSpacing: '0.3em', opacity: 0.7 }}>Playbook</div>
        <div className="mono caps" style={{ fontSize: 14, letterSpacing: '0.3em', opacity: 0.7 }}>Economics</div>
      </div>
    </div>
  </section>;


// ======================================================================
// SLIDE 8 — 15M SUBSCRIBERS (variants A, B)
// ======================================================================
const Slide08_FifteenMA = ({ num, total }) => {
  const stats = [
  { n: "14M+", l: "Followers", sub: "", accent: "var(--np-red)" },
  { n: "30M", l: "Monthly views", sub: "", accent: "var(--np-ink)" },
  { n: "70%", l: "Returning viewers", sub: "", accent: "var(--np-blue)" },
  { n: "1.26B", l: "Lifetime views", sub: "", accent: "var(--np-burgundy)" },
  { n: "137M", l: "Lifetime hours watched", sub: "", accent: "var(--np-green)" }];

  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="06 · AUDIENCE" />
      <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 64, paddingLeft: 96, paddingRight: 96 }}>
        {/* Header */}
        <div style={{ paddingTop: 72 }}>
          <Eyebrow color="red">Proof of Concept</Eyebrow>
          <h2 className="serif" style={{ fontSize: 84, lineHeight: 1.0, letterSpacing: '-0.025em', margin: '16px 0 0', maxWidth: 1500, color: 'var(--np-ink)' }}>
            We reach millions of people with<br /><em className="italic" style={{ color: 'var(--np-red)' }}>high-trust,</em> <em className="italic" style={{ color: 'var(--np-red)' }}>creator-led shows.</em>
          </h2>
        </div>

        {/* 5 stats — sparse, editorial */}
        <div style={{ alignSelf: 'center', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 36, paddingBottom: 80 }}>
          {stats.map((s, i) =>
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 18, borderTop: `2px solid ${s.accent}`, paddingTop: 20 }}>
              <div className="mono caps" style={{ fontSize: 11, letterSpacing: '0.28em', color: s.accent, opacity: 0.85 }}>0{i + 1}</div>
              <div className="serif" style={{ fontSize: 116, lineHeight: 0.86, letterSpacing: '-0.045em', color: s.accent }}>
                {s.n}
              </div>
              <div>
                <div className="serif" style={{ fontSize: 24, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--np-ink)' }}>{s.l}</div>
                {s.sub && <div className="serif italic" style={{ fontSize: 16, lineHeight: 1.35, marginTop: 8, opacity: 0.65, color: 'var(--np-ink)' }}>{s.sub}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>);

};

const Slide08_FifteenMB = ({ num, total }) =>
<section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="06 · AUDIENCE" />
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 32, paddingLeft: 48 }}>
      <div style={{ paddingTop: 40 }}>
        <Eyebrow>Audience</Eyebrow>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 80, alignItems: 'center' }}>
        <div>
          <div className="serif" style={{ fontSize: 440, lineHeight: 0.86, letterSpacing: '-0.04em', color: 'var(--np-red)', fontStyle: 'italic' }}>14M</div>
          <div className="mono caps" style={{ fontSize: 22, letterSpacing: '0.3em', marginTop: 20 }}>Subscribers, and counting.</div>
          <div style={{ marginTop: 40, borderTop: '1px solid var(--np-ink)', paddingTop: 24, maxWidth: 700 }}>
            <div className="serif" style={{ fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.012em' }}>
              Earned in five years. Across every platform that mattered.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="mono caps" style={{ fontSize: 12, letterSpacing: '0.26em', opacity: 0.6 }}>FIG. A · GROWTH 2021–2025</div>
          <GrowthChart />
        </div>
      </div>
    </div>
  </section>;


Object.assign(window, {
  Slide01_CoverA, Slide01_CoverB, Slide01_CoverC,
  Slide02_ProblemA, Slide02_ProblemB,
  Slide03_Impact, Slide04_Solution, Slide05_HowItWorks,
  Slide06_Reimagining, Slide07_ItsWorking,
  Slide08_FifteenMA, Slide08_FifteenMB
});