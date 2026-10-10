// Canvas galaxy map renderer and hit-testing.
(function (PG) {
  'use strict';
  const S = PG.sim;
  const R = PG.render = {
    cam: { x: 0, y: 0, z: 14 },
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
    glow: {}, bg: [], sensorLayer: null,
  };

  R.init = function (canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.sensorLayer = document.createElement('canvas');
    for (let i = 0; i < 500; i++) R.bg.push({ x: Math.random(), y: Math.random(), b: Math.random() ** 3, d: 0.02 + Math.random() * 0.06 });
    R.resize();
    window.addEventListener('resize', R.resize);
  };

  R.resize = function () {
    const r = R.canvas.getBoundingClientRect();
    R.dpr = window.devicePixelRatio || 1;
    R.w = r.width; R.h = r.height;
    R.canvas.width = Math.round(r.width * R.dpr);
    R.canvas.height = Math.round(r.height * R.dpr);
    R.sensorLayer.width = R.canvas.width;
    R.sensorLayer.height = R.canvas.height;
  };

  R.fit = function (radius) { R.cam.x = 0; R.cam.y = 0; R.cam.z = Math.min(R.w, R.h) / (2 * radius); };
  R.toScreen = (x, y) => ({ x: (x - R.cam.x) * R.cam.z + R.w / 2, y: (y - R.cam.y) * R.cam.z + R.h / 2 });
  R.toWorld = (sx, sy) => ({ x: (sx - R.w / 2) / R.cam.z + R.cam.x, y: (sy - R.h / 2) / R.cam.z + R.cam.y });
  R.zoomAt = function (sx, sy, factor) {
    const before = R.toWorld(sx, sy);
    R.cam.z = Math.max(3, Math.min(80, R.cam.z * factor));
    const after = R.toWorld(sx, sy);
    R.cam.x += before.x - after.x; R.cam.y += before.y - after.y;
  };

  function glowSprite(color) {
    if (R.glow[color]) return R.glow[color];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.12, color);
    grd.addColorStop(0.35, color + '55');
    grd.addColorStop(1, color + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return (R.glow[color] = c);
  }

  const starPx = st => PG.STAR_TYPES[st.type].r * Math.max(0.7, Math.min(1.7, R.cam.z / 12));

  R.pickStar = function (s, sx, sy) {
    let best = null, bd = 16;
    for (const st of s.stars) {
      const p = R.toScreen(st.x, st.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  };

  R.pickUnit = function (s, sx, sy) {
    let best = null, bd = 10;
    for (const p of s.probes) {
      if (!p.travel) continue;
      const w = S.pos(s, p), q = R.toScreen(w.x, w.y);
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  function tri(ctx, x, y, ang, size, fill, stroke) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.65); ctx.lineTo(-size * 0.35, 0); ctx.lineTo(-size * 0.7, -size * 0.65);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
  }

  function diamond(ctx, x, y, size, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  R.draw = function (s, ui, now) {
    const ctx = R.ctx, z = R.cam.z;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, R.w, R.h);

    // Parallax background dust
    for (const b of R.bg) {
      const x = ((b.x * R.w - R.cam.x * z * b.d) % R.w + R.w) % R.w;
      const y = ((b.y * R.h - R.cam.y * z * b.d) % R.h + R.h) % R.h;
      ctx.fillStyle = `rgba(180,200,255,${0.08 + b.b * 0.35})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Distance rings from Sol
    const sol = R.toScreen(0, 0);
    ctx.font = '10px JetBrains Mono, monospace';
    for (let r = 10; r <= 50; r += 10) {
      ctx.beginPath(); ctx.arc(sol.x, sol.y, r * z, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(90,130,200,0.07)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(90,130,200,0.25)';
      ctx.fillText(r + ' ly', sol.x + 4, sol.y - r * z - 3);
    }

    // Sensor coverage (single flat layer so overlaps don't stack)
    const sl = R.sensorLayer, sctx = sl.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sl.width, sl.height);
    sctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    sctx.fillStyle = '#5ce1e6';
    const range = S.sensorRange(s) * z;
    for (const src of S.sensorSources(s)) {
      const p = R.toScreen(src.x, src.y);
      sctx.beginPath(); sctx.arc(p.x, p.y, range, 0, Math.PI * 2); sctx.fill();
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.045; ctx.drawImage(sl, 0, 0); ctx.restore();

    // Travel routes
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    const route = (u, color) => {
      const a = S.pos(s, u), b = s.stars[u.travel.to];
      const pa = R.toScreen(a.x, a.y), pb = R.toScreen(b.x, b.y);
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    };
    for (const p of s.probes) if (p.travel) route(p, ui.sel && ui.sel.type === 'probe' && ui.sel.id === p.id ? 'rgba(255,255,255,.6)' : 'rgba(92,225,230,.3)');
    for (const sh of s.ships) if (sh.travel) route(sh, 'rgba(95,211,138,.35)');
    for (const e of s.enemies) if (e.travel && e.vis) route(e, 'rgba(255,92,92,.35)');
    ctx.setLineDash([]);

    const t = now / 1000;
    const selStar = ui.sel && ui.sel.type === 'star' ? ui.sel.id : (ui.sel && ui.sel.type === 'probe' && S.probe(s, ui.sel.id) ? S.probe(s, ui.sel.id).star : -1);

    // Stars
    for (const st of s.stars) {
      const p = R.toScreen(st.x, st.y);
      if (p.x < -60 || p.y < -60 || p.x > R.w + 60 || p.y > R.h + 60) continue;
      const type = PG.STAR_TYPES[st.type];
      const r = starPx(st);
      const known = st.surveyed || st.id === 0;
      ctx.globalAlpha = known ? 1 : 0.5;
      const spr = glowSprite(type.color);
      const gs = r * 7;
      ctx.drawImage(spr, p.x - gs / 2, p.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;

      if (st.ravaged) {
        ctx.strokeStyle = 'rgba(255,92,92,.55)'; ctx.lineWidth = 1.2;
        const k = r + 4;
        ctx.beginPath(); ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k); ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.stroke();
      }
      if (st.nest && (s.flags.nestKnown || st.surveyed) && !s.flags.nestDead) {
        const pr = r + 8 + Math.sin(t * 3) * 2;
        ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,60,60,.3)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr + 5, 0, Math.PI * 2); ctx.stroke();
      }
      if (st.combat) {
        ctx.strokeStyle = `rgba(255,92,92,${0.5 + 0.5 * Math.sin(t * 10)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 14, 0, Math.PI * 2); ctx.stroke();
      }
      // Markers
      if (known) {
        let hasCol = false, hasHab = false, terra = false, nat = null, nbuilt = 0;
        for (const pl of st.planets) {
          if (pl.colony) hasCol = true;
          else if (S.colonizable(s, pl)) hasHab = true;
          if (pl.struct) { nbuilt++; if (pl.struct.type === 'terraformer' && pl.hab < pl.max) terra = true; }
          if (pl.natives && !s.races[pl.natives].extinct && s.races[pl.natives].discovered) nat = pl.natives;
        }
        nbuilt += st.structs.length;
        if (hasCol) {
          ctx.strokeStyle = '#5fd38a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke();
        }
        if (hasHab) { ctx.fillStyle = '#5fd38a'; ctx.beginPath(); ctx.arc(p.x + r + 5, p.y - r - 4, 3, 0, Math.PI * 2); ctx.fill(); }
        if (terra) { ctx.fillStyle = '#5ce1e6'; ctx.beginPath(); ctx.arc(p.x + r + 5, p.y - r - 4, 2.2, 0, Math.PI * 2); ctx.fill(); }
        if (nat) diamond(ctx, p.x - r - 6, p.y - r - 4, 3.5, PG.RACES[nat].color);
        if (st.anomaly) diamond(ctx, p.x - r - 6, p.y + r + 4, 3, '#b48cff');
        if (nbuilt && z > 5) {
          ctx.fillStyle = '#ffb547';
          ctx.fillRect(p.x + r + 3, p.y + r + 1, 4, 4);
          if (z > 9) { ctx.font = '9px JetBrains Mono, monospace'; ctx.fillText(nbuilt, p.x + r + 9, p.y + r + 6); }
        }
      }
      // Flagged destinations (relic trail, distress beacons) are shown even before survey.
      if (!known && st.marked && st.anomaly) {
        ctx.strokeStyle = 'rgba(180,140,255,.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + Math.sin(t * 2) * 1.5, 0, Math.PI * 2); ctx.stroke();
      }
      // Label
      const show = st.id === 0 || st.id === selStar || (ui.hoverStar && ui.hoverStar.id === st.id) || z > 11 || (known && z > 5.5);
      if (show) {
        ctx.font = (st.id === 0 ? '600 ' : '') + '11px JetBrains Mono, monospace';
        ctx.fillStyle = st.id === selStar ? '#ffffff' : known ? 'rgba(207,220,239,.85)' : 'rgba(116,135,166,.6)';
        ctx.textAlign = 'center';
        ctx.fillText(st.name, p.x, p.y + r + 15);
        ctx.textAlign = 'left';
      }
      if (st.id === selStar) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(t * 0.6);
        ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, r + 10, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (ui.hoverStar && ui.hoverStar.id === st.id) {
        ctx.strokeStyle = 'rgba(92,225,230,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Probes and hostiles parked at stars orbit them.
    const atStar = {};
    for (const p of s.probes) if (!p.travel) (atStar[p.star] = atStar[p.star] || []).push(p);
    const selProbe = ui.sel && ui.sel.type === 'probe' ? ui.sel.id : -1;
    for (const sid in atStar) {
      const st = s.stars[sid], list = atStar[sid];
      const c = R.toScreen(st.x, st.y);
      const orbit = starPx(st) + 9 + Math.min(6, z * 0.2);
      list.forEach((p, i) => {
        const a = t * 0.5 + (i / list.length) * Math.PI * 2;
        const x = c.x + Math.cos(a) * orbit, y = c.y + Math.sin(a) * orbit;
        const idle = S.idle(p);
        tri(ctx, x, y, a + Math.PI / 2, 4.5, idle ? '#ffb547' : '#5ce1e6', p.id === selProbe ? '#ffffff' : null);
      });
    }
    for (const p of s.probes) {
      if (!p.travel) continue;
      const w = S.pos(s, p), q = R.toScreen(w.x, w.y), to = s.stars[p.travel.to];
      const ang = Math.atan2(to.y - w.y, to.x - w.x);
      tri(ctx, q.x, q.y, ang, 5, '#5ce1e6', p.id === selProbe ? '#ffffff' : null);
      if (p.id === selProbe || z > 14) {
        ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(92,225,230,.8)';
        ctx.fillText(p.name, q.x + 7, q.y - 6);
      }
    }
    for (const sh of s.ships) {
      const w = S.pos(s, sh), q = R.toScreen(w.x, w.y);
      ctx.fillStyle = '#5fd38a'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(95,211,138,.4)'; ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke();
    }
    const enAt = {};
    for (const e of s.enemies) {
      if (!e.vis || e.faction === 'nest') continue;
      if (e.travel) {
        const w = S.pos(s, e), q = R.toScreen(w.x, w.y);
        diamond(ctx, q.x, q.y, e.faction === 'others' ? 6 : 4.5, e.faction === 'others' ? '#ff4d4d' : '#ff9a3c');
      } else (enAt[e.star] = enAt[e.star] || []).push(e);
    }
    for (const sid in enAt) {
      const st = s.stars[sid], c = R.toScreen(st.x, st.y), list = enAt[sid];
      const orbit = starPx(st) + 12;
      list.forEach((e, i) => {
        const a = -t * 0.4 + (i / list.length) * Math.PI * 2 + Math.PI;
        diamond(ctx, c.x + Math.cos(a) * orbit, c.y + Math.sin(a) * orbit, e.faction === 'others' ? 6 : 4.5, e.faction === 'others' ? '#ff4d4d' : '#ff9a3c');
      });
    }

    // Move-order preview
    if (ui.moveMode && ui.hoverStar) {
      const p = S.probe(s, ui.sel.id);
      if (p) {
        const a = S.pos(s, p), pa = R.toScreen(a.x, a.y), pb = R.toScreen(ui.hoverStar.x, ui.hoverStar.y);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  };
})(window.PG);
