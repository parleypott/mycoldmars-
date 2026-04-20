/**
 * Flying Money Quiz — Question Bank
 * Sourced from Johnny Harris's "How Criminals Move Trillions Without a Trace"
 * 10 easy + 10 hard = 20 total questions
 */

const easy = [
  {
    question: 'What dynasty invented flying money?',
    options: ['Song Dynasty', 'Tang Dynasty', 'Ming Dynasty', 'Han Dynasty'],
    answer: 1,
    explanation: 'Merchants in the Tang Dynasty created a system of paper receipts to avoid carrying heavy copper coins — the origin of "flying money."',
    timecode: 329,
  },
  {
    question: 'Flying money is thought to be the first form of what?',
    options: ['Banking', 'Paper money', 'Cryptocurrency', 'Wire transfers'],
    answer: 1,
    explanation: 'These paper receipts were essentially IOUs that could be redeemed for coins — making them the first known form of paper money.',
    timecode: 416,
  },
  {
    question: 'What is the foundation that makes flying money work?',
    options: ['Technology', 'Trust', 'Government backing', 'Gold reserves'],
    answer: 1,
    explanation: 'The entire system runs on trust between brokers. No contracts, no receipts — just mutual faith that debts will be settled.',
    timecode: 403,
  },
  {
    question: 'How much in illicit proceeds flows through criminal systems annually?',
    options: ['$500 billion', '$1 trillion', '$4 trillion', '$10 trillion'],
    answer: 2,
    explanation: 'An estimated $4 trillion in illicit proceeds flows through these shadow financial systems every year.',
    timecode: 116,
  },
  {
    question: 'What annual limit did China set on moving money out of the country?',
    options: ['$10,000 USD', '$25,000 USD', '$50,000 USD', '$100,000 USD'],
    answer: 2,
    explanation: 'China caps outbound transfers at $50,000 per person per year, driving demand for underground money-moving systems.',
    timecode: 553,
  },
  {
    question: 'What is hawala described as in Afghanistan?',
    options: ['An illegal network', 'The de facto banking system', 'A terrorist funding tool', 'A government program'],
    answer: 1,
    explanation: 'In Afghanistan, hawala isn\'t underground at all — it\'s the de facto banking system that most of the country relies on.',
    timecode: 852,
  },
  {
    question: 'What is called "the cocaine of the sea"?',
    options: ['Shark fin', 'Totoaba swim bladder', 'Sea cucumber', 'Abalone'],
    answer: 1,
    explanation: 'Totoaba swim bladders are so valuable on the black market that they\'ve earned the nickname "the cocaine of the sea."',
    timecode: 1330,
  },
  {
    question: 'Which cartel got into illegal fishing in northern Mexico?',
    options: ['Jalisco New Generation', 'Sinaloa Cartel', 'Gulf Cartel', 'Los Zetas'],
    answer: 1,
    explanation: 'The Sinaloa Cartel expanded into poaching totoaba fish in the Sea of Cortez because the profits rivaled drug trafficking.',
    timecode: 1304,
  },
  {
    question: 'What kind of store does the Chinese broker in the US run as a front?',
    options: ['Grocery store', 'Laundromat', 'Electronics store', 'Restaurant'],
    answer: 2,
    explanation: 'The broker operates an electronics store as a front business, using it to move and launder money through seemingly legitimate transactions.',
    timecode: 1537,
  },
  {
    question: 'What two technologies could make flying money "almost unbreakable"?',
    options: [
      'AI and blockchain',
      'Encryption and decentralized currency',
      'VPNs and dark web',
      'Quantum computing and satellites',
    ],
    answer: 1,
    explanation: 'Encryption and decentralized currencies like crypto could make these shadow networks nearly impossible for law enforcement to crack.',
    timecode: 1815,
  },
];

const hard = [
  {
    question: 'What form of currency were people using in Tang Dynasty China?',
    options: ['Silver bars', 'Copper coins', 'Gold nuggets', 'Silk bolts'],
    answer: 1,
    explanation: 'People carried heavy strings of copper coins, which made long-distance trade dangerous and impractical — sparking the invention of flying money.',
    timecode: 339,
  },
  {
    question: 'What percentage of world GDP is estimated to be proceeds of crime?',
    options: ['Less than 1%', '1 to 2%', '3 to 5%', '8 to 10%'],
    answer: 2,
    explanation: 'The UN estimates that 3 to 5% of global GDP — trillions of dollars — comes from criminal activity.',
    timecode: 109,
  },
  {
    question: 'How many elephants were lost per year to ivory trade when Andrea started?',
    options: ['5,000 to 10,000', '15,000 to 20,000', '40,000 to 50,000', '100,000+'],
    answer: 2,
    explanation: 'When Andrea Crosta began investigating, 40,000 to 50,000 elephants were being killed every year for their ivory.',
    timecode: 971,
  },
  {
    question: 'What did Andrea Crosta create to fight environmental crime?',
    options: [
      'A wildlife sanctuary',
      'The first intelligence agency for Earth',
      'An international police force',
      'A blockchain tracking system',
    ],
    answer: 1,
    explanation: 'Andrea Crosta created what he calls "the first intelligence agency for Earth" — dedicated to investigating and exposing environmental crime networks.',
    timecode: 987,
  },
  {
    question: 'How did the broker hide $2M in a refrigerator trade deal?',
    options: [
      'Hid cash inside the refrigerators',
      'Under-invoiced the goods by $2 million',
      'Used fake shipping documents',
      'Created a shell company',
    ],
    answer: 1,
    explanation: 'The broker arranged a legitimate refrigerator shipment but under-invoiced by $2 million, allowing that difference to be settled off the books.',
    timecode: 793,
  },
  {
    question: 'How much drug cash vanished from US streets in one city?',
    options: ['More than $10 million', 'More than $50 million', 'More than $100 million', 'More than $500 million'],
    answer: 1,
    explanation: 'Law enforcement noticed more than $50 million in drug cash simply vanished from the streets of one US city — moved out through flying money networks.',
    timecode: 88,
  },
  {
    question: 'Totoaba swim bladders sell for what price range?',
    options: [
      'Hundreds of dollars per kilogram',
      'A few thousand dollars per kilogram',
      'Tens of thousands of dollars per kilogram',
      'Over a million dollars per kilogram',
    ],
    answer: 2,
    explanation: 'Totoaba swim bladders fetch tens of thousands of dollars per kilogram on the black market, making them more valuable by weight than many drugs.',
    timecode: 1346,
  },
  {
    question: "In the video's example, the Italian mafia's cash goes to a Chinese broker in which city?",
    options: ['Milan', 'Rome', 'Naples', 'London'],
    answer: 1,
    explanation: 'In the illustrated example, the Italian mafia hands their cash to a Chinese broker operating in Rome.',
    timecode: 1701,
  },
  {
    question: 'What does the Chinese broker in Rome buy for a Russian oligarch?',
    options: ['Real estate', 'Luxury cars', 'Fine art', 'Yachts'],
    answer: 1,
    explanation: 'The broker uses the mafia\'s cash to buy luxury cars on behalf of a Russian oligarch, settling debts across multiple criminal networks at once.',
    timecode: 1707,
  },
  {
    question: 'What fentanyl precursor chemical is shipped from China to settle cartel debts?',
    options: ['Methylamine', 'Phenylethyl bromide', 'Acetic anhydride', 'Pseudoephedrine'],
    answer: 1,
    explanation: 'Phenylethyl bromide, a key precursor for manufacturing fentanyl, is shipped from China to Mexican cartels as part of the flying money settlement cycle.',
    timecode: 1423,
  },
];

export { easy, hard };
