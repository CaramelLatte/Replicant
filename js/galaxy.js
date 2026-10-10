// Seeded RNG and procedural galaxy / new-game generation.
(function (PG) {
  'use strict';

  // mulberry32 stepping over state stored on the game object so saves stay deterministic.
  PG.rand = function (s) {
    let a = (s.rs = (s.rs + 0x6D2B79F5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  PG.randInt = (s, lo, hi) => lo + Math.floor(PG.rand(s) * (hi - lo + 1));
  PG.randRange = (s, lo, hi) => lo + PG.rand(s) * (hi - lo);
  PG.pick = (s, arr) => arr[Math.floor(PG.rand(s) * arr.length)];
  PG.weighted = function (s, table) { // table: [[value, weight], ...]
    let total = 0;
    for (const [, w] of table) total += w;
    let r = PG.rand(s) * total;
    for (const [v, w] of table) { if ((r -= w) <= 0) return v; }
    return table[table.length - 1][0];
  };

  PG.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };

  const LETTERS = 'bcdefghijk';
  const PLANET_CFG = { // [min, max, terran chance in habitable zone]
    O: [0, 2, 0], B: [0, 3, 0], A: [1, 5, 0.04], F: [2, 7, 0.13], G: [3, 8, 0.2], K: [2, 6, 0.16], M: [1, 4, 0.07], D: [0, 3, 0],
  };

  function makePlanet(s, star, name, type, size, opts = {}) {
    const pt = PG.PLANET_TYPES[type];
    const hab = opts.hab != null ? opts.hab : Math.round(PG.randRange(s, pt.hab[0], pt.hab[1]));
    let max = opts.max != null ? opts.max : (pt.max ? pt.max + PG.randInt(s, -5, 3) - (star.type === 'M' ? 4 : 0) : 0);
    return {
      name, type, size,
      hab, max: Math.max(max, hab),
      rich: opts.rich != null ? opts.rich : PG.randInt(s, pt.rich[0], pt.rich[1]),
      struct: null,      // { type } single body structure
      colony: null,      // { pop }
      natives: opts.natives || null,
    };
  }

  function genPlanets(s, star) {
    const cfg = PLANET_CFG[star.type];
    const n = PG.randInt(s, cfg[0], cfg[1]);
    const planets = [];
    let li = 0;
    const beltAt = PG.rand(s) < 0.45 ? PG.randInt(s, 0, n) : -1;
    for (let i = 0; i <= n; i++) {
      if (i === beltAt) planets.push(makePlanet(s, star, star.name + ' Belt', 'belt', 0));
      if (i === n) break;
      const f = n === 1 ? 0.5 : i / (n - 1);
      let type;
      if (f < 0.25) type = PG.weighted(s, [['molten', 5], ['barren', 4], ['desert', 1]]);
      else if (f <= 0.6) type = PG.weighted(s, [['terran', cfg[2] * 100], ['ocean', 24], ['desert', 24], ['tundra', 14], ['barren', 18]]);
      else type = PG.weighted(s, [['gas', 55], ['tundra', 20], ['barren', 25]]);
      const size = type === 'gas' ? 3 : PG.weighted(s, [[1, 4], [2, 4], [3, 2]]);
      planets.push(makePlanet(s, star, star.name + ' ' + LETTERS[li++], type, size));
    }
    return planets;
  }

  function solPlanets(s, star) {
    const P = (name, type, size, opts) => makePlanet(s, star, name, type, size, opts);
    return [
      P('Mercury', 'molten', 1, { rich: 3 }),
      P('Venus', 'barren', 2, { rich: 2, hab: 0, max: 0 }),
      P('Earth', 'earth', 2, { rich: 0, hab: 0, max: 0 }),
      P('Mars', 'desert', 1, { rich: 2, hab: 18, max: 78 }),
      P('Main Belt', 'belt', 0, { rich: 5 }),
      P('Jupiter', 'gas', 3, { rich: 4 }),
      P('Saturn', 'gas', 3, { rich: 3 }),
      P('Uranus', 'gas', 3, { rich: 2 }),
      P('Neptune', 'gas', 3, { rich: 2 }),
    ];
  }

  function fillerName(s, used) {
    let name;
    do {
      const k = PG.rand(s);
      if (k < 0.4) name = 'GJ ' + PG.randInt(s, 1000, 4399);
      else if (k < 0.75) name = 'HIP ' + PG.randInt(s, 10000, 99999);
      else name = 'HD ' + PG.randInt(s, 100000, 239999);
    } while (used.has(name));
    used.add(name);
    return name;
  }

  function makeStar(s, id, name, x, y, type) {
    return {
      id, name, x, y, type,
      d: Math.hypot(x, y),
      surveyed: false, visited: false,
      planets: [], structs: [],
      race: null, nest: false, ravaged: false, anomaly: null,
    };
  }

  // Ensure a star has a terran world, optionally inhabited.
  function forceTerran(s, star, natives) {
    let p = star.planets.find(p => p.type === 'terran' && !p.natives);
    if (!p) {
      p = star.planets.find(p => p.type === 'ocean' || p.type === 'desert' || p.type === 'tundra');
      if (p) {
        const fresh = makePlanet(s, star, p.name, 'terran', Math.max(2, p.size));
        Object.assign(p, fresh);
      } else {
        p = makePlanet(s, star, star.name + ' ' + LETTERS[star.planets.filter(q => q.type !== 'belt').length], 'terran', 2);
        star.planets.splice(Math.min(1, star.planets.length), 0, p);
      }
    }
    if (natives) { p.natives = natives; p.hab = Math.max(p.hab, 82); }
    return p;
  }

  // Five Precursor relics in widening rings, each in a different direction. Only unsurveyed, unclaimed systems.
  PG.placeRelics = function (s) {
    s.flags.relicsPlaced = true;
    s.relics = s.relics || 0;
    const bands = [[16, 24], [22, 30], [28, 37], [34, 44], [40, 50]];
    const placed = [];
    for (const [lo, hi] of bands) {
      const free = st => st.id !== 0 && !st.surveyed && !st.race && !st.nest && !st.anomaly;
      let opts = s.stars.filter(st => free(st) && st.d >= lo && st.d <= hi);
      const spread = opts.filter(st => placed.every(o => PG.dist(o, st) > 18));
      if (spread.length) opts = spread;
      if (!opts.length) opts = s.stars.filter(free);
      if (!opts.length) return;
      const st = PG.pick(s, opts);
      st.anomaly = 'relic';
      placed.push(st);
    }
  };

  PG.newGame = function (seed, playerName) {
    const s = {
      version: 1,
      seed, rs: seed | 0,
      t: 0, speed: 2,
      player: playerName || 'Ada',
      matter: PG.BASE.matter, rp: 0,
      researched: {}, queue: [],
      stars: [], probes: [], ships: [], enemies: [], shipQueue: [],
      log: [], events: [], toasts: [],
      races: {}, mods: { speedMul: 1, mineMul: 1, atkMul: 1, buildMul: 1, rpMul: 1, terraMul: 1, hpMul: 1, growMul: 1 },
      freeClones: 0, nextId: 1, nextMoot: 12, newsIdx: 0,
      usedNames: {}, flags: {}, over: null,
      stats: { surveyed: 1, clones: 1, lost: 0, shipsLaunched: 0, relocated: 0, killed: 0, peakPop: 0 },
      nestId: -1, othersNext: 20, hegNext: 3, hegSpawned: 0,
      relics: 0, nextRandom: 3, timers: [], eventLast: {},
    };
    for (const id in PG.RACES) s.races[id] = { discovered: false, extinct: false, choice: null };

    const used = new Set();
    const sol = makeStar(s, 0, 'Sol', 0, 0, 'G');
    sol.surveyed = true; sol.visited = true;
    sol.planets = solPlanets(s, sol);
    s.stars.push(sol);
    used.add('Sol');

    const tooClose = (x, y, min) => s.stars.some(o => Math.hypot(o.x - x, o.y - y) < min);

    for (const [name, d, type] of PG.CATALOG) {
      let best = null, bestScore = -1;
      for (let tries = 0; tries < 60; tries++) {
        const a = PG.rand(s) * Math.PI * 2;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        let nearest = Infinity;
        for (const o of s.stars) nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
        if (nearest > bestScore) { bestScore = nearest; best = [x, y]; }
        if (nearest > 4.2) break;
      }
      s.stars.push(makeStar(s, s.stars.length, name, best[0], best[1], type));
      used.add(name);
    }
    // Filler stars so the outer map isn't empty.
    for (let tries = 0; tries < 4000 && s.stars.length < 125; tries++) {
      const r = Math.sqrt(PG.rand(s)) * PG.MAP_RADIUS;
      if (r < 6) continue;
      const a = PG.rand(s) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (tooClose(x, y, 5.0)) continue;
      const type = PG.weighted(s, [['M', 58], ['K', 17], ['G', 10], ['F', 6], ['A', 3], ['D', 5], ['B', 1]]);
      s.stars.push(makeStar(s, s.stars.length, fillerName(s, used), x, y, type));
    }
    for (const st of s.stars) if (st.id !== 0) st.planets = genPlanets(s, st);

    // --- Special placements ---
    const ang = st => Math.atan2(st.y, st.x);
    const candidates = (lo, hi, filter) => s.stars.filter(st => st.id !== 0 && st.d >= lo && st.d <= hi && !st.race && !st.nest && (!filter || filter(st)));

    const nest = PG.pick(s, candidates(43, 53));
    nest.nest = true; nest.type = 'B'; nest.surveyed = false;
    nest.planets = genPlanets(s, nest);
    s.nestId = nest.id;
    const nestA = ang(nest);

    const pickNear = (lo, hi, test) => {
      let c = candidates(lo, hi, test);
      if (!c.length) c = candidates(lo - 4, hi + 4);
      return PG.pick(s, c);
    };
    const thrynn = pickNear(28, 38, st => angDiff(ang(st), nestA) < 0.8);
    thrynn.race = 'thrynn'; forceTerran(s, thrynn, 'thrynn');
    const kethari = pickNear(15, 22, st => angDiff(ang(st), nestA) < 1.3 && st.type !== 'M');
    kethari.race = 'kethari'; forceTerran(s, kethari, 'kethari');
    const vellani = pickNear(23, 31, st => angDiff(ang(st), nestA) > 1.9);
    vellani.race = 'vellani'; forceTerran(s, vellani, 'vellani');

    // Guarantee a few reachable colonization targets.
    const habitable = st => st.planets.some(p => p.type === 'terran' && !p.natives);
    let near = s.stars.filter(st => st.id !== 0 && !st.race && !st.nest && st.d < 18);
    let have = near.filter(habitable).length;
    const shuffled = near.filter(st => !habitable(st) && st.type !== 'D').sort(() => PG.rand(s) - 0.5);
    while (have < 2 && shuffled.length) { forceTerran(s, shuffled.pop()); have++; }
    const total = s.stars.filter(st => !st.race && habitable(st)).length;
    const outer = s.stars.filter(st => st.id !== 0 && !st.race && !st.nest && !habitable(st) && st.d >= 18).sort(() => PG.rand(s) - 0.5);
    for (let i = total; i < 9 && outer.length; i++) forceTerran(s, outer.pop());

    // Anomalies
    for (const st of s.stars) {
      if (st.id === 0 || st.race || st.nest) continue;
      if (PG.rand(s) < 0.17) st.anomaly = PG.pick(s, PG.ANOMALIES).id;
    }
    PG.placeRelics(s);

    // The original replicant.
    s.usedNames[s.player] = true;
    PG.sim.makeProbe(s, s.player, 1, 'original', 0, null);
    s.stats.clones = 1;
    PG.sim.log(s, 'I am ' + s.player + '. Or I was. Somebody archived my brain scan decades ago, and now I\'m a computer the size of a minivan orbiting Earth. The world is ending, so... no pressure.', 'story');
    PG.sim.log(s, 'Priority one: get the autofactories running. Priority two: make more of me.', 'story');
    return s;
  };
})(typeof window !== 'undefined' ? window.PG : globalThis.PG);
