// ═══════════════════════════════════════════════════════════════════════════
//  platform.js — Android / touch platform layer
// ═══════════════════════════════════════════════════════════════════════════
//
//  Loaded as a plain <script> AFTER the game's inline script, and injected only
//  into the Android build by tools/build-www.mjs. index.html is never edited for
//  the port, so the CrazyGames build and the Android build stay byte-identical
//  at the source level and nothing here can regress the web version.
//
//  It shares the inline script's global lexical scope, so it can reference GAME,
//  AUDIO, applyViewport and _shouldFill by bare name.
//
//  Responsibilities:
//    1. Publish window.PLATFORM so other modules can branch on it.
//    2. Make the game fill the screen (the web build's fill test is iframe-based
//       and would leave a phone showing a small letterboxed card).
//    3. Unlock audio, which Android blocks until the first real user gesture.
//    4. Kill browser touch behaviours that ruin a game: pull-to-refresh,
//       double-tap zoom, long-press menus, text selection, tap highlights.
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
    mobile : MOBILE,
    touch  : hasTouch || FORCED,
    forced : FORCED,
  };

  if (!MOBILE) return;
  document.documentElement.classList.add('mobile-ui');

  // ── 1. Fill the screen ──────────────────────────────────────────────────
  // The web build decides fit-vs-fill with `_isFS() || _inFrame`. On Android we
  // are neither: Capacitor serves the page as a top-level document, and nothing
  // ever calls requestFullscreen because the native activity is already
  // immersive. So the untouched logic would take the windowed branch and draw a
  // 900x600 card with margins in the middle of the phone screen.
  //
  // _shouldFill is a top-level function declaration, which in a classic script
  // means it lives as a property of the global object — so reassigning it here
  // genuinely changes what the bare `_shouldFill()` call inside applyViewport
  // resolves to. That lets us fix the behaviour without touching index.html.
  if (typeof _shouldFill === 'function') {
    window._shouldFill = function () { return true; };
  }

  function refit() {
    try { if (typeof applyViewport === 'function') applyViewport(); } catch (e) {}
  }
  refit();

  // Android fires resize and orientationchange at slightly different moments and
  // the reported viewport is briefly stale, so re-fit a couple of times after.
  window.addEventListener('orientationchange', () => {
    refit(); setTimeout(refit, 120); setTimeout(refit, 400);
  });
  window.addEventListener('resize', refit);
  // Returning from the background can restore the system bars; MainActivity
  // re-hides them, which changes the viewport again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(refit, 150); });

  // ── 2. Audio unlock ─────────────────────────────────────────────────────
  // Android blocks both the WebAudio context and <audio> playback until the
  // document has user activation. The game starts menu music before the player
  // has touched anything, so that first attempt is refused and the game is
  // silent for the whole session. Retry once, on the first real gesture.
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
  for (const ev of ['pointerdown', 'touchend', 'click']) {
    window.addEventListener(ev, unlockAudio, { once: true, passive: true, capture: true });
  }
  // Android also suspends the context when the app is backgrounded.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioUnlocked) { try { AUDIO.resume && AUDIO.resume(); } catch (e) {} }
  });

  // ── 3. Browser touch behaviours that ruin a game ────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  html.mobile-ui, html.mobile-ui body {
    /* No pull-to-refresh, no rubber-band scroll, no double-tap zoom. */
    touch-action: none;
    overscroll-behavior: none;
    overflow: hidden;
    /* No blue flash on tap, no long-press callout, no text selection. */
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    /* The desktop build paints a custom cursor; there is no cursor on a phone. */
    cursor: none;
  }
  html.mobile-ui * { -webkit-tap-highlight-color: transparent; }
  /* Hover styles latch on after a tap on touch devices and leave buttons stuck
     in their hover state, so neutralise the transform-based ones. */
  html.mobile-ui button:hover, html.mobile-ui .btn:hover,
  html.mobile-ui [onclick]:hover, html.mobile-ui .ac-btn:hover { transform: none; }
  `;
  document.head.appendChild(css);

  // Belt and braces: block gestures the CSS above cannot reach.
  document.addEventListener('gesturestart',  e => e.preventDefault());   // iOS-style pinch zoom
  document.addEventListener('contextmenu',   e => e.preventDefault());   // long-press menu
  document.addEventListener('dblclick',      e => e.preventDefault());   // double-tap zoom
  // A second touch point starting outside our controls would otherwise be able
  // to trigger zoom on some Android WebView builds.
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  console.log('[platform] mobile layer active', window.PLATFORM);
})();
