/**
 * Modern Middle East Quiz — Question Bank
 * Sourced from Johnny Harris's "The Modern Middle East, Explained"
 * 30 easy + 30 hard = 60 total questions
 */

const easy = [
  // ─── OIL & EARLY U.S. INVOLVEMENT ───
  {
    question: 'What resource first brought the United States to the Middle East?',
    options: ['Oil', 'Gold', 'Cotton', 'Diamonds'],
    answer: 0,
    explanation: 'A California oil company explored Saudi Arabia\'s desert in the 1930s, striking oil on March 3, 1938 — and the U.S. never left.',
  },
  {
    question: 'Which country did U.S. oil companies first explore in the Middle East?',
    options: ['Iraq', 'Iran', 'Saudi Arabia', 'Kuwait'],
    answer: 2,
    explanation: 'A California-based company got permission from the Saudi king to explore nearly a million square kilometers of desert for oil.',
  },
  {
    question: 'Where did civilization first begin in the Middle East?',
    options: ['Modern-day Egypt', 'Modern-day Iraq', 'Modern-day Iran', 'Modern-day Turkey'],
    answer: 1,
    explanation: 'The cradle of civilization was in Mesopotamia — modern-day Iraq — where early human societies first developed.',
  },

  // ─── COLD WAR & IRAN ───
  {
    question: 'Why did the U.S. overthrow Iran\'s leader in the 1950s?',
    options: ['He threatened Israel', 'He was too friendly with the Soviet Union', 'He stopped exporting oil', 'He invaded a neighbor'],
    answer: 1,
    explanation: 'The U.S. and UK overthrew Iran\'s democratically-elected leader because they thought he was too friendly with the Soviet Union.',
  },
  {
    question: 'What type of government replaced the U.S.-backed Shah in Iran in 1979?',
    options: ['A military dictatorship', 'A communist state', 'An Islamic republic', 'A constitutional monarchy'],
    answer: 2,
    explanation: 'The Iranian Revolution installed an Islamic republic headed by Ayatollah Khomeini, hostile to both Western powers and the Soviet Union.',
  },
  {
    question: 'Which superpower was the U.S. trying to keep out of the Middle East during the Cold War?',
    options: ['China', 'The Soviet Union', 'Japan', 'Germany'],
    answer: 1,
    explanation: 'In the 1950s-60s, the Soviet Union was coming into the region trying to recruit countries to communism, and the U.S. worked to stop them.',
  },

  // ─── OSAMA & AL-QAEDA ───
  {
    question: 'Which group founded by Osama bin Laden carried out attacks against the U.S.?',
    options: ['Hamas', 'Hezbollah', 'Al-Qaeda', 'The Taliban'],
    answer: 2,
    explanation: 'Bin Laden started Al-Qaeda during the war in Afghanistan. Its mission was to fight superpowers invading the Middle East.',
  },
  {
    question: 'In which country did Osama bin Laden fight against the Soviet Union?',
    options: ['Iraq', 'Syria', 'Afghanistan', 'Yemen'],
    answer: 2,
    explanation: 'Bin Laden joined rebel fighters in Afghanistan to fight the Soviet invasion. The U.S. secretly supported these fighters with weapons and money.',
  },
  {
    question: 'How many children did Mohammed bin Laden, Osama\'s father, have?',
    options: ['12', '28', '54', '70'],
    answer: 2,
    explanation: 'Mohammed bin Laden had 54 children from 22 wives — a common practice among wealthy Saudis.',
  },

  // ─── IRAN-IRAQ WAR ───
  {
    question: 'Which two countries fought an eight-year war from 1980 to 1988?',
    options: ['Iraq and Kuwait', 'Iran and Iraq', 'Syria and Israel', 'Egypt and Libya'],
    answer: 1,
    explanation: 'The Iran-Iraq War killed over a million people. After eight years, the borders were unchanged from before the fighting.',
  },
  {
    question: 'What type of illegal weapon did Saddam Hussein use against the Kurds and Iranians?',
    options: ['Nuclear bombs', 'Chemical weapons', 'Landmines', 'Biological agents'],
    answer: 1,
    explanation: 'Saddam dropped shells filled with mustard gas — weapons banned under international law — killing thousands of Kurdish civilians.',
  },
  {
    question: 'Who started the Iran-Iraq War by invading first?',
    options: ['Iran', 'Iraq', 'The United States', 'Kuwait'],
    answer: 1,
    explanation: 'Saddam Hussein sent his air force and 10,000 troops across the border in September 1980, thinking Iran was weak after its revolution.',
  },

  // ─── GULF WAR ───
  {
    question: 'Which country did Saddam Hussein invade in 1990, prompting U.S. intervention?',
    options: ['Iran', 'Kuwait', 'Saudi Arabia', 'Syria'],
    answer: 1,
    explanation: 'Saddam invaded Kuwait seeking its oil, believing he was owed spoils for fighting Iran. The U.S. crushed his army in 43 days.',
  },
  {
    question: 'Who flew to Saudi Arabia to organize the military response to Saddam\'s invasion of Kuwait?',
    options: ['Colin Powell', 'Donald Rumsfeld', 'Dick Cheney', 'George Bush Sr.'],
    answer: 2,
    explanation: 'Dick Cheney flew to Saudi Arabia the day after the invasion. The Saudis told him to come with as much force as possible.',
  },

  // ─── IRAQ WAR ───
  {
    question: 'What justification did the Bush administration use to invade Iraq in 2003?',
    options: ['Oil reserves', 'Weapons of mass destruction', 'Harboring bin Laden', 'A border dispute'],
    answer: 1,
    explanation: 'The U.S. claimed Iraq had WMDs. Over a decade of occupation, none were ever found.',
  },
  {
    question: 'How many Iraqi civilians are estimated to have died in the Iraq War?',
    options: ['About 50,000', 'About 100,000', 'About 500,000', 'About 1 million'],
    answer: 2,
    explanation: 'Bush\'s war took the life of an estimated half million Iraqis, and over a decade of occupation, no weapons were found.',
  },

  // ─── BORDERS & EMPIRES ───
  {
    question: 'Which European powers drew the borders of the modern Middle East?',
    options: ['Spain and Portugal', 'Germany and Italy', 'Britain and France', 'The Netherlands and Belgium'],
    answer: 2,
    explanation: 'The British and French carved up the region after defeating the Ottoman Empire, ignoring language, ethnicity, and regional identity.',
  },
  {
    question: 'Which empire controlled the Middle East before European powers carved it up?',
    options: ['The Roman Empire', 'The Mongol Empire', 'The Ottoman Empire', 'The Persian Empire'],
    answer: 2,
    explanation: 'The Ottoman Empire controlled the region until World War I, when European powers defeated it and divided the territory among themselves.',
  },

  // ─── THE KURDS ───
  {
    question: 'What is the name of the large stateless people of the Middle East?',
    options: ['The Kurds', 'The Druze', 'The Bedouin', 'The Berbers'],
    answer: 0,
    explanation: 'The Kurds are spread across Turkey, Iraq, Iran, and Syria. European powers drew borders through their homeland after WWI.',
  },
  {
    question: 'How many countries have significant Kurdish populations?',
    options: ['Two', 'Three', 'Four', 'Five'],
    answer: 2,
    explanation: 'The Kurds are split between Turkey, Iraq, Iran, and Syria — what could have been Kurdistan was divided into four territories.',
  },
  {
    question: 'Which country has the largest Kurdish population?',
    options: ['Iraq', 'Iran', 'Syria', 'Turkey'],
    answer: 3,
    explanation: 'There are more Kurdish people in Turkey than in any other country. The Turkish government has long oppressed them.',
  },

  // ─── ISRAEL-PALESTINE ───
  {
    question: 'What is the name of the violent group that took control of Gaza?',
    options: ['Fatah', 'Hamas', 'Al-Qaeda', 'ISIS'],
    answer: 1,
    explanation: 'Hamas won Palestinian elections and took over Gaza completely, becoming a major factor in the Israeli-Palestinian conflict.',
  },
  {
    question: 'What 1990s agreement first established a Palestinian government authority?',
    options: ['Camp David Accords', 'Oslo Accords', 'Balfour Declaration', 'UN Resolution 1441'],
    answer: 1,
    explanation: 'The Oslo Accords gave Palestinians authority over pockets of land in the West Bank and most of Gaza for the first time.',
  },
  {
    question: 'What is the term for the Palestinian uprisings against Israeli occupation?',
    options: ['Jihad', 'Intifada', 'Nakba', 'Fatwa'],
    answer: 1,
    explanation: 'The Intifadas were uprisings where Palestinians fought back against Israeli occupation — the first started with stone-throwing and boycotts.',
  },
  {
    question: 'Which Israeli leader was assassinated for pursuing peace with Palestinians?',
    options: ['Ariel Sharon', 'Yitzhak Rabin', 'Golda Meir', 'Shimon Peres'],
    answer: 1,
    explanation: 'Yitzhak Rabin was assassinated by a far-right Israeli shortly after signing the second part of the Oslo Accords.',
  },

  // ─── SAUDI ARABIA ───
  {
    question: 'Which country is home to the holiest sites in Islam — Mecca and Medina?',
    options: ['Iran', 'Iraq', 'Saudi Arabia', 'Egypt'],
    answer: 2,
    explanation: 'Saudi Arabia\'s role as guardian of Mecca and Medina gives it a central place in the Islamic world.',
  },

  // ─── HEZBOLLAH ───
  {
    question: 'In which country is Hezbollah based?',
    options: ['Syria', 'Lebanon', 'Iraq', 'Yemen'],
    answer: 1,
    explanation: 'Hezbollah — meaning "party of God" — rose in southern Lebanon to defend against the Israeli occupation in the 1980s.',
  },
  {
    question: 'Which country is Hezbollah\'s primary state sponsor?',
    options: ['Syria', 'Saudi Arabia', 'Iran', 'Turkey'],
    answer: 2,
    explanation: 'Iran picked Hezbollah because they shared goals of Islamic revolution and hostility toward Israel, providing money, weapons, and training.',
  },

  // ─── YEMEN & HOUTHIS ───
  {
    question: 'What are the Houthi rebels named after?',
    options: ['A city in Yemen', 'Their founding leader', 'A mountain range', 'An ancient tribe'],
    answer: 1,
    explanation: 'The Houthis are named after Hussein al-Houthi, the leader who was killed in a cave in northern Yemen fighting the government.',
  },
  {
    question: 'Which waterway did the Houthis threaten by attacking cargo ships?',
    options: ['The Suez Canal', 'The Persian Gulf', 'The Red Sea', 'The Strait of Hormuz'],
    answer: 2,
    explanation: 'The Houthis fired missiles and drones at cargo ships in the Red Sea, where 25% of global container traffic travels.',
  },
];

const hard = [
  // ─── OIL & EARLY U.S. INVOLVEMENT ───
  {
    question: 'What condition did Saudi Arabia set for the first U.S. military base on its soil?',
    options: [
      'No American flags or flagpoles allowed',
      'Only temporary structures permitted',
      'No women could work on base',
      'All personnel must learn Arabic',
    ],
    answer: 0,
    explanation: 'The Saudis told the Americans: "You cannot put your flag anywhere on this base." Instead, the U.S. placed a small plaque on the building.',
  },
  {
    question: 'What "sinful behavior" did American oil workers bring to Saudi Arabia in the 1930s-40s?',
    options: [
      'Gambling and card games',
      'Women driving and alcohol consumption',
      'Western music and dancing',
      'Pork consumption and mixed dining',
    ],
    answer: 1,
    explanation: 'American oil compounds were full of what Saudis considered sinful behavior — like allowing women to drive and consuming alcohol.',
  },
  {
    question: 'What year did the California oil company strike oil in Saudi Arabia?',
    options: ['1932', '1935', '1938', '1941'],
    answer: 2,
    explanation: 'On March 3, 1938, in a patch of coastal desert, they struck oil — launching the U.S.-Saudi relationship that continues today.',
  },

  // ─── OSAMA & AL-QAEDA ───
  {
    question: 'What did Prince Sultan tell Osama bin Laden when he volunteered to fight Saddam?',
    options: [
      '"You don\'t have enough men"',
      '"There are no caves in Kuwait"',
      '"This is not your war"',
      '"Leave this to professionals"',
    ],
    answer: 1,
    explanation: 'Bin Laden wanted to use his Afghan war tactics. Sultan pointed out Kuwait\'s flat desert was nothing like Afghanistan\'s mountains.',
  },
  {
    question: 'What was the family business of Osama bin Laden\'s father Mohammed?',
    options: ['Oil trading', 'Construction', 'Textiles', 'Banking'],
    answer: 1,
    explanation: 'Mohammed bin Laden ran a construction empire that built infrastructure for the American oil operation in Saudi Arabia.',
  },
  {
    question: 'What did Osama say he would use to fight Saddam\'s chemical weapons?',
    options: ['"American weapons"', '"Our faith"', '"Guerrilla tactics"', '"God\'s will"'],
    answer: 1,
    explanation: 'When asked how he\'d fight chemical and biological weapons, Osama responded: "We will fight them with our faith."',
  },
  {
    question: 'What did Saudi Arabia do to Osama bin Laden when he wouldn\'t stop his anti-American talk?',
    options: ['Imprisoned him', 'Took away his passport', 'Exiled him immediately', 'Froze his bank accounts'],
    answer: 1,
    explanation: 'The Saudi government took away his passport to stop him from leaving and told him to stop the anti-American Holy War talk.',
  },

  // ─── IRAN-IRAQ WAR ───
  {
    question: 'What scandal involved the U.S. secretly selling missiles to Iran in the 1980s?',
    options: ['Watergate', 'Iran-Contra', 'Pentagon Papers', 'October Surprise'],
    answer: 1,
    explanation: 'Reagan\'s administration secretly sold missiles to Iran and used the profits to fund anti-communist fighters in Nicaragua.',
  },
  {
    question: 'In 1988, which civilian aircraft did the U.S. Navy shoot down in the Persian Gulf?',
    options: [
      'A Saudi commercial flight',
      'An Iranian passenger jet',
      'A Kuwaiti cargo plane',
      'An Iraqi military transport',
    ],
    answer: 1,
    explanation: 'The U.S. shot down Iran Air Flight 655, killing all 290 civilians. The captain later received a medal, deepening Iranian distrust.',
  },
  {
    question: 'Which country secretly sold weapons parts to Iran early in the Iran-Iraq War?',
    options: ['The United States', 'Israel', 'Saudi Arabia', 'France'],
    answer: 1,
    explanation: 'Israel secretly sold supplies and parts to Iran to keep both adversaries fighting, helping the Iranian Air Force keep planes in the air.',
  },
  {
    question: 'Which country became Iran\'s top supplier of weapons during the Iran-Iraq War?',
    options: ['Russia', 'North Korea', 'China', 'Pakistan'],
    answer: 2,
    explanation: 'China claimed neutrality but sold weapons to both sides. They eventually became Iran\'s top supplier of weapons.',
  },
  {
    question: 'What was the result of the Iran-Iraq War after eight years of fighting?',
    options: [
      'Iran gained territory',
      'Iraq gained the waterway',
      'The borders were unchanged',
      'A new country was formed',
    ],
    answer: 2,
    explanation: 'After over a million deaths, the borders were exactly the same as before the fighting — nothing had changed.',
  },
  {
    question: 'Why did Khomeini refuse a ceasefire during the Iran-Iraq War?',
    options: [
      'He wanted to conquer Iraq',
      'The war unified his country and kept the military occupied',
      'Iran was winning decisively',
      'The Soviet Union pressured him to continue',
    ],
    answer: 1,
    explanation: 'The war was useful to Khomeini — it unified Iran and kept the military occupied so it wouldn\'t become a rival to his power.',
  },

  // ─── IRAQ WAR ───
  {
    question: 'What leaked British document revealed the U.S. planned to invade Iraq regardless of evidence?',
    options: ['The Iraq Dossier', 'The Downing Street Memo', 'The Chilcot Report', 'The Blair Papers'],
    answer: 1,
    explanation: 'The memo showed MI6 told Blair that the U.S. was "fixing intelligence" around a decision already made to invade.',
  },
  {
    question: 'Who was the UN weapons inspector who found no WMDs in Iraq?',
    options: ['Mohamed ElBaradei', 'Hans Blix', 'Scott Ritter', 'David Kay'],
    answer: 1,
    explanation: 'Blix conducted over 900 inspections at 500+ locations and found nothing. He noted the irony of "100% certainty about WMDs and zero certainty about where they are."',
  },
  {
    question: 'Who presented fabricated WMD evidence to the UN Security Council?',
    options: ['Donald Rumsfeld', 'Colin Powell', 'Condoleezza Rice', 'Dick Cheney'],
    answer: 1,
    explanation: 'Powell showed photos of supposed mobile weapons labs. He later said, "I deeply regret that some of the information I presented was wrong."',
  },
  {
    question: 'What did Rumsfeld say hours after 9/11 about why the U.S. needed to respond?',
    options: [
      '"We need to find those responsible"',
      '"We need to bomb something else to show we\'re big and strong"',
      '"We need to secure the oil supply"',
      '"We need to protect our allies"',
    ],
    answer: 1,
    explanation: 'Rumsfeld wrote: "We need to bomb something else to show that we\'re big and strong and not gonna be pushed around." Iraq was that something.',
  },
  {
    question: 'How many inspections did UN weapons inspectors conduct in Iraq before the 2003 invasion?',
    options: ['Over 200', 'Over 500', 'Over 900', 'Over 1,500'],
    answer: 2,
    explanation: 'Hans Blix and his team conducted over 900 inspections at over 500 locations — finding no WMDs, biological weapons, or nuclear programs.',
  },
  {
    question: 'When did Iraq actually dismantle its nuclear weapons program?',
    options: ['1988', '1991', '1998', '2002'],
    answer: 1,
    explanation: 'After the invasion, it seemed Iraq had dismantled its nuclear program back in 1991, and the rest of its weapons just a few years later.',
  },

  // ─── THE KURDS ───
  {
    question: 'What did Kurdish fighters rebrand themselves as at the U.S.\'s request to fight ISIS?',
    options: [
      'Free Kurdistan Army',
      'Syrian Democratic Forces',
      'People\'s Liberation Front',
      'Northern Alliance',
    ],
    answer: 1,
    explanation: 'The U.S. asked the Kurdish YPG to rebrand as the SDF to obscure their connection to the PKK, which is designated a terrorist group.',
  },
  {
    question: 'What was the PKK — the Kurdish Workers Party — originally rooted in?',
    options: ['Islamic fundamentalism', 'Pan-Arabism', 'Communist ideology', 'Tribal tradition'],
    answer: 2,
    explanation: 'The PKK formed as a communist insurgent group in Turkey, using violence to fight against the Turkification campaign targeting Kurds.',
  },
  {
    question: 'What percentage of Iraqi Kurds voted in favor of independence in a referendum?',
    options: ['67%', '78%', '85%', '92%'],
    answer: 3,
    explanation: '92% of the Kurdish population voted for independence, but the U.S. wouldn\'t support it, worried about destabilizing the new Iraqi state.',
  },
  {
    question: 'How many Kurds did the Syrian government remove from the country in the 1970s?',
    options: ['15,000', '50,000', '140,000', '500,000'],
    answer: 2,
    explanation: 'The Syrian government arrested and deported 140,000 Kurds, taking their land and giving it to Arabs.',
  },
  {
    question: 'What did George Bush Sr. do after encouraging the Kurds to rise up against Saddam?',
    options: [
      'Sent special forces to help',
      'Did nothing — abandoning them',
      'Imposed a no-fly zone immediately',
      'Supplied them with weapons',
    ],
    answer: 1,
    explanation: 'Bush Sr. called the Kurds to action via broadcasts, but when they rose up, the U.S. did nothing — allowing Saddam to crush the uprising.',
  },

  // ─── ISRAEL-PALESTINE ───
  {
    question: 'What was Netanyahu caught admitting on a leaked video with settlers?',
    options: [
      'Planning to annex the West Bank',
      'Sabotaging the Oslo peace accords',
      'Funding settlements illegally',
      'Cooperating with Hamas secretly',
    ],
    answer: 1,
    explanation: 'In a leaked video, Netanyahu admitted to sabotaging the Oslo Accords because he opposed Palestinian autonomy in any form.',
  },
  {
    question: 'According to a leaked Israeli cable, why was Israel happy Hamas took over Gaza?',
    options: [
      'It weakened Palestinian unity',
      'It justified treating Gaza as a hostile country',
      'It kept the Palestinian cause divided',
      'All of the above',
    ],
    answer: 3,
    explanation: 'The leaked cable showed Israel could treat Gaza as hostile, wasn\'t responsible for its 2 million civilians, and the Palestinian cause stayed divided.',
  },
  {
    question: 'What did a far-right Israeli lawmaker call Hamas?',
    options: ['"A useful enemy"', '"An asset"', '"A necessary evil"', '"Our best excuse"'],
    answer: 1,
    explanation: 'A far-right Israeli lawmaker called Hamas "an asset" — as long as Hamas controlled Gaza, the Palestinian cause remained weak and divided.',
  },

  // ─── HEZBOLLAH & LEBANON ───
  {
    question: 'What does "Hezbollah" translate to in English?',
    options: ['Army of God', 'Party of God', 'Shield of Islam', 'Defenders of Faith'],
    answer: 1,
    explanation: 'Hezbollah means "Party of God." It rose in southern Lebanon in 1982 to resist the Israeli occupation.',
  },
  {
    question: 'How many people did the 1983 Hezbollah truck bombing in Beirut kill?',
    options: ['Over 100', 'Over 200', 'Over 300', 'Over 400'],
    answer: 2,
    explanation: 'In 1983, a truck bomb at U.S. and French barracks in Beirut killed over 300 people. Most of the world blamed Hezbollah and its backer Iran.',
  },
  {
    question: 'Which country occupied Lebanon for 28 years before being forced out in 2005?',
    options: ['Israel', 'Iran', 'Syria', 'Iraq'],
    answer: 2,
    explanation: 'Syria occupied Lebanon for 28 years. After Lebanon\'s PM was assassinated in 2005 — blamed on Hezbollah and Syria — mass protests forced Syria out.',
  },

  // ─── YEMEN & HOUTHIS ───
  {
    question: 'What is on the Houthi flag\'s slogan?',
    options: [
      '"Freedom for Yemen"',
      '"God is great. Death to America. Death to Israel."',
      '"Victory through sacrifice"',
      '"Islam will prevail"',
    ],
    answer: 1,
    explanation: 'The Houthi flag reads: "God is great. Death to America. Death to Israel. Curse on the Jews. Victory to Islam."',
  },
  {
    question: 'What percentage of Red Sea container traffic declined after Houthi attacks on cargo ships?',
    options: ['25%', '50%', '73%', '90%'],
    answer: 2,
    explanation: 'In the days after Houthi missiles started flying, traffic through the Red Sea route declined by 73%.',
  },
  {
    question: 'Which country brokered diplomatic talks between Saudi Arabia and Iran?',
    options: ['The United States', 'Russia', 'China', 'Turkey'],
    answer: 2,
    explanation: 'China sponsored diplomatic talks between Saudi Arabia and Iran, helping cool regional tensions and the proxy war in Yemen.',
  },
  {
    question: 'What happened to former Yemeni President Saleh when he switched sides back to the Saudi coalition?',
    options: [
      'He was exiled to Saudi Arabia',
      'He was killed by the Houthis two days later',
      'He was arrested by his own forces',
      'He fled to the UAE',
    ],
    answer: 1,
    explanation: 'Saleh broke his alliance with the Houthis and joined the Saudi coalition. Fighting broke out, and he was killed just two days later.',
  },
  {
    question: 'What is the name of the wave of uprisings across the Middle East that began around 2011?',
    options: ['The Islamic Awakening', 'The Arab Spring', 'The Desert Revolution', 'The New Dawn'],
    answer: 1,
    explanation: 'The Arab Spring was an outpouring of public anger demanding change from governments across the region, removing old leaders in country after country.',
  },
];

export { easy, hard };
