/**
 * Newpress Investor Deck — Slide Data
 * Source: Google Doc (published) — strictly followed
 * Images: /deck/ folder in public
 */

const slides = [
  // ─── 1. TITLE ───
  {
    layout: 'title',
    bg: 'yellow',
    headline: 'Creator-led media company\nbuilt to scale.',
    body: 'Newpress is reimagining the future of journalism: creator-led, visually compelling, and built for the platforms where people actually consume media. By pairing trusted creators with scalable newsroom infrastructure, we turn individual shows into enduring brands.',
    logo: true,
  },

  // ─── 2. PROBLEM ───
  {
    layout: 'data',
    bg: 'blue',
    label: 'PROBLEM',
    headline: 'People don\u2019t trust institutions anymore.\nThey trust people.',
    body: 'Legacy media is losing the audience it needs to fund the journalism. Creators are gaining the audience without the infrastructure to do good journalism. The gap between them is where Newpress lives.',
    body2: 'The information ecosystem rewards headline-grabbing, polarizing content optimized for algorithms, not depth or rigor. Audiences are pushed into echo chambers where fear travels faster than understanding, often leading to fatigue, pessimism, and apathy.',
    stats: [
      { number: '54%', text: 'of Americans now access news via social or video networks, surpassing TV (50%) and news websites/apps (48%) for the first time.', source: 'Reuters Institute Digital News Report, 2025' },
      { number: '28%', text: 'of Americans have confidence in mass media \u2014 a record low.', source: 'Gallup, 2025' },
      { number: '70%', text: 'of news executives say creators are taking audience attention away from publishers.', source: 'Nieman Journalism Lab / Reuters Institute Trends Report' },
    ],
  },

  // ─── 3. SOLUTION ───
  {
    layout: 'statement',
    bg: 'green',
    label: 'SOLUTION',
    headline: 'Newpress combines the trust and reach of creators with the rigor of a newsroom.',
    body: 'By providing shared editorial, operational and production infrastructure behind each show, we enable trusted creators to produce high-quality journalism that can scale across multiple platforms into a durable media franchise.',
    image: '/deck/jh-myanmar.gif',
  },

  // ─── 4. WHY NOW? ───
  {
    layout: 'whynow',
    stripe: 'yellow',
    label: 'WHY NOW?',
    headline: 'Talent and audiences\nare moving fast.',
    subtext: 'We build journalism in the language of the internet \u2014 designed for mass distribution across YouTube and social platforms.',
    reach: 'Today, our shows reach 13M followers, generate 30M monthly views, and maintain 70% returning viewers \u2014 demonstrating the power of creator-led journalism distributed at scale.',
    sections: [
      {
        num: '1',
        title: 'YouTube is #1',
        text: 'Highest share of TV viewing every single month in 2025, overtaking Disney and Netflix.',
        source: 'Nielsen Media Distributor Gauge, 2025',
      },
      {
        num: '2',
        title: 'Talent is available',
        text: 'Top-tier journalists are leaving institutions in waves, looking for a new home. The window to recruit is open now.',
      },
    ],
  },

  // ─── 5. CREATORS ───
  {
    layout: 'creators',
    bg: 'warm',
    label: 'CREATORS',
    headline: 'The shows we\u2019ve built so far.',
    heroImage: '/deck/creators.gif',
    stages: [
      {
        num: '1',
        title: 'THE PROOF OF CONCEPT',
        name: 'Johnny Harris',
        tagline: 'Examining the systems that run our world through the voices of those most affected.',
        detail: 'Built from scratch. 3.2M average video views. The playbook that became Newpress.',
        subs: '7.5M subscribers',
        image: '/deck/johnny-harris.png',
      },
      {
        num: '2',
        title: 'THE PLAYBOOK IS EXPORTABLE',
        subtitle: 'We proved we can take journalists leaving institutions and launch them successfully with the same quality and velocity.',
        creators: [
          {
            name: 'Search Party \u00B7 Sam Ellis',
            tagline: 'Decoding geopolitics, sports and their unexpected links.',
            detail: 'Ex-Vox Atlas, Emmy nominated.',
            subs: '891K subscribers',
            image: null,
            channel: '/deck/search-party-banner.jpg',
          },
          {
            name: 'Tunnel Vision \u00B7 Christophe Haubursin',
            tagline: 'Using OSINT to solve internet mysteries and bring viewers along for the journey.',
            detail: 'Ex-Vox, Emmy nominated.',
            subs: '286K subscribers',
            image: '/deck/christophe.png',
            channel: '/deck/tunnel-vision-banner.jpg',
          },
        ],
      },
      {
        num: '3',
        title: 'EXPANDING THE MODEL',
        name: 'The Bigger Picture \u00B7 Max Fisher',
        tagline: 'Illuminating our world\u2019s inner workings, from geopolitics to our deepest mental recesses.',
        detail: 'We took a legacy journalist \u2014 not video-native \u2014 and successfully translated him into the creator era. Pulitzer finalist, ex-NYT, ex-WaPo, founding editor of Vox.',
        subs: '45K subscribers',
        image: '/deck/max-fisher.png',
      },
    ],
  },

  // ─── 6. MARKET POTENTIAL ───
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
      'Over $60B in annual ad spend is beginning to move out of television as audiences shift to digital platforms.',
      'The money has to go somewhere.',
      'Brands want to move legacy ad spend to creators but need a rigorous, safe environment. We are the only credible option for journalism.',
    ],
  },

  // ─── 7. MARKET — THE DESTINATION ───
  {
    layout: 'statement',
    bg: 'yellow',
    label: 'MARKET POTENTIAL \u2014 THE DESTINATION',
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

  // ─── 8. MONETIZATION READINESS ───
  {
    layout: 'monetization',
    bg: 'blue',
    label: 'MONETIZATION READINESS',
    headline: 'We are built for\nthis moment.',
    body: 'Our creator-led media brands are ready to absorb the next generation of advertising. A brand-safe environment where creators can produce high-quality content at scale.',
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
        text: 'Traditional newsrooms built for television and print distribution. Strong reporting, but not designed for the platforms or formats where audiences learn.',
        accent: false,
      },
      {
        title: 'NOT VENTURE DIGITAL MEDIA',
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
        traits: ['Creator-led', 'Curiosity-driven', 'Visual-first'],
        text: 'Newpress is not news. We help audiences move beyond the headlines with stories built for true understanding. We\u2019re trusted at scale for prioritizing context, rigor, and depth in our journalism.',
        values: [
          'Understanding > noise',
          'Nuance > polarization',
          'Depth > volume',
        ],
        accent: true,
      },
    ],
  },

  // ─── 10. BUSINESS MODEL ───
  {
    layout: 'business3',
    stripe: 'green',
    label: 'BUSINESS MODEL',
    headline: 'We\u2019ve already built a foundational business model with three core revenue pillars.',
    pillars: [
      {
        title: 'PROGRAMMATIC DIGITAL',
        color: 'blue',
        heroNum: '$100K',
        heroLabel: 'PER MONTH',
        text: 'Digital ad revenue against our 30M+ monthly views across all channels.',
      },
      {
        title: 'BRAND PARTNERSHIPS',
        color: 'yellow',
        partners: [
          { channel: 'JH', range: '100\u2013150K' },
          { channel: 'SP', range: '$8\u201315K' },
          { channel: 'TV', range: '$10\u201320K' },
          { channel: 'TBP', range: '$8\u201315K' },
        ],
      },
      {
        title: 'SUBSCRIBER BASE',
        color: 'green',
        intro: 'Launched Feb 19, 2026. Zero paid marketing.',
        stats: [
          { number: '36,143', label: 'Members' },
          { number: '4,056', label: 'Paid' },
          { number: '11%', label: 'Conversion' },
        ],
      },
    ],
  },

  // ─── 11. SUBSCRIBER MODEL ───
  {
    layout: 'subscriberModel',
    bg: 'ink',
    label: 'SUBSCRIBER MODEL',
    body: 'We are building the home for the most curious audience on the internet. What begins as deeper access to our stories will evolve into a platform where people participate in reporting, explore complex ideas, and spend real time understanding the world together.',
  },

  // ─── 12. THE HUMAN ELEMENT ───
  {
    layout: 'humanElement',
    bg: 'ink',
    label: 'THE HUMAN ELEMENT',
    headline: 'We\u2019re reinventing documentary\nfor the YouTube age.',
    body1: 'Johnny Harris has already built one of the largest audiences for explanatory journalism on the internet.',
    body2: 'His new show will push documentary storytelling into a new medium. The Human Element will combine investigative journalism, cinematic filmmaking, and creator-led storytelling designed for global digital distribution.',
    body3: 'The goal isn\u2019t just views. It\u2019s to build the kind of documentary storytelling that wins Emmys, Oscars, and reaches massive audiences at the same time.',
  },

  // ─── 13. TEAM ───
  {
    layout: 'team',
    label: 'TEAM',
    headline: 'Seasoned Team with\nIndustry Knowledge.',
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
        detail: 'Experienced builder and operator. Inherently financial.',
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

  // ─── 14. FUNDING ASK ───
  {
    layout: 'fundingAsk',
    stripe: 'blue',
    label: 'FUNDING ASK',
    headline: 'We are raising growth capital.\nHere\u2019s the opportunity.',
    opportunities: [
      {
        title: 'Undermonetized audience',
        text: 'Millions of followers with only early monetization across membership and products leaving significant room to grow direct audience revenue.',
      },
      {
        title: 'Undermonetized content',
        text: 'High-performing journalism with limited brand partnerships today; a dedicated sales effort unlocks premium sponsorship and large-scale advertising.',
      },
      {
        title: 'Untapped channel expansion',
        text: 'Proven storytelling formats can scale into multiple creator-led shows, expanding the network toward 100M+ subscribers across platforms.',
      },
      {
        title: 'Distribution upside',
        text: 'Major growth potential through YouTube optimization, Shorts, and broader social platform expansion.',
      },
    ],
    proceedsLabel: 'USE OF PROCEEDS',
    proceeds: [
      'Build a dedicated sales and marketing engine: Unlocking premium partnerships and fully monetizing our growing audience.',
      'Scale the membership platform and commerce layer: Expanding subscriptions, merchandising, and direct audience revenue.',
      'Invest in flagship programming and distribution: Including The Human Element, YouTube optimization, Shorts, and social growth.',
      'Develop live experiences and community: Building deeper audience engagement through events and in-person programming.',
      'Invest in practical studio and production infrastructure: Lean facilities that enable faster, more efficient production across shows.',
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
        items: ['10+ channels', '\u201CHuman Element\u201D on air', 'Enterprise sales team built', '100K paid members'],
      },
      {
        title: 'YEAR 3\u20134',
        items: ['20+ creator network', '$20M+ revenue', 'Dominant in premium creator advertising'],
      },
      {
        title: 'YEAR 5',
        items: ['$40M+ revenue', 'The NBC News of the creator era', 'The place the world\u2019s best journalists want to be'],
      },
    ],
    closing: 'We\u2019ve proven the model. Now we build the institution.',
  },

  // ─── 16. APPENDIX / FINANCIALS ───
  {
    layout: 'appendixFinancials',
    bg: 'yellow',
    label: 'APPENDIX / FINANCIALS',
    headline: 'FY25 Results',
    stats: [
      { number: '$4.4M', label: 'Net revenue*\n+30% growth YoY', note: '*after paid commissions' },
      { number: '$213K', label: 'Net income\n5% profit margin' },
      { number: '$1M', label: 'Cash on-hand' },
      { number: '30', label: 'Headcount' },
    ],
    membershipLabel: 'NEW SEGMENT \u2014 MEMBERSHIP \u2014 LAUNCHED 2/19/26',
    membershipStats: [
      { number: '$243K', label: 'Gross revenue*', note: '*89% gross margin' },
      { number: '$53', label: 'Per paid subscriber' },
    ],
    membershipNote: 'No marketing.',
  },
];

export default slides;
