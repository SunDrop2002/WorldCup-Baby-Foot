// ═══════════════════════════════════════════════════════════════════════════
//  platform.js — mobile / touch platform layer
// ═══════════════════════════════════════════════════════════════════════════
//
//  Loaded as a plain <script> AFTER the game's inline script, in BOTH builds:
//  the CrazyGames web build serves this game to phones as well as desktops, and
//  the Android/Capacitor port reuses the same files. It self-disables on a
//  mouse-and-keyboard machine, so a desktop player never sees any of it.
//
//  It shares the inline script's global lexical scope, so it can reference GAME,
//  AUDIO, applyViewport and _shouldFill by bare name.
//
//  Responsibilities:
//    1. Publish window.PLATFORM so other modules can branch on it.
//    2. Make the game fill the screen (the web build's fill test is iframe-based
//       and would leave a phone showing a small letterboxed card).
//    3. Unlock audio, which mobile browsers block until a real user gesture.
//    4. Kill browser touch behaviours that ruin a game: pull-to-refresh,
//       double-tap zoom, long-press menus, text selection, tap highlights.
//    5. Ask the player to rotate to landscape — but ONLY off CrazyGames, which
//       does this itself (see the note above the overlay).
//
//  ── Detection is two-stage, on purpose ─────────────────────────────────
//  matchMedia gives an answer immediately but can be wrong at the edges
//  (touchscreen laptops, desktop-mode requests on tablets). CrazyGames does
//  proper device detection server-side and exposes it through the SDK, and
//  their docs specifically recommend relying on it — but only after SDK.init()
//  resolves, which is well after this file parses. So: decide now with
//  matchMedia, then upgrade if the SDK later disagrees. Everything downstream
//  re-reads window.PLATFORM.mobile per frame rather than caching it at load.
//
//  Debug: ?mobile=1 forces this layer on in a desktop browser, ?mobile=0 off.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Detection ───────────────────────────────────────────────────────────
  const qs       = location.search;
  const FORCED   = /[?&]mobile=1/.test(qs);
  const DISABLED = /[?&]mobile=0/.test(qs);

  const isNative = !!(window.Capacitor &&
                      typeof window.Capacitor.isNativePlatform === 'function' &&
                      window.Capacitor.isNativePlatform());
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  const coarse   = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  const MOBILE = !DISABLED && (FORCED || isNative || (coarse && hasTouch));

  window.PLATFORM = {
    native : isNative,
    android: isNative && !!(window.Capacitor.getPlatform &&
                            window.Capacitor.getPlatform() === 'android'),
    mobile : MOBILE,          // mutable — the SDK may upgrade this (see below)
    touch  : hasTouch || FORCED,
    forced : FORCED,
    onCrazyGames: false,
  };

  // ── Mutable state, declared before the first call that touches it ───────
  // Not down beside the functions that use them, because `let` has a temporal
  // dead zone: applyMobileLayer() is invoked below, earlier in the source than
  // those functions appear, and a `let` further down throws ReferenceError the
  // moment the function assigns to it. Function declarations hoist; their `let`
  // state does not. This bit me twice — once for `applied`, once for `fillMode`.
  let applied  = false;
  let fillMode = 'none';   // 'wrapped' | 'direct' | 'none' — surfaced in ?diag=1
  let lastFill = '';

  // ── Go, before anything optional can fail ───────────────────────────────
  // This call used to sit at the BOTTOM of the file, after the SDK poll. That
  // cost us a whole broken build: reading SDK.environment on an uninitialised
  // SDK throws, the exception escaped this IIFE, and the line below never ran —
  // so a phone got the desktop's letterboxed 900x600 card and no touch layer.
  // The guaranteed work goes first; the SDK is a refinement and is treated as
  // one.
  if (MOBILE) applyMobileLayer();

  // ── Stage two: let the CrazyGames SDK correct us ────────────────────────
  // SDK.environment and SDK.user.systemInfo are plain variables in the v3 SDK,
  // but only meaningful once init() has resolved — which the game's CG.init()
  // does on its own schedule. Poll briefly rather than racing it, and give up
  // quietly: every downstream consumer already works off the matchMedia answer.
  //
  // The entire body is wrapped, not just the property reads. Off-platform the
  // SDK sitelocks itself and turns hostile — throwing on access rather than
  // returning a falsy value — so nothing in here can be assumed safe.
  (function pollSDK(tries) {
    let done = false;
    try {
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      const env = sdk && sdk.environment;
      if (env && env !== 'disabled') {
        done = true;
        window.PLATFORM.onCrazyGames = (env === 'crazygames');
        let info = null;
        try { info = sdk.user && sdk.user.systemInfo; } catch (e) {}
        const type = info && info.device && info.device.type;  // desktop|mobile|tablet
        if (type && !DISABLED) {
          const sdkSaysMobile = (type === 'mobile' || type === 'tablet');
          if (sdkSaysMobile && !window.PLATFORM.mobile) {
            window.PLATFORM.mobile = true;
            applyMobileLayer();             // controls appear on the next frame
            console.log('[platform] SDK upgraded us to mobile:', type);
          } else if (!sdkSaysMobile && !FORCED && !isNative) {
            // A touchscreen desktop or laptop: keep the browser-behaviour fixes
            // we may already have applied, but don't put a joystick on screen.
            window.PLATFORM.mobile = false;
          }
        }
      }
    } catch (e) {
      // Not on CrazyGames, or the SDK isn't ready. Either way matchMedia has
      // already given us a working answer.
      done = true;
    }
    if (!done && tries > 0) setTimeout(() => pollSDK(tries - 1), 250);
  })(24);   // ~6s, comfortably past a normal SDK init

  // ═════════════════════════════════════════════════════════════════════════
  //  MOBILE LAYER  — idempotent, so late detection can turn it on
  //  (`applied` is declared at the top of the IIFE — see the note there.)
  // ═════════════════════════════════════════════════════════════════════════
  function applyMobileLayer() {
    if (applied) return;
    applied = true;
    document.documentElement.classList.add('mobile-ui');

    // ── 1. Fill the screen ────────────────────────────────────────────────
    // The web build decides fit-vs-fill with `_isFS() || _inFrame`. On Android
    // we are neither: Capacitor serves the page as a top-level document, and
    // nothing ever calls requestFullscreen because the native activity is
    // already immersive. So the untouched logic would take the windowed branch
    // and draw a 900x600 card with margins in the middle of the phone screen.
    //
    // Two mechanisms, because the first one is not guaranteed.
    //
    // (a) Reassign _shouldFill. It is a top-level function declaration in a
    //     classic script, so it lives as a property of the global object and
    //     the bare `_shouldFill()` call inside applyViewport resolves to our
    //     replacement. Clean when it works — but it depends on scoping details
    //     of a file we don't own, and it silently no-ops if they ever change.
    //
    // (b) Wrap applyViewport and re-apply the fill geometry ourselves after it
    //     returns. This is the one that actually guarantees the result: it does
    //     not care who called applyViewport or what it decided, and it runs
    //     last. (a) alone left an iPhone showing a letterboxed 900x600 card.
    //
    // The renderer resize inside applyViewport is queued on rAF, so it measures
    // the canvas AFTER our geometry lands — no extra resize needed.
    if (typeof _shouldFill === 'function') {
      window._shouldFill = function () { return true; };
    }
    if (typeof applyViewport === 'function') {
      const _origApplyViewport = applyViewport;
      window.applyViewport = function () {
        let r;
        try { r = _origApplyViewport.apply(this, arguments); } catch (e) {}
        forceFill();
        return r;
      };
      fillMode = 'wrapped';
    } else {
      fillMode = 'direct';   // applyViewport unreachable — we own the layout
    }
    window.PLATFORM.fillMode = fillMode;   // visible to ?diag=1 and to tests
    refit();

    // iOS Safari never fires resize for toolbar show/hide, but visualViewport
    // does. Without this the game keeps the dimensions it had when the URL bar
    // was in a different state.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refit);
      window.visualViewport.addEventListener('scroll', refit);
    }

    // Added-to-Home-Screen is the ONLY way to get true fullscreen on an iPhone:
    // Safari on iOS does not implement the Fullscreen API on phones (iPad only),
    // so the FULL button cannot hide those toolbars. Injecting the meta here
    // rather than editing index.html keeps the web build's source untouched —
    // Safari reads the live DOM when the user adds the page to their Home
    // Screen, so this is just as effective.
    for (const [name, content] of [
      ['apple-mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
      ['mobile-web-app-capable', 'yes'],
    ]) {
      if (document.querySelector('meta[name="' + name + '"]')) continue;
      const m = document.createElement('meta');
      m.name = name; m.content = content;
      document.head.appendChild(m);
    }

    // ── 2. Audio unlock ───────────────────────────────────────────────────
    // Mobile browsers block both the WebAudio context and <audio> playback
    // until the document has user activation. The game starts menu music before
    // the player has touched anything, so that first attempt is refused and the
    // game is silent for the whole session. Retry once, on the first gesture.
    for (const ev of ['pointerdown', 'touchend', 'click']) {
      window.addEventListener(ev, unlockAudio, { once: true, passive: true, capture: true });
    }

    // ── 3. Browser touch behaviours that ruin a game ──────────────────────
    document.head.appendChild(mobileCSS());

    // Belt and braces: block gestures the CSS cannot reach.
    document.addEventListener('gesturestart', e => e.preventDefault());  // iOS pinch zoom
    document.addEventListener('contextmenu',  e => e.preventDefault());  // long-press menu
    document.addEventListener('dblclick',     e => e.preventDefault());  // double-tap zoom
    // A second touch point starting outside our controls would otherwise be
    // able to trigger zoom on some Android WebView builds.
    document.addEventListener('touchmove', e => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // ── 4. Rotate-to-landscape prompt ─────────────────────────────────────
    mountRotateGate();

    console.log('[platform] mobile layer active', window.PLATFORM);
  }

  // ── Viewport refitting ──────────────────────────────────────────────────
  // visualViewport is the only honest measure on iOS: window.innerHeight there
  // can describe a viewport that includes the space under Safari's toolbars,
  // which is space we cannot draw in. Fall back to innerWidth/Height elsewhere.
  function vpW() { const v = window.visualViewport; return Math.round((v && v.width)  || window.innerWidth); }
  function vpH() { const v = window.visualViewport; return Math.round((v && v.height) || window.innerHeight); }

  /**
   * The fill layout, applied directly rather than requested.
   *
   * Mirrors index.html's own fill branch: widen the 600-tall layout box to the
   * viewport's aspect so the 3D reaches edge to edge with no bars and no
   * distortion, never below 900 (the fixed-width UI would overflow), then scale
   * by whichever axis runs out first.
   */
  function forceFill() {
    const wrap = document.getElementById('wrap');
    if (!wrap) return;
    const vw = vpW(), vh = vpH();
    if (vw < 2 || vh < 2) return;

    const logicalW = Math.max(900, Math.round(600 * (vw / vh)));
    const scale    = Math.min(vh / 600, vw / logicalW);

    wrap.classList.add('fs');
    wrap.style.width     = logicalW + 'px';
    wrap.style.transform = 'scale(' + scale + ')';

    const cv = document.getElementById('gameCanvas');
    if (cv) { cv.style.width = '100%'; cv.style.height = '100%'; }

    lastFill = vw + 'x' + vh + ' -> ' + logicalW + '@' + scale.toFixed(3);
  }

  function refit() {
    let ran = false;
    try { if (typeof applyViewport === 'function') { applyViewport(); ran = true; } } catch (e) {}
    // If applyViewport is unreachable (or threw) we still own the layout.
    if (!ran && applied) forceFill();
  }
  // Mobile browsers fire resize and orientationchange at slightly different
  // moments and the reported viewport is briefly stale, so re-fit a few times
  // after. Bound unconditionally: harmless on desktop, and it has to be live
  // even if the mobile layer is applied late.
  window.addEventListener('orientationchange', () => {
    refit(); setTimeout(refit, 120); setTimeout(refit, 400);
  });
  window.addEventListener('resize', refit);
  // Returning from the background can restore the system bars; MainActivity
  // re-hides them, which changes the viewport again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(refit, 150); });

  // ── Audio ───────────────────────────────────────────────────────────────
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      if (typeof AUDIO !== 'undefined') {
        if (AUDIO.init)   AUDIO.init();
        if (AUDIO.resume) AUDIO.resume();
        // Restart whichever track should be playing for the current screen.
        const onGame = document.getElementById('screen-game');
        if (onGame && onGame.classList.contains('active')) {
          if (AUDIO.playMusic) AUDIO.playMusic();
        } else if (AUDIO.playMenuMusic) {
          AUDIO.playMenuMusic();
        }
      }
    } catch (e) {}
  }
  // Backgrounding suspends the context on Android, and on iOS puts it into an
  // 'interrupted' state that only a real gesture can leave — which is why this
  // touchend listener is permanent rather than {once:true}. Mirrors the fix
  // CrazyGames documents for iOS audio interruption.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioUnlocked) { try { AUDIO.resume && AUDIO.resume(); } catch (e) {} }
  });
  window.addEventListener('touchend', () => {
    if (!audioUnlocked) return;
    try { AUDIO.resume && AUDIO.resume(); } catch (e) {}
  }, { passive: true });

  // ── CSS ─────────────────────────────────────────────────────────────────
  function mobileCSS() {
    const css = document.createElement('style');
    css.textContent = `
    html.mobile-ui, html.mobile-ui body {
      /* The base stylesheet says min-height:100vh. On a phone browser 100vh is
         the LARGE viewport — it measures as if the URL bar were hidden, which
         it isn't — so the body ends up taller than the screen and the centred
         900x600 card is pushed half off the bottom. dvh tracks the viewport
         that actually exists. vh first as the fallback for older WebViews. */
      height: 100vh;
      height: 100dvh;
      min-height: 0;
      /* No pull-to-refresh, no rubber-band scroll, no double-tap zoom. */
      touch-action: none;
      overscroll-behavior: none;
      overflow: hidden;
      /* No blue flash on tap, no long-press callout, no text selection. */
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      /* The desktop build paints a custom cursor; there is no cursor on a phone. */
      cursor: none;
    }
    html.mobile-ui * { -webkit-tap-highlight-color: transparent; }
    /* Hover styles latch on after a tap on touch devices and leave buttons stuck
       in their hover state, so neutralise the transform-based ones. */
    html.mobile-ui button:hover, html.mobile-ui .btn:hover,
    html.mobile-ui [onclick]:hover, html.mobile-ui .ac-btn:hover { transform: none; }

    /* ── Rotate gate ── */
    #rotate-gate {
      position: fixed; inset: 0; z-index: 99999;
      display: none;
      align-items: center; justify-content: center;
      flex-direction: column; gap: 22px;
      background: linear-gradient(160deg, #071427 0%, #0d2340 55%, #071427 100%);
      color: #fff; text-align: center;
      font-family: 'Segoe UI', Arial, sans-serif;
      padding: 24px calc(24px + env(safe-area-inset-right)) 24px calc(24px + env(safe-area-inset-left));
    }
    #rotate-gate.show { display: flex; }
    #rotate-gate .rg-phone {
      width: 74px; height: 122px; border-radius: 12px;
      border: 4px solid #ffd700; position: relative;
      animation: rgTurn 2.1s ease-in-out infinite;
    }
    #rotate-gate .rg-phone::after {
      content: ''; position: absolute; left: 50%; bottom: 7px;
      width: 26px; height: 3px; margin-left: -13px; border-radius: 2px;
      background: #ffd700; opacity: .8;
    }
    @keyframes rgTurn {
      0%, 30%  { transform: rotate(0deg); }
      60%,100% { transform: rotate(-90deg); }
    }
    #rotate-gate .rg-title { font-size: 21px; font-weight: 900; letter-spacing: .3px; }
    #rotate-gate .rg-sub   { font-size: 13.5px; font-weight: 600; opacity: .72; max-width: 300px; line-height: 1.5; }
    `;
    return css;
  }

  // ── Rotate gate ─────────────────────────────────────────────────────────
  // CrazyGames handles this for us: you declare the supported orientations in
  // the submission form and their site shows its own rotate prompt, so stacking
  // ours on top would double up. Off-platform though — the Android build, or
  // the game opened directly — nothing asks, and a portrait phone gets a
  // 900x600 landscape pitch squeezed into a tall window. So: mount it, and let
  // the visibility check skip it once we know we're on CrazyGames.
  function mountRotateGate() {
    if (document.getElementById('rotate-gate')) return;
    const el = document.createElement('div');
    el.id = 'rotate-gate';
    el.innerHTML =
      '<div class="rg-phone"></div>' +
      '<div class="rg-title">Rotate your device</div>' +
      '<div class="rg-sub">World Cup Babyfoot is played in landscape. ' +
      'Turn your phone sideways to kick off.</div>';
    document.body.appendChild(el);

    let gated = false;
    function check() {
      const portrait = window.innerHeight > window.innerWidth;
      const show = portrait && window.PLATFORM.mobile && !window.PLATFORM.onCrazyGames;
      if (show === gated) return;
      gated = show;
      el.classList.toggle('show', show);
      if (show) {
        // Freeze play rather than let the match run on behind the overlay.
        // pause(), never stop(): stop() cancels the RAF loop with no way back.
        try { if (GAME.running && !GAME.paused && !GAME.countdownActive) GAME.pause(); } catch (e) {}
      } else {
        refit();
      }
    }
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => { check(); setTimeout(check, 200); });
    // The SDK poll can flip onCrazyGames / mobile after these listeners bind.
    setInterval(check, 1000);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────
  // Append ?diag=1 to print the platform state onto the screen. A phone on the
  // LAN has no console unless you tether it over USB, and "the game looks
  // small" is not enough information to tell a detection failure apart from a
  // viewport failure — this says which.
  if (/[?&]diag=1/.test(qs)) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;background:rgba(0,0,0,.82);' +
                        'color:#0f0;font:11px/1.45 monospace;padding:7px 9px;pointer-events:none;' +
                        'max-width:70vw;white-space:pre;border-bottom-right-radius:8px';
    document.body.appendChild(box);
    setInterval(() => {
      const p = window.PLATFORM;
      let fill = 'n/a';
      try { fill = String(_shouldFill()); } catch (e) { fill = 'threw'; }
      const w = document.getElementById('wrap');
      const vv = window.visualViewport;
      box.textContent =
        'mobile:' + p.mobile + '  touch:' + p.touch + '  native:' + p.native + '\n' +
        'onCrazyGames:' + p.onCrazyGames + '  layerApplied:' + applied + '\n' +
        'shouldFill:' + fill + '  fillMode:' + fillMode +
        '  wrap.fs:' + !!(w && w.classList.contains('fs')) + '\n' +
        'inner:' + window.innerWidth + 'x' + window.innerHeight +
        '  visual:' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : 'n/a') +
        '  dpr:' + (window.devicePixelRatio || 1) + '\n' +
        'fill:' + (lastFill || 'never ran') + '\n' +
        'wrap:' + (w ? w.style.width + ' ' + w.style.transform : 'missing') + '\n' +
        'touch-ui:' + (document.getElementById('touch-ui') ? 'mounted' : 'MISSING');
    }, 400);
  }
})();
