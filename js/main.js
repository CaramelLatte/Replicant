// Boot, game loop, input handling and persistence.
(function (PG) {
  'use strict';
  const S = PG.sim, R = PG.render, U = PG.ui;
  const SAVE_KEY = 'replicant-save-v1';
  const M = PG.main = { state: null };

  M.hasSave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  M.save = function (manual) {
    if (!M.state) return;
    try {
      const copy = Object.assign({}, M.state, { toasts: [] });
      localStorage.setItem(SAVE_KEY, JSON.stringify(copy));
      if (manual) U.toast('Game saved.', 'good');
    } catch (e) {
      if (manual) U.toast('Could not save: ' + e.message, 'danger');
    }
  };

  M.load = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return U.toast('No saved game found.', 'danger');
      M.start(S.migrate(JSON.parse(raw)));
      U.toast('Welcome back, ' + M.state.player + '.', 'good');
    } catch (e) {
      U.toast('Save is corrupted: ' + e.message, 'danger');
    }
  };

  M.newGame = function (name, seedStr) {
    name = (name || '').trim().slice(0, 16) || 'Ada';
    let seed = parseInt(seedStr, 10);
    if (!Number.isFinite(seed)) seed = Math.floor(Math.random() * 1e9);
    M.start(PG.newGame(seed, name));
    U.openModal({ kind: 'help' });
  };

  M.start = function (state) {
    M.state = state;
    U.modal = null;
    U.cache = {};
    U.sel = { type: 'star', id: 0 };
    U.moveMode = false;
    U.prevSpeed = state.speed || 2;
    M.lastSave = state.t;
    R.fit(16);
    U.update(true);
  };

  // ----------------------------------------------------------------- loop
  let last = performance.now();
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = M.state;
    if (s) {
      const paused = U.modal && U.modal.kind !== 'research';
      if (!paused && s.speed > 0) {
        const before = U.autoPauseSnapshot(s);
        S.update(s, dtReal * PG.SPEEDS[s.speed]);
        U.autoPauseCheck(s, before);
      }
      if (s.t - M.lastSave >= 5 && !s.over) { M.lastSave = s.t; M.save(false); }
      R.draw(s, U, now);
      U.update(false);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- input
  function bindInput(canvas) {
    let down = null, dragging = false;
    const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    canvas.addEventListener('pointerdown', e => {
      down = { ...local(e), button: e.button, cx: R.cam.x, cy: R.cam.y };
      dragging = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      const p = local(e);
      if (down && down.button === 0) {
        if (!dragging && Math.hypot(p.x - down.x, p.y - down.y) > 4) dragging = true;
        if (dragging) {
          R.cam.x = down.cx - (p.x - down.x) / R.cam.z;
          R.cam.y = down.cy - (p.y - down.y) / R.cam.z;
        }
      }
      if (!M.state) return;
      const star = dragging ? null : R.pickStar(M.state, p.x, p.y);
      U.hoverStar = star;
      U.tooltip(M.state, star, p.x, p.y);
      canvas.style.cursor = dragging ? 'grabbing' : star ? 'pointer' : 'crosshair';
    });
    canvas.addEventListener('pointerup', e => {
      if (!down) return;
      const p = local(e);
      if (!dragging && M.state) {
        const unit = R.pickUnit(M.state, p.x, p.y);
        const star = R.pickStar(M.state, p.x, p.y);
        U.mapClick(star, unit, down.button);
      }
      down = null; dragging = false;
    });
    canvas.addEventListener('pointerleave', () => { U.hoverStar = null; document.getElementById('tooltip').hidden = true; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      const k = e.shiftKey ? 1.35 : 1.12;
      R.zoomAt(p.x, p.y, e.deltaY < 0 ? k : 1 / k);
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') {
        if (e.key === 'Enter' && U.modal && U.modal.kind === 'intro') U.act('newgame', {});
        return;
      }
      if (!M.state) return;
      const key = e.key;
      if (key === 'Escape') {
        if (U.moveMode) { U.moveMode = false; U.update(true); }
        else if (U.modal && U.modal.kind !== 'event' && U.modal.kind !== 'intro') U.closeModal();
        else if (!U.modal) U.select(null);
        return;
      }
      if (U.modal && U.modal.kind !== 'research') return;
      if (key === ' ') { e.preventDefault(); U.togglePause(); }
      else if (key >= '1' && key <= '4') U.setSpeed(+key);
      else if (key === 'Tab') { e.preventDefault(); U.nextIdle(); }
      else if (key === 'r' || key === 'R') { if (U.modal) U.closeModal(); else U.openModal({ kind: 'research' }); }
      else if (key === 'h' || key === 'H' || key === '?') U.openModal({ kind: 'help' });
      else if ((key === 'm' || key === 'M') && U.sel && U.sel.type === 'probe') { U.moveMode = !U.moveMode; U.update(true); }
      else if (key === 'Home') R.fit(16);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('map');
    R.init(canvas);
    U.init();
    bindInput(canvas);
    U.openModal({ kind: 'intro' });
    requestAnimationFrame(frame);
  });
})(window.PG);
