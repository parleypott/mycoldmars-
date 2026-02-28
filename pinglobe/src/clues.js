const EASY_CLUE_SETS = [
  [
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
  ],
  [
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
  ],
  [
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
  ],
];

const HARD_CLUE_SETS = [
  [
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
  ],
  [
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
  ],
  [
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
  ],
];

export function getClueSet(difficulty = 'easy') {
  const sets = difficulty === 'hard' ? HARD_CLUE_SETS : EASY_CLUE_SETS;
  return sets[Math.floor(Math.random() * sets.length)];
}
