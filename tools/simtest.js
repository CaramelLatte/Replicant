// Headless balance test: runs a simple bot through full games.
// Usage: node tools/simtest.js [seeds=5] [verbose]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math, globalThis: null };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'galaxy.js', 'sim.js', 'events.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const PG = ctx.PG, S = PG.sim;

const ORDER = ['autofac2', 'colony', 'atmo', 'interceptors', 'sensors', 'drive2', 'fab', 'stasis', 'biome', 'relay', 'shields',
  'proxies', 'drive3', 'fusion', 'lance', 'arcology', 'antimatter'];

function bot(s) {
  if (!s.queue.length) { const next = ORDER.find(id => !S.has(s, id)); if (next) S.queueResearch(s, next); }
  while (s.events.length) {
    const ev = s.events[0];
    S.resolveEvent(s, ev.id, 0);
  }
  for (const p of s.probes) {
    if (!S.idle(p)) continue;
    const st = s.stars[p.star];
    if (!st.surveyed) { S.orderSurvey(s, p); continue; }
    if (st.id === 0 && S.has(s, 'colony') && !S.canBuild(s, p, 'shipyard')) { S.orderBuild(s, p, 'shipyard'); continue; }
    if (s.flags.othersSeen && st.planets.some(pl => pl.colony) && !S.canBuild(s, p, 'defense')) { S.orderBuild(s, p, 'defense'); continue; }
    const tf = st.planets.findIndex((pl, i) => pl.max >= 70 && pl.hab < 70 && !S.canBuild(s, p, 'terraformer', i));
    if (tf >= 0) { S.orderBuild(s, p, 'terraformer', tf); continue; }
    let bi = -1, br = 0;
    st.planets.forEach((pl, i) => { if (!S.canBuild(s, p, 'mine', i) && pl.rich > br && pl.max < 70) { br = pl.rich; bi = i; } });
    if (bi >= 0 && br >= 2) { S.orderBuild(s, p, 'mine', bi); continue; }
    if (st.structs.filter(x => x.type === 'lab').length < 1 && s.probes.length > 4 && !S.canBuild(s, p, 'lab')) { S.orderBuild(s, p, 'lab'); continue; }
    if (s.probes.length < 22 && !S.canReplicate(s, p)) { S.orderReplicate(s, p); continue; }
    if (p.id === s.probes[0].id) continue; // home probe stays put
    const claimed = new Set(s.probes.filter(o => o.travel).map(o => o.travel.to));
    let best = null, bd = Infinity;
    for (const o of s.stars) {
      if (o.surveyed || claimed.has(o.id) || (o.nest && s.flags.nestKnown)) continue;
      const d = PG.dist(st, o) + o.d * 0.15;
      if (d < bd) { bd = d; best = o; }
    }
    if (best) S.orderMove(s, p, best.id);
  }
  const targets = S.colonyTargets(s);
  if (targets.length && s.shipQueue.length < 2 && !S.canColonyShip(s) && s.matter > S.colonyShipCost(s) + 60) {
    const t = targets[Math.floor(Math.random() * Math.min(3, targets.length))];
    S.orderColonyShip(s, t.star, t.planet);
  }
}

const N = +(process.argv[2] || 5);
const verbose = process.argv[3] === 'v';
for (let seed = 1; seed <= N; seed++) {
  const s = PG.newGame(seed * 7919, 'Ada');
  let lastReport = 0;
  while (!s.over && s.t < PG.DEADLINE + 1) {
    bot(s);
    S.update(s, 0.1);
    if (verbose && s.t - lastReport >= 10) {
      lastReport = s.t;
      const inc = S.income(s);
      console.log(`  y${S.year(s).toFixed(0)} probes=${s.probes.length} matter=${s.matter.toFixed(0)} +${inc.matter.toFixed(0)}/yr rp+${inc.rp.toFixed(0)} techs=${Object.keys(s.researched).length} pop=${S.fmtPop(S.colonialPop(s))} enemies=${s.enemies.length} surveyed=${s.stats.surveyed} othersMinD=${Math.min(99,...s.enemies.filter(e=>e.faction==='others').map(e=>S.pos(s,e)).map(p=>Math.hypot(p.x,p.y))).toFixed(0)}`);
    }
  }
  console.log(`seed ${seed}: ${s.over} at ${S.year(s).toFixed(1)} pop=${S.fmtPop(S.colonialPop(s))} probes=${s.probes.length} lost=${s.stats.lost} ships=${s.stats.shipsLaunched} killed=${s.stats.killed} extinct=${Object.keys(s.races).filter(k => s.races[k].extinct)} colLost=${s.stats.coloniesLost || 0} structLost=${s.log.filter(l=>/destroyed our/.test(l.text)).length} techs=${Object.keys(s.researched).length}`);
}
