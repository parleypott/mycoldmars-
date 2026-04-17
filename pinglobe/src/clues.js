const EASY_CLUES = [
  // ── existing clues ──
  {
    clue: "Where fishermen still pray to a sea goddess who calmed the strait for her family",
    answer: "Taiwan",
    type: "country",
    countryId: "158",
    center: { lat: 23.7, lon: 120.96 },
    acceptRadius: null,
    blurb: "Mazu, the goddess of the sea, is Taiwan's most widely worshipped deity. Legend says she guided her fisherman brothers through a deadly storm. Today, her annual pilgrimage draws millions across the island."
  },
  {
    clue: "Home to an annual festival where millions throw colored powder to welcome spring",
    answer: "India",
    type: "country",
    countryId: "356",
    center: { lat: 20.6, lon: 78.9 },
    acceptRadius: null,
    blurb: "Holi, the festival of colors, celebrates the victory of good over evil and the arrival of spring. Participants drench each other in vibrant gulal powder, erasing social boundaries for a day of joyful chaos."
  },
  {
    clue: "The city where a sacred black stone has drawn pilgrims in white robes for fourteen centuries",
    answer: "Mecca",
    type: "point",
    center: { lat: 21.4225, lon: 39.8262 },
    acceptRadius: 120,
    blurb: "The Kaaba in Mecca's Grand Mosque contains the Black Stone, believed by Muslims to date to the time of Adam. The Hajj pilgrimage, one of Islam's five pillars, brings over two million people here annually."
  },
  {
    clue: "Where the dead are honored each November with marigold altars and sugar skulls",
    answer: "Mexico",
    type: "country",
    countryId: "484",
    center: { lat: 23.6, lon: -102.5 },
    acceptRadius: null,
    blurb: "Día de los Muertos blends pre-Columbian Aztec rituals with Catholic traditions. Families build ofrendas — altars adorned with marigolds, photos, and favorite foods — believing the dead return to visit each year."
  },
  {
    clue: "An ancient capital where monks in saffron robes collect alms each dawn along the Mekong",
    answer: "Luang Prabang",
    type: "point",
    center: { lat: 19.8856, lon: 102.1347 },
    acceptRadius: 150,
    blurb: "Each morning before sunrise in Luang Prabang, hundreds of Buddhist monks walk barefoot through the streets collecting rice from kneeling locals. This tak bat ritual has continued unbroken for centuries."
  },
  {
    clue: "Where an enormous red gate stands in the water, marking the boundary between the spirit and human worlds",
    answer: "Japan",
    type: "country",
    countryId: "392",
    center: { lat: 34.3, lon: 132.3 },
    acceptRadius: null,
    blurb: "The floating torii gate of Itsukushima Shrine on Miyajima island appears to hover over the water at high tide. In Shinto tradition, it marks the transition from the mundane world to the sacred."
  },
  {
    clue: "The city where a massive carnival fills the streets with samba for five days before Lent",
    answer: "Rio de Janeiro",
    type: "point",
    center: { lat: -22.9068, lon: -43.1729 },
    acceptRadius: 100,
    blurb: "Rio's Carnival is the world's largest, with samba schools spending all year preparing elaborate floats and costumes. The tradition fuses Portuguese Catholic Lenten customs with African rhythmic traditions brought by enslaved people."
  },
  {
    clue: "A nation of islands where a war dance of stamping and chanting opens sacred ceremonies",
    answer: "New Zealand",
    type: "country",
    countryId: "554",
    center: { lat: -40.9, lon: 174.9 },
    acceptRadius: null,
    blurb: "The Haka is a Māori ceremonial dance expressing pride, strength, and unity. While famous from rugby, it originally served as a war cry, a greeting for distinguished guests, and a tribute to the deceased."
  },
  {
    clue: "Where families break their Ramadan fast with dates and harira soup as the call to prayer echoes through the old medina",
    answer: "Morocco",
    type: "country",
    countryId: "504",
    center: { lat: 31.8, lon: -7.1 },
    acceptRadius: null,
    blurb: "Harira — a hearty tomato and lentil soup — is Morocco's traditional iftar dish. The breaking of the fast each evening during Ramadan transforms the ancient medinas into communal dining rooms under the stars."
  },
  {
    clue: "A highland country where priests guard churches carved from single blocks of stone, carrying an ark no outsider may see",
    answer: "Ethiopia",
    type: "country",
    countryId: "231",
    center: { lat: 9.15, lon: 40.5 },
    acceptRadius: null,
    blurb: "Lalibela's eleven rock-hewn churches were carved downward from solid volcanic rock in the 12th century. Ethiopian Orthodox tradition holds that the Ark of the Covenant rests in a chapel in Axum, guarded by a single monk for life."
  },
  {
    clue: "Where lanterns float down rivers each August to guide the spirits of ancestors back to the afterlife",
    answer: "Japan",
    type: "country",
    countryId: "392",
    center: { lat: 35.0, lon: 136.0 },
    acceptRadius: null,
    blurb: "Obon is Japan's festival of the dead, when spirits are believed to return home. Families light mukaebi fires to welcome them and set paper lanterns adrift on rivers to guide them back — a practice over 500 years old."
  },
  {
    clue: "A city of canals where masked revelers have concealed their identities during winter celebrations since the 13th century",
    answer: "Venice",
    type: "point",
    center: { lat: 45.4408, lon: 12.3155 },
    acceptRadius: 80,
    blurb: "Venice's Carnival masks originally allowed citizens to cross class boundaries anonymously. The tradition was banned by Napoleon, then revived in 1979. The iconic white bauta mask was designed specifically to let wearers eat and drink without removing it."
  },
  {
    clue: "Where shamans climb a sacred mountain to honor the Eternal Blue Sky, as their greatest conqueror once did",
    answer: "Mongolia",
    type: "country",
    countryId: "496",
    center: { lat: 46.9, lon: 103.8 },
    acceptRadius: null,
    blurb: "Burkhan Khaldun mountain is Mongolia's most sacred site, believed to be where Genghis Khan prayed and hid as a young man. Tengrism, the worship of the Eternal Blue Sky, still shapes Mongolian spiritual life alongside Buddhism."
  },
  {
    clue: "An island where offerings of flowers and rice are placed on doorsteps each morning to balance good and evil spirits",
    answer: "Bali",
    type: "point",
    center: { lat: -8.3405, lon: 115.092 },
    acceptRadius: 120,
    blurb: "Canang sari are small palm-leaf baskets filled with flowers, rice, and incense, placed daily as offerings to maintain cosmic balance. In Balinese Hinduism, every aspect of daily life is an act of devotion."
  },
  {
    clue: "Where New Year begins in April with a nationwide water fight to wash away the old year's sins",
    answer: "Thailand",
    type: "country",
    countryId: "764",
    center: { lat: 15.87, lon: 100.99 },
    acceptRadius: null,
    blurb: "Songkran, the Thai New Year, transforms the country into a joyful water battle. The water symbolizes purification and respect — traditionally, younger people gently pour scented water over elders' hands to receive blessings."
  },
  // ── new easy clues ──
  {
    clue: "Where three ancient pyramids have stood at the edge of a sprawling city for over four thousand years",
    answer: "Egypt",
    type: "country",
    countryId: "818",
    center: { lat: 29.98, lon: 31.13 },
    acceptRadius: null,
    blurb: "The Great Pyramids of Giza are the last surviving wonder of the ancient world. The largest, built for Pharaoh Khufu around 2560 BCE, contained over two million limestone blocks and held the record as the tallest structure on Earth for nearly 4,000 years."
  },
  {
    clue: "A country where an iron tower built for a world's fair became the most visited paid monument on Earth",
    answer: "France",
    type: "country",
    countryId: "250",
    center: { lat: 46.6, lon: 2.2 },
    acceptRadius: null,
    blurb: "The Eiffel Tower was built in 1889 for the Paris World's Fair and was originally meant to stand for just 20 years. Parisians hated it at first — artists called it an eyesore — but it became the city's defining icon, drawing seven million visitors a year."
  },
  {
    clue: "Where a stone citadel sits hidden among cloud-wrapped peaks, abandoned by its builders before colonizers could find it",
    answer: "Peru",
    type: "country",
    countryId: "604",
    center: { lat: -13.16, lon: -72.55 },
    acceptRadius: null,
    blurb: "Machu Picchu was built around 1450 CE by the Inca emperor Pachacuti as a royal estate. It was abandoned within a century, likely due to smallpox, and remained unknown to the outside world until Hiram Bingham arrived in 1911."
  },
  {
    clue: "Where the oldest known democracy was born in a city whose hilltop temple has stood in ruins for two and a half millennia",
    answer: "Greece",
    type: "country",
    countryId: "300",
    center: { lat: 37.97, lon: 23.73 },
    acceptRadius: null,
    blurb: "The Parthenon atop the Athenian Acropolis was completed in 438 BCE as a temple to Athena. Athens pioneered demokratia — rule by the people — where male citizens gathered to vote directly on laws, wars, and the fate of their city."
  },
  {
    clue: "Where a wall built to keep out northern invaders stretches over thousands of miles across mountain ridges",
    answer: "China",
    type: "country",
    countryId: "156",
    center: { lat: 40.43, lon: 116.57 },
    acceptRadius: null,
    blurb: "The Great Wall of China spans over 20,000 kilometers across northern China, built and rebuilt over two thousand years by multiple dynasties. Contrary to myth, it's not visible from space with the naked eye, but it remains the longest structure ever built."
  },
  {
    clue: "Home to the world's largest coral reef system, visible from space, sheltering thousands of marine species",
    answer: "Australia",
    type: "country",
    countryId: "036",
    center: { lat: -18.29, lon: 147.7 },
    acceptRadius: null,
    blurb: "The Great Barrier Reef stretches over 2,300 kilometers along Australia's northeast coast, comprising nearly 3,000 individual reef systems. It's the largest living structure on Earth, home to 1,500 species of fish and 400 types of coral."
  },
  {
    clue: "Where millions of wildebeest cross crocodile-filled rivers each year in the greatest animal migration on Earth",
    answer: "Kenya",
    type: "country",
    countryId: "404",
    center: { lat: -1.29, lon: 36.82 },
    acceptRadius: null,
    blurb: "The Great Migration sees over 1.5 million wildebeest, along with zebras and gazelles, travel in a clockwise loop between the Serengeti and Kenya's Maasai Mara. The treacherous Mara River crossings are among nature's most dramatic spectacles."
  },
  {
    clue: "A country where an entire town turns red once a year as thousands hurl tomatoes at each other in the streets",
    answer: "Spain",
    type: "country",
    countryId: "724",
    center: { lat: 39.47, lon: -0.38 },
    acceptRadius: null,
    blurb: "La Tomatina takes place every August in Buñol, Spain. What started as a spontaneous food fight among friends in 1945 became an official festival. Over 150,000 kilograms of overripe tomatoes are hurled in a single hour."
  },
  {
    clue: "Where grandmothers have fermented vegetables in clay pots for centuries, creating a side dish now recognized by UNESCO",
    answer: "South Korea",
    type: "country",
    countryId: "410",
    center: { lat: 35.91, lon: 127.77 },
    acceptRadius: null,
    blurb: "Kimchi — fermented napa cabbage seasoned with chili, garlic, and fish sauce — is central to Korean identity. The tradition of gimjang, communal kimchi-making each autumn, was inscribed on UNESCO's Intangible Cultural Heritage list in 2013."
  },
  {
    clue: "Where deep coastal inlets carved by glaciers cut between steep cliffs under shimmering curtains of green light",
    answer: "Norway",
    type: "country",
    countryId: "578",
    center: { lat: 61.0, lon: 7.0 },
    acceptRadius: null,
    blurb: "Norway's fjords were carved by glaciers over millions of years, creating some of the world's deepest and most dramatic inlets. The aurora borealis — caused by solar particles colliding with atmospheric gases — paints the skies above in winter."
  },
  {
    clue: "Home to the world's largest river by volume, flowing through a rainforest that produces a fifth of Earth's oxygen",
    answer: "Brazil",
    type: "country",
    countryId: "076",
    center: { lat: -3.47, lon: -62.22 },
    acceptRadius: null,
    blurb: "The Amazon River discharges more water than the next seven largest rivers combined. The Amazon Rainforest spans 5.5 million square kilometers and is home to an estimated 10 percent of all species on Earth."
  },
  {
    clue: "Where hundreds of hot air balloons rise at dawn over a surreal landscape of fairy chimneys and ancient cave dwellings",
    answer: "Turkey",
    type: "country",
    countryId: "792",
    center: { lat: 38.64, lon: 34.83 },
    acceptRadius: null,
    blurb: "Cappadocia's fairy chimneys are tall, thin spires of rock formed by volcanic eruptions millions of years ago. Early Christians carved entire underground cities, churches, and homes into the soft tufa stone, creating a labyrinth of hidden chambers."
  },
  {
    clue: "The world's second-largest country by area, where maple leaves turn scarlet each autumn and the national sport is played on ice",
    answer: "Canada",
    type: "country",
    countryId: "124",
    center: { lat: 56.13, lon: -106.35 },
    acceptRadius: null,
    blurb: "Canada's 9.98 million square kilometers stretch from the Atlantic to the Pacific and north to the Arctic. Ice hockey, born from British soldiers playing on frozen ponds in the 1800s, is so deeply woven into the culture it's practically a national religion."
  },
  {
    clue: "Where couples dance cheek to cheek in smoky milongas, performing a dance born in the port neighborhoods of its capital",
    answer: "Argentina",
    type: "country",
    countryId: "032",
    center: { lat: -34.6, lon: -58.38 },
    acceptRadius: null,
    blurb: "Tango emerged in the late 1800s in Buenos Aires' working-class port district of La Boca, blending African, European, and Indigenous influences. Originally scandalous for its close embrace, it became Argentina's most famous cultural export."
  },
  {
    clue: "An island where ancient stone forts cling to sea cliffs and pubs overflow with fiddle music on rainy evenings",
    answer: "Ireland",
    type: "country",
    countryId: "372",
    center: { lat: 53.14, lon: -7.69 },
    acceptRadius: null,
    blurb: "Ireland's tradition of live pub music — called a 'session' — dates back centuries. Musicians gather spontaneously to play jigs, reels, and airs on fiddles, tin whistles, and bodhrán drums, keeping an oral tradition alive in every village."
  },
  {
    clue: "Where classic American cars from the 1950s still cruise along a seaside promenade lined with crumbling colonial facades",
    answer: "Cuba",
    type: "country",
    countryId: "192",
    center: { lat: 23.11, lon: -82.37 },
    acceptRadius: null,
    blurb: "After the 1959 revolution and the US trade embargo, Cuba was cut off from new car imports. Cubans kept their pre-revolution Chevrolets, Fords, and Buicks running with improvised parts, turning Havana into a rolling museum of mid-century Americana."
  },
  {
    clue: "Where the largest religious monument ever built rises from the jungle, its towers shaped like lotus buds",
    answer: "Cambodia",
    type: "country",
    countryId: "116",
    center: { lat: 13.41, lon: 103.87 },
    acceptRadius: null,
    blurb: "Angkor Wat was built in the early 12th century by King Suryavarman II as a Hindu temple to Vishnu, later converted to Buddhism. Covering 162 hectares, it is the largest religious monument in the world and appears on Cambodia's flag."
  },
  {
    clue: "A West African country where master weavers create brilliant cloth of interlocking patterns, each design telling a proverb",
    answer: "Ghana",
    type: "country",
    countryId: "288",
    center: { lat: 7.95, lon: -1.02 },
    acceptRadius: null,
    blurb: "Kente cloth originated with the Ashanti people, who legend says learned weaving by watching a spider. Each color and pattern carries meaning — gold for royalty, green for harvest. Kente was once reserved for kings and is now worn at celebrations worldwide."
  },
  {
    clue: "Where prayer flags snap in thin air at the base camp of the world's tallest mountain",
    answer: "Nepal",
    type: "country",
    countryId: "524",
    center: { lat: 27.99, lon: 86.93 },
    acceptRadius: null,
    blurb: "Mount Everest straddles the Nepal-Tibet border at 8,849 meters. Tibetan Buddhists string prayer flags at high passes believing the wind carries their printed mantras to all beings. The Sherpa people have guided climbers here since the first summit in 1953."
  },
  {
    clue: "A country where vendors paddle wooden boats through floating markets, selling tropical fruit from canal to canal",
    answer: "Vietnam",
    type: "country",
    countryId: "704",
    center: { lat: 10.04, lon: 105.77 },
    acceptRadius: null,
    blurb: "The Mekong Delta's floating markets have operated for over a century. At Cai Rang, hundreds of boats gather before dawn, each hoisting a sample of their goods on a tall pole — pineapples, dragon fruit, coconuts — so buyers can spot them from afar."
  },
  {
    clue: "Where melancholic guitar ballads called fado echo through narrow alleyways of a hilly capital overlooking the sea",
    answer: "Portugal",
    type: "country",
    countryId: "620",
    center: { lat: 38.72, lon: -9.14 },
    acceptRadius: null,
    blurb: "Fado, meaning 'fate,' emerged in Lisbon's oldest neighborhoods in the early 1800s. Sung with Portuguese guitar accompaniment, it expresses saudade — a deep longing for something lost. UNESCO recognized it as Intangible Cultural Heritage in 2011."
  },
  {
    clue: "Where a flat-topped mountain looms over a city at the southern tip of a continent, often draped in cloud",
    answer: "South Africa",
    type: "country",
    countryId: "710",
    center: { lat: -33.96, lon: 18.4 },
    acceptRadius: null,
    blurb: "Table Mountain in Cape Town is over 600 million years old — one of the oldest mountains on Earth. Its flat summit is frequently covered by orographic clouds locals call 'the tablecloth,' formed when moist air from the ocean is pushed upward."
  },
  {
    clue: "Where colorful onion domes crown a cathedral built by a tsar to celebrate the capture of a Tatar stronghold",
    answer: "Russia",
    type: "country",
    countryId: "643",
    center: { lat: 55.75, lon: 37.62 },
    acceptRadius: null,
    blurb: "St. Basil's Cathedral was commissioned by Ivan the Terrible in 1555 to mark his conquest of Kazan. Its nine chapels, each topped with a uniquely patterned dome, were originally white — the vivid colors were added over the following two centuries."
  },
  {
    clue: "Where the world's largest salt flat becomes a giant mirror after the rains, reflecting the sky in perfect symmetry",
    answer: "Bolivia",
    type: "country",
    countryId: "068",
    center: { lat: -20.13, lon: -67.49 },
    acceptRadius: null,
    blurb: "Salar de Uyuni spans over 10,000 square kilometers at 3,656 meters elevation in the Andes. During the wet season, a thin layer of water transforms it into the world's largest natural mirror, blending earth and sky into a single plane."
  },
  {
    clue: "An ancient city carved into rose-red sandstone cliffs, hidden in a desert canyon and reached through a narrow gorge",
    answer: "Jordan",
    type: "country",
    countryId: "400",
    center: { lat: 30.33, lon: 35.44 },
    acceptRadius: null,
    blurb: "Petra was the capital of the Nabataean Kingdom, a trading empire that thrived from the 4th century BCE. Its most famous facade, Al-Khazneh (the Treasury), was carved directly into sandstone cliffs that shift between pink, red, and orange in the changing light."
  },
  {
    clue: "Where shepherds in the highlands still play wooden pan flutes whose melodies predate the arrival of the Spanish",
    answer: "Ecuador",
    type: "country",
    countryId: "218",
    center: { lat: -1.83, lon: -78.18 },
    acceptRadius: null,
    blurb: "The rondador, a set of cane pan pipes, is Ecuador's national instrument. Its haunting tones echo through Andean villages, carrying musical traditions from the Quechua and other Indigenous peoples that have survived centuries of colonial influence."
  },
  {
    clue: "A nation of over 17,000 islands where shadow puppets act out epic tales of gods and heroes behind a lit screen",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -7.61, lon: 110.2 },
    acceptRadius: null,
    blurb: "Wayang kulit shadow puppetry has been performed in Java for over a thousand years. A single dalang (puppeteer) manipulates dozens of intricately carved leather figures while narrating stories from the Ramayana and Mahabharata, often from dusk to dawn."
  },
  {
    clue: "Where an enormous statue of a redeemer stands with open arms atop a peak, watching over a city between mountains and sea",
    answer: "Brazil",
    type: "country",
    countryId: "076",
    center: { lat: -22.95, lon: -43.21 },
    acceptRadius: null,
    blurb: "Christ the Redeemer stands 30 meters tall atop Corcovado mountain in Rio de Janeiro. Completed in 1931, the Art Deco statue was built from reinforced concrete and soapstone, its outstretched arms spanning 28 meters across the skyline."
  },
  {
    clue: "Where women in bright saris celebrate a nine-night dance festival, whirling with decorated sticks under strings of lights",
    answer: "India",
    type: "country",
    countryId: "356",
    center: { lat: 23.0, lon: 72.6 },
    acceptRadius: null,
    blurb: "Navratri is a nine-night Hindu festival especially vibrant in Gujarat, where millions gather to perform Garba and Dandiya Raas — energetic circle dances with decorated sticks. The festival honors the goddess Durga's triumph over the demon Mahishasura."
  },
  {
    clue: "Home to a vast red desert where the world's tallest sand dunes glow orange at sunrise beside bleached dead trees",
    answer: "Namibia",
    type: "country",
    countryId: "516",
    center: { lat: -24.77, lon: 15.34 },
    acceptRadius: null,
    blurb: "Sossusvlei in the Namib Desert features dunes over 300 meters tall — among the highest on Earth. Nearby Deadvlei holds the skeletons of 900-year-old camelthorn trees, scorched black by the sun but preserved by the extreme aridity."
  },
  // ── expanded easy clues: geography, food, language, climate, landmarks ──
  {
    clue: "Where the world's longest road tunnel burrows nearly 25 kilometers through the Alps",
    answer: "Switzerland",
    type: "country",
    countryId: "756",
    center: { lat: 46.95, lon: 8.36 },
    acceptRadius: null,
    blurb: "The Gotthard Base Tunnel, completed in 2016, stretches 57 kilometers — the world's longest railway tunnel. Switzerland also holds the Lötschberg and older Gotthard road tunnel, threading through the Alps that define the nation's geography."
  },
  {
    clue: "Where the world's largest oil reserves lie beneath vast deserts and a sea of sand dunes called the Empty Quarter",
    answer: "Saudi Arabia",
    type: "country",
    countryId: "682",
    center: { lat: 24.71, lon: 46.68 },
    acceptRadius: null,
    blurb: "Saudi Arabia's Rub' al Khali — the Empty Quarter — is the largest contiguous sand desert on Earth, covering 650,000 square kilometers. Beneath the kingdom's sands lie roughly 267 billion barrels of proven oil reserves, fueling the global economy for decades."
  },
  {
    clue: "Where the lowest point on Earth's surface sits in a hyper-salty sea that lets swimmers float effortlessly",
    answer: "Jordan",
    type: "country",
    countryId: "400",
    center: { lat: 31.5, lon: 35.5 },
    acceptRadius: null,
    blurb: "The Dead Sea's surface sits at 430 meters below sea level, the lowest land elevation on Earth. Its salinity — nearly 10 times saltier than the ocean — makes it impossible to sink and impossible for most life to survive."
  },
  {
    clue: "Home to over 130 active volcanoes, more than any other country, stretching across thousands of islands along the Ring of Fire",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -2.5, lon: 118.0 },
    acceptRadius: null,
    blurb: "Indonesia sits on the Pacific Ring of Fire with about 130 active volcanoes. The 1815 eruption of Mount Tambora was the largest in recorded history, ejecting so much ash it caused 'the year without a summer' across the globe."
  },
  {
    clue: "Where you can find the world's highest waterfall, plunging nearly a kilometer from a flat-topped mountain into the jungle below",
    answer: "Venezuela",
    type: "country",
    countryId: "862",
    center: { lat: 5.97, lon: -62.54 },
    acceptRadius: null,
    blurb: "Angel Falls drops 979 meters from the summit of Auyán-tepuí, making it the world's highest uninterrupted waterfall. It was named after Jimmie Angel, a US aviator who crash-landed on the tepui in 1937."
  },
  {
    clue: "A country where the native language has no word for 'please' because generosity is simply expected, not requested",
    answer: "Iceland",
    type: "country",
    countryId: "352",
    center: { lat: 64.96, lon: -19.02 },
    acceptRadius: null,
    blurb: "Icelandic, one of the oldest living languages, has barely changed since the Viking sagas were written 800 years ago. Modern Icelanders can still read medieval texts. The language committee coins new Icelandic words rather than borrowing from English."
  },
  {
    clue: "Where breakfast means a spread of cheeses, olives, tomatoes, cucumbers, honey, and eggs served with strong tea from a double-stacked teapot",
    answer: "Turkey",
    type: "country",
    countryId: "792",
    center: { lat: 39.93, lon: 32.86 },
    acceptRadius: null,
    blurb: "Turkish breakfast — kahvaltı, literally 'before coffee' — is an elaborate communal affair. The çaydanlık (double teapot) brews strong tea that is diluted to taste. A weekend breakfast can stretch for hours with dozens of small plates."
  },
  {
    clue: "Where the northernmost capital city in the world sits on a bay warmed by volcanic springs, surrounded by lava fields",
    answer: "Iceland",
    type: "country",
    countryId: "352",
    center: { lat: 64.13, lon: -21.9 },
    acceptRadius: null,
    blurb: "Reykjavik, at 64°N, is the world's northernmost capital. Geothermal energy heats 90% of the city's buildings. The name means 'Smoky Bay,' from the steam Viking settler Ingólfr Arnarson saw rising from hot springs when he arrived around 870 CE."
  },
  {
    clue: "Where a high-altitude train crosses the world's highest railway pass, carrying passengers through landscapes above the clouds",
    answer: "China",
    type: "country",
    countryId: "156",
    center: { lat: 35.4, lon: 93.5 },
    acceptRadius: null,
    blurb: "The Qinghai-Tibet Railway reaches 5,072 meters at Tanggula Pass, the world's highest railway point. Pressurized carriages supply extra oxygen to passengers. Much of the track is built on permafrost, requiring innovative cooling systems to prevent melting."
  },
  {
    clue: "Where fishermen train cormorant birds to dive for fish, a tradition practiced for over a thousand years on its rivers",
    answer: "Japan",
    type: "country",
    countryId: "392",
    center: { lat: 35.42, lon: 136.76 },
    acceptRadius: null,
    blurb: "Ukai — cormorant fishing — has been practiced on the Nagara River in Gifu for over 1,300 years. Usho (cormorant masters) tie leashes around the birds' necks to prevent them from swallowing large fish, working by torchlight from wooden boats."
  },
  {
    clue: "Home to the world's largest island, where a vast ice sheet covers 80% of the land and glaciers calve icebergs into fjords",
    answer: "Greenland",
    type: "country",
    countryId: "304",
    center: { lat: 71.71, lon: -42.6 },
    acceptRadius: null,
    blurb: "Greenland's ice sheet is up to 3 kilometers thick and contains enough frozen water to raise global sea levels by 7 meters. Despite its name — a Viking marketing ploy by Erik the Red — only a narrow coastal strip is ice-free."
  },
  {
    clue: "Where street vendors serve bowls of spicy, sour soup with rice noodles for breakfast, lunch, and dinner from steaming sidewalk stalls",
    answer: "Vietnam",
    type: "country",
    countryId: "704",
    center: { lat: 21.03, lon: 105.85 },
    acceptRadius: null,
    blurb: "Phở is Vietnam's national dish — a fragrant broth simmered for hours with star anise, cinnamon, and charred ginger, served with rice noodles, herbs, and beef or chicken. It originated in northern Vietnam in the early 20th century and is eaten at any hour."
  },
  {
    clue: "Where the world's biggest amphitheater once held 50,000 spectators watching gladiators fight, and still stands at the heart of the capital",
    answer: "Italy",
    type: "country",
    countryId: "380",
    center: { lat: 41.89, lon: 12.49 },
    acceptRadius: null,
    blurb: "The Colosseum in Rome was completed in 80 CE and could hold up to 80,000 spectators. It hosted gladiatorial combat, animal hunts, and mock naval battles. Despite earthquakes and stone robbers, roughly two-thirds of the original structure survives."
  },
  {
    clue: "Where shepherds wear thick wool cloaks and wide-brimmed hats while tending flocks on wind-swept grasslands called pampas",
    answer: "Argentina",
    type: "country",
    countryId: "032",
    center: { lat: -36.0, lon: -60.0 },
    acceptRadius: null,
    blurb: "Gauchos are the iconic horsemen of the Argentine pampas. Their poncho, bombachas (baggy trousers), and boina (beret) are symbols of rural identity. They carry a facón knife and drink yerba mate from a shared gourd — a ritual of friendship."
  },
  {
    clue: "A country that straddles both Europe and Asia, with a strait dividing its largest city between two continents",
    answer: "Turkey",
    type: "country",
    countryId: "792",
    center: { lat: 41.01, lon: 28.98 },
    acceptRadius: null,
    blurb: "Istanbul sits on the Bosporus, a 31-kilometer strait separating Europe and Asia. The city has served as capital to the Roman, Byzantine, and Ottoman Empires. Ferries cross between continents in minutes, making it the world's only transcontinental metropolis."
  },
  {
    clue: "Where rice terraces carved into mountainsides over 2,000 years ago are still farmed by hand, following the contours of the slopes",
    answer: "Philippines",
    type: "country",
    countryId: "608",
    center: { lat: 16.92, lon: 121.06 },
    acceptRadius: null,
    blurb: "The Banaue Rice Terraces in the Cordillera Mountains were carved by the Ifugao people without modern tools. If laid end to end, they would stretch halfway around the world. They're still irrigated by an ancient system channeling water from mountaintop rainforests."
  },
  {
    clue: "Where the world's hottest temperature — 56.7°C — was officially recorded in a sun-scorched desert valley below sea level",
    answer: "United States",
    type: "country",
    countryId: "840",
    center: { lat: 36.46, lon: -116.87 },
    acceptRadius: null,
    blurb: "Death Valley recorded 56.7°C (134°F) on July 10, 1913 — the highest reliably measured air temperature on Earth. The valley floor sits 86 meters below sea level, surrounded by mountains that trap and amplify heat."
  },
  {
    clue: "Where the world's only high-altitude flamingo breeding ground sits on a salt lake at the edge of a volcano-studded desert",
    answer: "Bolivia",
    type: "country",
    countryId: "068",
    center: { lat: -22.4, lon: -67.8 },
    acceptRadius: null,
    blurb: "Laguna Colorada in Bolivia's Altiplano sits at 4,278 meters. Its red waters — tinted by algae and mineral sediments — support thousands of James's flamingos, one of the rarest flamingo species, which breed here in one of the harshest environments on Earth."
  },
  {
    clue: "Where people greet each other by pressing noses together, a tradition that shares the breath of life between two souls",
    answer: "New Zealand",
    type: "country",
    countryId: "554",
    center: { lat: -41.29, lon: 174.78 },
    acceptRadius: null,
    blurb: "The hongi is a traditional Māori greeting in which two people press their noses and foreheads together. It symbolizes the sharing of hā — the breath of life — and traces back to the creation story where the god Tāne breathed life into the first woman."
  },
  {
    clue: "Where a massive dam on the world's longest river created a reservoir that displaced over a million people",
    answer: "China",
    type: "country",
    countryId: "156",
    center: { lat: 30.82, lon: 111.0 },
    acceptRadius: null,
    blurb: "The Three Gorges Dam on the Yangtze River is the world's largest hydroelectric power station, generating 22,500 MW. Its reservoir stretches 660 kilometers and forced the relocation of over 1.3 million people and the submersion of ancient towns and archaeological sites."
  },
  {
    clue: "Where an entire country is built on thousands of low-lying coral atolls, facing extinction as sea levels rise",
    answer: "Maldives",
    type: "country",
    countryId: "462",
    center: { lat: 3.2, lon: 73.22 },
    acceptRadius: null,
    blurb: "The Maldives' 1,190 coral islands average just 1.5 meters above sea level, making it the world's lowest-lying country. Climate scientists warn that most of the archipelago could be uninhabitable by 2100 if sea levels continue to rise."
  },
  {
    clue: "Where a wine-growing region in the shadow of a flat-topped mountain produces some of the Southern Hemisphere's most celebrated vintages",
    answer: "South Africa",
    type: "country",
    countryId: "710",
    center: { lat: -33.94, lon: 18.86 },
    acceptRadius: null,
    blurb: "Stellenbosch, nestled beneath the Helderberg mountains near Cape Town, has produced wine since Dutch settlers planted the first vines in 1679. The region's unique terroir — Mediterranean climate, ancient granite soils — makes it one of the world's great wine regions."
  },
  {
    clue: "Where the midnight sun shines for months in summer and total darkness blankets the land in winter",
    answer: "Norway",
    type: "country",
    countryId: "578",
    center: { lat: 69.65, lon: 18.96 },
    acceptRadius: null,
    blurb: "North of the Arctic Circle in Norway, the sun doesn't set for weeks in summer — Tromsø gets continuous daylight from May to July. In winter, the polar night brings months of darkness, lit only by the aurora borealis."
  },
  {
    clue: "Where the national dish is a hearty stew of chickpeas, meat, and vegetables slow-cooked overnight for the Sabbath",
    answer: "Israel",
    type: "country",
    countryId: "376",
    center: { lat: 31.77, lon: 35.22 },
    acceptRadius: null,
    blurb: "Cholent (or hamin in Sephardic tradition) is a slow-cooked stew prepared before sundown on Friday, as Jewish law prohibits cooking on the Sabbath. It simmers overnight, filling homes with rich aromas by Saturday lunch."
  },
  {
    clue: "Where the world's largest flower — up to a meter across and smelling of rotting flesh — blooms in the rainforest",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -0.5, lon: 102.0 },
    acceptRadius: null,
    blurb: "Rafflesia arnoldii, found in the rainforests of Sumatra, produces blooms up to one meter in diameter — the world's largest individual flower. It has no roots, stems, or leaves, parasitizing jungle vines. Its rotting-meat smell attracts pollinating flies."
  },
  {
    clue: "Where the oldest known city in the world has been continuously inhabited for over 11,000 years",
    answer: "Syria",
    type: "country",
    countryId: "760",
    center: { lat: 33.51, lon: 36.29 },
    acceptRadius: null,
    blurb: "Damascus is widely considered the oldest continuously inhabited city in the world, with evidence of settlement from around 9000 BCE. Its Old City, a UNESCO World Heritage Site, contains layers of Roman, Byzantine, and Islamic architecture."
  },
  {
    clue: "Where a high plateau called the Roof of Africa holds the continent's tallest peak, a snow-capped volcano near the equator",
    answer: "Tanzania",
    type: "country",
    countryId: "834",
    center: { lat: -3.07, lon: 37.35 },
    acceptRadius: null,
    blurb: "Mount Kilimanjaro rises 5,895 meters — Africa's highest point — as a freestanding volcanic massif near the equator. Climbers pass through five distinct climate zones, from tropical rainforest to arctic summit. Its iconic glaciers are rapidly shrinking."
  },
];


const HARD_CLUES = [
  // ── existing clues ──
  {
    clue: "Where the Toraja people keep their dead in cliff-side caves and bring them out each year to dress them in fresh clothes",
    answer: "Sulawesi",
    type: "point",
    center: { lat: -3.07, lon: 119.82 },
    acceptRadius: 250,
    blurb: "The Ma'nene ceremony in Tana Toraja sees families exhume their deceased relatives, clean the mummified bodies, and dress them in new clothing. Death is seen not as a moment but a gradual process that can take years."
  },
  {
    clue: "A gas crater in the desert has been burning continuously since Soviet engineers accidentally ignited it in 1971",
    answer: "Turkmenistan",
    type: "country",
    countryId: "795",
    center: { lat: 40.2527, lon: 58.4397 },
    acceptRadius: null,
    blurb: "The Darvaza gas crater — nicknamed the Door to Hell — was created when a Soviet drilling rig collapsed into a cavern of natural gas. Engineers lit it, expecting it to burn out in weeks. Over 50 years later, it still blazes."
  },
  {
    clue: "Where whale bones and shipwrecks litter a fog-shrouded coast that earned a name from the skeletons left behind",
    answer: "Namibia",
    type: "country",
    countryId: "516",
    center: { lat: -22.0, lon: 17.1 },
    acceptRadius: null,
    blurb: "The Skeleton Coast stretches along Namibia's Atlantic shore, named for the remains of whales hunted in the 19th century and ships wrecked by its treacherous currents. The San people called it 'The Land God Made in Anger.'"
  },
  {
    clue: "A remote plateau where flat-topped mountains rise above the clouds, inspiring tales of a lost world filled with prehistoric creatures",
    answer: "Venezuela",
    type: "country",
    countryId: "862",
    center: { lat: 5.2, lon: -62.0 },
    acceptRadius: null,
    blurb: "The tepuis of Venezuela's Gran Sabana are ancient sandstone mesas over two billion years old. Mount Roraima inspired Arthur Conan Doyle's 'The Lost World' — its summit ecosystem evolved in near-total isolation."
  },
  {
    clue: "Where the world's oldest known figurative cave paintings show warty pigs rendered by human hands 45,000 years ago",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -5.0, lon: 119.8 },
    acceptRadius: null,
    blurb: "In 2021, archaeologists dated a painting of a Sulawesi warty pig in Leang Tedongnge cave to at least 45,500 years ago, making it the oldest known figurative art. It rewrote the story of when and where humans first created art."
  },
  {
    clue: "Where enormous stone heads weighing up to 50 tons were carved by a civilization that vanished before written history",
    answer: "Mexico",
    type: "country",
    countryId: "484",
    center: { lat: 18.15, lon: -94.1 },
    acceptRadius: null,
    blurb: "The Olmec colossal heads of southern Mexico, some standing 3.4 meters tall, were carved from single basalt boulders transported over 80 kilometers. The Olmec civilization, active from 1500–400 BCE, is considered the 'mother culture' of Mesoamerica."
  },
  {
    clue: "A country where divers descend into an almost perfectly circular blue sinkhole that drops 125 meters into ancient limestone",
    answer: "Belize",
    type: "country",
    countryId: "084",
    center: { lat: 17.19, lon: -88.5 },
    acceptRadius: null,
    blurb: "The Great Blue Hole off Belize's coast is a collapsed underwater cave system formed during the last ice age. Jacques Cousteau declared it one of the world's top diving sites after exploring its stalactite-filled depths in 1971."
  },
  {
    clue: "Where an underground city carved from volcanic rock once sheltered 20,000 people across eighteen stories of tunnels",
    answer: "Turkey",
    type: "country",
    countryId: "792",
    center: { lat: 38.37, lon: 34.73 },
    acceptRadius: null,
    blurb: "Derinkuyu in Cappadocia is the deepest known underground city, extending 60 meters below the surface. Built by early Christians fleeing Roman persecution, it contained stables, churches, schools, and rolling stone doors that sealed from the inside."
  },
  {
    clue: "Where enormous geoglyphs of animals and shapes stretch across a desert, visible only from high above, made by a people who left no written record",
    answer: "Peru",
    type: "country",
    countryId: "604",
    center: { lat: -14.74, lon: -75.13 },
    acceptRadius: null,
    blurb: "The Nazca Lines span 450 square kilometers and include over 800 straight lines, 300 geometric figures, and 70 animal designs. Created between 500 BCE and 500 CE, their purpose remains debated — theories range from astronomical calendars to water rituals."
  },
  {
    clue: "A desert so dry it went without recorded rainfall for 400 years, yet it hosts telescopes that see deeper into space than almost anywhere on Earth",
    answer: "Chile",
    type: "country",
    countryId: "152",
    center: { lat: -24.6, lon: -70.4 },
    acceptRadius: null,
    blurb: "The Atacama Desert's extreme aridity and high altitude create the clearest skies on Earth. ALMA, the world's largest ground-based astronomical project, sits at 5,000 meters here — its 66 antennas peer back to the earliest galaxies."
  },
  {
    clue: "Where the world's longest known cave system extends over 680 kilometers beneath rolling hills of bluegrass",
    answer: "United States",
    type: "country",
    countryId: "840",
    center: { lat: 37.19, lon: -86.1 },
    acceptRadius: null,
    blurb: "Mammoth Cave in Kentucky has over 680 km of surveyed passages, with new ones still being discovered. The cave's ecosystem includes eyeless fish and crayfish that evolved in total darkness over millions of years."
  },
  {
    clue: "An archipelago where a naturalist's five-week visit led him to rewrite the theory of how species come to exist",
    answer: "Ecuador",
    type: "country",
    countryId: "218",
    center: { lat: -0.83, lon: -91.13 },
    acceptRadius: null,
    blurb: "Charles Darwin visited the Galápagos in 1835 and observed that finches on different islands had evolved distinct beak shapes for different food sources. This observation became the cornerstone of his theory of natural selection."
  },
  {
    clue: "A volcanic island that rose from the sea in 1963 and has been closed to all but a handful of scientists ever since",
    answer: "Iceland",
    type: "country",
    countryId: "352",
    center: { lat: 63.3, lon: -20.6 },
    acceptRadius: null,
    blurb: "Surtsey erupted from the ocean floor off Iceland's coast over four years, creating a pristine natural laboratory. Scientists have tracked every species that colonizes it — from bacteria to seabirds — documenting how life claims new land."
  },
  {
    clue: "Where an ancient people built stepped wells descending seven stories underground to chase water tables that shift with each monsoon",
    answer: "India",
    type: "country",
    countryId: "356",
    center: { lat: 27.0, lon: 76.6 },
    acceptRadius: null,
    blurb: "Chand Baori in Rajasthan is one of the deepest stepwells in the world, with 3,500 narrow steps descending 13 stories. Built around 800 CE, these architectural marvels served as water storage, cool retreats, and community gathering places."
  },
  {
    clue: "A kingdom where a narrow strait separates islands whose animals evolved so differently that a scientist drew an invisible line between two biological worlds",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -8.4, lon: 116.8 },
    acceptRadius: null,
    blurb: "The Wallace Line runs between Bali and Lombok — just 35 km apart — yet separates Asian fauna (tigers, monkeys) from Australasian species (marsupials, cockatoos). Alfred Russel Wallace identified this boundary in 1859, independently conceiving natural selection."
  },
  // ── new hard clues ──
  {
    clue: "An island where trees bleed crimson sap and look like umbrellas blown inside out, found nowhere else on Earth",
    answer: "Yemen",
    type: "country",
    countryId: "887",
    center: { lat: 12.47, lon: 53.87 },
    acceptRadius: null,
    blurb: "Socotra Island, off Yemen's coast, separated from the African mainland over six million years ago. Its dragon blood trees, with their dense umbrella-shaped canopies, produce a dark red resin used since antiquity as dye, medicine, and incense."
  },
  {
    clue: "Where a monastery clings to the face of a sheer cliff at 3,000 meters, reachable only by a steep mountain path",
    answer: "Bhutan",
    type: "country",
    countryId: "064",
    center: { lat: 27.49, lon: 89.36 },
    acceptRadius: null,
    blurb: "Paro Taktsang — the Tiger's Nest — perches 900 meters above the valley floor. Legend says Guru Rinpoche flew here on the back of a tigress in the 8th century to meditate in a cave for three years, three months, and three days."
  },
  {
    clue: "Where an enormous circular formation in the desert, visible from orbit, puzzled astronauts who first thought it was a meteor impact",
    answer: "Mauritania",
    type: "country",
    countryId: "478",
    center: { lat: 21.12, lon: -11.4 },
    acceptRadius: null,
    blurb: "The Richat Structure — the Eye of the Sahara — is a 40-kilometer-wide bullseye of eroded rock in Mauritania's desert. Once thought to be an impact crater, geologists now believe it's a dome of rock pushed upward and eroded over millions of years."
  },
  {
    clue: "Where millions of golden jellyfish pulse through a marine lake each day, having lost their sting after evolving in isolation",
    answer: "Palau",
    type: "country",
    countryId: "585",
    center: { lat: 7.16, lon: 134.38 },
    acceptRadius: null,
    blurb: "Jellyfish Lake in Palau was cut off from the ocean roughly 12,000 years ago. Trapped golden jellyfish evolved without predators, losing their stinging cells. Each day, millions migrate across the lake following the sun to feed their symbiotic algae."
  },
  {
    clue: "Where hundreds of mysterious stone jars, some weighing several tons, are scattered across a highland plateau with no clear explanation",
    answer: "Laos",
    type: "country",
    countryId: "418",
    center: { lat: 19.46, lon: 103.18 },
    acceptRadius: null,
    blurb: "The Plain of Jars in Xieng Khouang province contains thousands of megalithic stone jars up to 3 meters tall, dating from 500 BCE to 500 CE. Their purpose is debated — burial urns, rice wine storage, or something else entirely."
  },
  {
    clue: "An island nation where a prehistoric fish, thought extinct for 65 million years, was pulled from the deep by a local fisherman in 1938",
    answer: "South Africa",
    type: "country",
    countryId: "710",
    center: { lat: -32.97, lon: 27.87 },
    acceptRadius: null,
    blurb: "The coelacanth was known only from fossils until Marjorie Courtenay-Latimer identified a living specimen caught off South Africa's coast. A second population was found near the Comoros Islands. These 'living fossils' have barely changed in hundreds of millions of years."
  },
  {
    clue: "Where the world's largest collection of medieval astronomical instruments stands on a hilltop, built by a prince who wanted to map the stars more precisely than anyone before",
    answer: "India",
    type: "country",
    countryId: "356",
    center: { lat: 26.93, lon: 75.83 },
    acceptRadius: null,
    blurb: "Jantar Mantar in Jaipur, built by Maharaja Sawai Jai Singh II in 1734, contains the world's largest stone sundial, standing 27 meters tall. Its collection of astronomical instruments can measure time, predict eclipses, and track star positions with remarkable precision."
  },
  {
    clue: "Where a vast underground vault beneath permafrost stores seeds from every nation as insurance against global catastrophe",
    answer: "Norway",
    type: "country",
    countryId: "578",
    center: { lat: 78.24, lon: 15.45 },
    acceptRadius: null,
    blurb: "The Svalbard Global Seed Vault, buried 120 meters inside an Arctic mountain, holds over 1.1 million seed samples from nearly every country. Built to withstand earthquakes, nuclear war, and rising seas, it's humanity's ultimate backup for the world's food crops."
  },
  {
    clue: "Where over 2,000 crumbling Buddhist temples spread across a vast plain beside a river, built by kings competing to outdo each other's piety",
    answer: "Myanmar",
    type: "country",
    countryId: "104",
    center: { lat: 21.17, lon: 94.86 },
    acceptRadius: null,
    blurb: "Bagan's temple-studded plain was built between the 9th and 13th centuries by the kings of the Pagan Dynasty. At its peak, over 10,000 structures stood here. Today, roughly 2,200 survive — the densest concentration of Buddhist temples and pagodas in the world."
  },
  {
    clue: "Where an avenue of ancient baobab trees, some over 800 years old, lines a dirt road through dry western forests",
    answer: "Madagascar",
    type: "country",
    countryId: "450",
    center: { lat: -20.25, lon: 44.42 },
    acceptRadius: null,
    blurb: "The Avenue of the Baobabs near Morondava features towering Grandidier's baobabs, up to 30 meters tall with trunks 11 meters in circumference. These trees once stood within a dense tropical forest that has since been cleared, leaving them as solitary sentinels."
  },
  {
    clue: "A country where the world's oldest wine-making tradition continues in clay vessels buried underground, a method unchanged for 8,000 years",
    answer: "Georgia",
    type: "country",
    countryId: "268",
    center: { lat: 42.32, lon: 43.36 },
    acceptRadius: null,
    blurb: "Georgia's qvevri winemaking uses large clay vessels buried in the earth, where grape juice ferments with skins and stems for months. Archaeological evidence from 6000 BCE makes this the oldest known winemaking method. UNESCO recognized it as intangible heritage in 2013."
  },
  {
    clue: "Where three massive turquoise-tiled squares once formed the heart of a Silk Road empire, dazzling travelers with geometric perfection",
    answer: "Uzbekistan",
    type: "country",
    countryId: "860",
    center: { lat: 39.65, lon: 66.96 },
    acceptRadius: null,
    blurb: "Samarkand's Registan — meaning 'sandy place' — features three grand madrasas framing a central plaza. Built between the 15th and 17th centuries under the Timurid dynasty, their soaring portals and intricate tilework made Samarkand the jewel of the Silk Road."
  },
  {
    clue: "Where the world's most linguistically diverse country has over 800 languages spoken across jungle-covered highlands and volcanic islands",
    answer: "Papua New Guinea",
    type: "country",
    countryId: "598",
    center: { lat: -6.31, lon: 143.96 },
    acceptRadius: null,
    blurb: "Papua New Guinea's 800-plus languages represent about 12 percent of all languages on Earth. The extreme terrain — dense rainforest, high mountains, and isolated valleys — kept communities apart for millennia, each developing unique languages, customs, and art forms."
  },
  {
    clue: "Where frankincense trees grow on misty escarpments above a desert coast, producing the resin that ancient Romans valued more than gold",
    answer: "Oman",
    type: "country",
    countryId: "512",
    center: { lat: 17.04, lon: 54.09 },
    acceptRadius: null,
    blurb: "The Dhofar region of Oman has been the world's primary source of frankincense for over 5,000 years. The aromatic resin, harvested by slashing Boswellia tree bark, was burned in temples from Rome to China and carried along trade routes that shaped the ancient world."
  },
  {
    clue: "Where the Earth's crust is splitting apart at a rift valley that will eventually tear a continent in two, creating a new ocean",
    answer: "Ethiopia",
    type: "country",
    countryId: "231",
    center: { lat: 11.5, lon: 41.0 },
    acceptRadius: null,
    blurb: "The Afar Triangle in Ethiopia sits atop a triple junction where three tectonic plates are pulling apart. In 2005, a 60-kilometer crack opened in days. Geologists estimate that in roughly 10 million years, the rift will fill with water, splitting Africa and creating a new ocean basin."
  },
  {
    clue: "Where a high-altitude lake straddling two countries holds floating islands built from bundled reeds by a people who predate the Inca",
    answer: "Peru",
    type: "country",
    countryId: "604",
    center: { lat: -15.84, lon: -69.95 },
    acceptRadius: null,
    blurb: "Lake Titicaca, at 3,812 meters, is the highest navigable lake in the world. The Uros people build and maintain floating islands from totora reeds, a tradition stretching back centuries. They originally moved onto the lake to escape Inca expansion."
  },
  // ── expanded hard clues: geography, food, language, climate, landmarks ──
  {
    clue: "Where the coldest inhabited place on Earth recorded minus 67.7°C, and residents leave their car engines running all winter",
    answer: "Russia",
    type: "country",
    countryId: "643",
    center: { lat: 63.46, lon: 142.79 },
    acceptRadius: null,
    blurb: "Oymyakon in Yakutia holds the record for the coldest permanently inhabited place: -67.7°C in 1933. At these temperatures, exhaled breath freezes instantly, glasses stick to faces, and the ground is permafrost hundreds of meters deep."
  },
  {
    clue: "Where a high-altitude salt desert holds the world's largest lithium reserves, fueling the global battery revolution",
    answer: "Bolivia",
    type: "country",
    countryId: "068",
    center: { lat: -20.13, lon: -67.49 },
    acceptRadius: null,
    blurb: "The Salar de Uyuni contains an estimated 21 million tons of lithium — roughly a quarter of the world's known reserves. As demand for electric vehicle batteries skyrockets, this remote Andean salt flat has become one of the most strategically important places on Earth."
  },
  {
    clue: "Where a language with clicking consonants is spoken by a people whose ancestors are the oldest genetic lineage of modern humans",
    answer: "Botswana",
    type: "country",
    countryId: "072",
    center: { lat: -22.33, lon: 24.68 },
    acceptRadius: null,
    blurb: "The San people of the Kalahari speak languages with up to 100 distinct click consonants — the most complex sound systems known. Genetic studies show the San carry the oldest mitochondrial DNA lineage, making them among the closest living relatives of the first Homo sapiens."
  },
  {
    clue: "Where an underwater cave system stretching over 370 kilometers contains the bones of Ice Age mammals and ancient Maya sacrifices",
    answer: "Mexico",
    type: "country",
    countryId: "484",
    center: { lat: 20.5, lon: -87.4 },
    acceptRadius: null,
    blurb: "The Yucatán Peninsula's cenotes connect to Sistema Sac Actun, the world's longest known underwater cave system. Inside, divers have found 12,000-year-old human skeletons, giant sloth bones, and Maya offerings — a subterranean museum of deep time."
  },
  {
    clue: "Where the world's deepest lake holds one-fifth of all unfrozen fresh water on Earth, home to the only freshwater seal",
    answer: "Russia",
    type: "country",
    countryId: "643",
    center: { lat: 53.5, lon: 108.0 },
    acceptRadius: null,
    blurb: "Lake Baikal in Siberia plunges 1,642 meters deep and contains about 23,000 cubic kilometers of fresh water. Its endemic nerpa seal is the world's only exclusively freshwater seal. The lake formed 25-30 million years ago, making it also the world's oldest."
  },
  {
    clue: "Where a coastal desert meets one of the richest marine ecosystems on Earth, fed by an upwelling current that draws nutrients from the deep",
    answer: "Peru",
    type: "country",
    countryId: "604",
    center: { lat: -14.0, lon: -76.0 },
    acceptRadius: null,
    blurb: "The Humboldt Current brings cold, nutrient-rich water up from the ocean depths along Peru's coast, creating one of the world's most productive fishing grounds. This same current keeps the adjacent Atacama-Sechura desert bone-dry."
  },
  {
    clue: "Where a massive underwater sinkhole called the Blue Hole drops straight down through ancient coral into darkness",
    answer: "Belize",
    type: "country",
    countryId: "084",
    center: { lat: 17.32, lon: -87.53 },
    acceptRadius: null,
    blurb: "The Great Blue Hole is a 300-meter-wide, 125-meter-deep marine sinkhole formed during the last Ice Age when sea levels were lower. Jacques Cousteau declared it one of the top ten diving sites in the world after exploring it in 1971."
  },
  {
    clue: "Where the densest population on Earth lives on a tiny island where every square meter has been built upon, even the rooftops",
    answer: "China",
    type: "country",
    countryId: "156",
    center: { lat: 22.33, lon: 114.16 },
    acceptRadius: null,
    blurb: "Hong Kong's Kowloon Walled City was once the densest place on Earth — 33,000 people in 2.6 hectares before it was demolished in 1993. Today, Hong Kong's overall density still reaches 130,000 people per square kilometer in its most packed districts."
  },
  {
    clue: "Where nomadic herders follow reindeer across frozen tundra, speaking a language with over 300 words for snow and ice",
    answer: "Norway",
    type: "country",
    countryId: "578",
    center: { lat: 69.0, lon: 25.0 },
    acceptRadius: null,
    blurb: "The Sámi people have herded reindeer across northern Scandinavia for thousands of years. Their language has hundreds of words for snow conditions — essential vocabulary for navigating a landscape where a wrong step on thin crust can mean disaster."
  },
  {
    clue: "Where a country's entire economy once collapsed overnight, its currency inflating so fast that a loaf of bread cost billions",
    answer: "Zimbabwe",
    type: "country",
    countryId: "716",
    center: { lat: -17.83, lon: 31.05 },
    acceptRadius: null,
    blurb: "Zimbabwe's hyperinflation peaked in November 2008 at an estimated 79.6 billion percent per month. Prices doubled every 24 hours. The government printed 100-trillion-dollar bills that couldn't buy a bus ticket. The Zimbabwean dollar was abandoned entirely in 2009."
  },
  {
    clue: "Where an ancient spice island once produced the world's entire supply of nutmeg, sparking wars between colonial empires",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -4.53, lon: 129.77 },
    acceptRadius: null,
    blurb: "The Banda Islands in the Maluku archipelago were the world's sole source of nutmeg for centuries. The spice was so valuable that in 1667, the Dutch traded Manhattan to the British in exchange for keeping control of the tiny island of Run."
  },
  {
    clue: "Where the driest inhabited continent has a rock formation sacred to Indigenous peoples that changes color throughout the day",
    answer: "Australia",
    type: "country",
    countryId: "036",
    center: { lat: -25.34, lon: 131.04 },
    acceptRadius: null,
    blurb: "Uluru (Ayers Rock) rises 348 meters from the flat red desert of central Australia. Sacred to the Anangu people for over 30,000 years, it shifts from ochre to deep red to violet as the sun moves. Climbing was officially banned in 2019 out of respect."
  },
  {
    clue: "Where the world's largest mangrove forest spans the delta of two great rivers, home to the Bengal tiger and threatened by rising seas",
    answer: "Bangladesh",
    type: "country",
    countryId: "050",
    center: { lat: 21.95, lon: 89.18 },
    acceptRadius: null,
    blurb: "The Sundarbans, spanning Bangladesh and India, is the world's largest mangrove forest at 10,000 square kilometers. It shelters the last significant population of Bengal tigers adapted to swimming in tidal waters. Rising seas threaten to submerge much of it by 2100."
  },
  {
    clue: "Where a fermented mare's milk drink is the national beverage, sipped from bowls inside felt tents on the open steppe",
    answer: "Mongolia",
    type: "country",
    countryId: "496",
    center: { lat: 47.92, lon: 106.92 },
    acceptRadius: null,
    blurb: "Airag (kumiss) is fermented mare's milk, slightly alcoholic and mildly sour, drunk by Mongolian nomads for centuries. It's prepared in cowhide bags and stirred thousands of times. A guest refusing airag in a ger (yurt) is considered deeply impolite."
  },
  {
    clue: "Where a single volcanic eruption in 1883 was heard 4,800 kilometers away — the loudest sound in recorded history",
    answer: "Indonesia",
    type: "country",
    countryId: "360",
    center: { lat: -6.1, lon: 105.42 },
    acceptRadius: null,
    blurb: "Krakatoa's 1883 eruption was equivalent to 200 megatons of TNT. The sound reached Australia, 4,800 km away. The explosion triggered tsunamis that killed over 36,000 people and ejected so much ash that global temperatures dropped by 1.2°C for five years."
  },
  {
    clue: "Where the largest living organism on Earth — a honey mushroom — spreads underground across nearly 10 square kilometers of forest",
    answer: "United States",
    type: "country",
    countryId: "840",
    center: { lat: 44.2, lon: -118.95 },
    acceptRadius: null,
    blurb: "The Armillaria ostoyae in Oregon's Blue Mountains covers 965 hectares, making it the world's largest known organism. Estimated at 2,400 to 8,650 years old, this single fungal network silently kills trees across an area larger than many cities."
  },
  {
    clue: "Where a landlocked country's flag is the only national flag in the world that isn't rectangular",
    answer: "Nepal",
    type: "country",
    countryId: "524",
    center: { lat: 27.72, lon: 85.32 },
    acceptRadius: null,
    blurb: "Nepal's flag is two stacked triangles — the world's only non-rectangular national flag. The triangles represent the Himalaya mountains and the two major religions of Hinduism and Buddhism. The crimson red symbolizes bravery, the blue border peace."
  },
  {
    clue: "Where a tiny European country is governed by a prince and is the world's second-smallest nation, built into a cliffside above the sea",
    answer: "Monaco",
    type: "country",
    countryId: "492",
    center: { lat: 43.73, lon: 7.42 },
    acceptRadius: null,
    blurb: "Monaco covers just 2.02 square kilometers — the world's second-smallest country after Vatican City. Its population density is the highest in the world. The Grimaldi family has ruled since 1297, making it one of the oldest ruling dynasties in Europe."
  },
  {
    clue: "Where a dense tropical forest shelters mountain gorillas found nowhere else on Earth, protected by rangers who risk their lives",
    answer: "Rwanda",
    type: "country",
    countryId: "646",
    center: { lat: -1.47, lon: 29.38 },
    acceptRadius: null,
    blurb: "The Virunga Mountains on Rwanda's border hold about a third of the world's 1,000 remaining mountain gorillas. Intensive conservation efforts have brought them back from the brink — their population has doubled since the 1980s."
  },
  {
    clue: "Where a vast stone fortress built on top of a 200-meter rock column once held a king's palace, gardens, and swimming pools",
    answer: "Sri Lanka",
    type: "country",
    countryId: "144",
    center: { lat: 7.96, lon: 80.76 },
    acceptRadius: null,
    blurb: "Sigiriya Rock Fortress was built by King Kashyapa in the 5th century CE atop a 200-meter volcanic plug. Its summit held a palace with elaborate water gardens. The western face still bears ancient frescoes of celestial maidens painted over 1,500 years ago."
  },
  {
    clue: "Where the world's longest system of underground rivers flows beneath a jungle-covered island, filled with cathedral-sized chambers",
    answer: "Philippines",
    type: "country",
    countryId: "608",
    center: { lat: 10.19, lon: 118.92 },
    acceptRadius: null,
    blurb: "The Puerto Princesa Underground River on Palawan island flows 8.2 kilometers through a spectacular limestone cave system directly into the sea. Its chambers reach up to 120 meters wide and contain million-year-old stalactites and fossils."
  },
  {
    clue: "Where an ancient trade route brought silk, spices, and ideas across deserts for thousands of miles, connecting East to West",
    answer: "China",
    type: "country",
    countryId: "156",
    center: { lat: 40.0, lon: 94.66 },
    acceptRadius: null,
    blurb: "The Silk Road stretched 6,400 kilometers from Xi'an to the Mediterranean, active from the 2nd century BCE to the 15th century CE. It carried not just silk and spices but religions, technologies, languages, and diseases — connecting civilizations across the known world."
  },
  {
    clue: "Where a country of a thousand hills was ravaged by genocide in 1994, then rebuilt itself into one of Africa's cleanest and fastest-growing economies",
    answer: "Rwanda",
    type: "country",
    countryId: "646",
    center: { lat: -1.94, lon: 29.87 },
    acceptRadius: null,
    blurb: "Rwanda's 1994 genocide killed approximately 800,000 people in 100 days. In the decades since, the country banned plastic bags, achieved near-universal healthcare, and became one of the safest nations in Africa — a transformation often called the 'Rwandan miracle.'"
  },
  {
    clue: "Where an 800-year-old university built around a mosque is considered the oldest continuously operating university in the world",
    answer: "Morocco",
    type: "country",
    countryId: "504",
    center: { lat: 34.07, lon: -5.0 },
    acceptRadius: null,
    blurb: "The University of al-Qarawiyyin in Fez was founded in 859 CE by Fatima al-Fihri, a merchant's daughter. UNESCO and the Guinness World Records recognize it as the oldest existing, continuously operating educational institution in the world."
  },
  {
    clue: "Where the world's largest cave chamber is big enough to fit a Boeing 747 inside, discovered only in 2009 by a local farmer",
    answer: "Vietnam",
    type: "country",
    countryId: "704",
    center: { lat: 17.54, lon: 106.15 },
    acceptRadius: null,
    blurb: "Sơn Đoòng Cave in Phong Nha province contains the world's largest cave passage — over 5 kilometers long, 200 meters tall, and 150 meters wide. A local farmer named Hồ Khanh discovered its entrance in 1991 but didn't return until British cavers explored it in 2009."
  },
  {
    clue: "Where a landlocked country in the Himalayas measures prosperity not by GDP but by Gross National Happiness",
    answer: "Bhutan",
    type: "country",
    countryId: "064",
    center: { lat: 27.47, lon: 89.64 },
    acceptRadius: null,
    blurb: "Bhutan's fourth king declared in 1972 that 'Gross National Happiness is more important than Gross National Product.' The country measures wellbeing across nine domains including ecological diversity, cultural resilience, and psychological well-being."
  },
  {
    clue: "Where a ring of limestone towers rises from emerald waters, creating one of the most dramatic seascapes on Earth",
    answer: "Vietnam",
    type: "country",
    countryId: "704",
    center: { lat: 20.9, lon: 107.1 },
    acceptRadius: null,
    blurb: "Hạ Long Bay contains nearly 2,000 limestone karst islands and islets rising from the Gulf of Tonkin. Vietnamese legend says the islands were created by a dragon spitting jewels to form a wall against invaders. Fishing villages still float among the towers."
  },
  {
    clue: "Where the world's widest river can stretch 50 kilometers across during flood season, making the far bank invisible",
    answer: "Argentina",
    type: "country",
    countryId: "032",
    center: { lat: -34.0, lon: -58.4 },
    acceptRadius: null,
    blurb: "The Río de la Plata estuary between Argentina and Uruguay spans up to 220 kilometers at its widest point. The Paraná River that feeds it is the second-longest river in South America and drains a basin the size of India."
  },
  {
    clue: "Where women of the Kayan people wear brass coils around their necks from childhood, elongating the appearance of their necks over decades",
    answer: "Myanmar",
    type: "country",
    countryId: "104",
    center: { lat: 19.5, lon: 97.0 },
    acceptRadius: null,
    blurb: "Kayan women begin wearing brass neck coils around age five, gradually adding rings. The coils don't actually lengthen the neck — they push down the collarbone and ribs, creating the illusion. The practice is tied to beauty ideals and cultural identity."
  },
  {
    clue: "Where the world's largest desert — larger than all of the United States — spans an entire continent from coast to coast",
    answer: "Algeria",
    type: "country",
    countryId: "012",
    center: { lat: 28.03, lon: 1.66 },
    acceptRadius: null,
    blurb: "The Sahara Desert covers 9.2 million square kilometers across North Africa — roughly the size of the United States. Algeria contains the largest portion. Despite its barren image, the Sahara was green and wet just 5,000 years ago, with rivers, lakes, and cattle herders."
  },
];


const seenEasy = new Set();
const seenHard = new Set();

export function getClueSet(difficulty = 'easy') {
  const pool = difficulty === 'hard' ? HARD_CLUES : EASY_CLUES;
  const seen = difficulty === 'hard' ? seenHard : seenEasy;

  // Reset seen set if we've used most of the pool
  if (seen.size > pool.length - 5) seen.clear();

  // Filter to unseen clues
  let available = pool.filter((_, i) => !seen.has(i));
  if (available.length < 5) {
    seen.clear();
    available = [...pool];
  }

  // Shuffle available
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const picked = available.slice(0, 5);

  // Mark as seen
  picked.forEach(clue => {
    const idx = pool.indexOf(clue);
    if (idx !== -1) seen.add(idx);
  });

  return picked;
}
