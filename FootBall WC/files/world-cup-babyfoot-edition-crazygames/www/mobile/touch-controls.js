// ═══════════════════════════════════════════════════════════════════════════
//  touch-controls.js — on-screen controls for the Android / touch build
// ═══════════════════════════════════════════════════════════════════════════
//
//  Loaded as a plain <script> AFTER the game's inline script. That matters:
//  the game declares GAME / KEYS / CFG / LIM with top-level `const`, which
//  does NOT create window properties but DOES live in the shared global
//  lexical scope. So this file can reference them by bare name, and must not
//  reach for `window.GAME` (which is undefined).
//
//  ── How input actually reaches the game ────────────────────────────────
//  The game has TWO input paths for player 1, and they read different objects.
//  Both have to be driven or half the mechanics go dead:
//
//    Rod movement   (_update, ~L1301)  reads KEY_P1  → raw KEYS['w'/'s']
//                                      because botMode is always true
//    Hold / aim /   (_updateHeld etc.) reads GAME.myInput
//    kick detection                    because testMode is always false
//
//  So a "press W" from touch means: KEYS['w'] = true AND myInput.up = true.
//
//  ── Why the slider does not set rod position directly ──────────────────
//  Writing GAME.p1Off from the slider would let a phone player move faster
//  than CFG.ROD_SPD allows, which changes the game's balance. Instead the
//  slider only records a TARGET, and each frame we press the same up/down
//  flags the keyboard would press until the rod arrives. Identical physics,
//  identical speed limit — the touch layer is purely an input device.
//
//  Debug: append ?touch=1 to force these controls on a desktop browser,
//         or ?touch=0 to force them off on a phone.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Activation ──────────────────────────────────────────────────────────
  const qs      = location.search;
  const FORCED  = /[?&]touch=1/.test(qs);
  const DISABLED= /[?&]touch=0/.test(qs);
  const isNative= !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
                     && window.Capacitor.isNativePlatform());
  const coarse  = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const hasTouch= 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;

  if (DISABLED || !(FORCED || isNative || (coarse && hasTouch))) return;

  document.documentElement.classList.add('touch-ui');

  // ── Tunables (logical px inside the 900×600 #wrap) ──────────────────────
  const TRACK_H     = 366;   // slider travel length
  const SWIPE_PASS  = 30;    // screen px of vertical travel on KICK = a pass
  const SWIPE_REARM = 14;    // must come back within this to allow another pass
  const DEADZONE    = 4.5;   // px of rod error we stop correcting (≈ half a frame at ROD_SPD 8.5)

  // ═════════════════════════════════════════════════════════════════════════
  //  STYLES
  // ═════════════════════════════════════════════════════════════════════════
  const css = document.createElement('style');
  css.textContent = `
  /* Touch builds get no mouse cursor art and must never scroll or zoom. */
  html.touch-ui, html.touch-ui body { cursor: none !important; touch-action: none; overscroll-behavior: none; }
  html.touch-ui body * { cursor: none !important; }
  html.touch-ui button:hover, html.touch-ui .btn:hover, html.touch-ui [onclick]:hover { transform: none; }

  /* The keyboard/mouse hint text on the ability cards is wrong on a phone. */
  html.touch-ui #ability-hud .ab-key { display: none; }

  #touch-ui {
    position: absolute; inset: 0; z-index: 40;
    pointer-events: none;              /* children opt back in individually */
    touch-action: none;
    display: none;
  }
  #touch-ui.on { display: block; }

  /* ── Left: rod slider ────────────────────────────────────────────── */
  #tc-slider {
    position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
    width: 92px; height: ${TRACK_H + 80}px;
    pointer-events: auto;
    display: flex; align-items: center; justify-content: center;
  }
  #tc-track {
    position: relative; width: 26px; height: ${TRACK_H}px;
    border-radius: 15px;
    background: rgba(6, 12, 26, .55);
    border: 2px solid rgba(255, 255, 255, .28);
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, .5);
  }
  /* Tick marks so the throw of the rod is legible at a glance. */
  #tc-track::before {
    content: ''; position: absolute; left: 50%; top: 10%; bottom: 10%;
    width: 2px; margin-left: -1px;
    background: repeating-linear-gradient(to bottom,
      rgba(255,255,255,.20) 0 2px, transparent 2px 26px);
  }
  /* Where the finger is asking the rod to go. */
  #tc-ghost {
    position: absolute; left: 50%; width: 40px; height: 40px;
    margin-left: -20px; margin-top: -20px;
    border-radius: 50%; border: 2px dashed rgba(255, 215, 0, .75);
    opacity: 0; transition: opacity .12s linear;
  }
  #tc-ghost.show { opacity: 1; }
  /* Where the rod actually is — deliberately lags the ghost, because the
     rod is speed-limited and the player should be able to see that. */
  #tc-thumb {
    position: absolute; left: 50%; width: 52px; height: 52px;
    margin-left: -26px; margin-top: -26px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff 0%, #ffd700 45%, #c99700 100%);
    border: 3px solid #0a1a2e;
    box-shadow: 0 3px 12px rgba(0, 0, 0, .55);
    display: flex; align-items: center; justify-content: center;
  }
  #tc-thumb::after {
    content: '⇅'; font-size: 24px; font-weight: 900; color: #0a1a2e; line-height: 1;
  }
  #tc-slider.grab #tc-thumb { box-shadow: 0 0 0 6px rgba(255, 215, 0, .25), 0 3px 12px rgba(0,0,0,.55); }

  /* ── Right: action buttons ───────────────────────────────────────── */
  #tc-actions {
    position: absolute; right: 18px; bottom: 20px;
    width: 260px; height: 250px;
    pointer-events: none;
  }
  .tc-btn {
    position: absolute; pointer-events: auto;
    border-radius: 50%;
    border: 3px solid #0a1a2e;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Arial, sans-serif; font-weight: 900;
    color: #0a1a2e; text-align: center; line-height: 1.05;
    box-shadow: 0 4px 14px rgba(0, 0, 0, .5);
    transition: transform .07s ease-out, filter .12s linear, opacity .15s linear;
    overflow: hidden;
  }
  .tc-btn .tc-lbl  { font-size: 15px; letter-spacing: .4px; }
  .tc-btn .tc-sub  { font-size: 9.5px; font-weight: 700; opacity: .72; margin-top: 1px; }
  .tc-btn.press    { transform: scale(.92); filter: brightness(1.15); }

  /* Abilities that need the ball are dimmed until it is held — this mirrors
     the existing .ability-card.dim behaviour on the HUD cards. */
  .tc-btn.gated    { opacity: .38; filter: grayscale(.75); }

  #tc-kick {
    right: 6px; bottom: 8px; width: 110px; height: 110px;
    background: radial-gradient(circle at 34% 28%, #fff 0%, #ffd700 46%, #d1a000 100%);
  }
  #tc-power {
    right: 118px; bottom: 62px; width: 86px; height: 86px;
    background: radial-gradient(circle at 34% 28%, #ffe9e9 0%, #ff5f5f 46%, #b62222 100%);
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5);
  }
  #tc-loft {
    right: 30px; bottom: 128px; width: 78px; height: 78px;
    background: radial-gradient(circle at 34% 28%, #e9f3ff 0%, #59a5ff 46%, #1e5fb4 100%);
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5);
  }
  /* Charge fill climbs the POWER button while it is held. */
  #tc-power-fill {
    position: absolute; left: 0; right: 0; bottom: 0; height: 0%;
    background: linear-gradient(to top, rgba(255,255,255,.85), rgba(255,255,255,.35));
    pointer-events: none;
  }
  #tc-power .tc-lbl, #tc-power .tc-sub { position: relative; z-index: 1; }

  /* Swipe-to-pass affordance: only meaningful while the ball is held. */
  #tc-passhint {
    position: absolute; right: 6px; bottom: 8px; width: 110px; height: 110px;
    border-radius: 50%; pointer-events: none;
    opacity: 0; transition: opacity .18s linear;
  }
  #tc-passhint.show { opacity: 1; }
  #tc-passhint span {
    position: absolute; left: 50%; transform: translateX(-50%);
    font-size: 15px; font-weight: 900; color: #0a1a2e; opacity: .55;
  }
  #tc-passhint .up   { top: -3px; }
  #tc-passhint .down { bottom: -3px; }

  /* Tutorial coach-mark glow, mirrored from the HUD cards onto the buttons. */
  .tc-btn.tc-glow {
    animation: tcGlow .85s ease-in-out infinite alternate;
  }
  @keyframes tcGlow {
    from { box-shadow: 0 0 0 0 rgba(255,215,0,.85), 0 4px 14px rgba(0,0,0,.5); }
    to   { box-shadow: 0 0 0 12px rgba(255,215,0,0), 0 4px 14px rgba(0,0,0,.5); }
  }
  #tc-slider.tc-glow #tc-thumb {
    animation: tcGlow .85s ease-in-out infinite alternate;
  }
  `;
  document.head.appendChild(css);

  // ═════════════════════════════════════════════════════════════════════════
  //  DOM  (mounted inside #screen-game so it inherits that screen's
  //        show/hide, and inside #wrap so it scales with the game)
  // ═════════════════════════════════════════════════════════════════════════
  const host = document.getElementById('screen-game');
  if (!host) { console.warn('[touch] #screen-game not found — controls not mounted'); return; }

  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.innerHTML = `
    <div id="tc-slider">
      <div id="tc-track">
        <div id="tc-ghost"></div>
        <div id="tc-thumb"></div>
      </div>
    </div>
    <div id="tc-actions">
      <div class="tc-btn" id="tc-loft">
        <span class="tc-lbl">LOFT</span><span class="tc-sub">tap</span>
      </div>
      <div class="tc-btn" id="tc-power">
        <div id="tc-power-fill"></div>
        <span class="tc-lbl">POWER</span><span class="tc-sub">hold</span>
      </div>
      <div class="tc-btn" id="tc-kick">
        <span class="tc-lbl">KICK</span><span class="tc-sub">hold = trap</span>
      </div>
      <div id="tc-passhint">
        <span class="up">▲ pass</span>
        <span class="down">▼ pass</span>
      </div>
    </div>`;
  host.appendChild(root);

  const elSlider = root.querySelector('#tc-slider');
  const elTrack  = root.querySelector('#tc-track');
  const elThumb  = root.querySelector('#tc-thumb');
  const elGhost  = root.querySelector('#tc-ghost');
  const elKick   = root.querySelector('#tc-kick');
  const elPower  = root.querySelector('#tc-power');
  const elLoft   = root.querySelector('#tc-loft');
  const elFill   = root.querySelector('#tc-power-fill');
  const elPassHint = root.querySelector('#tc-passhint');

  // ═════════════════════════════════════════════════════════════════════════
  //  GAME BRIDGE  — every write the keyboard/mouse handlers would have made
  // ═════════════════════════════════════════════════════════════════════════

  const tut = () => (window.TUTORIAL && window.TUTORIAL.active ? window.TUTORIAL : null);
  const okMove = () => { const t = tut(); return !t || t.allowMove(); };
  const okKick = () => { const t = tut(); return !t || t.allowKick(); };
  const allows = (what) => (typeof _tutAllows === 'function' ? _tutAllows(what) : true);
  const canShoot = () => (typeof _canShoot === 'function' ? _canShoot() : false);

  /** Press or release the equivalent of W / S. Drives BOTH input paths. */
  function setMove(up, down) {
    if (!okMove()) { up = down = false; }
    KEYS['w'] = up;   KEYS['s'] = down;      // rod movement, via KEY_P1
    GAME.myInput.up = up; GAME.myInput.down = down;  // aim direction while holding
    // The tutorial's rod drill counts real direction presses, and demands both
    // W and S per rep so spamming one way cannot satisfy it.
    const t = tut();
    if (t) { if (up) t._kW = true; if (down) t._kS = true; }
  }

  /** Press/release the equivalent of Space. */
  function setKick(down) {
    if (down && !okKick()) return;
    KEYS[' '] = down;
    GAME.myInput.kick = down;
    if (down && GAME.running) {
      // Leniency window that lets a slightly early/late press still count as
      // a catch, plus the timestamp the tutorial uses to prove the kick was
      // the player's own rather than an incidental figure collision.
      GAME._holdBufferP1 = GAME.HOLD_BUFFER_FRAMES;
      GAME._tutSpaceT = performance.now();
    }
  }

  /** Fire a pass, mirroring the Q / E keydown branch exactly. */
  function doPass(dir) {
    if (!(GAME.running && GAME.heldBy && !GAME.passAnim)) return false;
    const h = GAME.heldBy;
    const mine = GAME.testMode || h.team === GAME.myRole;
    if (!mine || !allows('pass')) return false;
    GAME._passRequest = dir;
    GAME._tutPass = (GAME._tutPass || 0) + 1;
    return true;
  }

  function startCharge() {
    if (!canShoot() || !allows('charge')) return false;
    GAME._chargeActive = true;
    GAME._chargeFrames = 0;
    return true;
  }
  function releaseCharge() {
    if (!GAME._chargeActive) return;
    GAME._releaseGroundShot(GAME._chargeFrames / GAME.CHARGE_MAX_FRAMES);
  }
  function doLoft() {
    if (!canShoot() || !allows('loft')) return;
    GAME._releaseLoftedShot();
  }

  /** Drop every input we might be holding (screen change, pause, blur). */
  function releaseAll() {
    setMove(false, false);
    KEYS[' '] = false;
    GAME.myInput.kick = false;
    if (GAME._chargeActive) { GAME._chargeActive = false; GAME._chargeFrames = 0; }
    slider.id = null; slider.target = null;
    elSlider.classList.remove('grab');
    elGhost.classList.remove('show');
    for (const b of [elKick, elPower, elLoft]) b.classList.remove('press');
    touches.clear();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  TOUCH ROUTER
  //  Tracked per touch identifier so the left thumb can drive the slider
  //  while the right thumb works the buttons at the same time.
  // ═════════════════════════════════════════════════════════════════════════
  const touches = new Map();          // identifier -> { kind, el, y0, passArmed }
  const slider  = { id: null, target: null };

  /** Map a clientY onto a rod offset target using the track's real screen box. */
  function targetFromY(clientY) {
    const r = elTrack.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height)));
    return LIM.p1.min + (LIM.p1.max - LIM.p1.min) * f;
  }

  function hitKind(target) {
    if (elSlider.contains(target)) return 'slider';
    if (elKick.contains(target))   return 'kick';
    if (elPower.contains(target))  return 'power';
    if (elLoft.contains(target))   return 'loft';
    return null;
  }

  function onStart(ev) {
    if (!visible()) return;
    for (const t of ev.changedTouches) {
      const kind = hitKind(t.target);
      if (!kind) continue;
      ev.preventDefault();

      if (kind === 'slider') {
        slider.id = t.identifier;
        slider.target = targetFromY(t.clientY);
        elSlider.classList.add('grab');
        elGhost.classList.add('show');
        touches.set(t.identifier, { kind });
      } else if (kind === 'kick') {
        setKick(true);
        elKick.classList.add('press');
        touches.set(t.identifier, { kind, y0: t.clientY, passArmed: true });
      } else if (kind === 'power') {
        if (startCharge()) elPower.classList.add('press');
        touches.set(t.identifier, { kind });
      } else if (kind === 'loft') {
        doLoft();
        elLoft.classList.add('press');
        touches.set(t.identifier, { kind });
      }
    }
  }

  function onMove(ev) {
    for (const t of ev.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      ev.preventDefault();

      if (rec.kind === 'slider') {
        slider.target = targetFromY(t.clientY);
      } else if (rec.kind === 'kick') {
        // Sliding the held finger up or down passes the ball to the next rod.
        // The finger stays down, so the ball stays trapped through the pass.
        const dy = t.clientY - rec.y0;
        if (rec.passArmed && Math.abs(dy) >= SWIPE_PASS) {
          if (doPass(dy < 0 ? 'prev' : 'next')) {
            rec.passArmed = false;
            rec.y0 = t.clientY;      // re-anchor so a long drag can pass twice
          }
        } else if (!rec.passArmed && Math.abs(dy) <= SWIPE_REARM) {
          rec.passArmed = true;
        }
      }
    }
  }

  function onEnd(ev) {
    for (const t of ev.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      touches.delete(t.identifier);

      if (rec.kind === 'slider') {
        if (slider.id === t.identifier) {
          slider.id = null;
          slider.target = null;        // rod holds position; it does not spring back
          elSlider.classList.remove('grab');
          elGhost.classList.remove('show');
        }
      } else if (rec.kind === 'kick') {
        setKick(false);
        elKick.classList.remove('press');
      } else if (rec.kind === 'power') {
        releaseCharge();
        elPower.classList.remove('press');
      } else if (rec.kind === 'loft') {
        elLoft.classList.remove('press');
      }
    }
  }

  root.addEventListener('touchstart',  onStart, { passive: false });
  root.addEventListener('touchmove',   onMove,  { passive: false });
  root.addEventListener('touchend',    onEnd,   { passive: false });
  root.addEventListener('touchcancel', onEnd,   { passive: false });

  // Desktop testing with ?touch=1 — synthesise touches from the mouse so the
  // whole scheme can be exercised in a browser without a device.
  if (FORCED && !hasTouch) {
    let downId = null;
    const fake = (e) => ({ identifier: 1, target: e.target, clientX: e.clientX, clientY: e.clientY });
    root.addEventListener('mousedown', (e) => {
      downId = 1; onStart({ changedTouches: [fake(e)], preventDefault: () => e.preventDefault() });
    });
    window.addEventListener('mousemove', (e) => {
      if (downId === null) return;
      onMove({ changedTouches: [fake(e)], preventDefault: () => {} });
    });
    window.addEventListener('mouseup', (e) => {
      if (downId === null) return; downId = null;
      onEnd({ changedTouches: [fake(e)], preventDefault: () => {} });
    });
  }

  window.addEventListener('blur', releaseAll);

  // ═════════════════════════════════════════════════════════════════════════
  //  PER-FRAME SYNC
  //  Runs on its own RAF so the game loop is untouched. All it does is set
  //  the same flags a keyboard would, then update the widget visuals.
  // ═════════════════════════════════════════════════════════════════════════
  function visible() {
    return !!(GAME && GAME.running && !GAME.paused
              && document.getElementById('screen-game').classList.contains('active'));
  }

  let wasVisible = false;

  function frame() {
    const vis = visible();
    if (vis !== wasVisible) {
      root.classList.toggle('on', vis);
      if (!vis) releaseAll();
      wasVisible = vis;
    }

    if (vis) {
      // ── drive the rod toward the slider target ──
      if (slider.target === null) {
        setMove(false, false);
      } else {
        const err = slider.target - GAME.p1Off;   // up decreases p1Off
        if (err < -DEADZONE)      setMove(true, false);
        else if (err > DEADZONE)  setMove(false, true);
        else                      setMove(false, false);
      }

      // ── widget visuals ──
      const span = (LIM.p1.max - LIM.p1.min) || 1;
      const fAct = Math.max(0, Math.min(1, (GAME.p1Off - LIM.p1.min) / span));
      elThumb.style.top = (fAct * TRACK_H) + 'px';
      if (slider.target !== null) {
        const fTgt = Math.max(0, Math.min(1, (slider.target - LIM.p1.min) / span));
        elGhost.style.top = (fTgt * TRACK_H) + 'px';
      }

      // Charge fill
      elFill.style.height = GAME._chargeActive
        ? Math.min(100, (GAME._chargeFrames / GAME.CHARGE_MAX_FRAMES) * 100) + '%'
        : '0%';

      // Gate the ball-dependent abilities, matching the HUD cards
      const held = GAME.heldBy && GAME.heldBy.team === GAME.myRole;
      elPower.classList.toggle('gated', !held);
      elLoft.classList.toggle('gated',  !held);
      elPassHint.classList.toggle('show', !!held);

      syncTutorialGlow();
    }
    requestAnimationFrame(frame);
  }

  // ── Mirror the tutorial's coach-mark glow onto the touch buttons ─────────
  // The tutorial adds .tut-glow to the HUD ability cards; on a phone the
  // player is looking at these buttons instead, so the highlight has to
  // travel with them or the coach-mark points at nothing.
  const GLOW_MAP = [
    ['charge-ability-card', elPower],
    ['loft-ability-card',   elLoft],
    ['hold-ability-card',   elKick],
    ['pass-ability-card',   elKick],
  ];
  function syncTutorialGlow() {
    let kickGlow = false;
    for (const [id, el] of GLOW_MAP) {
      const card = document.getElementById(id);
      const lit  = !!(card && card.classList.contains('tut-glow'));
      if (el === elKick) { kickGlow = kickGlow || lit; continue; }
      el.classList.toggle('tc-glow', lit);
    }
    elKick.classList.toggle('tc-glow', kickGlow);
    // The move drill highlights no HUD card at all, so key the slider off the
    // current step instead. TUTORIAL exposes allowMove/allowKick/allows but no
    // accessor for the step id, so read the step object directly and stay
    // defensive about its shape rather than assuming an API that isn't there.
    const t = tut();
    let step = null;
    try { const s = t && t.steps && t.steps[t.i]; step = s ? s.id : null; } catch(e){}
    elSlider.classList.toggle('tc-glow', step === 'move');
  }

  requestAnimationFrame(frame);

  // Expose a little state for debugging from the console / adb logcat.
  window.TOUCH = {
    get target()  { return slider.target; },
    get p1Off()   { return GAME.p1Off; },
    get touches() { return [...touches.entries()]; },
    press: { kick: setKick, pass: doPass, loft: doLoft, charge: startCharge, release: releaseCharge },
    setMove,
  };

  console.log('[touch] on-screen controls active' + (FORCED ? ' (forced via ?touch=1)' : ''));
})();
