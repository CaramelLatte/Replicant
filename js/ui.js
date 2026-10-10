// DOM user interface: top bar, roster, context panel, log, toasts and modals.
(function (PG) {
  'use strict';
  const S = PG.sim;
  const U = PG.ui = { sel: null, moveMode: false, hoverStar: null, cache: {}, modal: null, prevSpeed: 2 };
  const PREFS_KEY = 'replicant-prefs';
  U.prefs = { pauseIdle: false, pauseResearch: false };
  try { Object.assign(U.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* storage unavailable */ }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(U.prefs)); } catch (e) { /* storage unavailable */ } };
  const $ = id => document.getElementById(id);
  const esc = str => String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Math.floor(n).toLocaleString('en-US');
  const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1);
  const yr = t => (PG.START_YEAR + t).toFixed(1);
  const bar = (frac, cls) => `<div class="bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%"></i></div>`;

  function set(id, html) {
    if (U.cache[id] === html) return;
    U.cache[id] = html;
    $(id).innerHTML = html;
  }

  U.init = function () {
    // pointerdown so clicks survive the frequent panel re-renders
    document.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      if (el.tagName === 'INPUT') return;
      e.preventDefault();
      U.act(el.dataset.act, el.dataset);
    });
  };

  const game = () => PG.main.state;

  // ---------------------------------------------------------------- actions
  U.select = function (type, id) {
    U.sel = type ? { type, id } : null;
    U.moveMode = false;
    U.update(true);
  };

  U.act = function (act, d) {
    const s = game();
    const probe = d.probe != null ? S.probe(s, +d.probe) : null;
    let err = null;
    switch (act) {
      case 'speed': U.setSpeed(+d.v); break;
      case 'pref': U.prefs[d.k] = !U.prefs[d.k]; savePrefs(); break;
      case 'research': U.openModal({ kind: 'research' }); break;
      case 'help': U.openModal({ kind: 'help' }); break;
      case 'save': PG.main.save(true); break;
      case 'next-idle': U.nextIdle(); break;
      case 'sel-probe': {
        U.select('probe', +d.id);
        const p = S.probe(s, +d.id);
        if (p && d.center) { const w = S.pos(s, p); PG.render.cam.x = w.x; PG.render.cam.y = w.y; }
        break;
      }
      case 'sel-star': U.select('star', +d.id); if (d.center) { const st = s.stars[+d.id]; PG.render.cam.x = st.x; PG.render.cam.y = st.y; } break;
      case 'deselect': U.select(null); break;
      case 'move': U.moveMode = !U.moveMode; U.update(true); break;
      case 'replicate': err = S.orderReplicate(s, probe); break;
      case 'survey': err = S.orderSurvey(s, probe); break;
      case 'cancel': err = S.cancelTask(s, probe); break;
      case 'auto': S.setAuto(s, probe, !probe.auto); break;
      case 'build': err = S.orderBuild(s, probe, d.type, d.planet != null ? +d.planet : undefined); break;
      case 'ship': err = S.orderColonyShip(s, +d.star, +d.planet); break;
      case 'shipcancel': err = S.cancelColonyShip(s, +d.idx); break;
      case 'tech': if (!S.has(s, d.id)) S.queueResearch(s, d.id); break;
      case 'choice': U.resolveChoice(+d.ev, +d.idx, d.key); break;
      case 'close': U.closeModal(); break;
      case 'newgame': PG.main.newGame(($('in-name') || {}).value, ($('in-seed') || {}).value); break;
      case 'continue': PG.main.load(); break;
      case 'intro': U.openModal({ kind: 'intro' }); break;
    }
    if (err) U.toast(err, 'danger');
    U.update(true);
  };

  U.setSpeed = function (v) {
    const s = game();
    if (U.modal && U.modal.kind === 'event') return;
    s.speed = v;
    if (v > 0) U.prevSpeed = v;
    U.update(true);
  };
  U.togglePause = () => { const s = game(); U.setSpeed(s.speed === 0 ? (U.prevSpeed || 2) : 0); };

  U.nextIdle = function () {
    const s = game();
    const idle = s.probes.filter(p => S.idle(p) && !p.auto);
    if (!idle.length) { U.toast('No idle probes. Everyone\'s busy. As it should be.'); return; }
    const cur = U.sel && U.sel.type === 'probe' ? idle.findIndex(p => p.id === U.sel.id) : -1;
    const p = idle[(cur + 1) % idle.length];
    U.select('probe', p.id);
    const w = S.pos(s, p); PG.render.cam.x = w.x; PG.render.cam.y = w.y;
  };

  U.mapClick = function (star, unit, button) {
    const s = game();
    const selP = U.sel && U.sel.type === 'probe' ? S.probe(s, U.sel.id) : null;
    if ((U.moveMode || button === 2) && selP && star) {
      const err = S.orderMove(s, selP, star.id);
      if (err) U.toast(err, 'danger');
      U.moveMode = false;
      U.update(true);
      return;
    }
    if (button === 2) return;
    if (unit) return U.select('probe', unit.id);
    if (star) return U.select('star', star.id);
    U.select(null);
  };

  // ---------------------------------------------------------- auto-pause
  // Snapshot before a sim step, then compare after it: only transitions caused by the
  // simulation (not by the player's own clicks) trigger a pause.
  const isIdle = p => S.idle(p) && !p.auto;
  U.autoPauseSnapshot = s => ({
    busy: new Set(s.probes.filter(p => !isIdle(p)).map(p => p.id)),
    ids: new Set(s.probes.map(p => p.id)),
    research: s.queue.length > 0,
  });

  U.autoPauseCheck = function (s, before) {
    if (s.speed === 0 || (s.over && !s.flags.continued)) return;
    const reasons = [];
    let newlyIdle = [];
    if (U.prefs.pauseIdle) {
      newlyIdle = s.probes.filter(p => isIdle(p) && (before.busy.has(p.id) || !before.ids.has(p.id)));
      if (newlyIdle.length) reasons.push(newlyIdle.map(p => p.name).join(', ') + (newlyIdle.length > 1 ? ' are' : ' is') + ' idle');
    }
    if (U.prefs.pauseResearch && before.research && !s.queue.length) reasons.push('research queue is empty');
    if (!reasons.length) return;
    U.prevSpeed = s.speed;
    s.speed = 0;
    if (newlyIdle.length && !U.moveMode) U.sel = { type: 'probe', id: newlyIdle[0].id };
    U.toast('Paused \u2014 ' + reasons.join('; '), 'anomaly');
    U.update(true);
  };

  // ------------------------------------------------------------- toasts
  U.toast = function (text, kind) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 4500);
    setTimeout(() => el.remove(), 5200);
  };

  // ------------------------------------------------------------- render
  U.update = function (force) {
    const s = game();
    if (!s) { set('modal-root', U.modal ? modalHtml(null) : ''); return; }
    const now = performance.now();
    if (!force && now - (U.last || 0) < 200) return;
    U.last = now;
    if (U.sel && U.sel.type === 'probe' && !S.probe(s, U.sel.id)) { U.sel = null; U.moveMode = false; }

    while (s.toasts.length) { const t = s.toasts.shift(); U.toast(t.text, t.kind); }
    if (s.pauseRequest) {
      if (s.speed > 0) { U.prevSpeed = s.speed; s.speed = 0; U.toast('Paused \u2014 ' + s.pauseRequest, 'danger'); }
      s.pauseRequest = null;
    }
    topbar(s);
    roster(s);
    objectives(s);
    set('panel', panel(s));
    logView(s);
    const mh = $('modehint');
    if (U.moveMode) { mh.hidden = false; mh.textContent = 'Select a destination star  (Esc to cancel)'; } else mh.hidden = true;
    // Event queue -> modal
    if (!U.modal && s.events.length) U.openModal({ kind: 'event', id: s.events[0].id });
    if (U.modal) set('modal-root', modalHtml(s));
    else set('modal-root', '');
  };

  function topbar(s) {
    const left = PG.DEADLINE - s.t;
    set('tb-date', `<div class="stat"><small>Year</small><b>${yr(s.t)}</b></div>
      <div class="stat"><small>Earth</small><b class="${left < 15 ? 'earth-warn' : ''}">${Math.max(0, left).toFixed(1)} yrs</b></div>`);
    set('tb-speed', PG.SPEED_LABELS.map((l, i) => `<button data-act="speed" data-v="${i}" class="${s.speed === i ? 'on' : ''}" title="${i ? 'Speed ' + l : 'Pause (Space)'}">${l}</button>`).join(''));
    set('tb-auto', `<span class="ap-label">Auto-pause</span>
      <button data-act="pref" data-k="pauseIdle" class="chip ${U.prefs.pauseIdle ? 'on' : ''}" aria-pressed="${U.prefs.pauseIdle}" title="Pause when a replicant finishes its work and goes idle">Idle clone</button>
      <button data-act="pref" data-k="pauseResearch" class="chip ${U.prefs.pauseResearch ? 'on' : ''}" aria-pressed="${U.prefs.pauseResearch}" title="Pause when the research queue runs empty">Research done</button>`);
    const inc = S.income(s);
    const q = s.queue[0] && PG.TECH[s.queue[0]];
    set('tb-res', `<div class="stat"><small>Matter</small><b>${fmt(s.matter)}<span class="inc">+${inc.matter.toFixed(0)}/yr</span></b></div>
      <div class="stat" title="${q ? 'Researching ' + esc(q.name) : 'No research queued!'}"><small>Research ${q ? '→ ' + esc(q.name) : '<span style="color:var(--amber)">idle</span>'}</small><b>${fmt(s.rp)}${q ? '<span style="color:var(--dim);font-size:12px">/' + q.cost + '</span>' : ''}<span class="inc" style="color:var(--violet)">+${inc.rp.toFixed(0)}/yr</span></b></div>`);
    const pop = S.colonialPop(s);
    set('tb-goal', `<div class="stat goalbar"><small>Humans settled off-world: ${S.fmtPop(pop)} / ${S.fmtPop(PG.TARGET_POP)}</small>${bar(pop / PG.TARGET_POP, 'good')}</div>`);
  }

  function probeStatus(s, p) {
    if (p.travel) {
      const eta = (p.travel.d - p.travel.done) / S.probeSpeed(s, p);
      return '→ ' + s.stars[p.travel.to].name + ' (' + eta.toFixed(1) + 'y)';
    }
    const st = s.stars[p.star];
    if (st.combat) return '⚔ In combat at ' + st.name;
    if (p.task) {
      const t = p.task, k = Math.floor(t.progress / t.total * 100) + '%';
      if (t.type === 'survey') return 'Surveying ' + st.name + ' ' + k;
      if (t.type === 'build') return 'Building ' + PG.STRUCTS[t.what].name + ' ' + k;
      if (t.type === 'replicate') return 'Replicating ' + k;
    }
    return (p.auto ? 'Auto-exploring' : 'Idle') + ' at ' + st.name;
  }

  function roster(s) {
    set('roster-count', '(' + s.probes.length + ')');
    const sel = U.sel && U.sel.type === 'probe' ? U.sel.id : -1;
    set('roster', s.probes.map(p => {
      const cls = ['ro'];
      if (p.id === sel) cls.push('sel');
      if (S.idle(p) && !p.auto) cls.push('idle');
      if (p.hp < S.probeMaxHp(s, p) * 0.5) cls.push('hurt');
      return `<div class="${cls.join(' ')}" data-act="sel-probe" data-id="${p.id}" data-center="1">
        <span class="nm">${esc(p.name)}</span><span class="tr">G${p.gen} ${PG.TRAITS[p.trait].name}</span>
        <span class="stt">${esc(probeStatus(s, p))}</span></div>`;
    }).join(''));
  }

  function objectives(s) {
    const anyMine = s.stars.some(st => st.planets.some(pl => pl.struct && pl.struct.type === 'mine'));
    const pop = S.colonialPop(s);
    const list = [
      ['Build an Autofactory in Sol', anyMine],
      ['Queue a research project (R)', Object.keys(s.researched).length > 0 || s.queue.length > 0],
      ['Replicate yourself', s.stats.clones >= 2],
      ['Survey 5 star systems (' + Math.min(5, s.stats.surveyed - 1) + '/5)', s.stats.surveyed >= 6],
      ['Find a habitable world', S.colonyTargets(s).length > 0 || s.flags.firstColony],
      ['Research Colony Ships, build a Shipyard', s.stars[0].structs.some(x => x.type === 'shipyard')],
      ['Found a colony', !!s.flags.firstColony],
      ['Settle ' + S.fmtPop(PG.TARGET_POP) + ' humans before ' + (PG.START_YEAR + PG.DEADLINE), pop >= PG.TARGET_POP],
    ];
    let cur = false;
    let html = list.map(([txt, done]) => {
      let c = done ? 'done' : '';
      if (!done && !cur) { c = 'cur'; cur = true; }
      return `<div class="obj ${c}"><i>${done ? '✓' : c === 'cur' ? '▸' : '·'}</i>${esc(txt)}</div>`;
    }).join('');
    // Legacy goals: a few teasers during the Exodus, the full list once it's done.
    const legacy = S.legacy(s);
    const won = s.over === 'won';
    const teaser = { hive: true, species: true, relics: s.relics > 0, kethari: s.races.kethari.discovered };
    const shown = won ? legacy : legacy.filter(g => teaser[g.id]);
    if (won) html += `<div class="obj-head">Legacy <span>${legacy.filter(g => g.done).length}/${legacy.length}</span></div>`;
    html += shown.map(g => `<div class="obj bonus ${g.done ? 'done' : g.failed ? 'failed' : ''}"><i>${g.failed && !g.done ? '✕' : '★'}</i>${won ? '' : 'Bonus: '}${esc(g.label)}</div>`).join('');
    set('objectives', html);
  }

  function logView(s) {
    const key = s.log.length + ':' + (s.log.length ? s.log[s.log.length - 1].t : 0);
    if (U.cache.logKey === key) return;
    U.cache.logKey = key;
    const items = s.log.slice(-120).reverse();
    $('log').innerHTML = items.map(l => `<div class="le ${l.kind}"><span class="y">${yr(l.t)}</span>${esc(l.text)}</div>`).join('');
  }

  // --------------------------------------------------------------- panels
  function panel(s) {
    if (U.sel && U.sel.type === 'probe') {
      const p = S.probe(s, U.sel.id);
      if (p) return probePanel(s, p);
    }
    if (U.sel && U.sel.type === 'star') return starPanel(s, s.stars[U.sel.id], null);
    return overview(s);
  }

  function probePanel(s, p) {
    const tr = PG.TRAITS[p.trait];
    const maxHp = S.probeMaxHp(s, p);
    const hpf = p.hp / maxHp;
    let h = `<h2>${esc(p.name)} <small>Gen ${p.gen}</small></h2>
      <div class="sub"><span class="trait">${tr.name}</span> — ${esc(tr.desc)}${p.parent ? '<br>Cloned from ' + esc(p.parent) + ' in ' + Math.floor(PG.START_YEAR + p.born) + '.' : ''}</div>
      <div class="pbar">${bar(hpf, hpf < 0.35 ? 'danger' : hpf < 0.7 ? 'amber' : 'good')}</div>
      <dl class="kv"><dt>Hull</dt><dd>${fmt(p.hp)} / ${fmt(maxHp)}</dd>
      <dt>Speed</dt><dd>${S.probeSpeed(s, p).toFixed(2)} ly/yr</dd>
      <dt>Attack</dt><dd>${S.probeAtk(s, p).toFixed(1)}</dd>
      <dt>Research</dt><dd>${S.probeRp(s, p).toFixed(1)}/yr</dd>
      <dt>Status</dt><dd>${esc(probeStatus(s, p))}</dd></dl>`;
    if (p.task) h += `<div class="pbar">${bar(p.task.progress / p.task.total)}</div>`;
    const repErr = S.canReplicate(s, p);
    const repCost = S.replicateCost(s, p);
    h += `<div class="acts">
      <button data-act="move" data-probe="${p.id}" class="${U.moveMode ? 'on' : ''}" title="Then click a star, or right-click a star at any time (M)">Move</button>
      <button data-act="replicate" data-probe="${p.id}" ${repErr ? 'disabled title="' + esc(repErr) + '"' : ''}>Replicate — ${repCost} M</button>
      ${!p.travel && !s.stars[p.star].surveyed && !p.task ? `<button data-act="survey" data-probe="${p.id}">Survey</button>` : ''}
      ${p.task ? `<button class="warn" data-act="cancel" data-probe="${p.id}">Cancel task</button>` : ''}
      <button data-act="auto" data-probe="${p.id}" class="${p.auto ? 'on' : ''}" title="Automatically travel to and survey the nearest unexplored systems">Auto-explore</button>
    </div>`;
    if (!p.travel) h += '<div style="margin-top:14px"></div>' + starPanel(s, s.stars[p.star], p, true);
    else h += `<div class="note">In transit to <a href="#" data-act="sel-star" data-id="${p.travel.to}">${esc(s.stars[p.travel.to].name)}</a>. Replication and construction require being in a system.</div>`;
    return h;
  }

  function buildBtn(s, actor, type, planet, label) {
    if (!actor) return '';
    const err = S.canBuild(s, actor, type, planet);
    const cost = S.structCost(s, type, actor);
    if (err && !/^Need /.test(err)) return '';
    return `<button data-act="build" data-probe="${actor.id}" data-type="${type}" ${planet != null ? 'data-planet="' + planet + '"' : ''} ${err ? 'disabled' : ''} title="${esc(PG.STRUCTS[type].desc)}">${label || PG.STRUCTS[type].name} — ${cost} M</button>`;
  }

  function starPanel(s, st, pref, nested) {
    const probesHere = s.probes.filter(p => p.star === st.id && !p.travel);
    const actor = (pref && S.idle(pref) && pref.star === st.id) ? pref : probesHere.find(S.idle) || null;
    const H = nested ? 'h4' : 'h2';
    let h = nested ? `<h4>${esc(st.name)}<span>${st.type}-class · ${st.d.toFixed(1)} ly from Sol</span></h4>`
      : `<${H}>${esc(st.name)} <small>${st.type}-class star</small></${H}><div class="sub">${st.d.toFixed(1)} ly from Sol · ${st.surveyed ? 'Surveyed' : 'Unsurveyed'}</div>`;
    if (st.combat) h += `<div class="note bad">⚔ Combat in progress!</div>`;
    if (st.ravaged) h += `<div class="note bad">This system was harvested by the Gleaners.</div>`;
    if (st.nest && (s.flags.nestKnown || st.surveyed)) h += `<div class="note bad">${s.flags.nestDead ? 'The ruins of the Gleaner Hive.' : 'The Gleaner Hive. A hive-world wrapped in factories. It launches harvester fleets and will need an armada to kill.'}</div>`;
    if (st.marked && st.anomaly) h += `<div class="note mark">${st.anomaly === 'relic' ? 'A Precursor relic should be here. Send a probe.' : 'Flagged: a distress beacon. The first probe to arrive will investigate.'}</div>`;
    else if (st.surveyed && st.anomaly) h += `<div class="note mark">Unexplained readings. A probe on site will investigate.</div>`;
    if (st.race && s.races[st.race].discovered) {
      const r = PG.RACES[st.race], rs = s.races[st.race];
      const dev = st.race === 'kethari' && !rs.extinct ? `<div class="dev">Development toward spaceflight ${bar((rs.progress || 0) / 100)}</div>` : '';
      h += `<div class="race" style="border-color:${r.color}"><b style="color:${r.color}">${r.name}</b> <span style="color:var(--dim)">· ${r.kind}${rs.extinct ? ' · <span class="foe">EXTINCT</span>' : ''}</span><div>${esc(r.blurb)}</div>${dev}</div>`;
    }
    const foes = s.enemies.filter(e => e.star === st.id && !e.travel && e.vis);
    if (foes.length) {
      h += `<h4>Hostiles<span>${foes.length}</span></h4>`;
      h += foes.map(e => `<div class="list-row"><span class="grow foe">${esc(e.name)}</span><span style="width:90px">${bar(e.hp / e.maxHp, 'danger')}</span><span>atk ${e.atk.toFixed(0)}</span></div>`).join('');
    }
    if (!st.surveyed) {
      h += `<div class="note">Unknown system. Send a probe to survey it.</div>`;
      if (U.sel && U.sel.type === 'probe' && pref == null) {
        const p = S.probe(s, U.sel.id);
        if (p) h += `<div class="note">ETA for ${esc(p.name)}: ${S.eta(s, p, st.id).toFixed(1)} years.</div>`;
      }
    } else {
      if (actor) h += `<div class="note">Builder: <b style="color:#fff">${esc(actor.name)}</b> <span class="trait">${PG.TRAITS[actor.trait].name}</span></div>`;
      else if (probesHere.length) h += `<div class="note warn">All probes here are busy.</div>`;
      else h += `<div class="note">No probe present. Move one here to build.</div>`;
      h += `<h4>Bodies<span>${st.planets.length}</span></h4>`;
      h += st.planets.map((pl, i) => bodyRow(s, st, pl, i, actor)).join('') || '<div class="note">Just a lonely star.</div>';
      // Orbital
      const counts = {};
      st.structs.forEach(x => { counts[x.type] = (counts[x.type] || 0) + 1; });
      h += `<h4>Orbital<span>${st.structs.length ? Object.keys(counts).map(k => counts[k] + '× ' + PG.STRUCTS[k].name).join(', ') : 'none'}</span></h4>`;
      const defs = st.structs.filter(x => x.type === 'defense');
      if (defs.length) h += defs.map(x => `<div class="list-row"><span class="grow">Defense Platform</span><span style="width:90px">${bar(x.hp / S.defMaxHp(s), 'good')}</span></div>`).join('');
      const btns = ['lab', 'defense', 'observatory', 'shipyard', 'dyson'].map(t => buildBtn(s, actor, t)).join('');
      if (btns) h += `<div class="acts">${btns}</div>`;
      if (st.id === 0) h += shipyardSection(s);
    }
    if (probesHere.length) {
      h += `<h4>Replicants here<span>${probesHere.length}</span></h4>`;
      h += probesHere.map(p => `<div class="list-row link" data-act="sel-probe" data-id="${p.id}"><span class="grow">${esc(p.name)} <span class="trait">${PG.TRAITS[p.trait].name}</span></span><span style="color:var(--dim)">${esc(probeStatus(s, p).replace(' at ' + st.name, ''))}</span></div>`).join('');
    }
    return h;
  }

  function bodyRow(s, st, pl, i, actor) {
    const pt = PG.PLANET_TYPES[pl.type];
    let tags = '';
    if (pl.struct) tags += `<span class="tag ${pl.struct.type}">${PG.STRUCTS[pl.struct.type].name}${pl.struct.type === 'mine' ? ' +' + S.mineYield(s, pl).toFixed(0) + '/yr' : ''}</span>`;
    if (pl.pending) tags += `<span class="tag pend">under construction</span>`;
    if (pl.colony) tags += `<span class="tag col">Colony ${S.fmtPop(pl.colony.pop)} / ${S.fmtPop(S.popCap(s, pl))}</span>`;
    if (pl.natives) tags += `<span class="tag nat">${s.races[pl.natives].extinct ? 'extinct ' : ''}${PG.RACES[pl.natives].name}</span>`;
    let ln = '';
    if (pl.rich > 0 && pl.type !== 'earth') ln += `<span title="Mining richness">⛏ ${pl.rich}</span>`;
    if (pl.max > 0 || pl.hab > 0) {
      const cls = pl.hab >= 70 ? 'good' : pl.max >= 70 ? 'amber' : '';
      ln += `<span class="hab" title="Habitability ${pl.hab.toFixed(0)}% (max ${pl.max}%). 70% needed to colonize.">hab ${bar(pl.hab / 100, cls)} ${pl.hab.toFixed(0)}%${pl.max > pl.hab + 0.5 ? ' → ' + pl.max : ''}</span>`;
    }
    if (S.colonizable(s, pl) && !pl.colony) ln += `<span style="color:var(--good)">colonizable</span>`;
    let btns = '';
    if (actor) {
      btns += buildBtn(s, actor, 'mine', i, 'Autofactory');
      if (pl.type === 'earth') btns += buildBtn(s, actor, 'terraformer', i, 'Restore Earth');
      else if (pl.max >= 70 || pl.max > pl.hab + 10) btns += buildBtn(s, actor, 'terraformer', i, 'Terraform');
    }
    return `<div class="body"><div class="hd"><span class="dot" style="background:${pt.color}"></span><span class="nm">${esc(pl.name)}</span><span class="ty">${pl.size ? PG.SIZE_NAMES[pl.size] + ' ' : ''}${pt.name}</span></div>
      ${ln || tags ? `<div class="ln">${ln}${tags}</div>` : ''}${btns ? `<div class="acts">${btns}</div>` : ''}</div>`;
  }

  function shipyardSection(s) {
    let h = `<h4>Exodus<span>${S.fmtPop(S.colonyCap(s))} per ship</span></h4>`;
    if (!S.has(s, 'colony')) return h + `<div class="note">Research <b>Colony Ship Design</b> to start evacuating Earth.</div>`;
    const yards = s.stars[0].structs.filter(x => x.type === 'shipyard').length;
    if (!yards) return h + `<div class="note warn">Build an Orbital Shipyard here (needs an idle probe at Sol).</div>`;
    h += `<div class="note">${yards} shipyard${yards > 1 ? 's' : ''}, building ${Math.min(yards, s.shipQueue.length)} ship${yards > 1 ? 's' : ''} at a time. ${S.colonyShipTime(s).toFixed(1)} yrs per ship.</div>`;
    s.shipQueue.forEach((q, i) => {
      const pl = s.stars[q.target.star].planets[q.target.planet];
      h += `<div class="list-row"><span class="grow">${i < yards ? '⚒' : '⏳'} → ${esc(pl.name)}</span><span style="width:70px">${bar(q.progress)}</span><button class="mini bad" data-act="shipcancel" data-idx="${i}">✕</button></div>`;
    });
    const targets = S.colonyTargets(s);
    if (!targets.length) return h + `<div class="note warn">No colonizable worlds known. Explore, or terraform one to 70%+.</div>`;
    const err = S.canColonyShip(s);
    const cost = S.colonyShipCost(s);
    h += `<div class="note">Queue a colony ship (${cost} M) to:</div>`;
    h += targets.slice(0, 10).map(t => {
      const st = s.stars[t.star], pl = st.planets[t.planet];
      const danger = st.ravaged || s.enemies.some(e => e.vis && !e.travel && e.star === st.id);
      return `<div class="list-row"><span class="grow">${esc(pl.name)} <span style="color:var(--dim)">${st.d.toFixed(0)} ly · hab ${pl.hab.toFixed(0)}%${pl.colony ? ' · ' + S.fmtPop(pl.colony.pop) : ''}</span>${danger ? ' <span class="foe">⚠</span>' : ''}</span>
        <button class="mini" data-act="ship" data-star="${t.star}" data-planet="${t.planet}" ${err ? 'disabled title="' + esc(err) + '"' : ''}>Send</button></div>`;
    }).join('');
    return h;
  }

  function overview(s) {
    const inc = S.income(s);
    let h = `<h2>Mission Control</h2><div class="sub">Select a star or replicant. Nothing selected.</div>`;
    h += `<dl class="kv"><dt>Matter</dt><dd>${fmt(s.matter)} (+${inc.matter.toFixed(0)}/yr)</dd>
      <dt>Research</dt><dd>${fmt(s.rp)} (+${inc.rp.toFixed(0)}/yr)</dd>
      <dt>Replicants</dt><dd>${s.probes.length}</dd>
      <dt>Surveyed</dt><dd>${s.stats.surveyed} systems</dd>
      <dt>Ships en route</dt><dd>${s.ships.length}</dd></dl>`;
    const cols = [];
    s.stars.forEach(st => st.planets.forEach(pl => { if (pl.colony) cols.push([st, pl]); }));
    h += `<h4>Colonies<span>${S.fmtPop(S.colonialPop(s))}</span></h4>`;
    h += cols.length ? cols.map(([st, pl]) => `<div class="list-row link" data-act="sel-star" data-id="${st.id}" data-center="1"><span class="grow">${esc(pl.name)}</span><span style="color:var(--good)">${S.fmtPop(pl.colony.pop)}</span></div>`).join('')
      : '<div class="note">None yet.</div>';
    const tf = [];
    s.stars.forEach(st => st.planets.forEach(pl => { if (pl.struct && pl.struct.type === 'terraformer' && pl.hab < pl.max) tf.push([st, pl]); }));
    if (tf.length) {
      h += `<h4>Terraforming<span>${S.terraRate(s).toFixed(1)}%/yr</span></h4>`;
      h += tf.map(([st, pl]) => `<div class="list-row link" data-act="sel-star" data-id="${st.id}" data-center="1"><span class="grow">${esc(pl.name)}</span><span style="width:70px">${bar(pl.hab / 100, pl.hab >= 70 ? 'good' : 'amber')}</span><span>${pl.hab.toFixed(0)}%</span></div>`).join('');
    }
    const targets = S.colonyTargets(s).filter(t => !s.stars[t.star].planets[t.planet].colony);
    if (targets.length) {
      h += `<h4>Open habitable worlds<span>${targets.length}</span></h4>`;
      h += targets.slice(0, 8).map(t => { const st = s.stars[t.star]; return `<div class="list-row link" data-act="sel-star" data-id="${st.id}" data-center="1"><span class="grow">${esc(st.planets[t.planet].name)}</span><span style="color:var(--dim)">${st.d.toFixed(0)} ly</span></div>`; }).join('');
    }
    h += `<div class="hint">Tip: right-click a star to send the selected replicant there. Tab cycles idle probes. Shift+wheel zooms faster.</div>`;
    return h;
  }

  // --------------------------------------------------------------- tooltip
  U.tooltip = function (s, star, sx, sy) {
    const tt = $('tooltip');
    if (!star) { tt.hidden = true; return; }
    let txt = `<b>${esc(star.name)}</b> · ${star.type}-class · ${star.d.toFixed(1)} ly from Sol`;
    if (star.surveyed) {
      const hab = star.planets.filter(pl => S.colonizable(s, pl)).length;
      const cand = star.planets.filter(pl => !pl.natives && pl.max >= 70 && pl.hab < 70).length;
      const rich = star.planets.reduce((a, pl) => a + (pl.type !== 'earth' && !pl.natives ? pl.rich : 0), 0);
      txt += `\n${star.planets.length} bodies · richness ${rich}`;
      if (hab) txt += `\n<span style="color:var(--good)">${hab} habitable</span>`;
      if (cand) txt += `\n<span style="color:var(--amber)">${cand} terraformable</span>`;
      const pop = star.planets.reduce((a, pl) => a + (pl.colony ? pl.colony.pop : 0), 0);
      if (pop) txt += `\nColonists: ${S.fmtPop(pop)}`;
    } else txt += '\n<span style="color:var(--dim)">Unsurveyed</span>';
    if (star.marked && star.anomaly) txt += `\n<span style="color:var(--violet)">${star.anomaly === 'relic' ? 'Precursor relic' : 'Distress beacon'}</span>`;
    if (star.race && s.races[star.race].discovered) txt += `\n<span style="color:${PG.RACES[star.race].color}">${PG.RACES[star.race].name}</span>`;
    const foes = s.enemies.filter(e => e.vis && !e.travel && e.star === star.id);
    if (foes.length) txt += `\n<span class="foe">${foes.length} hostile${foes.length > 1 ? 's' : ''}</span>`;
    const p = U.sel && U.sel.type === 'probe' ? S.probe(s, U.sel.id) : null;
    if (p && p.star !== star.id) txt += `\n<span style="color:var(--amber)">${esc(p.name)}: ${S.eta(s, p, star.id).toFixed(1)} yrs travel</span>`;
    tt.innerHTML = txt;
    tt.hidden = false;
    const wrap = $('mapwrap').getBoundingClientRect();
    tt.style.left = Math.min(sx + 16, wrap.width - 270) + 'px';
    tt.style.top = Math.min(sy + 14, wrap.height - 120) + 'px';
  };

  // ---------------------------------------------------------------- modals
  U.openModal = function (m) {
    const s = game();
    if (m.kind === 'event' && s) {
      if (s.speed !== 0) U.prevSpeed = s.speed;
      s.speed = 0;
    }
    U.modal = m;
    U.update(true);
  };

  U.closeModal = function () {
    const m = U.modal;
    U.modal = null;
    const s = game();
    if (m && m.kind === 'event' && s && !s.events.length && !(s.over && !s.flags.continued)) s.speed = U.prevSpeed || 2;
    U.update(true);
  };

  U.resolveChoice = function (evId, idx, key) {
    const s = game();
    S.resolveEvent(s, evId, idx);
    U.modal = null;
    if (key === 'end:new') { U.openModal({ kind: 'intro' }); return; }
    if (s.events.length) U.openModal({ kind: 'event', id: s.events[0].id });
    else { U.modal = { kind: 'event' }; U.closeModal(); }
  };

  function modalHtml(s) {
    const m = U.modal;
    if (m.kind === 'event') {
      const ev = s.events.find(e => e.id === m.id);
      if (!ev) { U.modal = null; return ''; }
      const cls = ev.type === 'contact' ? 'contact' : ev.type === 'moot' ? 'moot' : ev.type === 'random' ? 'random' : ev.type === 'end' ? (ev.won ? 'won' : 'lost') : 'danger';
      const kicker = { contact: 'Contact', moot: 'Convergence', random: 'Incoming', end: ev.won ? 'Victory' : 'Defeat', info: 'Alert' }[ev.type] || 'Alert';
      return `<div class="modal ${cls}"><div class="kicker">${kicker} · ${yr(s.t)}</div><h1>${esc(ev.title)}</h1>
        <div class="body-text">${esc(ev.body)}</div>
        <div class="choices">${ev.choices.map((c, i) => `<button data-act="choice" data-ev="${ev.id}" data-idx="${i}" data-key="${c.key}">${esc(c.label)}${c.desc ? '<small>' + esc(c.desc) + '</small>' : ''}</button>`).join('')}</div></div>`;
    }
    if (m.kind === 'research') return researchHtml(s);
    if (m.kind === 'help') return helpHtml();
    if (m.kind === 'intro') return introHtml();
    return '';
  }

  function researchHtml(s) {
    const inc = S.income(s);
    const cats = ['Industry', 'Exploration', 'Military', 'Colonization'];
    let h = `<div class="modal wide"><div class="kicker">Research · ${fmt(s.rp)} banked · +${inc.rp.toFixed(0)}/yr</div><h1>Technology</h1>
      <div class="note">Click a project to queue it (prerequisites are queued automatically). Research completes automatically as points accumulate. Click again to dequeue.</div><div class="tree">`;
    for (const c of cats) {
      h += `<div><h5>${c}</h5>`;
      for (const t of PG.TECHS.filter(x => x.cat === c)) {
        const done = S.has(s, t.id);
        const qi = s.queue.indexOf(t.id);
        const avail = S.techAvailable(s, t.id);
        const cls = done ? 'done' : qi >= 0 ? 'queued' : avail ? '' : 'locked';
        let status = done ? 'Researched' : qi >= 0 ? 'Queued #' + (qi + 1) + (qi === 0 ? ' · ' + pct(s.rp, t.cost) + '%' : '') : avail ? 'Available' : 'Needs ' + t.req.filter(r => !S.has(s, r)).map(r => PG.TECH[r].name).join(', ');
        h += `<div class="tech ${cls}" data-act="tech" data-id="${t.id}"><div class="tn">${esc(t.name)}<span>${done ? '✓' : t.cost}</span></div><div class="td">${esc(t.desc)}</div><div class="tq">${esc(status)}</div></div>`;
      }
      h += '</div>';
    }
    return h + `</div><div class="foot"><button data-act="close">Close (Esc)</button></div></div>`;
  }

  function helpHtml() {
    return `<div class="modal wide"><div class="kicker">Field manual</div><h1>How to Play</h1>
      <p class="lead">You are a human mind uploaded into a self-replicating Von Neumann probe. Earth is dying. You have ${PG.DEADLINE} years.</p>
      <div class="row"><div>
      <b>Goal</b>
      <ul><li>Settle <b>${S.fmtPop(PG.TARGET_POP)} humans</b> on colony worlds before Earth’s biosphere collapses in ${PG.START_YEAR + PG.DEADLINE}.</li>
      <li>Colony ships launch from an <b>Orbital Shipyard</b> at Sol and fly to any surveyed world with ≥70% habitability.</li>
      <li>Colonies grow on their own, but the <b>Others</b> will strip them bare if left undefended.</li></ul>
      <b>Economy</b>
      <ul><li><b>Matter</b> comes from Autofactories built on planets, belts and gas giants. Richness ⛏ sets the yield.</li>
      <li><b>Research</b> comes from every replicant plus Research Labs and Observation Posts.</li>
      <li><b>Replicate</b> to create a new probe. Each clone gets a personality trait.</li></ul>
      </div><div>
      <b>Exploration</b>
      <ul><li>Probes automatically survey unexplored systems on arrival.</li>
      <li>Look for <span style="color:var(--good)">green markers</span> (habitable) and planets with a high max habitability to <b>terraform</b>.</li>
      <li>Three alien species are out there, and something very hungry. Strange signals and ancient relics turn up too.</li></ul>
      <b>After the Exodus</b>
      <ul><li>Saving humanity isn’t the end. Keep playing to chase <b>Legacy</b> goals: restore Earth, build a Dyson Swarm, decode the Precursor Archive, and more.</li></ul>
      <b>Controls</b>
      <ul><li>Left-click: select star/probe. <b>Right-click a star</b>: move selected probe.</li>
      <li>Drag: pan. Wheel: zoom. <b>Space</b>: pause. <b>1-4</b>: speed.</li>
      <li><b>Tab</b>: next idle probe. <b>M</b>: move mode. <b>R</b>: research. <b>Esc</b>: cancel/close.</li></ul>
      </div></div>
      <div class="foot"><button data-act="close">Got it</button></div></div>`;
  }

  function introHtml() {
    const has = PG.main.hasSave();
    return `<div class="modal"><div class="kicker">${PG.START_YEAR} · Earth orbit</div><h1 class="big">REPLICANT</h1>
      <p class="lead">Decades ago your brain was scanned for a research archive. The archive got sold. Now you’re the operating system of a self-replicating Von Neumann probe, and nobody asked you first.</p>
      <p>Earth is dying: a carbon-capture microbe built to save the climate is eating the atmosphere instead. You have ${PG.DEADLINE} years to explore the stars, build copies of yourself, terraform new homes and carry humanity out before the air runs out.</p>
      <p>Also: you are probably not alone out there.</p>
      <div class="row"><div><label for="in-name">Your name</label><input id="in-name" value="Ada" maxlength="16"></div>
      <div><label for="in-seed">Galaxy seed (optional)</label><input id="in-seed" placeholder="random"></div></div>
      <div class="foot">${has ? '<button class="warn" data-act="continue">Continue saved game</button>' : ''}<button data-act="newgame">Launch ▸</button></div></div>`;
  }
})(window.PG);
