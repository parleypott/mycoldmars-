/**
 * Newpress Investor Deck — Slide Data
 * Source: Google Doc (published)
 * Images: /deck/ folder in public
 */

const slides = [
  // ─── 1. PURPOSE — WHAT ───
  {
    layout: 'title',
    label: 'PURPOSE \u2014 WHAT',
    headline: 'Creator-led media company\nbuilt to scale.',
    body: 'Newpress is building the next generation of journalism: creator-led, visually compelling, and built for the platforms where people actually learn today. By pairing trusted creators with a scalable newsroom infrastructure, we turn individual shows into enduring media brands.',
    logo: true,
  },

  // ─── 2. PROBLEM — WHY ───
  {
    layout: 'data',
    bg: 'blue',
    label: 'PROBLEM \u2014 WHY',
    headline: 'People don\u2019t trust\ninstitutions anymore.\nThey trust people.',
    body: 'Legacy media is losing the audience it needs to fund the journalism. Creators are gaining the audience without the infrastructure to do good journalism. The gap between them is where Newpress lives.',
    stats: [
      { number: '54%', text: 'of Americans now access news via social or video networks, surpassing TV (50%) and news websites/apps (48%) for the first time.', source: 'Reuters Institute Digital News Report, 2025' },
      { number: '28%', text: 'of Americans have confidence in mass media \u2014 a record low.', source: 'Gallup, 2025' },
      { number: '70%', text: 'of news executives say creators are taking audience attention away from publishers.', source: 'Nieman Journalism Lab / Reuters Institute' },
    ],
  },

  // ─── 3. SOLUTION ───
  {
    layout: 'statement',
    bg: 'green',
    label: 'SOLUTION',
    headline: 'The trust and reach of creators.\nThe rigor of a newsroom.',
    body: 'Newpress combines both. By providing shared editorial, operational and production infrastructure behind each show, we enable trusted creators to produce high-quality journalism that can scale across multiple platforms into a durable media franchise.',
  },

  // ─── 4. WHY NOW? ───
  {
    layout: 'whynow',
    stripe: 'yellow',
    label: 'WHY NOW?',
    headline: 'The talent and audiences\nare moving fast.',
    sections: [
      {
        num: '1',
        title: 'The audience has already moved.',
        text: 'YouTube held the highest share of TV viewing every single month in 2025, overtaking Disney and Netflix. 38% of adults under 30 regularly get news from creators. This isn\u2019t a trend \u2014 it\u2019s the new baseline.',
        source: 'Nielsen Media Distributor Gauge, 2025',
      },
      {
        num: '2',
        title: 'Legacy talent is available \u2014 right now.',
        text: 'Top-tier journalists are leaving institutions in waves. Trust in national news organizations has dropped 20 points since 2016. The window to recruit is open now.',
        source: 'Pew Research Center',
      },
      {
        num: '3',
        title: 'Ad dollars are beginning to move.',
        text: 'Linear TV advertising is entering structural decline. Brands know the audience has left \u2014 and the budgets are starting to follow. The company that can offer a premium, brand-safe, creator-native environment will absorb that migration.',
      },
    ],
  },

  // ─── 5. MARKET POTENTIAL ───
  {
    layout: 'marketQuote',
    bg: 'burgundy',
    label: 'MARKET POTENTIAL',
    headline: 'A once-in-a-generation\nmedia transition.',
    quoteLabel: 'TOTAL MARKET SCALE',
    quote: 'The total addressable market of the creator economy could roughly double in size over the next five years to $480 billion by 2027 from $250 billion today.',
    quoteSource: 'Goldman Sachs',
    subhead: 'THE LARGEST ADVERTISING MIGRATION IN DECADES',
    bullets: [
      'Linear TV advertising is entering structural decline.',
      'Over $60B in annual ad spend is beginning to move out of television.',
      'The money has to go somewhere.',
      'Brands need a rigorous, safe environment. We are the only credible option.',
    ],
  },

  // ─── 6. MARKET — THE DESTINATION ───
  {
    layout: 'statement',
    bg: 'yellow',
    label: 'MARKET POTENTIAL \u2014 THE DESTINATION',
    labelDot: 'red',
    headline: 'The destination\nisn\u2019t clear yet.',
    stat: 'Nearly half (48%) of advertising decision-makers now classify creator partnerships as a \u201Cmust-buy\u201D strategic pillar, ranking it just behind social media and paid search in importance.',
    body: 'Creators are capturing the audience. Brands want to move ad spend there. But most creators lack the infrastructure brands need:',
    bullets: [
      'Brand safety',
      'Editorial rigor',
      'Professional production',
      'Scalable partnerships',
    ],
  },

  // ─── 7. MARKET — OUR POSITION ───
  {
    layout: 'position',
    bg: 'blue',
    label: 'MARKET POTENTIAL \u2014 OUR POSITION',
    headline: 'We are built for\nthis moment.',
    body: 'Newpress combines the trust and reach of creators with the rigor and infrastructure of a newsroom. A brand-safe environment where creators can produce high-quality journalism at scale.',
    resultLabel: 'THE RESULT',
    resultBody: 'Our creator-led media brands are ready to absorb the next generation of advertising.',
    quote: 'Brand ads appearing in vetted, premium media environments drive a 40% higher increase in purchase intent than those in less-vetted or lower-quality social feeds.',
  },

  // ─── 8. BUSINESS MODEL ───
  {
    layout: 'business',
    stripe: 'green',
    label: 'BUSINESS MODEL',
    labelDot: 'green',
    headline: 'Two revenue streams.\nOne flywheel.',
    subhead: 'We\u2019ve already built a profitable business model with two main revenue streams.',
    col1: {
      title: 'AD SALES',
      points: [
        'YouTube ad revenue: 30M+ monthly views',
        'Brand partnerships: host-read integrations, presenting sponsorships, multi-creator network bundles',
      ],
    },
    col2: {
      title: 'SUBSCRIBER REVENUE',
      intro: 'Newpress.com membership launched February 19, 2026. Zero paid marketing.',
      stats: [
        { number: '34,773', label: 'Members' },
        { number: '3,937', label: 'Paid subscribers' },
        { number: '$236K', label: 'Revenue banked' },
        { number: '11%', label: 'Paid conversion' },
      ],
      kicker: 'In two weeks.',
    },
    revenueOpp: {
      label: 'REVENUE OPPORTUNITY',
      body: 'Combine proven media models with direct audience relationships of the creator economy.',
      bullets: ['Merchandise & products', 'Podcast expansion', 'Newsletters & owned audiences', 'Licensing & syndication', 'Streaming & distribution deals'],
    },
  },

  // ─── 9. WHAT WE'RE NOT ───
  {
    layout: 'competition',
    stripe: 'red',
    label: 'WHAT WE\u2019RE NOT',
    cards: [
      {
        title: 'NOT LEGACY MEDIA',
        text: 'Traditional newsrooms built for television and print distribution. Great reporting, but not designed for the platforms or formats where audiences now learn.',
        accent: false,
      },
      {
        title: 'NOT VENTURE DIGITAL',
        sub: 'Vox \u00B7 BuzzFeed \u00B7 Vice',
        text: 'Large editorial organizations built to chase traffic scale and ad volume, requiring massive headcount and constant publishing.',
        accent: false,
      },
      {
        title: 'NOT SOLO CREATORS',
        text: 'Individual creators with massive reach, but limited reporting infrastructure and difficult to scale beyond a single personality.',
        accent: false,
      },
      {
        title: 'WHAT WE ARE',
        text: 'Creator-led journalism built to scale. Trusted creators supported by a shared newsroom infrastructure, producing high-quality reporting across multiple scalable shows.',
        accent: true,
      },
    ],
  },

  // ─── 10. CREATORS ───
  {
    layout: 'creators',
    bg: 'warm',
    label: 'CREATORS \u2014 PROOF OF CONCEPT',
    headline: 'They didn\u2019t inherit their audiences.\nThey earned them.',
    stages: [
      {
        num: '1',
        title: 'THE PROOF OF CONCEPT',
        name: 'Johnny Harris',
        detail: 'Built from scratch. 7.5M subscribers. 3.2M average video views. The playbook that became Newpress.',
        image: null,
      },
      {
        num: '2',
        title: 'THE PLAYBOOK IS EXPORTABLE',
        subtitle: 'We proved we can take journalists leaving institutions and launch them successfully with the same quality and growth velocity.',
        creators: [
          {
            name: 'Search Party \u00B7 Sam Ellis',
            detail: 'Ex-Vox Atlas, Emmy nominated. 891K subscribers.',
            image: null,
            channel: '/deck/search-party-banner.jpg',
          },
          {
            name: 'Tunnel Vision \u00B7 Christophe Haubursin',
            detail: 'Ex-Vox, Emmy nominated. 286K subscribers.',
            image: '/deck/christophe.png',
            channel: '/deck/tunnel-vision-banner.jpg',
          },
        ],
      },
      {
        num: '3',
        title: 'EXPANDING THE MODEL',
        name: 'The Bigger Picture \u00B7 Max Fisher',
        detail: 'We took a legacy journalist \u2014 Pulitzer finalist, ex-NYT, ex-WaPo, founding editor of Vox \u2014 not video-native \u2014 and successfully translated him into the creator era.',
        image: null,
      },
    ],
    kicker: 'Newpress owns the intellectual property of all four channels.',
  },

  // ─── 11. FINANCIALS ───
  {
    layout: 'financials',
    bg: 'yellow',
    label: 'FINANCIALS',
    headline: 'Profitable from day one.\n30% growth. Zero outside capital.',
    stats: [
      { number: '$4.5M', label: 'FY25\nrevenue' },
      { number: '~30%', label: 'Year-over-year\ngrowth' },
      { number: '$0', label: 'Outside capital\nraised' },
      { number: '$236K', label: 'Membership revenue\n2 weeks, no marketing' },
    ],
    kicker: 'Six years. Profitable every year. Built without a single outside dollar.\nThis raise is not a lifeline. It\u2019s an accelerant.',
  },

  // ─── 12. TEAM ───
  {
    layout: 'team',
    label: 'TEAM',
    headline: 'Built this once.\nNow we build it at scale.',
    members: [
      {
        name: 'Iz Harris',
        title: 'Co-Founder & CEO, Executive Producer',
        detail: 'Formerly Vox Media Producer. The operational architect.',
        image: '/deck/iz-harris.png',
      },
      {
        name: 'Johnny Harris',
        title: 'Co-Founder, Emmy-Winning Journalist',
        detail: 'The distribution flywheel and proof of concept.',
        image: null,
      },
      {
        name: 'Michael Letta',
        title: 'Chief Operating Officer',
        detail: 'Has scaled multiple media startups.',
        image: null,
      },
      {
        name: 'Jon Laurence',
        title: 'VP Production',
        detail: 'Emmy & Peabody winner. Formerly AJ+, NowThis, Channel 4 UK.',
        image: null,
      },
      {
        name: 'Adam Freelander',
        title: 'Supervising Producer, Editorial',
        detail: 'Formerly Vox and NYT.',
        image: null,
      },
    ],
  },

  // ─── 13. THE RAISE ───
  {
    layout: 'raise',
    stripe: 'blue',
    label: 'THE RAISE \u2014 USE OF PROCEEDS',
    headline: '$20M to go from profitable boutique\nto definitive media house.',
    allocations: [
      {
        pct: '40%',
        title: 'CHANNEL EXPANSION',
        text: 'We have a proven launch playbook. Identify, recruit, and launch a new cohort of world-class journalists. We provide the infrastructure; they bring the talent and trust.',
        color: 'blue',
      },
      {
        pct: '35%',
        title: 'OPERATIONAL EXCELLENCE',
        text: 'Institutional-grade production, fact-checking, and operational leadership. More output without sacrificing the Newpress standard. Faster audience growth. Higher advertising rates.',
        color: 'yellow',
      },
      {
        pct: '25%',
        title: 'REVENUE ENGINE',
        text: 'Dedicated enterprise salesforce to bridge legacy ad budgets to the creator economy. Expanding revenue team around subscriber funded platform.',
        color: 'red',
      },
    ],
  },

  // ─── 14. VISION ───
  {
    layout: 'vision',
    bg: 'blue',
    label: 'VISION \u2014 5 YEARS',
    headline: 'The definitive media house\nof the next decade.',
    body: 'In 5 years, Newpress is what HBO was to cable and what Netflix was to streaming \u2014 the company that defined what premium journalism looks like in the platform era.',
    phases: [
      {
        title: 'YEAR 1\u20132',
        items: ['10+ channels launched', 'Human Element on air', 'Enterprise sales team built', '100K paid members'],
      },
      {
        title: 'YEAR 3\u20134',
        items: ['20+ creator network', '$20M+ revenue run rate', 'Dominant in premium creator advertising', 'International expansion begins'],
      },
      {
        title: 'YEAR 5',
        items: ['The NBC News of the creator era', 'IPO-ready or strategic acquisition candidate', 'The place the world\u2019s best journalists want to be'],
      },
    ],
    closing: 'We\u2019ve proven the model. Now we build the institution.',
  },
];

export default slides;
