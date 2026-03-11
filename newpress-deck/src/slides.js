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
    body: 'Legacy media is losing the audience it needs to fund the journalism. Creators are gaining the audience without the infrastructure to do good journalism.',
    body2: 'This shift has created a massive gap in the media ecosystem. The gap between them is where Newpress lives.',
    stats: [
      { number: '54%', text: 'of Americans now access news via social or video networks, surpassing TV (50%) and news websites/apps (48%) for the first time.', source: 'Reuters Institute Digital News Report, 2025' },
      { number: '28%', text: 'of Americans have confidence in mass media \u2014 a record low.', source: 'Gallup, 2025' },
      { number: '70%', text: 'of news executives say creators are taking audience attention away from publishers.', source: 'Nieman Journalism Lab / Reuters Institute Trends Report' },
      { number: '#1', text: 'YouTube is #1 \u2014 highest share of TV viewing every single month in 2025, overtaking Disney and Netflix.', source: 'Nielsen Media Distributor Gauge, 2025' },
    ],
  },

  // ─── 3. SOLUTION ───
  {
    layout: 'statement',
    bg: 'green',
    label: 'SOLUTION',
    headline: 'Newpress\u2019s creator-led model combines the trust and reach of creators with the rigor of a newsroom.',
    body: 'By providing shared editorial, operational and production infrastructure behind each show, we enable trusted creators to produce high-quality journalism that can scale across multiple platforms into a durable media franchise.',
    kicker: 'Infrastructure makes creator-led journalism possible. Our editorial model is what makes it trusted.',
    image: '/deck/jh-myanmar.gif',
  },

  // ─── 4. COMPETITORS ───
  {
    layout: 'competition',
    bg: 'burgundy',
    label: 'COMPETITORS',
    competitorHeadline: 'The next generation of journalism won\u2019t come from existing media models.',
    cards: [
      {
        title: 'NOT LEGACY MEDIA',
        text: 'Newsrooms built for television and print distribution. Strong reporting, but disconnected from where audiences now live.',
        accent: false,
      },
      {
        title: 'NOT VENTURE DIGITAL MEDIA',
        sub: 'Vox \u00B7 BuzzFeed \u00B7 Vice',
        text: 'Traffic-driven editorial machines built to chase ad volume at scale. Massive headcount, endless publishing, fragile economics.',
        accent: false,
      },
      {
        title: 'NOT SOLO CREATORS',
        text: 'Creators with enormous reach, but limited reporting infrastructure, editorial rigor, and long-term scalability.',
        accent: false,
      },
    ],
    footer: 'None of these models solve the core challenge of modern journalism: trust, scale, and sustainability, all at once.',
  },

  // ─── 5. NEWPRESS EDITORIAL MODEL ───
  {
    layout: 'statement',
    bg: 'warm',
    label: 'NEWPRESS EDITORIAL MODEL',
    headline: 'In a polarized media environment, attention is rewarded for speed, outrage, and certainty.',
    body: 'Newpress is built differently.',
    bullets: [
      'Understanding over noise',
      'Nuance over certainty',
      'Visual storytelling that makes complexity accessible',
      'Creator voices grounded in transparency and rigor',
      'Depth over volume',
    ],
    kicker: 'When audiences trust the journalism, they return again and again. That loyalty is what allows creator-led journalism to scale, and it\u2019s exactly what we\u2019re seeing across our shows today.',
    callout: '70% of Newpress views come from returning viewers',
  },

  // ─── 5. PROOF OF CONCEPT ───
  {
    layout: 'proofOfConcept',
    bg: 'burgundy',
    label: 'PROOF OF CONCEPT',
    headline: 'The Newpress model\nis already working.',
    intro: 'Today, our shows reach:',
    heroStats: [
      { number: '13M+', label: 'followers' },
      { number: '30M', label: 'monthly views' },
      { number: '70%', label: 'returning viewers' },
    ],
    kicker: 'Our shows are built in the language of the internet, designed for mass distribution across YouTube and social platforms, proving the power of creator-led journalism at scale.',
  },

  // ─── 6. HERE'S HOW WE PROVED IT ───
  {
    layout: 'creators',
    bg: 'warm',
    headline: 'The shows we\u2019ve built so far.',
    heroImage: '/deck/creators.gif',
    stages: [
      {
        num: '1',
        title: 'THE PROOF OF CONCEPT',
        subtitle: 'Built from scratch. 3.2M average video views. The playbook that became Newpress.',
        name: 'Johnny Harris',
        tagline: 'Examining the systems that run our world through the voices of those most affected.',
        detail: 'Ex-Vox Borders, Emmy winning.',
        subs: '7.5M subscribers / 4.4M followers',
        image: '/deck/johnny-harris.png',
        youtube: 'https://www.youtube.com/@johnnyharris',
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
            subs: '1M subscribers',
            image: '/deck/sam-ellis.png',
            channel: '/deck/search-party-banner.jpg',
            youtube: 'https://www.youtube.com/@SearchParty',
          },
          {
            name: 'Tunnel Vision \u00B7 Christophe Haubursin',
            tagline: 'Using OSINT to solve internet mysteries and bring viewers along for the journey.',
            detail: 'Ex-Vox, Emmy nominated.',
            subs: '286K subscribers',
            image: '/deck/christophe.png',
            channel: '/deck/tunnel-vision-banner.jpg',
            youtube: 'https://www.youtube.com/@christophe',
          },
        ],
      },
      {
        num: '3',
        title: 'EXPANDING THE MODEL',
        subtitle: 'We took a legacy journalist, not video-native \u2014 and successfully translated him into the creator era.',
        name: 'The Bigger Picture \u00B7 Max Fisher',
        tagline: 'Illuminating our world\u2019s inner workings, from geopolitics to our deepest mental recesses.',
        detail: 'Pulitzer finalist, ex-NYT, ex-WaPo, founding editor of Vox.',
        subs: '45K subscribers',
        image: '/deck/max-fisher.png',
        youtube: 'https://www.youtube.com/@maxfisher',
      },
    ],
  },

  // ─── 7. MARKET POTENTIAL ───
  {
    layout: 'marketQuote',
    bg: 'sepia',
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

  // ─── 8. MARKET — THE DESTINATION ───
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

  // ─── 9. WE ARE BUILT FOR THIS MOMENT ───
  {
    layout: 'monetization',
    bg: 'blue',
    headline: 'We are built for\nthis moment.',
    body: 'Our creator-led media brands are ready to absorb the next generation of advertising. A brand-safe environment where creators can produce high-quality content at scale.',
    revenueOpp: {
      label: 'REVENUE OPPORTUNITY',
      body: 'Combine proven media models with direct audience relationships of the creator economy.',
      bullets: ['Merchandise & products', 'Podcast expansion', 'Newsletters & owned audiences', 'Licensing & syndication', 'Streaming & distribution deals'],
    },
  },

  // ─── 11. BUSINESS MODEL ───
  {
    layout: 'business',
    bg: 'warm',
    label: 'BUSINESS MODEL',
    headline: 'We\u2019ve already built a foundational business model with two core revenue streams.',
    col1: {
      title: 'ADVERTISING',
      programmatic: { number: '$100K', label: 'PROGRAMMATIC / MONTH' },
      partnerLabel: 'BRAND PARTNERSHIPS (PER VIDEO)',
      partners: [
        { channel: 'Johnny Harris', range: '$100\u2013150K' },
        { channel: 'Search Party', range: '$8\u201315K' },
        { channel: 'Tunnel Vision', range: '$10\u201320K' },
        { channel: 'The Bigger Picture', range: '$8\u201315K' },
      ],
    },
    col2: {
      title: 'SUBSCRIPTION',
      intro: 'Newpress.com membership: launched Feb 19, 2026. Zero paid marketing.',
      stats: [
        { number: '36,143', label: 'Members' },
        { number: '4,056', label: 'Paid subscribers' },
        { number: '11%', label: 'Paid conversion' },
      ],
    },
  },

  // ─── 13. NEW MEMBERSHIP PLATFORM ───
  {
    layout: 'subscriberModel',
    bg: 'burgundy',
    label: 'NEW MEMBERSHIP PLATFORM',
    body: 'Newpress.com is the home for the most curious audience on the internet. Launched in February 2026, we already have over 40k active users and over 4k paying ($60/yr). The platform gives our audience a place to contribute to reporting and witness stories as they take shape. Over time, it will grow into a destination people return to each week to understand the world, and explore ideas together.',
    images: [
      '/deck/sub-homepage.png',
      '/deck/sub-palau.png',
      '/deck/sub-comment.png',
      '/deck/sub-tinder.png',
    ],
  },

  // ─── 14. THE HUMAN ELEMENT ───
  {
    layout: 'humanElement',
    bg: 'ink',
    label: 'THE HUMAN ELEMENT',
    poster: '/deck/human-element-poster.png',
    headline: 'We\u2019re reinventing documentary\nfor the YouTube age.',
    body1: 'Johnny Harris has built one of the largest audiences for explanatory journalism on the internet.',
    body2: 'His new show, The Human Element, brings investigative journalism and cinematic storytelling into the creator era.',
    body3: 'The goal isn\u2019t just views. It\u2019s to build the kind of documentary that impacts culture, wins awards, and builds the credibility that powers the Newpress network.',
    comingSoon: 'Coming Fall 2026.',
  },

  // ─── 15. TEAM ───
  {
    layout: 'team',
    bg: 'warm',
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
        image: '/deck/johnny-harris.png',
      },
      {
        name: 'Michael Letta',
        title: 'Chief Operating Officer',
        detail: 'Experienced builder and operator. Inherently financial.',
        image: '/deck/michael-letta.jpg',
      },
      {
        name: 'Jon Laurence',
        title: 'VP Production',
        detail: 'Emmy & Peabody winner. Formerly AJ+, NowThis, Channel 4 UK.',
        image: '/deck/jon-laurence.jpg',
      },
      {
        name: 'Adam Freelander',
        title: 'Supervising Producer, Editorial',
        detail: 'Formerly Vox and NYT.',
        image: '/deck/adam-freelander.jpg',
      },
    ],
  },

  // ─── 16. THE OPPORTUNITY ───
  {
    layout: 'fundingAsk',
    bg: 'green',
    label: 'THE OPPORTUNITY',
    headline: 'We are raising growth capital.\nHere\u2019s the opportunity.',
    opportunities: [
      {
        title: 'Undermonetized audience',
        text: 'Tens of millions of followers with only very early traction (newly launched membership product) leaving significant room to grow direct to consumer.',
      },
      {
        title: 'Distribution upside',
        text: 'Outsized growth potential through YouTube optimization, growing demand for Shorts, broader social platform expansion and licensing and syndication.',
      },
      {
        title: 'Untapped channel expansion',
        text: 'Proven explainer, visual-first formats can scale into multiple creator-led shows, expanding the network toward 100M+ subscribers across platforms.',
      },
      {
        title: 'Undermonetized content',
        text: 'Trust, loyalty, and attention at scale should attract and unlock more premium sponsorships, large-scale advertising opportunities, and elite brand partnerships.',
      },
    ],
  },

  // ─── 17. HOW WE SCALE ───
  {
    layout: 'howWeScale',
    bg: 'green',
    label: 'HOW WE SCALE',
    headline: 'This investment will accelerate four core areas of the Newpress model.',
    sections: [
      {
        num: '1',
        title: 'Creator Expansion',
        text: 'Launch and scale new creator-led journalism brands.',
        bullets: [
          'Recruit top journalists leaving institutions',
          'Launch new shows using the Newpress production playbook',
          'Expand existing shows into multi-platform media brands',
        ],
      },
      {
        num: '2',
        title: 'Flagship Show Development',
        text: 'Invest in premium programming such as Human Element to evolve the Newpress model and push the boundaries of creator-led journalism.',
        bullets: [
          'Develop flagship documentary-style programming',
          'Establish signature shows that elevate the entire network',
        ],
      },
      {
        num: '3',
        title: 'Editorial & Production Infrastructure',
        text: 'Build the editorial systems that allow creators and trust to scale.',
        bullets: [
          'Reporting and research teams',
          'Production and visual storytelling capacity',
          'Shared editorial standards and workflows',
        ],
      },
      {
        num: '4',
        title: 'Audience & Revenue Expansion',
        text: 'Strengthen direct audience relationships and monetization.',
        bullets: [
          'Membership growth and owned audience channels',
          'Brand partnerships and advertising expansion to more premium partners',
          'Podcasts, newsletters, and licensing opportunities',
        ],
      },
    ],
  },

  // ─── 18. VISION ───
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

  // ─── 19. APPENDIX / FINANCIALS ───
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
