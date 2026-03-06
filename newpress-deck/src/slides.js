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
    headline: 'People don\u2019t trust institutions anymore.\nThey trust people.',
    body: 'Legacy media is losing the audience it needs to fund the journalism. Creators are gaining the audience without the infrastructure to do it well. The gap between them is where Newpress lives.',
    stats: [
      { number: '54%', text: 'of Americans now access news via social or video networks \u2014 surpassing TV and news websites for the first time.', source: 'Reuters Institute, 2025' },
      { number: '28%', text: 'of Americans have confidence in mass media \u2014 a record low.', source: 'Gallup, 2025' },
      { number: '70%', text: 'of news executives say creators are taking audience attention away from publishers.', source: 'Reuters / Nieman Lab' },
    ],
  },

  // ─── 3. SOLUTION — HOW ───
  {
    layout: 'solution',
    label: 'SOLUTION \u2014 HOW',
    headline: 'The journalist is the brand.\nThe newsroom is the backbone.',
    body: 'Every model that exists right now has a structural flaw. Legacy media has the journalism \u2014 but not the audience. The creator economy has the audience \u2014 but not the infrastructure. Venture digital tried to bridge both and collapsed under its own overhead.',
    subhead: 'Newpress is built differently.',
    points: [
      'Creator-led shows with direct audience trust',
      'Small, elite teams \u2014 not large editorial staffs',
      'Shared reporting, production, and visual infrastructure',
      'Cross-platform storytelling built for modern distribution',
      'Multiple revenue streams built around each show',
    ],
    kicker: 'Creators build single shows. Media companies build expensive institutions. Newpress builds both.',
  },

  // ─── 4. WHY NOW ───
  {
    layout: 'whynow',
    stripe: 'yellow',
    label: 'WHY NOW?',
    headline: 'The talent and the audience are moving at the same time.',
    sections: [
      {
        num: '1',
        title: 'The audience has already moved.',
        text: 'YouTube held the highest share of TV viewing every single month in 2025, overtaking Disney and Netflix. 38% of adults under 30 regularly get news from creators. This isn\u2019t a trend \u2014 it\u2019s the new baseline.',
        source: 'Nielsen, 2025 \u00B7 Pew Research Center',
      },
      {
        num: '2',
        title: 'Legacy talent is available \u2014 right now.',
        text: 'Top-tier journalists are leaving institutions in waves. Trust in national news organizations has dropped 20 points since 2016. The people who built the best journalism of the last decade are looking for a new home.',
        source: 'Pew Research Center',
      },
      {
        num: '3',
        title: 'Ad dollars are beginning to move.',
        text: 'Linear TV advertising is entering structural decline. Brands know the audience has left \u2014 and the budgets are starting to follow. The company that can offer a premium, brand-safe, creator-native environment will absorb that migration.',
      },
    ],
  },

  // ─── 5. MARKET — AD MIGRATION ───
  {
    layout: 'market',
    bg: 'burgundy',
    label: 'MARKET \u2014 THE AD MIGRATION',
    headline: '$60 billion is looking\nfor a new home.',
    body: 'Linear TV advertising is in structural decline. Over $60B in annual US ad spend is beginning to move out of television as audiences shift to digital platforms. This isn\u2019t a gradual drift \u2014 it\u2019s a structural reallocation happening in real time.',
    stats: [
      { number: '$250B', label: 'Creator economy\ntoday' },
      { number: '$480B', label: 'Creator economy\nby 2027 (projected)', source: 'Goldman Sachs' },
      { number: '$60B+', label: 'Linear TV ad spend\nunder pressure' },
      { number: '48%', label: 'Ad decision-makers call\ncreator partnerships \u201Cmust-buy\u201D', source: 'IAB' },
    ],
  },

  // ─── 6. MARKET — DESTINATION PROBLEM ───
  {
    layout: 'statement',
    label: 'MARKET \u2014 THE DESTINATION PROBLEM',
    labelDot: 'red',
    headline: 'Brands want to move.\nThey don\u2019t know where to land.',
    body: 'Creators are capturing the audience. Brands want to follow. But most of the creator economy can\u2019t absorb enterprise-scale advertising \u2014 not safely, not at the quality brands require.',
    bullets: [
      'Brand safety and editorial standards',
      'Professional production quality',
      'Scalable partnership infrastructure',
      'Consistent audience trust \u2014 not algorithmic reach',
    ],
    bulletLabel: 'WHAT BRANDS NEED THAT MOST CREATORS CAN\u2019T OFFER',
    kicker: 'The result: billions in ad budget sitting on the sidelines, waiting for a home that doesn\u2019t exist yet.',
  },

  // ─── 7. MARKET — OUR POSITION ───
  {
    layout: 'position',
    bg: 'blue',
    label: 'MARKET \u2014 OUR POSITION',
    headline: 'We are built for\nthis moment.',
    quote: 'Brand ads in vetted, premium media environments drive a 40% higher increase in purchase intent than those in lower-quality social feeds.',
    body: 'Our creator-led media brands are ready to absorb the next generation of advertising. We\u2019re not asking brands to take a chance on creators. We\u2019re giving them what they\u2019ve been waiting for: the reach of YouTube with the trust of a newsroom.',
  },

  // ─── 8. BUSINESS MODEL ───
  {
    layout: 'business',
    label: 'BUSINESS MODEL',
    labelDot: 'green',
    headline: 'Two revenue streams.\nOne flywheel.',
    subhead: 'We\u2019ve already built a profitable business with this model. Now we scale it.',
    col1: {
      title: 'ADVERTISING',
      points: [
        'YouTube ad revenue: 30M+ monthly views, 13-min avg watch time, premium CPMs',
        'Brand partnerships: host-read integrations, presenting sponsorships, multi-creator bundles',
        'Enterprise sales opportunity: bridge legacy TV ad budgets to the creator economy',
      ],
    },
    col2: {
      title: 'SUBSCRIBER PLATFORM',
      intro: 'Newpress.com membership launched February 19, 2026. Zero paid marketing.',
      stats: [
        { number: '34,773', label: 'Total members' },
        { number: '3,937', label: 'Paid subscribers' },
        { number: '$236K', label: 'Revenue banked' },
        { number: '11%', label: 'Paid conversion rate' },
      ],
      kicker: 'In two weeks.',
    },
  },

  // ─── 9. COMPETITION ───
  {
    layout: 'competition',
    stripe: 'red',
    label: 'COMPETITION \u2014 WHAT WE\u2019RE NOT',
    cards: [
      {
        title: 'NOT LEGACY MEDIA',
        text: 'Traditional newsrooms built for television and print. Great journalism, wrong distribution. Not designed for the platforms or formats where audiences now learn.',
        accent: false,
      },
      {
        title: 'NOT VENTURE DIGITAL',
        sub: 'Vox \u00B7 BuzzFeed \u00B7 Vice',
        text: 'Built to chase traffic scale. Required massive headcount and constant publishing volume. When platforms shifted, the economics collapsed.',
        accent: false,
      },
      {
        title: 'NOT SOLO CREATORS',
        text: 'Massive reach, real trust \u2014 but one person is one point of failure. No reporting infrastructure. No editorial floor. No flywheel.',
        accent: false,
      },
      {
        title: 'WHAT WE ARE',
        text: 'Creator-led journalism built to scale. Trusted creators supported by shared newsroom infrastructure. The reach of YouTube. The trust of a newsroom. The economics of neither.',
        accent: true,
      },
    ],
  },

  // ─── 10. CREATORS ───
  {
    layout: 'creators',
    label: 'CREATORS \u2014 PROOF OF CONCEPT',
    headline: 'They didn\u2019t inherit their audiences.\nThey earned them.',
    stages: [
      {
        num: '1',
        title: 'THE PROOF OF CONCEPT',
        name: 'Johnny Harris',
        detail: 'Built from scratch. Emmy-winning journalist. 7.5M subscribers. 3.2M average views per video.',
        sub: 'The playbook that became Newpress.',
        image: null, // PLACEHOLDER — need Johnny headshot
        channel: null,
      },
      {
        num: '2',
        title: 'THE PLAYBOOK IS EXPORTABLE',
        creators: [
          {
            name: 'Search Party \u00B7 Sam Ellis',
            detail: 'Emmy nominated. Formerly Vox Atlas. Geopolitics and sport. 891K subscribers.',
            image: null, // PLACEHOLDER — need Sam headshot
            channel: '/deck/search-party-banner.jpg',
          },
          {
            name: 'Tunnel Vision \u00B7 Christophe Haubursin',
            detail: 'Emmy nominated. Formerly Vox. Tech and internet investigations. 286K subscribers.',
            image: '/deck/christophe.png',
            channel: '/deck/tunnel-vision-banner.jpg',
          },
        ],
      },
      {
        num: '3',
        title: 'THE MOST IMPORTANT PROOF',
        name: 'The Bigger Picture \u00B7 Max Fisher',
        detail: 'Pulitzer Prize finalist. A decade at The Washington Post and The New York Times. Founding editor of Vox. Not video-native.',
        sub: 'Newpress can modernize the best talent from collapsing legacy newsrooms.',
        image: null, // PLACEHOLDER — need Max headshot
        channel: null, // PLACEHOLDER — need Bigger Picture art
      },
    ],
    kicker: 'Newpress owns the intellectual property of all four channels.',
  },

  // ─── 11. THE HUMAN ELEMENT ───
  {
    layout: 'series',
    bg: 'sepia',
    label: 'THE HUMAN ELEMENT \u2014 IN DEVELOPMENT',
    headline: 'The next evolution of\nwhat already works.',
    tagline: 'Anthony Bourdain meets 60 Minutes.',
    body: 'A premium adventure documentary series explaining the invisible forces reshaping our world \u2014 geopolitics, climate, trade, technology \u2014 through the lives of people at the center of change. Cinematic. Rigorous. Human.',
    episodes: ['Taiwan', 'Myanmar', 'Palau', 'Nepal', '+ 8 more'],
    proof: 'Johnny\u2019s existing field documentaries already average 4 million views at 40\u201360 minute runtimes.',
    status: 'In active development. In talks with YouTube for a New York City premiere in Fall 2026.',
    image: null, // PLACEHOLDER — need The Human Element key art
  },

  // ─── 12. TEAM ───
  {
    layout: 'team',
    label: 'TEAM',
    headline: 'Built this once.\nNow we build it at scale.',
    members: [
      {
        name: 'Iz Harris',
        title: 'Co-Founder & CEO',
        detail: 'Formerly Vox Media. Built Newpress from the ground up alongside Johnny.',
        image: '/deck/iz-harris.png',
      },
      {
        name: 'Johnny Harris',
        title: 'Co-Founder',
        detail: '7.5M subscribers. The proof of concept and primary distribution engine.',
        image: null, // PLACEHOLDER
      },
      {
        name: 'Michael Letta',
        title: 'Chief Operating Officer',
        detail: 'Has scaled multiple media startups from early stage to institutional operations.',
        image: null, // PLACEHOLDER
      },
      {
        name: 'Jon Laurence',
        title: 'VP Production',
        detail: 'Emmy and Peabody Award winner. Formerly AJ+, NowThis, Channel 4 UK.',
        image: null, // PLACEHOLDER
      },
      {
        name: 'Adam Freelander',
        title: 'Supervising Producer',
        detail: 'Formerly Vox and The New York Times.',
        image: null, // PLACEHOLDER
      },
    ],
  },

  // ─── 13. FINANCIALS ───
  {
    layout: 'financials',
    bg: 'yellow',
    label: 'FINANCIALS',
    headline: 'Profitable from day one.\n30% growth. Zero outside capital.',
    stats: [
      { number: '$4.5M', label: 'FY25 top-line\nrevenue' },
      { number: '~30%', label: 'Year-over-year\ngrowth' },
      { number: '$0', label: 'Outside capital\nraised' },
      { number: '$236K', label: 'Membership revenue\nfirst 2 weeks, no marketing' },
    ],
    kicker: 'Six years. Profitable every year. Built without a single outside dollar.\nThis raise is not a lifeline. It\u2019s an accelerant.',
  },

  // ─── 14. THE RAISE ───
  {
    layout: 'raise',
    stripe: 'blue',
    label: 'THE RAISE \u2014 USE OF PROCEEDS',
    headline: '$20M to go from profitable boutique\nto definitive media house.',
    allocations: [
      {
        pct: '40%',
        title: 'CHANNEL EXPANSION',
        text: 'Identify, recruit, and launch a new cohort of world-class journalists. We provide the infrastructure and distribution \u2014 they bring the talent and trust.',
        color: 'blue',
      },
      {
        pct: '35%',
        title: 'OPERATIONAL EXCELLENCE',
        text: 'Institutional-grade production, rigorous fact-checking, and operational leadership. More output without sacrificing the Newpress standard.',
        color: 'yellow',
      },
      {
        pct: '25%',
        title: 'REVENUE ENGINE',
        text: 'Dedicated enterprise salesforce to bridge legacy ad budgets to the creator economy. Expanding the subscriber platform.',
        color: 'red',
      },
    ],
  },

  // ─── 15. VISION ───
  {
    layout: 'vision',
    bg: 'blue',
    label: 'VISION \u2014 5 YEARS',
    headline: 'The definitive media house\nof the next decade.',
    body: 'In 5 years, Newpress is what HBO was to cable and what Netflix was to streaming \u2014 the company that defined what premium journalism looks like in the platform era.',
    phases: [
      {
        title: 'YEAR 1\u20132',
        items: ['10+ channels launched', 'The Human Element on air', 'Enterprise sales team built', '100K paid members'],
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
  },
];

export default slides;
