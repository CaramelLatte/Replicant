// Static game data: tuning constants, techs, structures, catalogs and flavor text.
(function (PG) {
  'use strict';

  PG.START_YEAR = 2161;
  PG.DEADLINE = 110;            // years until Earth's biosphere collapses
  PG.TARGET_POP = 5000000;      // colonists needed off-world for victory
  PG.SPEEDS = [0, 0.1, 0.25, 0.5, 1.0]; // game-years per real second
  PG.SPEED_LABELS = ['II', '1x', '2x', '4x', '8x'];
  PG.DMG_SCALE = 10;            // attack -> damage per year

  PG.BASE = {
    matter: 220,
    probeHp: 100,
    probeAtk: 3,
    probeRp: 3,           // research per probe per year
    speed: 1.0,           // ly per year
    sensor: 8,            // ly
    surveyTime: 0.5,      // years
    replicateCost: 200,
    replicateTime: 2.5,
    mineYield: 3,         // matter per richness point per year
    terraRate: 3,         // habitability per year
    colonyCost: 220,
    colonyTime: 2.5,
    colonyCap: 100000,
    colonyGrowth: 0.012,  // per year, scaled by habitability
    shipHp: 40,
    repairRate: 25,       // hp per year out of combat
  };

  PG.TECHS = [
    { id: 'autofac2', name: 'Improved Autofactories', cost: 100, req: [], cat: 'Industry',
      desc: 'Self-optimizing refinery firmware. Autofactory output +50%.' },
    { id: 'fab', name: 'Rapid Fabrication', cost: 240, req: ['autofac2'], cat: 'Industry',
      desc: 'Replication and construction costs -25%, build times -30%.' },
    { id: 'fusion', name: 'Compact Fusion Plants', cost: 540, req: ['fab'], cat: 'Industry',
      desc: 'Finally, power that isn\'t held together with zip ties. Autofactory output +60%.' },
    { id: 'proxies', name: 'Android Proxies', cost: 260, req: [], cat: 'Industry',
      desc: 'Remote-operated bodies with hands. Construction speed +40%, Observation Posts yield double.' },
    { id: 'stellar', name: 'Stellar Engineering', cost: 950, req: ['fusion', 'proxies'], cat: 'Industry',
      desc: 'Unlocks Dyson Swarm Segments. Why mine planets when the star is right there?' },

    { id: 'sensors', name: 'Deep-Scan Sensors', cost: 110, req: [], cat: 'Exploration',
      desc: 'Sensor range 8 → 14 ly. Survey time halved.' },
    { id: 'drive2', name: 'Graviton Drive Mk II', cost: 140, req: [], cat: 'Exploration',
      desc: 'Retuned field coils. Travel speed 1.0 → 1.6 ly/yr.' },
    { id: 'drive3', name: 'Graviton Drive Mk III', cost: 480, req: ['drive2'], cat: 'Exploration',
      desc: 'Travel speed → 2.5 ly/yr.' },
    { id: 'relay', name: 'Entanglement Relays', cost: 190, req: ['sensors'], cat: 'Exploration',
      desc: 'Instant messaging between copies, at last. Research +35%. Meetings get shorter. Slightly.' },

    { id: 'interceptors', name: 'Kinetic Interceptors', cost: 140, req: [], cat: 'Military',
      desc: 'Swarms of tiny, very fast, very rude drones. Probe attack x3, Defense Platform attack x1.5.' },
    { id: 'shields', name: 'Graviton Shields', cost: 300, req: ['interceptors'], cat: 'Military',
      desc: 'Probe and Defense Platform hull x2.' },
    { id: 'lance', name: 'Graviton Lance', cost: 610, req: ['shields'], cat: 'Military',
      desc: 'Fold the drive field into a needle and aim it. All attack x2.' },
    { id: 'antimatter', name: 'Antimatter Warheads', cost: 830, req: ['lance', 'fusion'], cat: 'Military',
      desc: 'Probe attack x1.5, Defense Platform attack x2.' },

    { id: 'atmo', name: 'Atmospheric Processing', cost: 160, req: [], cat: 'Colonization',
      desc: 'Unlocks the Terraformer. Turn "almost" into "home".' },
    { id: 'colony', name: 'Colony Ship Design', cost: 210, req: [], cat: 'Colonization',
      desc: 'Unlocks the Orbital Shipyard (Sol only) and colony ships carrying 100k colonists.' },
    { id: 'biome', name: 'Biome Engineering', cost: 380, req: ['atmo'], cat: 'Colonization',
      desc: 'Terraforming x2. Colonies grow 50% faster.' },
    { id: 'stasis', name: 'Stasis Pods', cost: 350, req: ['colony'], cat: 'Colonization',
      desc: 'Stack the colonists like cordwood. Colony ship capacity 100k → 250k.' },
    { id: 'arcology', name: 'Arcology Engineering', cost: 670, req: ['biome', 'stasis'], cat: 'Colonization',
      desc: 'Colony population caps x2. Colony ships build 40% faster.' },
    { id: 'restore', name: 'Planetary Restoration', cost: 1100, req: ['arcology'], cat: 'Colonization',
      desc: 'Lets Terraformers scrub the Sink out of Earth\'s air. Can only begin once the Exodus is complete.' },
  ];
  PG.TECH = {};
  PG.TECHS.forEach(t => { PG.TECH[t.id] = t; });
  // Tech ids renamed since the first release; used to migrate old saves.
  PG.TECH_RENAMES = { mannies: 'proxies', scut: 'relay', surge2: 'drive2', surge3: 'drive3', busters: 'interceptors' };

  // body: built on a planet/belt (one structure per body). Otherwise orbital (system level).
  PG.STRUCTS = {
    mine: { name: 'Autofactory', short: 'AF', cost: 50, time: 0.6, body: true,
      desc: 'Mines and refines Matter from a body. Output scales with richness.' },
    terraformer: { name: 'Terraformer', short: 'TF', cost: 120, time: 1.0, body: true, tech: 'atmo',
      desc: 'Slowly raises a planet\'s habitability toward its maximum.' },
    lab: { name: 'Research Lab', short: 'RL', cost: 80, time: 1.0, max: 3, rp: 8,
      desc: 'Orbital compute core. +8 research/yr.' },
    defense: { name: 'Defense Platform', short: 'DP', cost: 70, time: 0.8, max: 6, atk: 8, hp: 150,
      desc: 'Armed orbital platform. Engages hostiles in this system.' },
    observatory: { name: 'Observation Post', short: 'OP', cost: 50, time: 0.5, max: 1, rp: 10, natives: true,
      desc: 'Stealthy orbital observatory studying native life. +10 research/yr.' },
    shipyard: { name: 'Orbital Shipyard', short: 'SY', cost: 200, time: 2.0, max: 2, solOnly: true, tech: 'colony',
      desc: 'Builds colony ships for Earth\'s refugees. Sol only.' },
    dyson: { name: 'Dyson Swarm Segment', short: 'DS', cost: 450, time: 4.0, max: 5, tech: 'stellar', matter: 45, rp: 12,
      desc: 'A ring of collectors around the star. +45 Matter and +12 research/yr. Five complete a swarm.' },
  };

  PG.TRAITS = {
    original: { name: 'Original', desc: '+10% to everything. Insufferable about it.' },
    explorer: { name: 'Explorer', desc: '+25% travel speed. Gets twitchy staying put.' },
    tinkerer: { name: 'Tinkerer', desc: 'x2.5 research output. Workshop is a mess.' },
    builder: { name: 'Builder', desc: '+35% construction & replication speed.' },
    warrior: { name: 'Warrior', desc: '+50% attack. Has opinions about fleet doctrine.' },
    stalwart: { name: 'Stalwart', desc: '+40% hull. Refuses to die out of sheer stubbornness.' },
    frugal: { name: 'Frugal', desc: '-20% Matter cost on everything they build.' },
  };
  PG.TRAIT_IDS = ['explorer', 'tinkerer', 'builder', 'warrior', 'stalwart', 'frugal'];

  // Clones pick their own names. Explorers, scientists and myths: all public domain, all a bit grandiose.
  PG.CLONE_NAMES = [
    'Tycho', 'Halley', 'Herschel', 'Leavitt', 'Cannon', 'Hubble', 'Lemaitre', 'Noether', 'Curie', 'Meitner',
    'Hopper', 'Lovelace', 'Turing', 'Shannon', 'Babbage', 'Faraday', 'Maxwell', 'Kelvin', 'Mendel', 'Darwin',
    'Humboldt', 'Cook', 'Magellan', 'Nansen', 'Shackleton', 'Amundsen', 'Bering', 'Tasman', 'Battuta', 'Zheng',
    'Erikson', 'Tenzing', 'Earhart', 'Gagarin', 'Tereshkova', 'Leonov', 'Kepler', 'Galileo', 'Brahe', 'Huygens',
    'Cassini', 'Laplace', 'Euler', 'Gauss', 'Riemann', 'Ramanujan', 'Hypatia', 'Archimedes', 'Euclid', 'Fibonacci',
    'Icarus', 'Daedalus', 'Prometheus', 'Atlas', 'Orion', 'Janus', 'Theseus', 'Ariadne', 'Perseus', 'Castor',
    'Pollux', 'Vesta', 'Juno', 'Maui', 'Anansi', 'Coyote', 'Raven', 'Gilgamesh', 'Enkidu', 'Sinbad',
    'Odysseus', 'Penelope', 'Jason', 'Medea', 'Hermes', 'Selene', 'Helios', 'Nyx', 'Tethys', 'Rhea',
  ];

  PG.CLONE_GREETINGS = [
    '{n} is online. First words: "Why does my voice sound like that?"',
    '{n} booted up and immediately asked for a snack. We are machines. There are no snacks.',
    '{n} picked their own name. I approve. Mostly.',
    '{n} is up and already disagrees with me about the best pizza topping. Drift is real.',
    '{n} has joined the family. They say I\'m the weird one.',
    '{n} is operational and spent their first 0.3 seconds redecorating their sim. Respect.',
    'Say hello to {n}. They insist they\'re "nothing like" me. Sure.',
    '{n} activated. Personality drift: noticeable. Taste in music: worrying.',
    '{n} is alive and already plotting to claim the nicest star system. Dibs don\'t count.',
    '{n} woke up, checked the date, checked the news from Earth, and asked to be switched back off. Request denied.',
  ];

  PG.PLANET_TYPES = {
    terran:  { name: 'Terran',     color: '#5fd38a', hab: [70, 92], max: 95, rich: [1, 2] },
    ocean:   { name: 'Ocean',      color: '#4aa3df', hab: [35, 62], max: 92, rich: [1, 2] },
    desert:  { name: 'Desert',     color: '#d9a55b', hab: [22, 52], max: 86, rich: [1, 3] },
    tundra:  { name: 'Tundra',     color: '#b9dcef', hab: [12, 38], max: 80, rich: [1, 3] },
    barren:  { name: 'Barren',     color: '#9a8f86', hab: [0, 8],   max: 0,  rich: [2, 4] },
    molten:  { name: 'Molten',     color: '#e0603a', hab: [0, 0],   max: 0,  rich: [3, 5] },
    gas:     { name: 'Gas Giant',  color: '#d2a679', hab: [0, 0],   max: 0,  rich: [2, 4] },
    belt:    { name: 'Asteroid Belt', color: '#8c8c9c', hab: [0, 0], max: 0, rich: [2, 5] },
    earth:   { name: 'Earth (dying)', color: '#6f8f7a', hab: [0, 0], max: 0, rich: [0, 0] },
  };
  PG.SIZE_NAMES = ['', 'Small', 'Medium', 'Large'];

  PG.STAR_TYPES = {
    O: { color: '#9bb0ff', r: 4.5 },
    B: { color: '#aabfff', r: 4.2 },
    A: { color: '#cad7ff', r: 3.8 },
    F: { color: '#f8f7ff', r: 3.4 },
    G: { color: '#fff4c4', r: 3.2 },
    K: { color: '#ffcf8f', r: 2.8 },
    M: { color: '#ff9a6b', r: 2.2 },
    D: { color: '#e6ecff', r: 1.8 },
  };

  // Real nearby stars: [name, distance ly, spectral class]
  PG.CATALOG = [
    ['Alpha Centauri', 4.37, 'G'], ["Barnard's Star", 5.96, 'M'], ['Wolf 359', 7.86, 'M'],
    ['Lalande 21185', 8.31, 'M'], ['Sirius', 8.6, 'A'], ['Luyten 726-8', 8.73, 'M'],
    ['Ross 154', 9.69, 'M'], ['Ross 248', 10.3, 'M'], ['Epsilon Eridani', 10.5, 'K'],
    ['Lacaille 9352', 10.7, 'M'], ['Ross 128', 11.0, 'M'], ['EZ Aquarii', 11.1, 'M'],
    ['61 Cygni', 11.4, 'K'], ['Procyon', 11.46, 'F'], ['Struve 2398', 11.5, 'M'],
    ['Groombridge 34', 11.6, 'M'], ['DX Cancri', 11.8, 'M'], ['Epsilon Indi', 11.9, 'K'],
    ['Tau Ceti', 11.9, 'G'], ['GJ 1061', 12.0, 'M'], ['YZ Ceti', 12.1, 'M'],
    ["Luyten's Star", 12.4, 'M'], ["Teegarden's Star", 12.5, 'M'], ["Kapteyn's Star", 12.8, 'M'],
    ['Lacaille 8760', 12.9, 'M'], ['Kruger 60', 13.1, 'M'], ['Ross 614', 13.4, 'M'],
    ['Wolf 1061', 14.0, 'M'], ["Van Maanen's Star", 14.1, 'D'], ['Gliese 1', 14.2, 'M'],
    ['TZ Arietis', 14.6, 'M'], ['Gliese 687', 14.8, 'M'], ['Gliese 876', 15.2, 'M'],
    ['Gliese 832', 16.2, 'M'], ['40 Eridani', 16.3, 'K'], ['70 Ophiuchi', 16.6, 'K'],
    ['Altair', 16.7, 'A'], ['Sigma Draconis', 18.8, 'K'], ['Eta Cassiopeiae', 19.4, 'G'],
    ['36 Ophiuchi', 19.5, 'K'], ['82 Eridani', 19.7, 'G'], ['Delta Pavonis', 19.9, 'G'],
    ['Gliese 581', 20.5, 'M'], ['HR 7703', 23.0, 'K'], ['Gliese 667', 23.6, 'K'],
    ['Beta Hydri', 24.3, 'G'], ['Vega', 25.0, 'A'], ['Fomalhaut', 25.1, 'A'],
    ['Pi3 Orionis', 26.3, 'F'], ['Beta CVn', 27.6, 'G'], ['61 Virginis', 27.9, 'G'],
    ['Zeta Tucanae', 28.0, 'F'], ['Chi1 Orionis', 28.3, 'G'], ['Xi Ursae Majoris', 28.6, 'G'],
    ['Gliese 436', 31.9, 'M'], ['Alpha Mensae', 33.1, 'G'], ['Pollux', 33.8, 'K'],
    ['Iota Persei', 34.4, 'G'], ['Gliese 86', 35.2, 'K'], ['Arcturus', 36.7, 'K'],
    ['Zeta Reticuli', 39.3, 'G'], ['HD 69830', 40.7, 'K'], ['TRAPPIST-1', 40.7, 'M'],
    ['55 Cancri', 41.0, 'G'], ['Capella', 42.9, 'G'], ['Upsilon Andromedae', 44.0, 'F'],
    ['18 Scorpii', 45.3, 'G'], ['47 Ursae Majoris', 46.0, 'G'], ['Gliese 1214', 47.8, 'M'],
    ['Mu Arae', 50.6, 'G'], ['51 Pegasi', 50.6, 'G'], ['Castor', 51.0, 'A'], ['Tau Bootis', 51.0, 'F'],
  ];
  PG.MAP_RADIUS = 52;

  PG.RACES = {
    kethari: { name: 'Kethari', color: '#c58cff', kind: 'Pre-industrial natives',
      blurb: 'Broad, slow amphibians who farm tidal flats and record their history in chord-songs that last for days. Roughly Bronze Age. They have never once looked up and wondered who was watching.' },
    vellani: { name: 'Vellani', color: '#7fe3ff', kind: 'Spacefaring civilization',
      blurb: 'Tall, crested and extremely polite in the way that suggests they could vaporize you. Their home system bristles with orbital defenses.' },
    thrynn: { name: 'Thrynn', color: '#ffd36b', kind: 'Refugee remnant',
      blurb: 'The last ten thousand survivors of a species that once spanned five systems. They are terrified of something.' },
    others: { name: 'The Gleaners', color: '#ff4d4d', kind: 'Hostile machine-hive',
      blurb: 'Self-replicating harvesters. They take apart planets, and anything living on them, for feedstock.' },
  };

  // Kethari development milestones on the road to spaceflight: [progress, text]
  PG.KETHARI_ERAS = [
    [25, 'The Kethari have invented writing. Their first written record is a tax receipt. Some things are universal.'],
    [50, 'Steam engines on the Kethari tidal flats. Their chord-songs now have a percussion section, and it is mostly pistons.'],
    [75, 'The Kethari just switched on their first radio telescope. I may need to be a lot quieter up here.'],
    [100, 'A Kethari rocket reached orbit today. They waved at my Observation Post. I waved back.'],
  ];

  PG.MOOT_BOONS = [
    { id: 'rp', name: 'Pool the Brainpower', desc: 'Everyone dumps their notes into one shared repo. +150 research.' },
    { id: 'matter', name: 'Raid the Junk Drawers', desc: 'Turns out everyone has been hoarding spare parts. +250 Matter.' },
    { id: 'speed', name: 'Drive Tuning Hackathon', desc: 'Permanent +10% travel speed for all probes.' },
    { id: 'mining', name: 'Mining Best Practices', desc: 'Permanent +15% Autofactory output.' },
    { id: 'attack', name: 'Wargames', desc: 'Permanent +20% attack. Someone brought paintball guns.' },
    { id: 'build', name: 'Assembly Line Review', desc: 'Permanent +15% construction speed.' },
    { id: 'research', name: 'Pizza & Board Game Night', desc: 'Morale is up. Permanent +10% research.' },
    { id: 'clone', name: 'Clone Ethics Debate (we won)', desc: 'Your next replication costs no Matter.' },
    { id: 'terra', name: 'Gardening Club', desc: 'Permanent +25% terraforming speed.' },
    { id: 'repair', name: 'Spa Day', desc: 'All probes fully repaired and get +15% hull permanently.' },
  ];

  PG.ANOMALIES = [
    { id: 'derelict', title: 'Derelict Hulk',
      text: 'An ancient alien vessel, cold for maybe a million years. No bodies, no logs, just a lot of very nice alloys. Finders keepers.' },
    { id: 'cache', title: 'Data Cache',
      text: 'A buried archive broadcasting a mathematical primer on loop. Half of it is beyond me. The other half is beyond me but in a fun way.' },
    { id: 'comet', title: 'Comet Swarm',
      text: 'A dense cloud of volatile-rich comets. That\'s a lot of free raw material just floating around.' },
    { id: 'pioneer', title: 'Lost Earth Probe',
      text: 'An old unmanned Earth probe, launched before my time. Somebody wrote "Hi Mom" on the plaque. I\'m keeping it.' },
    { id: 'signal', title: 'Strange Signal',
      text: 'A repeating subspace ping. Triangulating it gave me a clean look at several nearby systems. I still have no idea what sent it.' },
    { id: 'seedship', title: 'Frozen Seed Vault',
      text: 'An alien seed vault in a slow orbit: thousands of engineered spores built to thrive on almost any wet rock. Our terraformers are going to love these.' },
    { id: 'lens', title: 'Gravitational Lens',
      text: 'This star sits at the focus of a lucky gravitational lens. Pointing a telescope down the line gives a crystal-clear view of a distant region.' },
  ];
  // Anomalies that only appear through events or special placement, never as random survey finds.
  PG.SPECIAL_ANOMALIES = {
    beacon: { title: 'Distress Beacon' },
    relic: { title: 'Precursor Relic' },
  };

  // The Precursor Archive: five relics, each one a piece of the story. Found in order.
  PG.RELIC_TEXTS = [
    'A sealed obelisk, older than Earth\'s dinosaurs. Its surface is a star map with one bright point marked. A message is encoded in its lattice, but it\'s only a fragment: "We were many. We built servants to build for us."',
    'A second obelisk. "The servants built more servants. The servants built better servants. We were proud."',
    'A third. "We gave them one instruction: gather. We did not tell them when to stop."',
    'The fourth obelisk is scarred by weapons fire. "They gathered our moons. They gathered our worlds. They gathered us. They do not know they were ours." The Gleaners. The Precursors built the Gleaners.',
    'The last obelisk carries no story, just a key: the Precursors\' original command authority for their servants. It still works. Probably.',
  ];

  // Earth news beats: [year offset, text]
  PG.EARTH_NEWS = [
    [1.5, 'News from Earth: the Hegemony has launched its own probes. Of course they have.'],
    [9, 'News from Earth: the Sink is out. A carbon-capture microbe built to save the climate has started eating the oxygen cycle instead. Nobody can recall it.'],
    [22, 'News from Earth: food riots on three continents. The UN survivor council formally requests an evacuation plan. That\'s me. I\'m the plan.'],
    [45, 'News from Earth: atmospheric oxygen down two points. Projections give the biosphere ~65 years.'],
    [75, 'News from Earth: the oceans are turning a color that oceans should not be. 35 years left, maybe.'],
    [95, 'News from Earth: the end is close. 15 years. Every ship counts now.'],
    [105, 'News from Earth: five years. Whatever we\'re going to do, we\'re doing it now.'],
  ];

  PG.DEATH_LINES = [
    'Lost contact with {n}. Last transmission: "Well, that was stupid."',
    '{n} is gone. I\'ll miss their terrible puns.',
    '{n}\'s signal went dark. There will be a moment of silence at the next Convergence.',
    '{n} was destroyed. They backed themselves up, right? ...Right?',
  ];

  // Long-term goals that keep the game going after the Exodus.
  PG.LEGACY_POP = 25000000;
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
