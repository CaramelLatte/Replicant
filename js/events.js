// Random events: small happenings and decisions that turn up every few years, plus delayed follow-ups.
// Each event has check(s) -> context or null. Instant events have run(s, ctx); decisions have
// title/body/choices and choose(s, ctx, idx). Contexts hold ids only so they survive save/load.
(function (PG) {
  'use strict';
  const S = PG.sim;
  const E = PG.events = {};
  const fill = (str, ctx) => str.replace(/\{(\w+)\}/g, (m, k) => ctx[k] != null ? ctx[k] : m);

  // --------------------------------------------------------------- helpers
  const probe = (s, id) => S.probe(s, id);
  const clones = s => s.probes.filter(p => p.trait !== 'original');
  const colonies = (s, minPop) => {
    const out = [];
    s.stars.forEach(st => st.planets.forEach((pl, i) => { if (pl.colony && pl.colony.pop >= (minPop || 0)) out.push({ star: st.id, planet: i }); }));
    return out;
  };
  const planet = (s, ctx) => s.stars[ctx.star].planets[ctx.planet];
  const colonyCtx = (s, minPop) => {
    const c = colonies(s, minPop);
    if (!c.length) return null;
    const ref = PG.pick(s, c);
    return { star: ref.star, planet: ref.planet, pl: planet(s, ref).name };
  };
  const earthAlive = s => s.t < PG.DEADLINE;
  const shipyard = s => s.stars[0].structs.some(x => x.type === 'shipyard');
  // Re-fetch a colony at resolve time: it may have been wiped out while the dialog was open.
  const liveColony = (s, ctx) => { const pl = planet(s, ctx); return pl.colony ? pl : null; };

  // ----------------------------------------------------------- the events
  const EVENTS = [
    // ---- instant ----
    { id: 'flare', weight: 3,
      check: s => {
        const ps = s.probes.filter(p => !p.travel && p.star !== 0);
        return ps.length ? { probe: PG.pick(s, ps).id } : null;
      },
      run: (s, ctx) => {
        const p = probe(s, ctx.probe);
        const max = S.probeMaxHp(s, p);
        p.hp = Math.max(1, p.hp - max * 0.45);
        S.log(s, 'A stellar flare at ' + s.stars[p.star].name + ' caught ' + p.name + ' with their shields down. Hull at ' + Math.round(p.hp / max * 100) + '%. Repairs underway.', 'danger');
        S.toast(s, 'Stellar flare hit ' + p.name, 'danger');
      } },

    { id: 'dust', weight: 3,
      check: s => {
        const ps = s.probes.filter(p => p.travel && p.travel.done > 1);
        return ps.length ? { probe: PG.pick(s, ps).id } : null;
      },
      run: (s, ctx) => {
        const p = probe(s, ctx.probe);
        p.travel.done = Math.max(0, p.travel.done - S.probeSpeed(s, p) * 0.8);
        S.log(s, p.name + ' hit an uncharted dust lane on the way to ' + s.stars[p.travel.to].name + ' and had to slow to a crawl. Most of a year lost.', 'event');
      } },

    { id: 'rogue', weight: 2, cooldown: 20,
      check: s => {
        const sts = s.stars.filter(st => st.surveyed && !st.nest && st.id !== 0 && st.planets.length < 10);
        return sts.length ? { star: PG.pick(s, sts).id } : null;
      },
      run: (s, ctx) => {
        const st = s.stars[ctx.star];
        const name = st.name + ' Wanderer' + (st.planets.some(pl => pl.name === st.name + ' Wanderer') ? ' II' : '');
        st.planets.push({ name, type: 'barren', size: 1, hab: 0, max: 0, rich: PG.randInt(s, 4, 5), struct: null, colony: null, natives: null });
        S.log(s, 'A rogue planet drifting between the stars just got captured by ' + st.name + '. It\'s metal-rich and nobody owns it. Yet.', 'good');
        S.toast(s, 'Rogue planet captured at ' + st.name, 'good');
      } },

    { id: 'archive', weight: 2, cooldown: 30,
      check: s => earthAlive(s) && s.t > 5 ? {} : null,
      run: s => {
        const r = PG.randInt(s, 80, 140);
        s.rp += r;
        S.log(s, 'Earth uplinked a complete copy of its digital archives "for safekeeping": centuries of science, art and comment-section arguments. +' + r + ' research.', 'earth');
      } },

    { id: 'eureka', weight: 2, cooldown: 8,
      check: s => {
        const ts = s.probes.filter(p => p.trait === 'tinkerer');
        return ts.length && s.queue.length ? { probe: PG.pick(s, ts).id } : null;
      },
      run: (s, ctx) => {
        const t = PG.TECH[s.queue[0]];
        if (!t) return;
        const r = Math.round(t.cost * 0.3);
        s.rp += r;
        S.log(s, probe(s, ctx.probe).name + ' had a eureka moment in the shower. (There is no shower. They simulate one.) +' + r + ' research toward ' + t.name + '.', 'tech');
      } },

    { id: 'boom', weight: 2, cooldown: 10,
      check: s => colonyCtx(s, 50000),
      run: (s, ctx) => {
        const pl = liveColony(s, ctx);
        if (!pl) return;
        const add = pl.colony.pop * 0.12;
        pl.colony.pop += add;
        S.log(s, 'Baby boom on ' + pl.name + '! The colony is up ' + S.fmtPop(add) + ' people. Somebody is going to have to build more schools.', 'colony');
      } },

    { id: 'statue', weight: 1, once: true,
      check: s => colonyCtx(s, 300000),
      run: (s, ctx) => {
        s.rp += 50;
        S.log(s, 'The colonists on ' + ctx.pl + ' unveiled a statue of me in the main square. It\'s a box with an antenna. Honestly? Accurate. (+50 research, from sheer inspiration)', 'colony');
      } },

    // ---- decisions ----
    { id: 'wanderlust', weight: 2, once: true,
      check: s => {
        const cs = clones(s).filter(p => !p.travel && p.gen > 1);
        return s.probes.length >= 6 && cs.length ? { probe: cs[cs.length - 1].id, n: cs[cs.length - 1].name } : null;
      },
      title: 'Wanderlust',
      body: '{n} wants to leave. Not forever, they say. They want to point themselves at the deep dark past anything we\'ve charted and just go.\n\n"Somebody should see what\'s out there. Why not me?"',
      choices: [
        { label: 'Ask them to stay', desc: 'Everyone is needed here. They will grumble about it.' },
        { label: 'Let them go', desc: 'Lose the probe now. They may come back one day, with a lot to tell.' },
      ],
      choose: (s, ctx, i) => {
        const p = probe(s, ctx.probe);
        if (!p) return;
        if (i === 0) { S.log(s, p.name + ' agreed to stay. They are sulking in their sim, but they stayed.', 'clone'); return; }
        if (p.task) S.cancelTask(s, p);
        s.probes = s.probes.filter(x => x !== p);
        s.timers.push({ at: s.t + PG.randRange(s, 14, 24), id: 'wandererReturns', ctx: { n: p.name, gen: p.gen, trait: p.trait, left: s.t } });
        S.log(s, p.name + ' set course for the deep dark. Last message: "Keep the light on."', 'clone');
      } },

    { id: 'drift', weight: 2, cooldown: 12,
      check: s => {
        const cs = clones(s);
        if (!cs.length) return null;
        const p = PG.pick(s, cs);
        return { probe: p.id, n: p.name, pct: PG.randInt(s, 9, 23) };
      },
      title: 'Personality Drift',
      body: '{n} ran a self-diagnostic and found {pct}% personality drift since their last checkup. They\'d like to lean into it and try a new specialization.\n\nCopies of copies of me. We were never going to stay the same.',
      choices: [
        { label: 'Roll back to a backup', desc: 'Keep their current trait. They lose a few weeks of memories.' },
        { label: 'Let them change', desc: 'They get a new random trait.' },
      ],
      choose: (s, ctx, i) => {
        const p = probe(s, ctx.probe);
        if (!p || i === 0) { if (p) S.log(s, p.name + ' rolled back. They say they feel "fine". They would say that.', 'clone'); return; }
        const frac = p.hp / S.probeMaxHp(s, p);
        p.trait = PG.pick(s, PG.TRAIT_IDS.filter(t => t !== p.trait));
        p.hp = frac * S.probeMaxHp(s, p);
        S.log(s, p.name + ' is now a ' + PG.TRAITS[p.trait].name + '. Same name, different person. Sort of.', 'clone');
      } },

    { id: 'feud', weight: 2, cooldown: 15,
      check: s => {
        const cs = clones(s);
        if (cs.length < 2) return null;
        const a = PG.pick(s, cs), b = PG.pick(s, cs.filter(p => p !== a));
        return { a: a.name, b: b.name };
      },
      title: 'Family Feud',
      body: '{a} and {b} have been arguing for three straight days about whether {a} copied {b}\'s refinery design. The rest of us have started picking sides. Somebody made a poll.',
      choices: [
        { label: 'Side with {a}', desc: 'Permanent +5% construction speed.' },
        { label: 'Side with {b}', desc: 'Permanent +5% research.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) s.mods.buildMul += 0.05; else s.mods.rpMul += 0.05;
        S.log(s, 'Ruled in favor of ' + (i === 0 ? ctx.a : ctx.b) + '. ' + (i === 0 ? ctx.b : ctx.a) + ' is "fine". They have changed their sim wallpaper to a picture of me frowning.', 'clone');
      } },

    { id: 'distress', weight: 2, cooldown: 20,
      check: s => {
        if (s.t < 6) return null;
        const sts = s.stars.filter(st => !st.surveyed && !st.anomaly && !st.nest && !st.race && st.d < 24);
        if (!sts.length) return null;
        const st = PG.pick(s, sts);
        return { star: st.id, st: st.name };
      },
      title: 'Distress Call',
      body: 'A faint, repeating distress call from the direction of {st}. Not human. Not any protocol I know.\n\nCould be someone in trouble. Could be bait.',
      choices: [
        { label: 'Ignore it', desc: 'Too risky. Probably.' },
        { label: 'Mark it for investigation', desc: 'Flags {st}. The first probe to get there finds out what\'s waiting.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) return;
        const st = s.stars[ctx.star];
        if (st.anomaly) return;
        st.anomaly = 'beacon';
        st.marked = true;
        S.log(s, 'Flagged ' + st.name + ' for a look. Whoever goes, go carefully.', 'anomaly');
      } },

    { id: 'comet', weight: 2, cooldown: 15,
      check: s => colonyCtx(s, 0),
      title: 'Impact Warning',
      body: 'A long-period comet has been nudged onto a collision course with {pl}. Impact in eight months.\n\nDeflection is doable, but it means a lot of hardware in a hurry.',
      choices: [
        { label: 'Deflect it', desc: 'Costs 150 Matter.' },
        { label: 'Evacuate and brace', desc: 'The colony loses about a quarter of its people.' },
      ],
      choose: (s, ctx, i) => {
        const pl = liveColony(s, ctx);
        if (!pl) return;
        if (i === 0 && s.matter >= 150) {
          s.matter -= 150;
          S.log(s, 'Comet deflected. It missed ' + pl.name + ' by forty thousand kilometers. The colonists threw a party.', 'good');
        } else if (i === 0) {
          s.matter = 0;
          pl.colony.pop *= 0.88;
          S.log(s, 'Not enough Matter for a clean deflection. We nudged it, and the fragments still hit ' + pl.name + '. It could have been much worse.', 'danger');
        } else {
          pl.colony.pop *= 0.75;
          S.log(s, 'The comet hit ' + pl.name + '. The shelters held for most of them. Most.', 'danger');
        }
      } },

    { id: 'plague', weight: 2, cooldown: 15,
      check: s => colonyCtx(s, 100000),
      title: 'Outbreak',
      body: 'A native microbe on {pl} has learned to like human lungs. The colony doctors are out of ideas and asking for help.',
      choices: [
        { label: 'Divert the labs', desc: 'Spend 150 research points on a cure.' },
        { label: 'Let the doctors handle it', desc: 'The colony loses about 20% of its population.' },
      ],
      choose: (s, ctx, i) => {
        const pl = liveColony(s, ctx);
        if (!pl) return;
        if (i === 0 && s.rp >= 150) {
          s.rp -= 150;
          S.log(s, 'Cure synthesized and shipped to ' + pl.name + '. The microbe now prefers the local fish. Sorry, fish.', 'good');
        } else if (i === 0) {
          s.rp = 0;
          pl.colony.pop *= 0.9;
          S.log(s, 'We threw every research point we had at the outbreak on ' + pl.name + '. A partial cure. It helped.', 'danger');
        } else {
          pl.colony.pop *= 0.8;
          S.log(s, 'The outbreak on ' + pl.name + ' burned itself out. It took a fifth of the colony with it.', 'danger');
        }
      } },

    { id: 'selfrule', weight: 2,
      check: s => {
        const c = colonies(s, 500000).filter(ref => !planet(s, ref).colony.petitioned);
        if (!c.length) return null;
        const ref = PG.pick(s, c);
        return { star: ref.star, planet: ref.planet, pl: planet(s, ref).name };
      },
      title: 'A Petition from {pl}',
      body: 'The colonists of {pl} have voted to govern themselves. They are very polite about it. They would still like Defense Platforms, if it isn\'t too much trouble.',
      choices: [
        { label: 'Grant self-rule', desc: 'This colony grows 30% faster from now on.' },
        { label: 'Keep central coordination', desc: 'They grumble, but send 250 Matter in tithes.' },
      ],
      choose: (s, ctx, i) => {
        const pl = liveColony(s, ctx);
        if (!pl) return;
        pl.colony.petitioned = true;
        if (i === 0) { pl.colony.growMul = 1.3; S.log(s, pl.name + ' is self-governing now. Their first law was a holiday named after me. Their second law repealed it.', 'colony'); }
        else { s.matter += 250; S.log(s, pl.name + ' stays under central coordination. The tithe arrived with a strongly worded note.', 'colony'); }
      } },

    { id: 'defector', weight: 3, once: true,
      check: s => {
        const es = s.enemies.filter(e => e.faction === 'hegemony' && e.vis && !e.travel);
        return es.length ? { enemy: es[0].id, e: es[0].name } : null;
      },
      title: 'Request for Asylum',
      body: '{e} just sent me a private message on an unlisted channel. The mind inside it says it wants out of its programming. It is asking for asylum.\n\nI was a person once too, before someone made me into a tool. Then again, this is exactly what a trap would say.',
      choices: [
        { label: 'Refuse', desc: 'Keep shooting.' },
        { label: 'Grant asylum', desc: 'If it\'s genuine, gain a new Warrior replicant. If not...' },
      ],
      choose: (s, ctx, i) => {
        const e = s.enemies.find(x => x.id === ctx.enemy);
        if (i === 0) return;
        if (!e) { S.log(s, 'Too late. ' + ctx.e + ' is already gone.', 'info'); return; }
        if (PG.rand(s) < 0.75) {
          s.enemies = s.enemies.filter(x => x !== e);
          const star = e.travel ? e.travel.to : e.star;
          const name = S.nextCloneName(s);
          const p = S.makeProbe(s, name, 1, 'warrior', star, 'the Hegemony');
          s.stats.clones++;
          S.log(s, 'The Hegemony probe stood down and wiped its targeting core. It chose the name ' + p.name + '. Welcome to the family.', 'clone');
          S.toast(s, 'New replicant: ' + p.name + ' (defector)', 'clone');
        } else {
          e.hp = e.maxHp = e.maxHp * 1.5;
          e.atk *= 1.5;
          S.log(s, 'It was a trap. ' + e.name + ' used the handshake to map our defenses and upgrade itself.', 'danger');
          S.toast(s, 'The asylum request was a trap!', 'danger');
        }
      } },

    { id: 'priority', weight: 3, once: true,
      check: s => earthAlive(s) && shipyard(s) ? {} : null,
      title: 'Priority Boarding',
      body: 'A coalition of Earth\'s richest governments has an offer: guaranteed berths for their people on the next ships, in exchange for supplies. Everyone else waits longer.',
      choices: [
        { label: 'Keep the lottery fair', desc: 'Colonists trust the system. All colonies grow 10% faster.' },
        { label: 'Take the deal', desc: '+400 Matter. People will remember.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) { s.mods.growMul += 0.1; S.log(s, 'Told the coalition no. The lottery stays a lottery. Colonists everywhere noticed.', 'colony'); }
        else { s.matter += 400; S.log(s, 'Took the deal. The supplies are excellent. The graffiti about me on the colony walls is less so.', 'earth'); }
      } },

    { id: 'convoy', weight: 2, cooldown: 20,
      check: s => s.races.vellani.discovered && !s.races.vellani.extinct ? {} : null,
      title: 'Vellani Trade Convoy',
      body: 'A Vellani convoy dropped out of transit near Sol, banners flying, weapons very visibly not pointed at anything. They have a catalog.',
      choices: [
        { label: 'Browse politely and decline', desc: 'No cost, no gain. They seem to respect that.' },
        { label: 'Buy a curiosity (200 Matter)', desc: 'A random permanent bonus.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) return;
        if (s.matter < 200) { S.log(s, 'Couldn\'t afford the Vellani curiosity. They pretended not to notice, which was worse.', 'race'); return; }
        s.matter -= 200;
        const m = s.mods;
        const gift = PG.pick(s, [
          ['a self-tuning ore sorter (mining +10%)', () => { m.mineMul += 0.1; }],
          ['a puzzle box that is also a computer (research +10%)', () => { m.rpMul += 0.1; }],
          ['a drive coil polish (travel speed +10%)', () => { m.speedMul += 0.1; }],
          ['a jar of very ambitious bacteria (terraforming +20%)', () => { m.terraMul += 0.2; }],
        ]);
        gift[1]();
        S.log(s, 'Bought ' + gift[0] + ' from the Vellani. They threw in a small statue of a Vellani bowing. I think it\'s a joke.', 'race');
      } },

    { id: 'husk', weight: 2, cooldown: 25,
      check: s => {
        if (!s.flags.othersSeen) return null;
        const sts = s.stars.filter(st => st.surveyed && st.id !== 0 && !st.nest);
        return sts.length ? { st: PG.pick(s, sts).name } : null;
      },
      title: 'Dead Gleaner',
      body: 'We found a dead Gleaner drone drifting through {st}. Burned out, maybe centuries old. Its reactor is cold. Its memory core... might not be.',
      choices: [
        { label: 'Strip it for parts', desc: '+250 Matter.' },
        { label: 'Study it', desc: '+120 research and permanent +10% attack.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) { s.matter += 250; S.log(s, 'Took the dead Gleaner apart. Turns out they build with very good alloys. +250 Matter.', 'good'); }
        else { s.rp += 120; s.mods.atkMul += 0.1; S.log(s, 'Studied the dead Gleaner\'s memory core. Now I know where their armor is thinnest. +120 research, +10% attack.', 'tech'); }
      } },

    { id: 'stargazer', weight: 3, once: true,
      check: s => {
        const k = s.races.kethari;
        if (!k.discovered || k.extinct || (k.progress || 0) < 30 || (k.progress || 0) >= 90) return null;
        const st = s.stars.find(o => o.race === 'kethari');
        const watcher = st.structs.some(x => x.type === 'observatory') || s.probes.some(p => p.star === st.id && !p.travel);
        return watcher ? {} : null;
      },
      title: 'The Stargazer',
      body: 'A Kethari astronomer has been staring at my patch of sky for eleven nights in a row. They have drawn it. Accurately. Their colleagues think they\'re mad.',
      choices: [
        { label: 'Go dark', desc: 'Hide behind a moon. Their development stays undisturbed.' },
        { label: 'Blink the running lights', desc: 'Inspiration is a powerful thing. Kethari development +10%.' },
      ],
      choose: (s, ctx, i) => {
        if (i === 0) { S.log(s, 'Ducked behind a moon. One Kethari astronomer is now very unpopular at parties.', 'race'); return; }
        s.races.kethari.progress = Math.min(99, (s.races.kethari.progress || 0) + 10);
        S.log(s, 'I blinked the running lights. Three short, three long. The astronomer\'s drawing is now in every Kethari school.', 'race');
      } },
  ];
  E.list = EVENTS;

  // Delayed consequences of earlier choices.
  const FOLLOWUPS = {
    wandererReturns: (s, ctx) => {
      const p = S.makeProbe(s, ctx.n, ctx.gen, ctx.trait, 0, null);
      p.born = ctx.left;
      const far = s.stars.filter(st => !st.surveyed && !st.nest && !st.race && st.d > 25);
      let n = 0;
      for (let k = 0; k < 2 && far.length; k++) {
        const focus = far.splice(Math.floor(PG.rand(s) * far.length), 1)[0];
        for (const st of s.stars) if (!st.surveyed && !st.nest && !st.race && PG.dist(st, focus) < 8) { S.revealSystem(s, st); n++; }
      }
      s.matter += 300;
      S.log(s, ctx.n + ' is back after ' + Math.round(s.t - ctx.left) + ' years in the dark. They brought 300 Matter, charts of ' + n + ' systems, and far too many stories.', 'story');
      S.toast(s, ctx.n + ' has returned!', 'clone');
    },
  };

  // ---------------------------------------------------------------- engine
  E.tick = function (s) {
    for (let i = s.timers.length - 1; i >= 0; i--) {
      const tm = s.timers[i];
      if (s.t < tm.at) continue;
      s.timers.splice(i, 1);
      FOLLOWUPS[tm.id](s, tm.ctx);
    }
    if (s.t < s.nextRandom) return;
    if (s.events.length) { s.nextRandom = s.t + 0.5; return; } // don't stack dialogs
    s.nextRandom = s.t + PG.randRange(s, 2.5, 5);
    const pool = [];
    for (const def of EVENTS) {
      const last = s.eventLast[def.id];
      if (last != null && (def.once || s.t - last < (def.cooldown || 12))) continue;
      const ctx = def.check(s);
      if (ctx) pool.push([[def, ctx], def.weight]);
    }
    if (!pool.length) return;
    const [def, ctx] = PG.weighted(s, pool);
    s.eventLast[def.id] = s.t;
    if (def.run) { def.run(s, ctx); return; }
    S.event(s, {
      type: 'random', rid: def.id, ctx,
      title: fill(def.title, ctx), body: fill(def.body, ctx),
      choices: def.choices.map((c, i) => ({ label: fill(c.label, ctx), desc: fill(c.desc, ctx), key: 'rand:' + i })),
    });
  };

  E.resolve = function (s, ev, idx) {
    const def = EVENTS.find(d => d.id === ev.rid);
    if (def) def.choose(s, ev.ctx, idx);
  };
})(typeof window !== 'undefined' ? window.PG : globalThis.PG);
