// ═══════════════════════════════════════════════════════════════════════════
//  touch-controls.js — on-screen controls for the mobile / touch build
// ═══════════════════════════════════════════════════════════════════════════
//
//  Loaded as a plain <script> AFTER the game's inline script. That matters:
//  the game declares GAME / KEYS / CFG / LIM with top-level `const`, which
//  does NOT create window properties but DOES live in the shared global
//  lexical scope. So this file can reference them by bare name, and must not
//  reach for `window.GAME` (which is undefined).
//
//  ── The control scheme ──────────────────────────────────────────────────
//    Joystick (left)   drag up / down          = W / S
//    TRAP     (right)  tap                     = Space
//    SHOOT    (right)  hold w/ ball  = charge  = hold Left-click
//                      tap  w/o ball = strike  = tap  Left-click
//    CHIP     (right)  tap  w/ ball  = loft    = Right-click
//
//  Three buttons, matching the three things a desktop player can do. Nothing
//  is labelled LMB/RMB because there is no mouse on a phone — each button is
//  named for its effect.
//
//  ── How input actually reaches the game ────────────────────────────────
//  The game has TWO input paths for player 1, and they read different objects.
//  Both have to be driven or half the mechanics go dead:
//
//    Rod movement   (_update)      reads KEY_P1  → raw KEYS['w'/'s']
//                                  because botMode is always true
//    Hold / aim     (_updateHeld)  reads GAME.myInput
//                                  because testMode is always false
//
//  So a "press W" from touch means: KEYS['w'] = true AND myInput.up = true.
//
//  ── The latch ───────────────────────────────────────────────────────────
//  Space no longer holds-to-trap. One press ARMS a grab for GRAB_ARM_FRAMES
//  (~1s), and the ball then stays latched in the grip until a shot or the
//  hold timer releases it. Pressing again while already holding does nothing
//  on purpose — players spam the key to make sure a catch lands, and under
//  the old rule that extra press threw the ball straight back out.
//
//  Passing (Q/E) was removed from the game entirely. There is deliberately no
//  swipe gesture here: a dead gesture that silently does nothing is worse than
//  no gesture at all.
//
//  ── Why the joystick doesn't set rod position directly ─────────────────
//  Writing GAME.p1Off would let a phone player move faster than CFG.ROD_SPD
//  allows, changing the game's balance. The stick only presses the same up /
//  down flags a keyboard would. Identical physics, identical speed limit —
//  the touch layer is purely an input device.
//
//  Debug: append ?touch=1 to force these controls on in a desktop browser,
//         or ?touch=0 to force them off on a phone.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Activation ──────────────────────────────────────────────────────────
  // Evaluated per-frame, not once at load. platform.js may only learn the
  // device is a phone after the CrazyGames SDK finishes initialising, and the
  // controls have to be able to appear at that point.
  const qs       = location.search;
  const FORCED   = /[?&]touch=1/.test(qs);
  const DISABLED = /[?&]touch=0/.test(qs);
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;

  function wanted() {
    if (DISABLED) return false;
    if (FORCED)   return true;
    return !!(window.PLATFORM && window.PLATFORM.mobile);
  }

  // ── Tunables (logical px inside the 900×600 #wrap) ──────────────────────
  const STICK_BASE = 150;   // joystick base diameter
  const STICK_KNOB = 64;    // knob diameter
  const STICK_TRAV = (STICK_BASE - STICK_KNOB) / 2;   // 43 — knob travel radius
  const STICK_DEAD = 0.20;  // fraction of travel that reads as "centred"

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

  /* ── Left: movement joystick ─────────────────────────────────────── */
  /* The hit area is deliberately larger than the art. A thumb resting at the
     bottom-left of a phone lands wide of centre, and a stick you have to aim
     for is a stick you fight. */
  #tc-stick {
    position: absolute; left: 10px; bottom: 10px;
    width: ${STICK_BASE + 44}px; height: ${STICK_BASE + 44}px;
    pointer-events: auto;
    display: flex; align-items: center; justify-content: center;
  }
  #tc-base {
    position: relative; width: ${STICK_BASE}px; height: ${STICK_BASE}px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 50%, rgba(8,16,32,.62) 0%, rgba(6,12,26,.45) 70%, rgba(6,12,26,.25) 100%);
    border: 2px solid rgba(255,255,255,.26);
    box-shadow: inset 0 3px 14px rgba(0,0,0,.55);
  }
  /* Up / down chevrons, so the axis is legible before you touch it. */
  #tc-base::before, #tc-base::after {
    position: absolute; left: 50%; transform: translateX(-50%);
    font-size: 19px; font-weight: 900; color: rgba(255,255,255,.42); line-height: 1;
  }
  #tc-base::before { content: '▲'; top: 9px; }
  #tc-base::after  { content: '▼'; bottom: 9px; }
  #tc-knob {
    position: absolute; left: 50%; top: 50%;
    width: ${STICK_KNOB}px; height: ${STICK_KNOB}px;
    margin-left: ${-STICK_KNOB / 2}px; margin-top: ${-STICK_KNOB / 2}px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff 0%, #ffd700 45%, #c99700 100%);
    border: 3px solid #0a1a2e;
    box-shadow: 0 3px 12px rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
    /* Springs back to centre on release; follows the finger 1:1 while held. */
    transition: transform .10s ease-out;
  }
  #tc-stick.grab #tc-knob { transition: none; box-shadow: 0 0 0 6px rgba(255,215,0,.22), 0 3px 12px rgba(0,0,0,.55); }
  #tc-knob::after { content: '⇅'; font-size: 27px; font-weight: 900; color: #0a1a2e; line-height: 1; }

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

  /* CHIP genuinely needs the ball, so it dims when there isn't one — the same
     signal the HUD ability cards use. SHOOT is never dimmed: with no ball it
     is still a live action (a plain strike on a loose ball). */
  .tc-btn.gated    { opacity: .38; filter: grayscale(.75); }

  #tc-trap {
    right: 6px; bottom: 8px; width: 110px; height: 110px;
    background: radial-gradient(circle at 34% 28%, #fff 0%, #ffd700 46%, #d1a000 100%);
  }
  #tc-shoot {
    right: 118px; bottom: 62px; width: 86px; height: 86px;
    background: radial-gradient(circle at 34% 28%, #ffe9e9 0%, #ff5f5f 46%, #b62222 100%);
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5);
  }
  #tc-chip {
    right: 30px; bottom: 128px; width: 78px; height: 78px;
    background: radial-gradient(circle at 34% 28%, #e9f3ff 0%, #59a5ff 46%, #1e5fb4 100%);
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.5);
  }
  /* Charge fill climbs the SHOOT button while it is held. */
  #tc-shoot-fill {
    position: absolute; left: 0; right: 0; bottom: 0; height: 0%;
    background: linear-gradient(to top, rgba(255,255,255,.85), rgba(255,255,255,.35));
    pointer-events: none;
  }
  #tc-shoot .tc-lbl, #tc-shoot .tc-sub { position: relative; z-index: 1; }

  /* Tutorial coach-mark glow, mirrored from the HUD cards onto the buttons. */
  .tc-btn.tc-glow { animation: tcGlow .85s ease-in-out infinite alternate; }
  @keyframes tcGlow {
    from { box-shadow: 0 0 0 0 rgba(255,215,0,.85), 0 4px 14px rgba(0,0,0,.5); }
    to   { box-shadow: 0 0 0 12px rgba(255,215,0,0), 0 4px 14px rgba(0,0,0,.5); }
  }
  #tc-stick.tc-glow #tc-knob { animation: tcGlow .85s ease-in-out infinite alternate; }
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
    <div id="tc-stick">
      <div id="tc-base"><div id="tc-knob"></div></div>
    </div>
    <div id="tc-actions">
      <div class="tc-btn" id="tc-chip">
        <span class="tc-lbl">CHIP</span><span class="tc-sub">lob it over</span>
      </div>
      <div class="tc-btn" id="tc-shoot">
        <div id="tc-shoot-fill"></div>
        <span class="tc-lbl">SHOOT</span><span class="tc-sub">hold = power</span>
      </div>
      <div class="tc-btn" id="tc-trap">
        <span class="tc-lbl">TRAP</span><span class="tc-sub">catch the ball</span>
      </div>
    </div>`;
  host.appendChild(root);

  const elStick = root.querySelector('#tc-stick');
  const elBase  = root.querySelector('#tc-base');
  const elKnob  = root.querySelector('#tc-knob');
  const elTrap  = root.querySelector('#tc-trap');
  const elShoot = root.querySelector('#tc-shoot');
  const elChip  = root.querySelector('#tc-chip');
  const elFill  = root.querySelector('#tc-shoot-fill');

  // ═════════════════════════════════════════════════════════════════════════
  //  GAME BRIDGE  — every write the keyboard/mouse handlers would have made
  // ═════════════════════════════════════════════════════════════════════════

  const tut      = () => (window.TUTORIAL && window.TUTORIAL.active ? window.TUTORIAL : null);
  const okMove   = () => { const t = tut(); return !t || t.allowMove(); };
  const okKick   = () => { const t = tut(); return !t || t.allowKick(); };
  const allows   = (what) => (typeof _tutAllows === 'function' ? _tutAllows(what) : true);
  const canShoot = () => (typeof _canShoot === 'function' ? _canShoot() : false);

  /** True when the game is in a state where a fresh strike is meaningful. */
  function liveNoBall() {
    return !!(GAME.running && !GAME.paused && !GAME.heldBy
              && !GAME.countdownActive && !GAME.goalSeq);
  }

  /** Press or release the equivalent of W / S. Drives BOTH input paths. */
  function setMove(up, down) {
    if (!okMove()) { up = down = false; }
    KEYS['w'] = up;   KEYS['s'] = down;               // rod movement, via KEY_P1
    GAME.myInput.up = up; GAME.myInput.down = down;   // aim direction while holding
    // The tutorial's rod drill counts real direction presses, and demands both
    // W and S per rep so spamming one way cannot satisfy it.
    const t = tut();
    if (t) { if (up) t._kW = true; if (down) t._kS = true; }
  }

  /**
   * TRAP — the Space keydown branch, exactly.
   * Arms a grab for ~1s and nothing else. Deliberately a no-op while the ball
   * is already latched, matching the keyboard: the ball leaves the grip only
   * via a shot or the hold timer.
   */
  function pressTrap() {
    if (!okKick()) return;
    KEYS[' '] = true;
    GAME.myInput.kick = true;
    if (!GAME.running) return;
    if (!GAME.heldBy) GAME._holdBufferP1 = GAME.GRAB_ARM_FRAMES;
    GAME._tutSpaceT = performance.now();   // tutorial: proves the press was the player's
  }
  function releaseTrap() {
    KEYS[' '] = false;
    GAME.myInput.kick = false;
  }

  /**
   * SHOOT press — the left-mousedown branch, which means two different things
   * depending on whether the ball is in the grip:
   *   ball held  → begin charging a ground shot (release fires it)
   *   no ball    → buffer a powered strike on a loose ball, because a tap
   *                almost never lands on the exact frame the ball touches a
   *                figure. This is the ONLY way to kick without trapping, and
   *                the old touch layer had no equivalent at all.
   */
  function pressShoot() {
    if (!allows('charge')) return false;
    if (canShoot()) {
      GAME._chargeActive = true;
      GAME._chargeFrames = 0;
      return true;
    }
    if (liveNoBall()) {
      GAME._kickBufferP1 = GAME.KICK_BUFFER_FRAMES;
      return true;
    }
    return false;
  }
  function releaseShoot() {
    if (!GAME._chargeActive) return;
    GAME._releaseGroundShot(GAME._chargeFrames / GAME.CHARGE_MAX_FRAMES);
  }

  /** CHIP — the right-mousedown branch. Genuinely requires the ball. */
  // -Infinity, not 0: `now - 0 < 4000` is true for the first four seconds after
  // load, so a zero start would swallow the one hint that matters most — the
  // player's very first tap on a button they don't understand yet.
  let _chipHintT = -Infinity;
  function pressChip() {
    if (canShoot()) {
      if (!allows('loft')) return;
      GAME._releaseLoftedShot();
      return;
    }
    // A dimmed button that does nothing when tapped teaches nothing. Say why —
    // rate-limited so it coaches instead of nagging. The game's own
    // _hintNeedBall() is not reused because its wording names a keyboard key.
    if (!GAME.running || GAME.paused || GAME.countdownActive || GAME.goalSeq) return;
    if (tut()) return;                       // the tutorial does its own teaching
    const now = performance.now();
    if (now - _chipHintT < 4000) return;
    _chipHintT = now;
    try { APP.toast('Trap the ball first — tap TRAP as it arrives', 1800); } catch (e) {}
  }

  /** Drop every input we might be holding (screen change, pause, blur). */
  function releaseAll() {
    setMove(false, false);
    releaseTrap();
    if (GAME._chargeActive) { GAME._chargeActive = false; GAME._chargeFrames = 0; }
    stick.id = null; stick.dy = 0;
    elStick.classList.remove('grab');
    elKnob.style.transform = '';
    for (const b of [elTrap, elShoot, elChip]) b.classList.remove('press');
    touches.clear();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  TOUCH ROUTER
  //  Tracked per touch identifier so the left thumb can drive the stick while
  //  the right thumb works the buttons at the same time.
  // ═════════════════════════════════════════════════════════════════════════
  const touches = new Map();                  // identifier -> { kind }
  const stick   = { id: null, y0: 0, dy: 0 }; // dy in logical px, already clamped

  /**
   * Convert a screen-space drag into logical #wrap px. #wrap is CSS-scaled to
   * fit the device, so a raw clientY delta is in the wrong unit — measuring the
   * base's real box gives us the scale factor for free, and keeps working when
   * the player rotates the phone mid-drag.
   */
  function toLogical(dyScreen) {
    const r = elBase.getBoundingClientRect();
    const scale = (r.height || STICK_BASE) / STICK_BASE;
    return dyScreen / (scale || 1);
  }

  function hitKind(target) {
    if (elStick.contains(target)) return 'stick';
    if (elTrap.contains(target))  return 'trap';
    if (elShoot.contains(target)) return 'shoot';
    if (elChip.contains(target))  return 'chip';
    return null;
  }

  function onStart(ev) {
    if (!visible()) return;
    for (const t of ev.changedTouches) {
      const kind = hitKind(t.target);
      if (!kind) continue;
      ev.preventDefault();

      if (kind === 'stick') {
        if (stick.id !== null) continue;        // one finger owns the stick
        stick.id = t.identifier;
        stick.y0 = t.clientY;
        stick.dy = 0;
        elStick.classList.add('grab');
        elKnob.style.transform = 'translateY(0px)';
      } else if (kind === 'trap') {
        pressTrap();
        elTrap.classList.add('press');
      } else if (kind === 'shoot') {
        pressShoot();
        elShoot.classList.add('press');
      } else if (kind === 'chip') {
        pressChip();
        elChip.classList.add('press');
      }
      touches.set(t.identifier, { kind });
    }
  }

  function onMove(ev) {
    for (const t of ev.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec || rec.kind !== 'stick') continue;
      ev.preventDefault();
      const d = toLogical(t.clientY - stick.y0);
      stick.dy = Math.max(-STICK_TRAV, Math.min(STICK_TRAV, d));
      elKnob.style.transform = 'translateY(' + stick.dy.toFixed(1) + 'px)';
    }
  }

  function onEnd(ev) {
    for (const t of ev.changedTouches) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      touches.delete(t.identifier);

      if (rec.kind === 'stick') {
        if (stick.id === t.identifier) {
          stick.id = null;
          stick.dy = 0;                       // springs back to centre → rod stops
          elStick.classList.remove('grab');
          elKnob.style.transform = 'translateY(0px)';
        }
      } else if (rec.kind === 'trap') {
        releaseTrap();
        elTrap.classList.remove('press');
      } else if (rec.kind === 'shoot') {
        releaseShoot();
        elShoot.classList.remove('press');
      } else if (rec.kind === 'chip') {
        elChip.classList.remove('press');
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
  //  Runs on its own RAF so the game loop is untouched. All it does is set the
  //  same flags a keyboard would, then update the widget visuals.
  // ═════════════════════════════════════════════════════════════════════════
  function visible() {
    if (!wanted()) return false;
    const s = document.getElementById('screen-game');
    return !!(GAME && GAME.running && !GAME.paused && s && s.classList.contains('active'));
  }

  let wasVisible = false;

  function frame() {
    const vis = visible();
    if (vis !== wasVisible) {
      root.classList.toggle('on', vis);
      document.documentElement.classList.toggle('touch-ui', wanted());
      if (!vis) releaseAll();
      wasVisible = vis;
    }

    if (vis) {
      // ── stick → W / S ──
      // Binary, because CFG.ROD_SPD is fixed: the game has no notion of a
      // half-speed rod, so an analog magnitude would be a lie.
      const dead = STICK_TRAV * STICK_DEAD;
      if (stick.id === null || Math.abs(stick.dy) < dead) setMove(false, false);
      else if (stick.dy < 0)                              setMove(true, false);   // up
      else                                                setMove(false, true);   // down

      // ── widget visuals ──
      elFill.style.height = GAME._chargeActive
        ? Math.min(100, (GAME._chargeFrames / GAME.CHARGE_MAX_FRAMES) * 100) + '%'
        : '0%';

      // Only CHIP is gated. SHOOT always does something, so dimming it would
      // be a lie about the loose-ball strike.
      const held = !!(GAME.heldBy && GAME.heldBy.team === GAME.myRole);
      elChip.classList.toggle('gated', !held);

      syncTutorialGlow();
    }
    requestAnimationFrame(frame);
  }

  // ── Mirror the tutorial's coach-mark glow onto the touch buttons ─────────
  // The tutorial adds .tut-glow to the HUD ability cards; on a phone the player
  // is looking at these buttons instead, so the highlight has to travel with
  // them or the coach-mark points at nothing.
  //
  // There is no 'pass-ability-card' entry any more — passing was removed from
  // the game, the card no longer exists, and the old mapping was aiming the
  // TRAP glow at a null element on every frame.
  const GLOW_MAP = [
    ['hold-ability-card',   elTrap],
    ['charge-ability-card', elShoot],
    ['loft-ability-card',   elChip],
  ];
  function syncTutorialGlow() {
    for (const [id, el] of GLOW_MAP) {
      const card = document.getElementById(id);
      el.classList.toggle('tc-glow', !!(card && card.classList.contains('tut-glow')));
    }
    // The move drill highlights no HUD card at all, so key the stick off the
    // current step instead. TUTORIAL exposes allowMove/allowKick/allows but no
    // accessor for the step id, so read the step object directly and stay
    // defensive about its shape rather than assuming an API that isn't there.
    const t = tut();
    let step = null;
    try { const s = t && t.steps && t.steps[t.i]; step = s ? s.id : null; } catch (e) {}
    elStick.classList.toggle('tc-glow', step === 'move');
  }

  requestAnimationFrame(frame);

  // Expose a little state for debugging from the console / adb logcat.
  window.TOUCH = {
    get dy()      { return stick.dy; },
    get p1Off()   { return GAME.p1Off; },
    get touches() { return [...touches.entries()]; },
    press: {
      trap: pressTrap, untrap: releaseTrap,
      shoot: pressShoot, unshoot: releaseShoot,
      chip: pressChip,
    },
    setMove,
  };

  console.log('[touch] on-screen controls mounted' + (FORCED ? ' (forced via ?touch=1)' : ''));
})();
