// Game simulation: derived stats, player actions, and the per-tick update.
(function (PG) {
  'use strict';
  const S = PG.sim = {};
  const B = PG.BASE;

  // ---------------------------------------------------------------- helpers
  S.has = (s, id) => !!s.researched[id];
  S.year = s => PG.START_YEAR + s.t;
  S.star = (s, id) => s.stars[id];
  S.probe = (s, id) => s.probes.find(p => p.id === id);
  S.fmtYear = t => (PG.START_YEAR + t).toFixed(1);

  S.log = function (s, text, kind) {
    s.log.push({ t: s.t, text, kind: kind || 'info' });
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  };
  S.toast = function (s, text, kind) { s.toasts.push({ text, kind: kind || 'info' }); };
  S.event = function (s, ev) { ev.id = s.nextId++; s.events.push(ev); };
  const fill = (tpl, n) => tpl.replace(/\{n\}/g, n);

  S.pos = function (s, u) {
    if (u.travel) {
      const tr = u.travel, to = s.stars[tr.to];
      const f = tr.d > 0 ? Math.min(1, tr.done / tr.d) : 1;
      return { x: tr.x0 + (to.x - tr.x0) * f, y: tr.y0 + (to.y - tr.y0) * f };
    }
    const st = s.stars[u.star];
    return { x: st.x, y: st.y };
  };

  // ---------------------------------------------------------- derived stats
  const traitIs = (p, t) => p && p.trait === t;
  S.speedTier = s => S.has(s, 'drive3') ? 2.5 : S.has(s, 'drive2') ? 1.6 : B.speed;
  S.probeSpeed = (s, p) => S.speedTier(s) * s.mods.speedMul * (traitIs(p, 'explorer') ? 1.25 : 1) * (traitIs(p, 'original') ? 1.1 : 1);
  S.shipSpeed = s => S.speedTier(s) * 0.8 * s.mods.speedMul;
  S.atkMul = s => (S.has(s, 'interceptors') ? 3 : 1) * (S.has(s, 'lance') ? 2 : 1) * s.mods.atkMul;
  S.probeAtk = (s, p) => B.probeAtk * S.atkMul(s) * (S.has(s, 'antimatter') ? 1.5 : 1) *
    (traitIs(p, 'warrior') ? 1.5 : 1) * (traitIs(p, 'original') ? 1.1 : 1);
  S.hpMul = s => (S.has(s, 'shields') ? 2 : 1) * s.mods.hpMul;
  S.probeMaxHp = (s, p) => B.probeHp * S.hpMul(s) * (traitIs(p, 'stalwart') ? 1.4 : 1) * (traitIs(p, 'original') ? 1.1 : 1);
  S.defAtk = s => PG.STRUCTS.defense.atk * (S.has(s, 'interceptors') ? 1.5 : 1) * (S.has(s, 'lance') ? 2 : 1) *
    (S.has(s, 'antimatter') ? 2 : 1) * s.mods.atkMul;
  S.defMaxHp = s => PG.STRUCTS.defense.hp * S.hpMul(s);
  S.sensorRange = s => S.has(s, 'sensors') ? 14 : B.sensor;
  S.surveyTime = s => B.surveyTime * (S.has(s, 'sensors') ? 0.5 : 1);
  S.buildSpeed = (s, p) => (S.has(s, 'proxies') ? 1.4 : 1) * (traitIs(p, 'builder') ? 1.35 : 1) *
    (traitIs(p, 'original') ? 1.1 : 1) * s.mods.buildMul / (S.has(s, 'fab') ? 0.7 : 1);
  S.costMul = (s, p) => (S.has(s, 'fab') ? 0.75 : 1) * (traitIs(p, 'frugal') ? 0.8 : 1);
  S.structCost = (s, type, p) => Math.round(PG.STRUCTS[type].cost * S.costMul(s, p));
  S.replicateCost = (s, p) => s.freeClones > 0 ? 0 : Math.round(B.replicateCost * S.costMul(s, p));
  S.probeRp = (s, p) => B.probeRp * (traitIs(p, 'tinkerer') ? 2.5 : 1) * (traitIs(p, 'original') ? 1.1 : 1);
  S.mineYield = (s, planet) => planet.rich * B.mineYield * (S.has(s, 'autofac2') ? 1.5 : 1) * (S.has(s, 'fusion') ? 1.6 : 1) * s.mods.mineMul;
  S.terraRate = (s, planet) => B.terraRate * (S.has(s, 'biome') ? 2 : 1) * s.mods.terraMul * (planet && planet.type === 'earth' ? 0.5 : 1);
  S.colonyCap = s => B.colonyCap * (S.has(s, 'stasis') ? 2.5 : 1);
  S.colonyShipCost = s => Math.round(B.colonyCost * (S.has(s, 'fab') ? 0.75 : 1));
  S.colonyShipTime = s => B.colonyTime * (S.has(s, 'arcology') ? 0.6 : 1) * (S.has(s, 'fab') ? 0.7 : 1);
  S.popCap = (s, planet) => planet.size * 1500000 * (planet.hab / 100) * (S.has(s, 'arcology') ? 2 : 1);
  S.obsYield = (s) => PG.STRUCTS.observatory.rp * (S.has(s, 'proxies') ? 2 : 1) * (s.races.kethari.choice === 'observe' ? 1.5 : 1);

  S.nativesAlive = (s, planet) => planet.natives && !s.races[planet.natives].extinct;
  S.starHasNatives = (s, st) => st.planets.some(p => S.nativesAlive(s, p));
  S.colonizable = (s, planet) => planet.hab >= 70 && !planet.natives && planet.type !== 'earth';

  S.income = function (s) {
    let matter = 0, rp = 0;
    for (const st of s.stars) {
      for (const pl of st.planets) if (pl.struct && pl.struct.type === 'mine') matter += S.mineYield(s, pl);
      for (const x of st.structs) {
        if (x.type === 'lab') rp += PG.STRUCTS.lab.rp;
        else if (x.type === 'dyson') { matter += PG.STRUCTS.dyson.matter; rp += PG.STRUCTS.dyson.rp; }
        else if (x.type === 'observatory' && S.starHasNatives(s, st)) rp += S.obsYield(s);
      }
    }
    for (const p of s.probes) rp += S.probeRp(s, p);
    rp *= (S.has(s, 'relay') ? 1.35 : 1) * s.mods.rpMul;
    return { matter, rp };
  };

  S.colonialPop = function (s) {
    let n = 0;
    for (const st of s.stars) for (const pl of st.planets) if (pl.colony) n += pl.colony.pop;
    return n;
  };

  // ------------------------------------------------------------- creation
  S.nextCloneName = function (s) {
    const free = PG.CLONE_NAMES.filter(n => !s.usedNames[n]);
    let name = free.length ? PG.pick(s, free) : s.player + '-' + s.nextId;
    s.usedNames[name] = true;
    return name;
  };

  S.makeProbe = function (s, name, gen, trait, starId, parent) {
    const p = { id: s.nextId++, name, gen, trait, parent, hp: 0, star: starId, travel: null, task: null, auto: false, born: s.t };
    p.hp = S.probeMaxHp(s, p);
    s.probes.push(p);
    return p;
  };

  // --------------------------------------------------------------- actions
  // Each returns null on success or an error string.
  S.idle = p => p && !p.travel && !p.task;

  S.pendingCount = (s, starId, type) => s.probes.filter(p => p.star === starId && p.task && p.task.type === 'build' && p.task.what === type).length;

  S.canBuild = function (s, p, type, planetIdx) {
    const def = PG.STRUCTS[type];
    if (!p) return 'No probe available';
    if (p.travel) return 'Probe is in transit';
    if (p.task) return 'Probe is busy';
    const st = s.stars[p.star];
    if (!st.surveyed) return 'System not surveyed';
    if (def.tech && !S.has(s, def.tech)) return 'Requires ' + PG.TECH[def.tech].name;
    if (def.body) {
      const pl = st.planets[planetIdx];
      if (!pl) return 'No such body';
      if (pl.struct || pl.pending) return 'Body already developed';
      if (pl.type === 'earth') {
        if (type !== 'terraformer') return 'Earth has enough problems';
        if (!S.has(s, 'restore')) return 'Requires Planetary Restoration';
        if (s.over !== 'won') return 'Finish the Exodus first';
      }
      if (S.nativesAlive(s, pl)) return 'Natives live here';
      if (type === 'mine' && pl.rich <= 0) return 'Nothing to mine';
      if (type === 'terraformer' && pl.type !== 'earth') {
        if (!['ocean', 'desert', 'tundra', 'terran'].includes(pl.type)) return 'Cannot be terraformed';
        if (pl.hab >= pl.max) return 'Already at maximum habitability';
      }
    } else {
      if (def.solOnly && st.id !== 0) return 'Sol only';
      if (def.natives && !S.starHasNatives(s, st)) return 'No natives to observe';
      const n = st.structs.filter(x => x.type === type).length + S.pendingCount(s, st.id, type);
      if (def.max && n >= def.max) return 'Maximum ' + def.max + ' per system';
    }
    const cost = S.structCost(s, type, p);
    if (s.matter < cost) return 'Need ' + cost + ' Matter';
    return null;
  };

  S.orderBuild = function (s, p, type, planetIdx) {
    const err = S.canBuild(s, p, type, planetIdx);
    if (err) return err;
    const def = PG.STRUCTS[type];
    const cost = S.structCost(s, type, p);
    s.matter -= cost;
    const st = s.stars[p.star];
    if (def.body) st.planets[planetIdx].pending = true;
    p.task = { type: 'build', what: type, planet: def.body ? planetIdx : null, progress: 0, total: def.time, cost };
    return null;
  };

  S.canReplicate = function (s, p) {
    if (!p) return 'No probe';
    if (p.travel) return 'Probe is in transit';
    if (p.task) return 'Probe is busy';
    const st = s.stars[p.star];
    if (!st.surveyed) return 'Survey the system first';
    const cost = S.replicateCost(s, p);
    if (s.matter < cost) return 'Need ' + cost + ' Matter';
    return null;
  };

  S.orderReplicate = function (s, p) {
    const err = S.canReplicate(s, p);
    if (err) return err;
    const cost = S.replicateCost(s, p);
    if (s.freeClones > 0) s.freeClones--;
    s.matter -= cost;
    p.task = { type: 'replicate', progress: 0, total: B.replicateTime, cost };
    return null;
  };

  S.orderSurvey = function (s, p) {
    if (!p || p.travel) return 'Probe is in transit';
    if (p.task) return 'Probe is busy';
    if (s.stars[p.star].surveyed) return 'Already surveyed';
    p.task = { type: 'survey', progress: 0, total: S.surveyTime(s) };
    return null;
  };

  S.cancelTask = function (s, p) {
    if (!p || !p.task) return 'Nothing to cancel';
    const t = p.task;
    if (t.cost) s.matter += t.cost;
    if (t.type === 'replicate' && t.cost === 0) s.freeClones++;
    if (t.type === 'build' && t.planet != null) s.stars[p.star].planets[t.planet].pending = false;
    p.task = null;
    return null;
  };

  S.orderMove = function (s, p, starId) {
    if (!p) return 'No probe';
    if (p.star === starId && !p.travel) return 'Already there';
    if (p.task) S.cancelTask(s, p);
    const from = S.pos(s, p);
    const to = s.stars[starId];
    p.travel = { x0: from.x, y0: from.y, to: starId, d: Math.hypot(to.x - from.x, to.y - from.y), done: 0 };
    p.star = null;
    return null;
  };

  S.eta = (s, p, starId) => {
    const from = S.pos(s, p), to = s.stars[starId];
    return Math.hypot(to.x - from.x, to.y - from.y) / S.probeSpeed(s, p);
  };

  S.techAvailable = (s, id, includeQueued) => {
    const t = PG.TECH[id];
    return t.req.every(r => S.has(s, r) || (includeQueued && s.queue.includes(r)));
  };

  S.queueResearch = function (s, id) {
    if (S.has(s, id)) return 'Already researched';
    if (s.queue.includes(id)) { s.queue = s.queue.filter(q => q !== id && !PG.TECH[q].req.includes(id)); return null; }
    // Pull in missing prerequisites automatically.
    const add = (tid) => {
      if (S.has(s, tid) || s.queue.includes(tid)) return;
      PG.TECH[tid].req.forEach(add);
      s.queue.push(tid);
    };
    add(id);
    return null;
  };

  S.colonyTargets = function (s) {
    const out = [];
    for (const st of s.stars) {
      if (!st.surveyed) continue;
      st.planets.forEach((pl, i) => { if (S.colonizable(s, pl)) out.push({ star: st.id, planet: i }); });
    }
    return out.sort((a, b) => s.stars[a.star].d - s.stars[b.star].d);
  };

  S.canColonyShip = function (s) {
    if (!S.has(s, 'colony')) return 'Requires Colony Ship Design';
    if (!s.stars[0].structs.some(x => x.type === 'shipyard')) return 'Build an Orbital Shipyard at Sol';
    const cost = S.colonyShipCost(s);
    if (s.matter < cost) return 'Need ' + cost + ' Matter';
    return null;
  };

  S.orderColonyShip = function (s, starId, planetIdx) {
    const err = S.canColonyShip(s);
    if (err) return err;
    const pl = s.stars[starId] && s.stars[starId].planets[planetIdx];
    if (!pl || !S.colonizable(s, pl)) return 'Invalid destination';
    const cost = S.colonyShipCost(s);
    s.matter -= cost;
    s.shipQueue.push({ target: { star: starId, planet: planetIdx }, progress: 0, cost });
    return null;
  };

  S.cancelColonyShip = function (s, idx) {
    const q = s.shipQueue[idx];
    if (!q) return 'Nothing to cancel';
    s.matter += q.cost;
    s.shipQueue.splice(idx, 1);
    return null;
  };

  // ----------------------------------------------------------- events
  S.resolveEvent = function (s, evId, choiceIdx) {
    const i = s.events.findIndex(e => e.id === evId);
    if (i < 0) return;
    const ev = s.events[i];
    s.events.splice(i, 1);
    const ch = ev.choices && ev.choices[choiceIdx];
    if (!ch) return;
    const [kind, arg] = ch.key.split(':');
    switch (kind) {
      case 'moot': applyBoon(s, arg); break;
      case 'kethari':
        s.races.kethari.choice = arg;
        if (arg === 'uplift') { s.rp += 150; S.log(s, 'I engineered a counter-fungus and let it drift down with the spring rains. The Kethari harvest came in. They credited a particularly lucky song. Fine by me. +150 research.', 'race'); }
        else S.log(s, 'Hands off. I\'ll watch the Kethari from orbit like a very quiet nature documentary. Observation Posts here yield +50%.', 'race');
        break;
      case 'vellani':
        s.races.vellani.choice = arg;
        if (arg === 'tech') {
          const opts = PG.TECHS.filter(t => !S.has(s, t.id) && t.id !== 'restore' && S.techAvailable(s, t.id)).sort((a, b) => b.cost - a.cost);
          const gift = opts[0];
          if (gift) { completeTech(s, gift.id); S.log(s, 'The Vellani shared their research on ' + gift.name + '. It\'s humbling how far ahead they are.', 'race'); }
          else { s.rp += 300; }
        } else { s.matter += 400; S.log(s, 'The Vellani traded us 400 Matter worth of refined exotic alloys for... our entire catalog of Earth music. They really like polka.', 'race'); }
        break;
      case 'thrynn':
        s.races.thrynn.choice = arg;
        s.flags.nestKnown = true;
        if (arg === 'weapons') {
          const w = ['interceptors', 'shields', 'lance'].find(id => !S.has(s, id));
          if (w) { completeTech(s, w); S.log(s, 'The Thrynn gave us their weapon designs: ' + PG.TECH[w].name + '. They didn\'t save them. Maybe they\'ll save us.', 'race'); }
          else { s.rp += 200; }
        } else {
          const th = s.stars.find(st => st.race === 'thrynn');
          let n = 0;
          for (const st of s.stars) if (!st.surveyed && PG.dist(st, th) < 16 && !st.nest && !st.race) { revealSystem(s, st); n++; }
          S.log(s, 'The Thrynn star charts revealed ' + n + ' systems in detail.', 'race');
        }
        S.log(s, 'The Thrynn marked the Gleaner Hive on our charts. It\'s at ' + s.stars[s.nestId].name + '.', 'danger');
        break;
      case 'kethorbit': {
        const st = s.stars.find(o => o.race === 'kethari');
        if (arg === 'arm') {
          for (let i = 0; i < 4; i++) st.structs.push({ type: 'defense', hp: S.defMaxHp(s) });
          S.log(s, 'We gave the Kethari our defense platform designs. Four new platforms already orbit their world. They named them after their four most stubborn ancestors.', 'race');
        } else {
          s.mods.rpMul += 0.15;
          S.log(s, 'Formal contact with the Kethari. Their scholars have joined our research network, and they\'re fast learners. Research +15%.', 'race');
        }
        break;
      }
      case 'relic':
        if (arg === 'shutdown') {
          const fleets = s.enemies.filter(e => e.faction === 'others');
          s.enemies = s.enemies.filter(e => e.faction !== 'others');
          const nest = s.enemies.find(e => e.faction === 'nest');
          if (nest) { nest.maxHp = Math.round(nest.maxHp / 2); nest.hp = Math.min(nest.hp, nest.maxHp); }
          s.othersNext = Math.max(s.othersNext, s.t) + 25;
          S.log(s, 'I broadcast the Precursor command key on every band at once. ' + fleets.length + ' Gleaner ships went dark mid-flight. The Hive is reeling and has stopped launching, for now.', 'good');
        } else {
          s.mods.rpMul += 0.25; s.mods.mineMul += 0.25;
          s.mods.atkMul += 0.5;
          S.log(s, 'We kept the Archive. Precursor science is now our science: research +25%, mining +25%, attack +50%. I hope we\'re wiser with it than they were.', 'good');
        }
        break;
      case 'rand': PG.events.resolve(s, ev, +arg); break;
      case 'end':
        if (arg === 'continue') s.flags.continued = true;
        break;
    }
  };

  function applyBoon(s, id) {
    const m = s.mods;
    switch (id) {
      case 'rp': s.rp += 150; break;
      case 'matter': s.matter += 250; break;
      case 'speed': m.speedMul += 0.1; break;
      case 'mining': m.mineMul += 0.15; break;
      case 'attack': m.atkMul += 0.2; break;
      case 'build': m.buildMul += 0.15; break;
      case 'research': m.rpMul += 0.1; break;
      case 'clone': s.freeClones++; break;
      case 'terra': m.terraMul += 0.25; break;
      case 'repair':
        rescaleHp(s, () => { m.hpMul += 0.15; });
        for (const p of s.probes) p.hp = S.probeMaxHp(s, p);
        break;
    }
    const boon = PG.MOOT_BOONS.find(b => b.id === id);
    S.log(s, 'Convergence resolution: ' + boon.name + '. ' + boon.desc, 'moot');
  }

  function rescaleHp(s, change) {
    const before = s.probes.map(p => p.hp / S.probeMaxHp(s, p));
    const defBefore = S.defMaxHp(s);
    change();
    s.probes.forEach((p, i) => { p.hp = before[i] * S.probeMaxHp(s, p); });
    const k = S.defMaxHp(s) / defBefore;
    for (const st of s.stars) for (const x of st.structs) if (x.type === 'defense') x.hp *= k;
  }

  function completeTech(s, id) {
    rescaleHp(s, () => { s.researched[id] = true; });
    s.queue = s.queue.filter(q => q !== id);
    S.log(s, 'Research complete: ' + PG.TECH[id].name + '.', 'tech');
    S.toast(s, 'Research complete: ' + PG.TECH[id].name, 'tech');
  }
  S.completeTech = completeTech;

  // --------------------------------------------------------------- survey
  function revealSystem(s, st) {
    if (st.surveyed) return;
    st.surveyed = true;
    s.stats.surveyed++;
  }
  S.revealSystem = revealSystem;

  function completeSurvey(s, st, p) {
    revealSystem(s, st);
    const notes = [];
    const hab = st.planets.filter(pl => S.colonizable(s, pl));
    const terra = st.planets.filter(pl => !pl.natives && pl.max >= 70 && pl.hab < 70);
    if (hab.length) notes.push(hab.length + ' habitable world' + (hab.length > 1 ? 's' : '') + '!');
    if (terra.length) notes.push(terra.length + ' terraforming candidate' + (terra.length > 1 ? 's' : ''));
    const rich = st.planets.reduce((a, pl) => a + (pl.type !== 'earth' && !pl.natives ? pl.rich : 0), 0);
    notes.push('total richness ' + rich);
    S.log(s, p.name + ' surveyed ' + st.name + ': ' + st.planets.length + ' bodies, ' + notes.join(', ') + '.', hab.length ? 'good' : 'info');
    if (hab.length) S.toast(s, 'Habitable world found at ' + st.name + '!', 'good');
    if (st.anomaly) triggerAnomaly(s, st, p);
    if (st.race && !s.races[st.race].discovered) discoverRace(s, st.race, st, p);
  }

  // Also fires when a probe visits a system that was revealed remotely (charts, signals) with its anomaly untouched.
  function triggerAnomaly(s, st, p) {
    const id = st.anomaly;
    st.anomaly = null;
    st.marked = false;
    const a = PG.ANOMALIES.find(x => x.id === id) || PG.SPECIAL_ANOMALIES[id];
    let title = a.title, text = a.text, reward = '';
    switch (id) {
      case 'derelict': { const m = PG.randInt(s, 120, 220); s.matter += m; reward = '+' + m + ' Matter'; break; }
      case 'cache': { const r = PG.randInt(s, 60, 130); s.rp += r; reward = '+' + r + ' research'; break; }
      case 'comet': {
        let belt = st.planets.find(pl => pl.type === 'belt');
        if (!belt) { belt = { name: st.name + ' Cometary Cloud', type: 'belt', size: 0, hab: 0, max: 0, rich: 3, struct: null, colony: null, natives: null }; st.planets.push(belt); }
        else belt.rich += 2;
        reward = 'rich new mining site';
        break;
      }
      case 'pioneer': s.rp += 40; reward = '+40 research, +1 sentimental value'; break;
      case 'signal': {
        const near = s.stars.filter(o => !o.surveyed && !o.nest && !o.race && PG.dist(o, st) < 14).slice(0, 4);
        near.forEach(o => revealSystem(s, o));
        reward = near.length + ' nearby systems revealed';
        break;
      }
      case 'seedship': s.mods.terraMul += 0.2; reward = 'terraforming +20% permanently'; break;
      case 'lens': {
        const far = s.stars.filter(o => !o.surveyed && !o.nest && !o.race && PG.dist(o, st) > 14);
        const focus = far.length ? PG.pick(s, far) : null;
        const seen = focus ? far.filter(o => PG.dist(o, focus) < 9).slice(0, 6) : [];
        seen.forEach(o => revealSystem(s, o));
        reward = seen.length + ' distant systems revealed' + (focus ? ' around ' + focus.name : '');
        break;
      }
      case 'beacon':
        if (PG.rand(s) < 0.6) {
          text = 'A crippled alien survey ship, crew long gone, its beacon still faithfully crying for help. I gave the hulk a burial in the star. I kept the cargo. I\'m sentimental, not stupid.';
          s.matter += 260; s.rp += 80; reward = '+260 Matter, +80 research';
        } else {
          text = 'It was bait. A Hegemony hunter-killer was parked behind the beacon, waiting for someone soft-hearted.';
          s.enemies.push({ id: s.nextId++, faction: 'hegemony', name: 'Hegemony Hunter', hp: 130, maxHp: 130, atk: 7, star: st.id, travel: null, wait: 1, speed: 1.0 });
          reward = 'ambush!';
        }
        break;
      case 'relic': {
        const n = s.relics = (s.relics || 0) + 1;
        s.rp += 100;
        title = 'Precursor Relic ' + n + '/5';
        text = PG.RELIC_TEXTS[n - 1];
        reward = '+100 research';
        const next = s.stars.filter(o => o.anomaly === 'relic').sort((a, b) => PG.dist(a, st) - PG.dist(b, st))[0];
        if (next) {
          next.marked = true;
          S.log(s, 'The relic\'s star map highlights ' + next.name + ', ' + next.d.toFixed(0) + ' ly from Sol. Marked on our charts.', 'anomaly');
        }
        if (n === 1) S.event(s, { type: 'info', title: 'The Precursors', body: p.name + ' found something at ' + st.name + ' that nobody built in the last hundred million years.\n\n' + text + '\n\nThere are more of these out there. The obelisk points to the next one, ' + (next ? next.name : 'somewhere') + '.', choices: [{ label: 'Follow the trail.', key: 'ok' }] });
        if (n === 5) S.event(s, {
          type: 'info', title: 'The Precursor Archive',
          body: 'All five relics are decoded. The Precursors built self-replicating machines to gather resources, and never told them to stop. The Gleaners are what is left of their servants. The Precursors are what is left of their meal.\n\nI am a self-replicating machine too. I\'m trying not to think about that too hard.\n\nThe last relic holds their command key. We can use it once, loudly, or keep the Archive and learn from it.',
          choices: [
            { label: 'Broadcast the shutdown', desc: 'Every roaming Gleaner ship goes dark. The Hive loses half its strength and stops launching for 25 years.', key: 'relic:shutdown' },
            { label: 'Keep the Archive', desc: 'Permanent research +25%, mining +25%, attack +50%.', key: 'relic:keep' },
          ],
        });
        break;
      }
    }
    S.log(s, 'ANOMALY at ' + st.name + ': ' + title + '. ' + text + ' (' + reward + ')', 'anomaly');
    S.toast(s, title + ' at ' + st.name + ': ' + reward, 'anomaly');
  }

  function discoverRace(s, id, st, p) {
    const r = s.races[id];
    r.discovered = true;
    const info = PG.RACES[id];
    s.stats.races = (s.stats.races || 0) + 1;
    const ev = { type: 'contact', race: id, title: 'First Contact: ' + info.name, star: st.id };
    if (id === 'kethari') {
      ev.body = p.name + ' found intelligent life at ' + st.name + '. ' + info.blurb + '\n\nA fungal blight is tearing through their tidal crops this season. They\'re no threat to anyone. Which means if the Gleaners find them, they\'re done.\n\nGiven time and protection, they might reach the stars themselves one day.';
      ev.choices = [
        { label: 'Observe from orbit (Observation Posts +50%)', key: 'kethari:observe' },
        { label: 'Quietly cure the blight (+150 research, they develop 50% faster)', key: 'kethari:uplift' },
      ];
    } else if (id === 'vellani') {
      ev.body = p.name + ' was hailed (politely, with targeting lasers) on arrival at ' + st.name + '. ' + info.blurb + '\n\nAfter some awkward linguistics they offer a trade.';
      ev.choices = [
        { label: 'Trade for technology (free advanced tech)', key: 'vellani:tech' },
        { label: 'Trade for materials (+400 Matter)', key: 'vellani:matter' },
      ];
    } else if (id === 'thrynn') {
      ev.body = p.name + ' found a battered settlement at ' + st.name + '. ' + info.blurb + '\n\nThey call the enemy "the Hungry Quiet". I\'ve been calling them the Gleaners. Their Hive is at ' + s.stars[s.nestId].name + '. The Thrynn offer what they can.';
      ev.choices = [
        { label: 'Weapon designs (free military tech)', key: 'thrynn:weapons' },
        { label: 'Star charts (reveal nearby systems)', key: 'thrynn:charts' },
      ];
    }
    S.log(s, 'FIRST CONTACT with the ' + info.name + ' at ' + st.name + '.', 'race');
    S.event(s, ev);
  }

  // ------------------------------------------------------------- update
  S.update = function (s, dt) {
    if (s.over && !s.flags.continued) return;
    while (dt > 0) {
      const step = Math.min(dt, 0.02);
      tick(s, step);
      dt -= step;
    }
  };

  function tick(s, dt) {
    s.t += dt;

    // Economy
    const inc = S.income(s);
    s.matter += inc.matter * dt;
    s.rp += inc.rp * dt;
    s.queue = s.queue.filter(id => !S.has(s, id));
    while (s.queue.length && S.techAvailable(s, s.queue[0]) && s.rp >= PG.TECH[s.queue[0]].cost) {
      s.rp -= PG.TECH[s.queue[0]].cost;
      completeTech(s, s.queue[0]);
    }

    const combatStars = new Set();
    for (const e of s.enemies) if (!e.travel) combatStars.add(e.star);

    // Probes
    for (const p of s.probes.slice()) {
      if (p.travel) {
        p.travel.done += S.probeSpeed(s, p) * dt;
        if (p.travel.done >= p.travel.d) arriveProbe(s, p);
        continue;
      }
      const st = s.stars[p.star];
      const fighting = combatStars.has(p.star);
      if (!fighting) p.hp = Math.min(S.probeMaxHp(s, p), p.hp + B.repairRate * dt);
      if (p.task && !fighting) progressTask(s, p, st, dt);
      if (!p.task && st.surveyed && st.anomaly && !fighting) triggerAnomaly(s, st, p);
      if (!p.task && !p.travel && p.auto && !fighting) autoExplore(s, p);
    }

    // Terraforming & colonies
    for (const st of s.stars) {
      for (const pl of st.planets) {
        if (pl.struct && pl.struct.type === 'terraformer' && pl.hab < pl.max) {
          const was = pl.hab;
          pl.hab = Math.min(pl.max, pl.hab + S.terraRate(s, pl) * dt);
          if (was < 70 && pl.hab >= 70 && pl.type === 'earth') homecoming(s, pl);
          else if (was < 70 && pl.hab >= 70) {
            S.log(s, pl.name + ' crossed 70% habitability. Humans could live there now. Shirtsleeve environment, mostly.', 'good');
            S.toast(s, pl.name + ' is now habitable!', 'good');
          }
        }
        if (pl.colony) {
          const cap = S.popCap(s, pl);
          const g = B.colonyGrowth * (pl.hab / 100) * (S.has(s, 'biome') ? 1.5 : 1) * s.mods.growMul * (pl.colony.growMul || 1);
          pl.colony.pop += pl.colony.pop * g * dt * Math.max(-0.5, 1 - pl.colony.pop / cap);
        }
      }
    }

    // Defense platforms regen
    for (const st of s.stars) if (!combatStars.has(st.id)) for (const x of st.structs) if (x.type === 'defense') x.hp = Math.min(S.defMaxHp(s), x.hp + 30 * dt);

    // Shipyards
    const yards = s.stars[0].structs.filter(x => x.type === 'shipyard').length;
    for (let i = 0; i < Math.min(yards, s.shipQueue.length); i++) {
      const q = s.shipQueue[i];
      q.progress += dt / S.colonyShipTime(s);
      if (q.progress >= 1) {
        s.shipQueue.splice(i, 1); i--;
        launchShip(s, q.target);
      }
    }

    // Colony ships
    for (const sh of s.ships.slice()) {
      if (sh.travel) {
        sh.travel.done += S.shipSpeed(s) * dt;
        if (sh.travel.done >= sh.travel.d) { sh.star = sh.travel.to; sh.travel = null; }
      }
      if (!sh.travel && !combatStars.has(sh.star)) landShip(s, sh);
    }

    // Enemies
    spawnEnemies(s);
    for (const e of s.enemies.slice()) {
      if (e.travel) {
        e.travel.done += e.speed * dt;
        if (e.travel.done >= e.travel.d) { e.star = e.travel.to; e.travel = null; e.wait = PG.randRange(s, 0.2, 0.6); }
      }
    }
    resolveCombat(s, dt);
    for (const e of s.enemies) if (!e.travel && e.faction !== 'nest') enemyThink(s, e, dt);
    if (s.nestId >= 0) {
      const nest = s.enemies.find(e => e.faction === 'nest');
      if (nest) nest.hp = Math.min(nest.maxHp, nest.hp + 40 * dt);
    }

    updateVisibility(s);
    storyBeats(s);
    kethariProgress(s, dt);
    PG.events.tick(s);
    checkEnd(s);
    checkLegacy(s);
  }

  function progressTask(s, p, st, dt) {
    const t = p.task;
    t.progress += dt * (t.type === 'survey' ? 1 : S.buildSpeed(s, p));
    if (t.progress < t.total) return;
    p.task = null;
    if (t.type === 'survey') completeSurvey(s, st, p);
    else if (t.type === 'build') {
      const def = PG.STRUCTS[t.what];
      if (def.body) {
        const pl = st.planets[t.planet];
        pl.pending = false;
        pl.struct = { type: t.what };
        if (t.what === 'mine') S.log(s, p.name + ' finished an Autofactory on ' + pl.name + ' (+' + S.mineYield(s, pl).toFixed(0) + ' Matter/yr).', 'build');
        else if (pl.type === 'earth') {
          pl.max = 88;
          S.log(s, p.name + ' started restoring Earth. Step one: convince the Sink to eat something else. Target: ' + pl.max + '% habitability.', 'story');
        } else S.log(s, p.name + ' started terraforming ' + pl.name + '. Target: ' + pl.max + '% habitability.', 'build');
      } else {
        const x = { type: t.what };
        if (t.what === 'defense') x.hp = S.defMaxHp(s);
        st.structs.push(x);
        S.log(s, p.name + ' completed a ' + def.name + ' at ' + st.name + '.', 'build');
        if (t.what === 'dyson' && st.structs.filter(x => x.type === 'dyson').length === 5) {
          S.log(s, 'The Dyson Swarm around ' + st.name + ' is complete. From a distance, the star looks like it\'s wearing lace.', 'story');
          S.toast(s, 'Dyson Swarm complete at ' + st.name + '!', 'good');
        }
        if (t.what === 'shipyard' && !s.flags.yardMsg) {
          s.flags.yardMsg = true;
          S.log(s, 'The shipyard is up. Earth\'s governments are already fighting over boarding priority. Humans gonna human.', 'story');
        }
      }
    } else if (t.type === 'replicate') {
      const trait = PG.pick(s, PG.TRAIT_IDS);
      const name = S.nextCloneName(s);
      const c = S.makeProbe(s, name, p.gen + 1, trait, st.id, p.name);
      s.stats.clones++;
      S.log(s, fill(PG.pick(s, PG.CLONE_GREETINGS), name) + ' [Gen ' + c.gen + ' ' + PG.TRAITS[trait].name + ']', 'clone');
      S.toast(s, 'New replicant: ' + name + ' (' + PG.TRAITS[trait].name + ')', 'clone');
    }
  }

  function arriveProbe(s, p) {
    const st = s.stars[p.travel.to];
    p.star = st.id;
    p.travel = null;
    if (!st.visited) { st.visited = true; }
    if (!st.surveyed) p.task = { type: 'survey', progress: 0, total: S.surveyTime(s) };
    else if (st.race && !s.races[st.race].discovered) discoverRace(s, st.race, st, p);
  }

  function autoExplore(s, p) {
    const here = s.stars[p.star];
    const claimed = new Set(s.probes.filter(o => o.travel).map(o => o.travel.to));
    const danger = new Set(s.enemies.filter(e => e.vis && !e.travel).map(e => e.star));
    let best = null, bd = Infinity;
    for (const st of s.stars) {
      if (st.surveyed || claimed.has(st.id) || danger.has(st.id)) continue;
      if (st.nest && s.flags.nestKnown) continue;
      const d = PG.dist(here, st) + st.d * 0.15;
      if (d < bd) { bd = d; best = st; }
    }
    if (best) S.orderMove(s, p, best.id);
    else { p.auto = false; S.log(s, p.name + ': nothing left to explore in range. Going idle.', 'info'); }
  }

  S.setAuto = function (s, p, on) {
    p.auto = on;
    if (on && S.idle(p) && s.stars[p.star].surveyed) autoExplore(s, p);
  };

  function launchShip(s, target) {
    const pl = s.stars[target.star].planets[target.planet];
    const sh = { id: s.nextId++, hp: B.shipHp, star: null, pop: S.colonyCap(s), target };
    const sol = s.stars[0], to = s.stars[target.star];
    sh.travel = { x0: sol.x, y0: sol.y, to: target.star, d: PG.dist(sol, to), done: 0 };
    s.ships.push(sh);
    s.stats.shipsLaunched++;
    S.log(s, 'Colony ship launched for ' + pl.name + ' with ' + fmtPop(sh.pop) + ' colonists in cold storage.', 'colony');
  }

  function landShip(s, sh) {
    const st = s.stars[sh.star];
    let pl = st.planets[sh.target.planet];
    if (!S.colonizable(s, pl) && !pl.colony) {
      // Find a fallback destination.
      const opts = S.colonyTargets(s);
      if (!opts.length) return;
      opts.sort((a, b) => PG.dist(st, s.stars[a.star]) - PG.dist(st, s.stars[b.star]));
      sh.target = opts[0];
      const to = s.stars[opts[0].star];
      if (to.id !== st.id) { sh.travel = { x0: st.x, y0: st.y, to: to.id, d: PG.dist(st, to), done: 0 }; sh.star = null; return; }
      pl = to.planets[opts[0].planet];
    }
    const first = !pl.colony;
    if (first) pl.colony = { pop: 0, founded: s.t };
    pl.colony.pop += sh.pop;
    s.stats.relocated += sh.pop;
    s.ships = s.ships.filter(x => x !== sh);
    if (first) {
      S.log(s, 'Colony founded on ' + pl.name + '! ' + fmtPop(sh.pop) + ' humans are waking up under an alien sky.', 'colony');
      S.toast(s, 'Colony founded on ' + pl.name, 'good');
      if (!s.flags.firstColony) { s.flags.firstColony = true; S.log(s, 'First extrasolar human colony. I may have gotten something in my virtual eye.', 'story'); }
    } else S.log(s, fmtPop(sh.pop) + ' more colonists arrived at ' + pl.name + '.', 'colony');
  }

  function fmtPop(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k';
    return Math.round(n) + '';
  }
  S.fmtPop = fmtPop;

  // ------------------------------------------------------------ enemies
  const OTHERS_NAMES = ['Harvester', 'Thresher', 'Strip-Miner', 'Reclaimer', 'Hive-Ship', 'Scourer'];
  const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];

  function spawnEnemies(s) {
    // The Hive exists from the start.
    if (!s.flags.nestSpawned) {
      s.flags.nestSpawned = true;
      s.enemies.push({ id: s.nextId++, faction: 'nest', name: 'Gleaner Hive', hp: 2400, maxHp: 2400, atk: 26, star: s.nestId, travel: null, wait: 0, speed: 0 });
    }
    const nestAlive = s.enemies.some(e => e.faction === 'nest');
    if (nestAlive && s.t >= s.othersNext) {
      const k = s.t - 20;
      const hp = 140 + 8 * k, atk = 6 + 0.26 * k;
      s.enemies.push({ id: s.nextId++, faction: 'others', name: 'Gleaner ' + PG.pick(s, OTHERS_NAMES), hp, maxHp: hp, atk, star: s.nestId, travel: null, wait: 0.5, speed: 2.2 });
      s.othersNext += Math.max(1.6, 4 - k / 25) * PG.randRange(s, 0.8, 1.2);
    }
    if (s.hegSpawned < 3 && s.t >= s.hegNext && s.probes.length >= 2) {
      const opts = s.stars.filter(st => st.d > 7 && st.d < 13 && !st.race);
      const st = PG.pick(s, opts);
      s.enemies.push({ id: s.nextId++, faction: 'hegemony', name: 'Hegemony Probe ' + GREEK[s.hegSpawned], hp: 90, maxHp: 90, atk: 5, star: st.id, travel: null, wait: 1, speed: 1.0 });
      s.hegSpawned++;
      s.hegNext += PG.randRange(s, 6, 10);
    }
  }

  function playerValue(s, st) {
    let v = st.structs.length;
    for (const pl of st.planets) { if (pl.struct) v++; if (pl.colony) v += 3; }
    return v;
  }

  function enemyThink(s, e, dt) {
    const st = s.stars[e.star];
    const hostiles = s.probes.some(p => p.star === st.id && !p.travel) || st.structs.some(x => x.type === 'defense') || s.ships.some(sh => sh.star === st.id && !sh.travel);
    if (hostiles) return; // combat handles it
    // Harvest
    if (e.faction === 'others' && (playerValue(s, st) > 0 || S.starHasNatives(s, st))) {
      e.harvest = (e.harvest || 0) + dt;
      if (e.harvest >= 0.5) { e.harvest = 0; othersHarvest(s, st, e); }
      return;
    }
    if (e.faction === 'hegemony' && playerValue(s, st) - colonyCount(st) * 3 > 0) {
      e.harvest = (e.harvest || 0) + dt;
      if (e.harvest >= 0.8) { e.harvest = 0; destroyOneStruct(s, st, e); }
      return;
    }
    if (e.faction === 'others' && !st.ravaged && st.id !== s.nestId && playerValue(s, st) === 0) {
      st.ravaged = true;
    }
    e.wait -= dt;
    if (e.wait > 0) return;
    const target = e.faction === 'others' ? othersTarget(s, e, st) : hegemonyTarget(s, e, st);
    if (target) {
      e.travel = { x0: st.x, y0: st.y, to: target.id, d: PG.dist(st, target), done: 0 };
      e.lastStar = st.id;
    } else e.wait = 1;
  }

  const colonyCount = st => st.planets.filter(p => p.colony).length;

  function destroyOneStruct(s, st, e) {
    if (st.structs.length) {
      const x = st.structs.splice(PG.randInt(s, 0, st.structs.length - 1), 1)[0];
      S.log(s, e.name + ' destroyed our ' + PG.STRUCTS[x.type].name + ' at ' + st.name + '.', 'danger');
      return true;
    }
    const pl = st.planets.find(p => p.struct);
    if (pl) {
      S.log(s, e.name + ' destroyed our ' + PG.STRUCTS[pl.struct.type].name + ' on ' + pl.name + '.', 'danger');
      pl.struct = null;
      return true;
    }
    return false;
  }

  function othersHarvest(s, st, e) {
    if (destroyOneStruct(s, st, e)) return;
    const col = st.planets.find(p => p.colony);
    if (col) {
      col.colony.pop *= 0.35;
      if (col.colony.pop < 20000) {
        col.colony = null;
        S.log(s, 'The colony on ' + col.name + ' is gone. The Gleaners took everything. Everyone.', 'danger');
        S.toast(s, 'Colony on ' + col.name + ' destroyed!', 'danger');
        s.stats.coloniesLost = (s.stats.coloniesLost || 0) + 1;
      } else S.log(s, 'The Gleaners are attacking the colony on ' + col.name + '. Population down to ' + fmtPop(col.colony.pop) + '.', 'danger');
      return;
    }
    const nat = st.planets.find(p => S.nativesAlive(s, p));
    if (nat) {
      nat.nativeHarm = (nat.nativeHarm || 0) + 1;
      if (nat.nativeHarm >= 3) {
        const r = s.races[nat.natives];
        r.extinct = true;
        nat.type = 'barren'; nat.hab = 0; nat.max = 0;
        if (!r.discovered) { S.log(s, 'Sensors caught strange emissions from ' + st.name + ': something big disassembling a planet. Whatever lived there, it\'s gone.', 'danger'); return; }
        S.log(s, 'The ' + PG.RACES[nat.natives].name + ' are extinct. The Gleaners stripped ' + nat.name + ' down to bedrock. I should have been there.', 'danger');
        S.event(s, { type: 'info', title: 'Extinction', body: 'The ' + PG.RACES[nat.natives].name + ' homeworld, ' + nat.name + ', has been harvested by the Gleaners.\n\nAn entire species, gone. Every story they ever told, every song.\n\nThis cannot keep happening.', choices: [{ label: 'Never again.', key: 'ok' }] });
      } else if (s.races[nat.natives].discovered) S.log(s, 'The Gleaners are harvesting ' + nat.name + '. The ' + PG.RACES[nat.natives].name + ' are dying.', 'danger');
    }
  }

  function othersTarget(s, e, here) {
    let best = null, bs = -Infinity;
    const heading = {};
    for (const o of s.enemies) if (o !== e && o.travel) heading[o.travel.to] = (heading[o.travel.to] || 0) + 1;
    for (const st of s.stars) {
      if (st.id === here.id || st.id === s.nestId) continue;
      if (st.race === 'vellani') continue; // they defend themselves just fine
      const d = PG.dist(here, st);
      const v = playerValue(s, st) + (S.starHasNatives(s, st) ? 4 : 0);
      if (d > (v > 0 ? 22 : 14)) continue;
      // Valuable targets attract from afar; otherwise the swarm creeps steadily toward Sol.
      let score;
      if (v > 0) score = 30 + Math.min(v, 12) * 3 - d * 1.2;
      else score = -d * 0.5 - st.d * 1.5 + PG.rand(s) * 6 - (st.ravaged ? 12 : 0);
      if (st.id === e.lastStar) score -= 30;
      score -= (heading[st.id] || 0) * 10;
      if (score > bs) { bs = score; best = st; }
    }
    return best;
  }

  function hegemonyTarget(s, e, here) {
    const opts = s.stars.filter(st => st.id !== here.id && st.d < 16 && st.id !== 0 && PG.dist(st, here) < 12 && !st.race);
    if (!opts.length) return null;
    const juicy = opts.filter(st => playerValue(s, st) > 0 || s.probes.some(p => p.star === st.id));
    e.wait = PG.randRange(s, 1, 2.5);
    return PG.pick(s, juicy.length && PG.rand(s) < 0.7 ? juicy : opts);
  }

  // ------------------------------------------------------------- combat
  function resolveCombat(s, dt) {
    const byStar = {};
    for (const e of s.enemies) if (!e.travel) (byStar[e.star] = byStar[e.star] || []).push(e);
    for (const sid in byStar) {
      const st = s.stars[sid];
      const enemies = byStar[sid];
      const probes = s.probes.filter(p => p.star === st.id && !p.travel);
      const defs = st.structs.filter(x => x.type === 'defense');
      const ships = s.ships.filter(sh => sh.star === st.id && !sh.travel);
      if (!probes.length && !defs.length && !ships.length) { st.combat = false; continue; }
      st.combat = true;
      st.lastCombat = s.t;
      let patk = 0;
      for (const p of probes) patk += S.probeAtk(s, p);
      for (const d of defs) patk += S.defAtk(s);
      let eatk = 0;
      for (const e of enemies) eatk += e.atk;

      // Player fire: focus weakest enemy.
      let dmg = patk * PG.DMG_SCALE * dt;
      enemies.sort((a, b) => a.hp - b.hp);
      for (const e of enemies) {
        if (dmg <= 0) break;
        const take = Math.min(e.hp, dmg);
        e.hp -= take; dmg -= take;
        if (e.hp <= 0) killEnemy(s, e, st);
      }
      // Enemy fire: platforms soak first, then the healthiest probe, then ships.
      dmg = eatk * PG.DMG_SCALE * dt;
      const targets = [...defs, ...probes.sort((a, b) => b.hp - a.hp), ...ships];
      for (const u of targets) {
        if (dmg <= 0) break;
        const take = Math.min(u.hp, dmg);
        u.hp -= take; dmg -= take;
        if (u.hp <= 0) {
          if (defs.includes(u)) { st.structs.splice(st.structs.indexOf(u), 1); S.log(s, 'Defense Platform destroyed at ' + st.name + '.', 'danger'); }
          else if (probes.includes(u)) killProbe(s, u, st);
          else { s.ships = s.ships.filter(x => x !== u); S.log(s, 'A colony ship was destroyed at ' + st.name + '. ' + fmtPop(u.pop) + ' people. I\'m going to be sick, if I still could.', 'danger'); S.toast(s, 'Colony ship destroyed!', 'danger'); }
        }
      }
      if (!s.flags['fight' + sid] || s.t - s.flags['fight' + sid] > 3) {
        s.flags['fight' + sid] = s.t;
        S.log(s, 'Combat at ' + st.name + '! ' + enemies.map(e => e.name).join(', ') + ' engaging.', 'danger');
        if (probes.length) { s.pauseRequest = 'Combat at ' + st.name + '!'; }
      }
    }
    for (const st of s.stars) if (st.combat && !byStar[st.id]) st.combat = false;
  }

  function killEnemy(s, e, st) {
    s.enemies = s.enemies.filter(x => x !== e);
    s.stats.killed++;
    if (e.faction === 'nest') {
      S.log(s, 'THE HIVE IS DESTROYED. ' + st.name + ' is quiet for the first time in a million years.', 'good');
      s.flags.nestDead = true;
      S.event(s, { type: 'info', title: 'The Hive Falls', body: 'The Gleaner Hive at ' + st.name + ' has been destroyed. No more harvester fleets will launch.\n\nThe remaining fleets are still out there, but the bleeding has stopped. Somewhere, a Thrynn is going to sleep well tonight.', choices: [{ label: 'Hell yeah.', key: 'ok' }] });
    } else S.log(s, e.name + ' destroyed at ' + st.name + '.', 'good');
  }

  function killProbe(s, p, st) {
    s.probes = s.probes.filter(x => x !== p);
    s.stats.lost++;
    S.log(s, fill(PG.pick(s, PG.DEATH_LINES), p.name) + ' (at ' + st.name + ')', 'danger');
    S.toast(s, p.name + ' was destroyed at ' + st.name, 'danger');
  }

  // --------------------------------------------------------- visibility
  S.sensorSources = function (s) {
    const src = [];
    for (const p of s.probes) src.push(S.pos(s, p));
    for (const st of s.stars) if (st.structs.length || st.planets.some(pl => pl.struct || pl.colony)) src.push({ x: st.x, y: st.y });
    return src;
  };

  function updateVisibility(s) {
    const src = S.sensorSources(s);
    const r2 = S.sensorRange(s) ** 2;
    for (const e of s.enemies) {
      const p = S.pos(s, e);
      e.vis = src.some(o => (o.x - p.x) ** 2 + (o.y - p.y) ** 2 <= r2) || (e.faction === 'nest' && s.flags.nestKnown);
      if (e.vis && !e.seen) {
        e.seen = true;
        if (e.faction === 'others' && !s.flags.othersSeen) {
          s.flags.othersSeen = true;
          S.log(s, 'Unknown contact on long-range sensors. Big. Fast. Heading for inhabited systems. I don\'t like this at all.', 'danger');
          S.event(s, { type: 'info', title: 'The Gleaners', body: 'Sensors picked up a massive vessel moving between systems. It doesn\'t answer hails. Spectroscopy of the last system it visited shows... nothing. Planets reduced to rubble and refined away.\n\nWhatever they are, they eat worlds. And they\'re coming this way.\n\nBuild Defense Platforms, research weapons (Kinetic Interceptors!), and keep colonies protected.', choices: [{ label: 'Arm up.', key: 'ok' }] });
        } else if (e.faction === 'hegemony' && !s.flags.hegSeen) {
          s.flags.hegSeen = true;
          S.log(s, 'Detected a Hegemony probe nearby. Their replicants are programmed to see me as a target. Keep my distance until I have weapons.', 'danger');
          S.toast(s, 'Hostile Hegemony probe detected!', 'danger');
        } else if (e.faction === 'nest' && !s.flags.nestSeen) {
          s.flags.nestSeen = true; s.flags.nestKnown = true;
          S.log(s, 'Found the Gleaner Hive: a hive-world at ' + s.stars[e.star].name + ' wrapped in orbital factories. Killing it would stop the fleets. It will take a real armada.', 'danger');
        }
      }
    }
  }

  // ------------------------------------------------------- story & end
  function storyBeats(s) {
    while (s.newsIdx < PG.EARTH_NEWS.length && s.t >= PG.EARTH_NEWS[s.newsIdx][0]) {
      S.log(s, PG.EARTH_NEWS[s.newsIdx][1], 'earth');
      s.newsIdx++;
    }
    if (s.t >= s.nextMoot) {
      if (s.probes.length >= 3) {
        s.nextMoot += 10;
        const pool = PG.MOOT_BOONS.slice();
        const picks = [];
        while (picks.length < 3) picks.push(pool.splice(Math.floor(PG.rand(s) * pool.length), 1)[0]);
        S.event(s, {
          type: 'moot', title: 'Convergence ' + Math.round(S.year(s)),
          body: 'Every ten years we sync up. ' + s.probes.length + ' of us crammed into one shared simulation. After the usual arguments about who drifted furthest from the original, we agreed on one big initiative:',
          choices: picks.map(b => ({ label: b.name, desc: b.desc, key: 'moot:' + b.id })),
        });
      } else s.nextMoot += 2;
    }
    if (s.over === 'won' && s.t >= PG.DEADLINE && !s.flags.earthDeadline) {
      s.flags.earthDeadline = true;
      if (s.flags.homecoming) S.log(s, 'The year Earth was supposed to die came and went. The oceans are blue. Nobody even noticed the date.', 'earth');
      else S.log(s, 'News from Earth: the Sink has finished its work. Earth\'s biosphere has collapsed. Everyone who could leave, left. Fixing that is going on my to-do list.', 'earth');
    }
  }

  function homecoming(s, pl) {
    pl.type = 'terran';
    s.flags.homecoming = true;
    S.log(s, 'Earth crossed 70% habitability. There are birds over the Atlantic again.', 'story');
    S.event(s, { type: 'info', title: 'Homecoming', body: 'Earth is breathing again. The Sink is dormant, the oceans are clearing, and the first colony ships are asking for permission to land at home.\n\nWe left because we had to. Now we get to come back because we want to.', choices: [{ label: 'Welcome home.', key: 'ok' }] });
  }

  function kethariProgress(s, dt) {
    const k = s.races.kethari;
    if (!k.discovered || k.extinct || (k.progress || 0) >= 100) return;
    const before = k.progress || 0;
    k.progress = Math.min(100, before + dt * 1.6 * (k.choice === 'uplift' ? 1.5 : 1));
    for (const [at, text] of PG.KETHARI_ERAS) if (before < at && k.progress >= at) S.log(s, text, 'race');
    if (k.progress >= 100) {
      S.event(s, {
        type: 'contact', title: 'The Kethari Reach Orbit',
        body: 'Two centuries of history in a single lifetime of mine, and the Kethari have made it to space on their own terms. They know we\'re here. They have known for a while, it turns out, and they would like to talk.\n\nThey are polite, curious, and very aware of what the Gleaners would do to them.',
        choices: [
          { label: 'Open formal contact', desc: 'Kethari scholars join our network. Permanent research +15%.', key: 'kethorbit:council' },
          { label: 'Share our defenses', desc: 'Four Defense Platforms now guard the Kethari homeworld.', key: 'kethorbit:arm' },
        ],
      });
    }
  }

  // Long-term goals. Shown after the Exodus; reaching them all ends in a final summary.
  S.legacy = function (s) {
    const k = s.races.kethari;
    const dyson = Math.max(0, ...s.stars.map(st => st.structs.filter(x => x.type === 'dyson').length));
    const met = ['kethari', 'vellani', 'thrynn'].filter(id => s.races[id].discovered).length;
    return [
      { id: 'hive', label: 'Destroy the Gleaner Hive', done: !!s.flags.nestDead },
      { id: 'relics', label: 'Decode the Precursor Archive (' + (s.relics || 0) + '/5)', done: (s.relics || 0) >= 5 },
      { id: 'kethari', label: k.discovered ? 'See the Kethari reach orbit (' + Math.floor(k.progress || 0) + '%)' : 'Help a native species reach orbit',
        done: (k.progress || 0) >= 100, failed: k.extinct },
      { id: 'dyson', label: 'Complete a Dyson Swarm (' + dyson + '/5)', done: dyson >= 5 },
      { id: 'earth', label: 'Restore Earth', done: !!s.flags.homecoming },
      { id: 'pop', label: 'Grow humanity off-world to ' + fmtPop(PG.LEGACY_POP), done: s.stats.peakPop >= PG.LEGACY_POP },
      { id: 'species', label: 'Meet all three alien species (' + met + '/3)', done: met === 3 },
    ];
  };

  function checkLegacy(s) {
    if (s.over !== 'won' || s.flags.legacyDone) return;
    const goals = S.legacy(s);
    if (!goals.every(g => g.done || g.failed)) return;
    s.flags.legacyDone = true;
    const done = goals.filter(g => g.done).length;
    S.log(s, 'Every long-term goal is settled. Not bad for a brain scan in a box.', 'story');
    S.event(s, { type: 'end', won: true, title: 'A Legacy Among the Stars', body: 'Year ' + Math.floor(S.year(s)) + '. ' + done + ' of ' + goals.length + ' legacy goals achieved.\n\n' + summary(s, true), choices: [{ label: 'Keep playing', key: 'end:continue' }, { label: 'New game', key: 'end:new' }] });
  }

  // Bring saves from older versions up to date.
  S.migrate = function (s) {
    for (const [from, to] of Object.entries(PG.TECH_RENAMES)) {
      if (s.researched[from]) { delete s.researched[from]; s.researched[to] = true; }
    }
    s.queue = s.queue.map(id => PG.TECH_RENAMES[id] || id).filter(id => PG.TECH[id]);
    if (s.mods.growMul == null) s.mods.growMul = 1;
    if (s.nextRandom == null) s.nextRandom = s.t + 3;
    s.timers = s.timers || [];
    s.eventLast = s.eventLast || {};
    if (!s.flags.relicsPlaced) PG.placeRelics(s);
    for (const e of s.enemies) e.name = e.name.replace(/^Others Nest$/, 'Gleaner Hive').replace(/^Others /, 'Gleaner ');
    return s;
  };

  function checkEnd(s) {
    const pop = S.colonialPop(s);
    s.stats.peakPop = Math.max(s.stats.peakPop, pop);
    if (s.over) return;
    if (pop >= PG.TARGET_POP) {
      s.over = 'won';
      S.log(s, 'Five million humans live among the stars. Whatever happens to Earth now, we survive.', 'story');
      S.event(s, { type: 'end', won: true, title: 'Exodus Complete', body: summary(s, true), choices: [{ label: 'Keep playing', key: 'end:continue' }, { label: 'New game', key: 'end:new' }] });
    } else if (s.t >= PG.DEADLINE) {
      s.over = 'lost';
      S.event(s, { type: 'end', won: false, title: 'Earth Falls Silent', body: summary(s, false), choices: [{ label: 'New game', key: 'end:new' }] });
    } else if (!s.probes.length) {
      s.over = 'lost';
      S.event(s, { type: 'end', won: false, title: 'Signal Lost', body: 'Every replicant has been destroyed. There is no one left to carry humanity out.\n\n' + summary(s, false), choices: [{ label: 'New game', key: 'end:new' }] });
    }
  }

  function summary(s, won) {
    const pop = S.colonialPop(s);
    const lines = [
      won ? 'Year ' + Math.floor(S.year(s)) + '. ' + fmtPop(pop) + ' humans now live on ' + s.stars.reduce((a, st) => a + colonyCount(st), 0) + ' worlds beyond Sol.'
          : 'Year ' + Math.floor(S.year(s)) + '. Earth\'s biosphere has collapsed. ' + fmtPop(pop) + ' humans made it out. It wasn\'t enough.',
      '',
      'Replicants created: ' + s.stats.clones + '   Lost: ' + s.stats.lost,
      'Systems surveyed: ' + s.stats.surveyed,
      'Colony ships launched: ' + s.stats.shipsLaunched,
      'Hostiles destroyed: ' + s.stats.killed + (s.flags.nestDead ? ' (including the Hive!)' : ''),
      'Species met: ' + Object.keys(s.races).filter(k => k !== 'others' && s.races[k].discovered).length + '/3' +
        '   Species lost: ' + Object.keys(s.races).filter(k => s.races[k].extinct).length,
    ];
    return lines.join('\n');
  }
})(typeof window !== 'undefined' ? window.PG : globalThis.PG);
