// Slides 9–15

// ======================================================================
// SLIDE 9 — PLAYBOOK (Johnny's channel + network effect)
// ======================================================================
const Slide09_Playbook = ({ num, total }) => {
  const [active, setActive] = React.useState(false);
  // Bump a nonce every time we (re)enter so the iframe fully remounts and
  // restarts its animation from frame 0 — instead of continuing mid-play.
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    const myIndex = num - 1;
    const onSlideChange = (e) => {
      const idx = e.detail && typeof e.detail.index === 'number' ? e.detail.index : null;
      if (idx === null) return;
      if (idx === myIndex) {
        setNonce((n) => n + 1);
        setActive(true);
      } else {
        setActive(false);
      }
    };
    document.addEventListener('slidechange', onSlideChange);
    // Also handle the case where this slide is the initial slide on load —
    // deck-stage fires 'init' on mount, which we've already caught above,
    // but if the event fired before this listener was attached, fall back
    // to reading the stage's current index.
    try {
      const stage = document.querySelector('deck-stage');
      if (stage && typeof stage.index === 'number' && stage.index === myIndex) {
        setNonce((n) => n + 1);
        setActive(true);
      }
    } catch (err) {}
    return () => document.removeEventListener('slidechange', onSlideChange);
  }, [num]);

  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="07 · THE PLAYBOOK" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr', gap: 28, paddingLeft: 48, paddingRight: 48}}>
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 20}}>
          <Eyebrow>The Playbook</Eyebrow>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1.15fr', gap: 64, alignItems:'stretch', paddingTop: 8, paddingBottom: 24}}>
          {/* LEFT — title + numbered list */}
          <div style={{display:'flex', flexDirection:'column', justifyContent:'center'}}>
            <h2 className="serif" style={{fontSize: 88, lineHeight: 0.98, letterSpacing:'-0.02em', margin: 0}}>
              The <em className="italic" style={{color:'var(--np-red)'}}>playbook.</em>
            </h2>
            <ol style={{listStyle:'none', margin:'56px 0 0', padding: 0, display:'flex', flexDirection:'column', gap: 0, borderTop:'1px solid var(--np-ink)'}}>
              {[
                "Partner with world-class journalists",
                "Build creator-led shows around their voice",
                "Own the IP, share in the upside",
                "Launch and scale with built-in distribution",
              ].map((item, i) => (
                <li key={i} style={{display:'grid', gridTemplateColumns:'auto 1fr', columnGap: 32, alignItems:'baseline', borderBottom:'1px solid var(--np-ink)', padding:'24px 0'}}>
                  <div className="mono" style={{fontSize: 26, fontWeight: 500, letterSpacing:'0.04em', color:'var(--np-red)', minWidth: 48}}>
                    {String(i+1).padStart(2,'0')}
                  </div>
                  <div className="serif" style={{fontSize: 34, lineHeight: 1.2, letterSpacing:'-0.005em'}}>
                    {item}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* RIGHT — embedded growth chart */}
          <div style={{position:'relative', overflow:'hidden', background:'var(--np-paper)', borderLeft:'1px solid var(--np-ink)'}}>
            {active ? (
              <iframe
                key={nonce}
                src="https://www.newpress.press/growth/"
                title="Newpress growth"
                scrolling="no"
                style={{position:'absolute', left:'-60px', top:-40, width:'calc(100% + 120px)', height:'calc(100% + 120px)', border:0, display:'block', background:'transparent'}}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

// ======================================================================
// SLIDE 10 — EXPANSION (finance / healthcare / fashion / culture / science)
// ======================================================================
const Slide10_Expansion = ({ num, total }) => {
  const verticals = [
    { cat: "Finance",       color: "var(--np-green)",    note: "Where money and narrative meet." },
    { cat: "Economics",     color: "var(--np-green)",    note: "The forces moving everything." },
    { cat: "Healthcare",    color: "var(--np-red)",      note: "The story every household needs." },
    { cat: "Science",       color: "var(--np-sepia)",    note: "From lab bench to feed." },
    { cat: "Technology",    color: "var(--np-burgundy)", note: "The systems shaping everything else." },
    { cat: "Culture",       color: "var(--np-blue)",     note: "The beat that explains the others." },
    { cat: "Entertainment", color: "var(--np-ink)",      note: "Where audiences live." },
    { cat: "Sports",        color: "var(--np-red)",      note: "Where culture and competition meet." },
  ];
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="08 · EXPANSION" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr auto', gap: 40, paddingLeft: 48}}>
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 20, maxWidth: 1700}}>
          <Eyebrow>Expansion</Eyebrow>
          <h2 className="serif" style={{fontSize: 72, lineHeight: 1, letterSpacing:'-0.015em', margin:'12px 0 0'}}>
            The same <em className="italic" style={{color:'var(--np-red)'}}>playbook,</em> applied across the biggest categories.
          </h2>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gridAutoRows:'1fr', gap: 24, alignContent:'stretch', paddingRight: 48}}>
          {verticals.map((v, i) => (
            <div key={i} style={{border:'1px solid var(--np-ink)', padding: 22, display:'flex', flexDirection:'column', justifyContent:'space-between', position:'relative', overflow:'hidden'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                  <div className="mono caps" style={{fontSize:12, letterSpacing:'0.24em', color: v.color}}>Vertical {String(i+1).padStart(2,'0')}</div>
                  <div className="serif" style={{fontSize: 38, lineHeight: 0.98, letterSpacing:'-0.02em', marginTop: 12, color: v.color}}>{v.cat}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Footer line */}
        <div style={{borderTop:'1px solid var(--np-ink)', paddingTop: 24, paddingBottom: 40, paddingRight: 48, display:'flex', justifyContent:'flex-start', alignItems:'baseline', gap: 32}}>
          <div className="serif" style={{fontSize: 44, lineHeight: 1, letterSpacing:'-0.018em', color:'var(--np-ink)'}}>
            We want to grow to <em className="italic" style={{color:'var(--np-red)'}}>100M+</em> in reach.
          </div>
        </div>
      </div>
    </section>
  );
};

// ======================================================================
// SLIDE 11 — CAPITAL EFFICIENCY (reframed: deal flow w/ no sales team)
// ======================================================================
const Slide11_CapitalEff = ({ num, total }) => (
  <section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="FUNDING PHASE 1" />
    <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr auto', paddingLeft: 48, paddingRight: 48}}>

      {/* Header eyebrow */}
      <div style={{paddingTop: 40}}>
        <Eyebrow>Funding Phase 1</Eyebrow>
      </div>

      {/* HERO — headline left, kicker right */}
      <div style={{display:'grid', gridTemplateColumns:'1.55fr 1fr', gap: 72, alignItems:'start', paddingTop: 20}}>
        {/* LEFT — the narrative */}
        <div>
          <h2 className="serif" style={{fontSize: 72, lineHeight: 1.02, letterSpacing:'-0.02em', margin: 0, color:'var(--np-ink)', textWrap:'balance'}}>
            We bootstrapped <em className="italic" style={{color:'var(--np-red)'}}>$20M</em> of ad &amp; brand deals — and ran a <em className="italic" style={{color:'var(--np-red)'}}>profitable</em> company for <em className="italic" style={{color:'var(--np-red)'}}>5&nbsp;years</em> with no&nbsp;outside&nbsp;capital.
          </h2>

          {/* Three zeros — the punchline */}
          <div style={{marginTop: 44, borderTop:'1px solid var(--np-ink)', paddingTop: 24}}>
            <div className="mono caps" style={{fontSize: 11, letterSpacing:'0.28em', opacity: 0.55, marginBottom: 18, color:'var(--np-ink)'}}>&nbsp;</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', columnGap: 40}}>
              {[
                {stat:"$0", label:"Sales team"},
                {stat:"$0", label:"Marketing spend"},
                {stat:"$0", label:"Outside capital"},
              ].map((d, i) => (
                <div key={i}>
                  <div className="serif" style={{fontSize: 76, lineHeight: 0.9, letterSpacing:'-0.025em', color:'var(--np-ink)'}}>{d.stat}</div>
                  <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.24em', opacity: 0.75, color:'var(--np-ink)', marginTop: 12}}>{d.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Next up */}
        <div style={{borderLeft:'1px solid var(--np-ink)', paddingLeft: 44, display:'flex', flexDirection:'column', gap: 22, paddingTop: 4}}>
          <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.28em', color:'var(--np-red)'}}>Next up</div>
          <div className="serif" style={{fontSize: 30, lineHeight: 1.26, letterSpacing:'-0.008em', color:'var(--np-ink)'}}>
            With a real commercial team we plan to properly value our <em className="italic" style={{color:'var(--np-red)'}}>massive audience</em> and rapidly increase our revenue opportunities.
          </div>
          <div className="mono caps" style={{fontSize: 11, letterSpacing:'0.24em', opacity: 0.5, marginTop: 8, borderTop:'1px solid var(--np-rule-faint)', paddingTop: 16}}>Phase 2 · Commercial activation</div>
        </div>
      </div>

      {/* SUB-FOOTER — Financials strip (FY25 proof points) */}
      <div style={{borderTop:'1px solid var(--np-ink)', paddingTop: 20, paddingBottom: 40, marginRight: 80}}>
        <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.28em', opacity: 0.55, marginBottom: 22}}>Supporting Financials · FY25</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap: 36}}>
          {[
            {stat: "$4.4M", label: "Ad &amp; Brand Revenue · FY25",     foot: "+30% YoY — organic deal flow, no outbound."},
            {stat: "$278K", label: "Membership Revenue · 90% margin",   foot: "High-intent audience signal."},
            {stat: "$213K", label: "Net Income",                         foot: "Profitable while scaling production."},
            {stat: "$1M",   label: "Cash On-Hand",                       foot: ""},
            {stat: "$0",    label: "Marketing Spend",                    foot: "Pure organic trust."},
          ].map((d, i) => (
            <div key={i}>
              <div className="mono" style={{fontSize: 38, fontWeight: 500, lineHeight: 1, letterSpacing:'-0.015em', color:'var(--np-ink)'}}>{d.stat}</div>
              <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.22em', opacity:0.78, marginTop: 14, lineHeight: 1.4, color:'var(--np-ink)'}} dangerouslySetInnerHTML={{__html: d.label}}/>
              {d.foot && <div className="mono" style={{fontSize: 11, opacity:0.55, lineHeight: 1.45, fontStyle:'italic', marginTop: 8, color:'var(--np-ink)'}}>{d.foot}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// ======================================================================
// SLIDE 12 — MARKET / TIMING
// ======================================================================
const Slide12_Market = ({ num, total }) => (
  <section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="10 · MARKET & TIMING" />
    <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr', gap: 48, paddingLeft: 48, paddingRight: 48}}>
      {/* Header */}
      <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 28, maxWidth: 1750}}>
        <Eyebrow>Market & Timing</Eyebrow>
        <h2 className="serif" style={{fontSize: 80, lineHeight: 1.02, letterSpacing:'-0.02em', margin:'14px 0 0'}}>
          We want to capture the <em className="italic" style={{color:'var(--np-red)'}}>massive market</em> of ad spend as it moves from legacy to creator media.
        </h2>
      </div>

      {/* Body — hero stat + 3-up supporting stats */}
      <div style={{display:'grid', gridTemplateColumns:'1.15fr 2fr', gap: 80, alignItems:'start', paddingBottom: 56}}>
        {/* Hero stat */}
        <div style={{borderTop:'4px solid var(--np-red)', paddingTop: 28, paddingRight: 24}}>
          <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.28em', color:'var(--np-red)'}}>The Market</div>
          <div className="serif" style={{fontSize: 220, lineHeight: 0.92, letterSpacing:'-0.04em', color:'var(--np-red)', marginTop: 18}}>
            $480B
          </div>
          <div className="serif" style={{fontSize: 26, lineHeight: 1.3, letterSpacing:'-0.005em', color:'var(--np-ink)', marginTop: 20, maxWidth: 460}}>
            Total creator economy size by 2027.
          </div>
          <div className="mono caps" style={{fontSize: 11, letterSpacing:'0.24em', opacity:0.55, marginTop: 16}}>
            Source · Goldman Sachs
          </div>
        </div>

        {/* Supporting stats — stacked */}
        <div style={{display:'flex', flexDirection:'column', gap: 28, paddingTop: 28}}>
          {[
            {num:"$37B",  label:"U.S. creator ad spend by 2025.",                         src:"eMarketer"},
            {num:"40%",   label:"Of all ad spending is now social / creator-led.",        src:"IAB, 2026"},
            {num:"50%",   label:"Of brand leaders are cutting linear TV ad spend.",       src:"CMO Survey, 2025"},
          ].map((d,i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'200px 1fr auto', gap: 32, alignItems:'baseline', borderTop:'1px solid var(--np-ink)', paddingTop: 20}}>
              <div className="serif" style={{fontSize: 88, lineHeight: 0.95, letterSpacing:'-0.025em', color:'var(--np-ink)'}}>{d.num}</div>
              <div className="serif" style={{fontSize: 24, lineHeight: 1.3, letterSpacing:'-0.005em', color:'var(--np-ink)', opacity: 0.85}}>{d.label}</div>
              <div className="mono caps" style={{fontSize: 11, letterSpacing:'0.24em', opacity:0.55, whiteSpace:'nowrap'}}>{d.src}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// ======================================================================
// SLIDE 12.5 — THE OPPORTUNITY (between Market and What's Next)
// ======================================================================
const Slide12b_Opportunity = ({ num, total }) => {
  const items = [
    {
      tag: "01",
      title: "Talent is available",
      body: "Top journalists are leaving institutions — opportunity to scale from 14M to 100M+ following.",
      color: "var(--np-red)",
    },
    {
      tag: "02",
      title: "Ad dollars are shifting",
      body: "Brand spend is moving to creator-led media — opportunity to build a premium internal sales engine.",
      color: "var(--np-blue)",
    },
    {
      tag: "03",
      title: "Audience demand is unmet",
      body: "Massive global audience seeking trusted, high-quality content not being served by traditional media.",
      color: "var(--np-burgundy)",
    },
    {
      tag: "04",
      title: "The creator economy is maturing",
      body: "Tools, talent, and audience behavior have all caught up — building a media company around creators is finally repeatable, not a one-off bet.",
      color: "var(--np-green)",
    },
  ];
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="11 · THE OPPORTUNITY" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr', gap: 56, paddingLeft: 48, paddingRight: 48}}>
        {/* Header */}
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 28, maxWidth: 1700}}>
          <Eyebrow>The Opportunity</Eyebrow>
          <h2 className="serif" style={{fontSize: 76, lineHeight: 1.02, letterSpacing:'-0.02em', margin:'14px 0 0'}}>
            This moment creates a <em className="italic" style={{color:'var(--np-red)'}}>clear opportunity</em> to build a scaled, creator-led media company.
          </h2>
        </div>
        {/* 4 pillars */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gridAutoRows:'1fr', gap: 56, alignItems:'stretch', paddingBottom: 40, paddingRight: 80}}>
          {items.map((it, i) => (
            <div key={i} style={{display:'flex', flexDirection:'column', gap: 20, borderTop:`4px solid ${it.color}`, paddingTop: 24}}>
              <div className="mono caps" style={{fontSize:13, letterSpacing:'0.28em', color: it.color}}>{it.tag}</div>
              <div className="serif" style={{fontSize: 48, lineHeight: 1.05, letterSpacing:'-0.018em', color:'var(--np-ink)'}}>
                {it.title}
              </div>
              <div className="mono" style={{fontSize: 16, lineHeight: 1.55, letterSpacing:'0.005em', color:'var(--np-ink)', opacity: 0.78, maxWidth: 640, marginTop: 6}}>
                {it.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ======================================================================
// ======================================================================
// SLIDE 14 — WHAT'S NEXT (One audience, expanding products)
// ======================================================================
const Slide13_Future = ({ num, total }) => {
  const pillars = [
    {
      tag: "01",
      title: "Creator Expansion",
      lede: "Recruit top journalists leaving institutions.",
      bullets: [
        "Recruit top journalists leaving institutions",
        "Launch new shows using the Newpress production playbook",
        "Expand existing shows into multi-platform media brands",
      ],
      color: "var(--np-red)",
    },
    {
      tag: "02",
      title: "Strengthen the Editorial Engine",
      lede: "Attract the exceptional, experienced talent that allows creators and trust to scale.",
      bullets: [
        { text: "Bring on exceptional talent to scale:", sub: [
          "Reporting and research teams",
          "Production and visual storytelling capacity",
          "Shared editorial standards and workflows",
          "Upgraded studio facilities in DC & NYC",
        ]},
      ],
      color: "var(--np-blue)",
    },
    {
      tag: "03",
      title: "Audience & Revenue Expansion",
      lede: "Strengthen direct audience relationships and monetization.",
      bullets: [
        "Build sales and marketing function",
        "Invest in membership scale",
        "Expand sponsorships with more premium brand partnerships",
        { text: "Expand and monetize new formats:", sub: ["Podcasts", "Newsletter", "Live events"] },
      ],
      color: "var(--np-green)",
    },
    {
      tag: "04",
      title: "Flagship Show Development",
      lede: "Invest in premium programming to push the boundaries of creator-led journalism.",
      bullets: [
        "Develop flagship documentary-style programming to push the boundaries of creator-led journalism",
        "Establish signature shows that appear on top streaming platforms and elevate the entire network",
        "Host in-person premieres with creators",
      ],
      color: "var(--np-burgundy)",
    },
  ];
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="12 · WHERE WE SCALE" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr', gap: 36, paddingLeft: 48, paddingRight: 48}}>
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 24}}>
          <Eyebrow>What's Next</Eyebrow>
          <h2 className="serif" style={{fontSize: 84, lineHeight: 1, letterSpacing:'-0.02em', margin:'14px 0 0'}}>
            <em className="italic" style={{color:'var(--np-red)'}}>Where</em> we scale.
          </h2>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 36, paddingBottom: 40, alignItems:'start'}}>
          {pillars.map((p, i) => (
            <div key={i} style={{display:'flex', flexDirection:'column', gap: 18, borderTop:`4px solid ${p.color}`, paddingTop: 22}}>
              <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.28em', color: p.color}}>{p.tag}</div>
              <div className="serif" style={{fontSize: 30, lineHeight: 1.05, letterSpacing:'-0.012em', color:'var(--np-ink)', minHeight: 96}}>
                {p.title}
              </div>
              <ul style={{listStyle:'none', margin: 0, padding: 0, display:'flex', flexDirection:'column', gap: 10}}>
                {p.bullets.map((b, j) => {
                  if (typeof b === 'string') {
                    return (
                      <li key={j} style={{display:'grid', gridTemplateColumns:'10px 1fr', gap: 12, alignItems:'baseline'}}>
                        <span style={{width:6, height:6, background: p.color, borderRadius: '50%', marginTop: 7}}></span>
                        <span className="mono" style={{fontSize: 14, lineHeight: 1.5, color:'var(--np-ink)', letterSpacing: '0.005em'}}>{b}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={j} style={{display:'flex', flexDirection:'column', gap: 8}}>
                      <div style={{display:'grid', gridTemplateColumns:'10px 1fr', gap: 12, alignItems:'baseline'}}>
                        <span style={{width:6, height:6, background: p.color, borderRadius:'50%', marginTop: 7}}></span>
                        <span className="mono" style={{fontSize: 14, lineHeight: 1.5, color:'var(--np-ink)', letterSpacing: '0.005em'}}>{b.text}</span>
                      </div>
                      <ul style={{listStyle:'none', margin:'2px 0 0 22px', padding: 0, display:'flex', flexDirection:'column', gap: 6}}>
                        {b.sub.map((s, k) => (
                          <li key={k} style={{display:'grid', gridTemplateColumns:'10px 1fr', gap: 12, alignItems:'baseline'}}>
                            <span style={{width:5, height:1, background: p.color, marginTop: 11}}></span>
                            <span className="mono" style={{fontSize: 13, lineHeight: 1.5, color:'var(--np-ink)', opacity: 0.78, letterSpacing: '0.005em'}}>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ======================================================================
// SLIDE 14 — TEAM (variants A and B)
// ======================================================================
const Slide14_TeamA = ({ num, total }) => {
  const V = "?v=3";
  const team = [
    {
      name: "Iz Harris",
      role: "Co-Founder & CEO, Executive Producer",
      bio: "Former host with mass audience turned exec. The operational architect.",
      photo: "assets/team/iz-harris.png",
    },
    {
      name: "Johnny Harris",
      role: "Co-Founder, Emmy-Winning Journalist",
      bio: "Ex-Vox. Contributor, NYT and The Economist.",
      photo: "assets/team/johnny-harris.jpeg",
    },
    {
      name: "Michael Letta",
      role: "Chief Operating Officer",
      bio: "A natural operator with deep finance instincts.",
      photo: "assets/team/michael-letta.jpg",
      objectPosition: "35% 30%",
    },
    {
      name: "Jon Laurence",
      role: "VP Production",
      bio: "Emmy & Peabody winner. Formerly AJ+, NowThis, Channel 4 UK.",
      photo: "assets/team/jon-laurence.png",
    },
    {
      name: "Adam Freelander",
      role: "Supervising Producer, Editorial",
      bio: "Formerly Vox and NYT.",
      photo: "assets/team/adam-freelander.jpg",
    },
  ];
  const advisors = [
    {name: "Mark Rober", role: "YouTuber, 76M Subscribers", note: "", photo: "assets/team/mark-rober.png"},
    {name: "Bill Owens", role: "Former EP, 60 Minutes", note: "", photo: "assets/team/bill-owens.png"},
    {name: "Cleo Abram", role: "Founder: 'Huge if True'", note: "", photo: "assets/team/cleo-abram.png"},
    {name: "Zachariah Reitano", role: "Founder & CEO of Ro", note: "", photo: "assets/team/zachariah-reitano.png"},
    {name: "James Zelnick", role: "ex-TSG Consumer Partners", note: "", photo: "assets/team/james-zelnick.png"},
    {name: "Alex Lieberman", role: "Founder, Morning Brew", note: "", photo: "assets/team/alex-lieberman.png"},
  ];
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="13 · THE TEAM" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr', gap: 32, paddingLeft: 48, paddingRight: 80}}>
        <div style={{paddingTop: 36, borderBottom:'1px solid var(--np-ink)', paddingBottom: 18, maxWidth: 1800}}>
          <Eyebrow>Team</Eyebrow>
          <h2 className="serif" style={{fontSize: 64, lineHeight: 1, letterSpacing:'-0.02em', margin:'10px 0 0'}}>
            Seasoned team with <em className="italic" style={{color:'var(--np-red)'}}>industry knowledge.</em>
          </h2>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'2.6fr 1fr', gap: 44, alignItems:'start'}}>
          {/* LEFT — Team */}
          <div style={{display:'flex', flexDirection:'column', gap: 22}}>
            <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.24em', color:'var(--np-blue)'}}>Leadership</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap: 22}}>
              {team.map((p,i)=>(
                <div key={i} style={{display:'flex', flexDirection:'column', gap: 0}}>
                  <div style={{aspectRatio:'3/4', overflow:'hidden', background:'var(--np-cool-neutral)'}}>
                    <img src={p.photo + V} alt={p.name} style={{width:'100%', height:'100%', objectFit:'cover', objectPosition: p.objectPosition || 'center 20%', display:'block'}}/>
                  </div>
                  <div className="serif" style={{fontSize: 28, lineHeight: 1.05, letterSpacing:'-0.012em', marginTop: 18, minHeight: 'calc(28px * 1.05 * 2)', display:'flex', alignItems:'flex-start'}}>{p.name}</div>
                  <div className="mono caps" style={{fontSize: 10, letterSpacing:'0.2em', color:'var(--np-blue)', lineHeight: 1.4, marginTop: 8, minHeight: 'calc(10px * 1.4 * 2)'}}>{p.role}</div>
                  <div className="mono body-sm" style={{opacity:0.78, fontSize: 13, lineHeight: 1.45, marginTop: 8}}>{p.bio}</div>
                </div>
              ))}
            </div>
          </div>
          {/* RIGHT — Advisors (aligned with team eyebrow baseline) */}
          <div style={{borderLeft:'1px solid var(--np-ink)', paddingLeft: 32, display:'flex', flexDirection:'column', gap: 22, alignSelf:'stretch', justifyContent:'flex-start'}}>
            <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.24em', color:'var(--np-red)'}}>Advisors</div>
            <div style={{display:'flex', flexDirection:'column', gap: 0}}>
              {advisors.map((a,i) => (
                <div key={i} style={{display:'grid', gridTemplateColumns:'64px 1fr', gap: 18, alignItems:'center', borderTop: '1px solid var(--np-rule-faint)', paddingTop: 18, paddingBottom: 18}}>
                  {a.photo ? (
                    <div style={{width:64, height:64, borderRadius:'50%', overflow:'hidden', background:'var(--np-cool-neutral)'}}>
                      <img src={a.photo + V} alt={a.name} style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}}/>
                    </div>
                  ) : (
                    <div style={{width:64, height:64, borderRadius:'50%', background:'var(--np-cool-neutral)', display:'grid', placeItems:'center'}}>
                      <span className="serif italic" style={{fontSize: 24, color:'var(--np-ink)', opacity:0.45}}>{a.name.split(' ').map(n=>n[0]).join('')}</span>
                    </div>
                  )}
                  <div>
                    <div className="serif" style={{fontSize: 24, lineHeight: 1.08, letterSpacing:'-0.005em'}}>{a.name}</div>
                    <div className="mono caps" style={{fontSize: 11, letterSpacing:'0.2em', color:'var(--np-blue)', marginTop: 5, lineHeight: 1.35}}>{a.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Slide14_TeamB = ({ num, total }) => {
  const team = Array.from({length: 8}).map((_,i) => ({name:`[ Name ${i+1} ]`, role:"Role / Title"}));
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="13 · THE TEAM" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr auto', gap: 32, paddingLeft: 48}}>
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 20}}>
          <Eyebrow>The Team</Eyebrow>
          <h2 className="serif" style={{fontSize: 72, lineHeight: 1, letterSpacing:'-0.015em', margin:'12px 0 0'}}>
            We have the team to do it.
          </h2>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap: 16}}>
          {team.map((p,i)=>(
            <div key={i} style={{display:'flex', flexDirection:'column', gap: 10}}>
              <PH label="Portrait" sub="3:4" style={{aspectRatio:'3/4'}}/>
              <div className="serif" style={{fontSize: 22, lineHeight: 1.1}}>{p.name}</div>
              <div className="mono body-sm" style={{opacity:0.7, fontSize: 13}}>{p.role}</div>
            </div>
          ))}
        </div>
        <div style={{borderTop:'1px solid var(--np-ink)', paddingTop: 20, display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:40}}>
          <div className="mono body" style={{opacity:0.8, maxWidth: 1400}}>
            Emmy-nominated. A decade building new-age media at Netflix, YouTube, and beyond. Advised by <strong>Mark Rober</strong> and [ TK ].
          </div>
          <div className="tag tag--red">Backed by operators</div>
        </div>
      </div>
    </section>
  );
};

// ======================================================================
// SLIDE 15 — CLOSING (variants)
// ======================================================================
const Slide15_CloseA = ({ num, total }) => {
  const items = [
    { text: "A network of top journalists turned creators reaching 100M+", color: "var(--np-red)" },
    { text: "New, monetized formats across shows", color: "var(--np-blue)" },
    { text: "A premium advertising and partnership business", color: "var(--np-burgundy)" },
    { text: "Product expansion: live events, merchandise, membership", color: "var(--np-green)" },
  ];
  return (
    <section className="slide" data-theme="paper">
      <Chrome num={num} total={total} section="14 · THE VISION" right="APR 2026" />
      <div style={{height:'100%', display:'grid', gridTemplateRows:'auto auto 1fr auto', gap: 32, paddingLeft: 48, paddingRight: 48}}>
        {/* Header */}
        <div style={{paddingTop: 40, borderBottom:'1px solid var(--np-ink)', paddingBottom: 28, maxWidth: 1750}}>
          <Eyebrow>The Vision</Eyebrow>
          <h2 className="serif" style={{fontSize: 96, lineHeight: 1, letterSpacing:'-0.022em', margin:'14px 0 0'}}>
            The defining <em className="italic" style={{color:'var(--np-red)'}}>media company</em> of the creator era.
          </h2>
        </div>

        {/* Body — left-pinned numbered list (matches earlier "What this looks like" treatment) */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 96, alignItems:'start', paddingRight: 24, marginTop: 8}}>
          <div style={{display:'flex', flexDirection:'column', gap: 18}}>
            <div className="mono caps" style={{fontSize: 12, letterSpacing:'0.28em', color:'var(--np-red)'}}>Help us build</div>
            <ul style={{listStyle:'none', margin: 0, padding: 0, display:'flex', flexDirection:'column', gap: 0}}>
              {items.map((it, i) => (
                <li key={i} style={{display:'grid', gridTemplateColumns:'56px 1fr', gap: 24, alignItems:'baseline', borderTop:'1px solid var(--np-ink)', paddingTop: 18, paddingBottom: 18}}>
                  <div className="mono caps" style={{fontSize: 13, letterSpacing:'0.24em', color: it.color}}>{String(i+1).padStart(2,'0')}</div>
                  <div className="serif" style={{fontSize: 24, lineHeight: 1.35, letterSpacing:'-0.005em', color:'var(--np-ink)'}}>{it.text}</div>
                </li>
              ))}
            </ul>
          </div>
          <div></div>
        </div>

        {/* Spacer */}
        <div></div>

        {/* Bottom — single-line closer, paper theme */}
        <div style={{borderTop:'1px solid var(--np-ink)', paddingTop: 28, paddingBottom: 40}}>
          <div className="serif italic" style={{fontSize: 64, lineHeight: 1.05, letterSpacing:'-0.015em', color:'var(--np-red)'}}>
            We've proven the model.{' '}
            <span style={{color:'var(--np-ink)'}}>Now we build the institution.</span>
          </div>
        </div>
      </div>
    </section>
  );
};

const Slide15_CloseB = ({ num, total }) => (
  <section className="slide" data-theme="paper">
    <Chrome num={num} total={total} section="THE ASK" right="APR 2026" />
    <div style={{height:'100%', display:'grid', gridTemplateRows:'auto 1fr auto', paddingLeft: 48}}>
      <div style={{paddingTop: 40}}>
        <Eyebrow>Join Us</Eyebrow>
      </div>
      <div style={{display:'grid', placeItems:'center'}}>
        <div style={{textAlign:'center', maxWidth: 1600}}>
          <img src="assets/icons/Newpress_Icon_Burgundy-Yellow.png" style={{width: 180, margin: '0 auto 32px'}} alt=""/>
          <h2 className="serif italic" style={{fontSize: 128, lineHeight: 0.98, letterSpacing:'-0.025em', margin:0}}>
            Reimagine media models.<br/>
            <span style={{color:'var(--np-red)'}}>Restore trust in journalism.</span>
          </h2>
          <p className="lede" style={{marginTop: 40, maxWidth: 1200, margin: '40px auto 0', opacity: 0.8}}>
            Help hundreds of millions of people understand the world around them — wherever and however they consume information.
          </p>
        </div>
      </div>
      <div style={{borderTop:'1px solid var(--np-ink)', padding:'24px 0', display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap: 32}}>
        <div className="mono caps" style={{fontSize: 14, letterSpacing:'0.28em', opacity:0.7}}>The Ask · [ TK ]</div>
        <div className="serif italic" style={{fontSize: 36}}>newpress</div>
        <div className="mono caps" style={{fontSize: 14, letterSpacing:'0.28em', opacity:0.7, textAlign:'right'}}>Contact · [ TK ]</div>
      </div>
    </div>
  </section>
);

Object.assign(window, {
  Slide09_Playbook, Slide10_Expansion, Slide11_CapitalEff,
  Slide12_Market, Slide12b_Opportunity, Slide13_Future,
  Slide14_TeamA, Slide14_TeamB,
  Slide15_CloseA, Slide15_CloseB,
});
