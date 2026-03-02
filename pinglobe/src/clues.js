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
];

export function getClueSet(difficulty = 'easy') {
  const pool = difficulty === 'hard' ? HARD_CLUES : EASY_CLUES;
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 5);
}
