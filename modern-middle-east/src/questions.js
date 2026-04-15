/**
 * Modern Middle East Quiz — Question Bank
 * Sourced from Johnny Harris's "The Modern Middle East, Explained"
 */

const easy = [
  {
    question: 'What resource first brought the United States to the Middle East?',
    options: ['Oil', 'Gold', 'Cotton', 'Diamonds'],
    answer: 0,
    explanation: 'A California oil company explored Saudi Arabia\'s desert in the 1930s, striking oil on March 3, 1938 — and the U.S. never left.',
  },
  {
    question: 'What is the name of the large stateless people of the Middle East?',
    options: ['The Kurds', 'The Druze', 'The Bedouin', 'The Berbers'],
    answer: 0,
    explanation: 'The Kurds are spread across Turkey, Iraq, Iran, and Syria. European powers drew borders through their homeland after WWI instead of around it.',
  },
  {
    question: 'Which country did Saddam Hussein invade in 1990, prompting U.S. intervention?',
    options: ['Iran', 'Kuwait', 'Saudi Arabia', 'Syria'],
    answer: 1,
    explanation: 'Saddam invaded Kuwait seeking its oil, believing he was owed spoils for fighting Iran. The U.S. crushed his army in 43 days.',
  },
  {
    question: 'Which group founded by Osama bin Laden carried out attacks against the U.S.?',
    options: ['Hamas', 'Hezbollah', 'Al-Qaeda', 'The Taliban'],
    answer: 2,
    explanation: 'Bin Laden started Al-Qaeda during the war in Afghanistan. Its mission was to fight superpowers invading the Middle East.',
  },
  {
    question: 'Which two countries fought an eight-year war from 1980 to 1988?',
    options: ['Iraq and Kuwait', 'Iran and Iraq', 'Syria and Israel', 'Egypt and Libya'],
    answer: 1,
    explanation: 'The Iran-Iraq War killed over a million people. After eight years, the borders were unchanged from before the fighting.',
  },
  {
    question: 'What justification did the Bush administration use to invade Iraq in 2003?',
    options: ['Oil reserves', 'Weapons of mass destruction', 'Harboring bin Laden', 'A border dispute'],
    answer: 1,
    explanation: 'The U.S. claimed Iraq had WMDs. Over a decade of occupation, none were ever found.',
  },
  {
    question: 'Which European powers drew the borders of the modern Middle East?',
    options: ['Spain and Portugal', 'Germany and Italy', 'Britain and France', 'The Netherlands and Belgium'],
    answer: 2,
    explanation: 'The British and French carved up the region after defeating the Ottoman Empire, ignoring language, ethnicity, and regional identity.',
  },
  {
    question: 'What is the name of the violent group that took control of Gaza?',
    options: ['Fatah', 'Hamas', 'Al-Qaeda', 'ISIS'],
    answer: 1,
    explanation: 'Hamas won Palestinian elections and took over Gaza completely, becoming a major factor in the Israeli-Palestinian conflict.',
  },
  {
    question: 'Which country is home to the holiest sites in Islam — Mecca and Medina?',
    options: ['Iran', 'Iraq', 'Saudi Arabia', 'Egypt'],
    answer: 2,
    explanation: 'Saudi Arabia\'s role as guardian of Mecca and Medina gives it a central place in the Islamic world.',
  },
  {
    question: 'What 1990s agreement first established a Palestinian government authority?',
    options: ['Camp David Accords', 'Oslo Accords', 'Balfour Declaration', 'UN Resolution 1441'],
    answer: 1,
    explanation: 'The Oslo Accords gave Palestinians authority over pockets of land in the West Bank and most of Gaza for the first time.',
  },
];

const hard = [
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
    question: 'What scandal involved the U.S. secretly selling missiles to Iran in the 1980s?',
    options: ['Watergate', 'Iran-Contra', 'Pentagon Papers', 'October Surprise'],
    answer: 1,
    explanation: 'Reagan\'s administration secretly sold missiles to Iran and used the profits to fund anti-communist fighters in Nicaragua.',
  },
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
    explanation: 'Blix conducted over 900 inspections at 500+ locations and found nothing. He later noted the irony of "100% certainty about WMDs and zero certainty about where they are."',
  },
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
    question: 'What was the family business of Osama bin Laden\'s father Mohammed?',
    options: ['Oil trading', 'Construction', 'Textiles', 'Banking'],
    answer: 1,
    explanation: 'Mohammed bin Laden ran a construction empire that built infrastructure for the American oil operation in Saudi Arabia.',
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
    question: 'What was the PKK — the Kurdish Workers Party — originally rooted in?',
    options: ['Islamic fundamentalism', 'Pan-Arabism', 'Communist ideology', 'Tribal tradition'],
    answer: 2,
    explanation: 'The PKK formed as a communist insurgent group in Turkey, using violence to fight against the Turkification campaign targeting Kurds.',
  },
  {
    question: 'Who presented fabricated WMD evidence to the UN Security Council to justify invading Iraq?',
    options: ['Donald Rumsfeld', 'Colin Powell', 'Condoleezza Rice', 'Dick Cheney'],
    answer: 1,
    explanation: 'Powell showed photos of supposed mobile weapons labs. He later said, "I deeply regret that some of the information I presented was wrong."',
  },
];

export { easy, hard };
