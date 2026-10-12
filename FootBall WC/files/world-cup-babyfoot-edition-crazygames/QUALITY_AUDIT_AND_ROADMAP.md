# World Cup: Babyfoot Edition — Quality Audit & Production Roadmap

Prepared after a full read of the codebase (single `index.html`, 2,727 lines, self-contained — no separate JS/asset modules besides `three.min.js`, 5 mp3s, and 47 flag PNGs in `worldcup countries/`).

## How the game actually works today

Two rendering systems sit side by side, and that split matters for everything below:

The menu, team-select, HUD chrome, and all overlays (goal, pause, match-end, countdown) are plain DOM/CSS, styled with gradients and emoji glyphs (⚽🏆🇧🇷⭐). The 2D `trailCanvas` layer draws the ball trail, hold/charge/pass indicators — all Canvas2D vector work, well executed.

The match itself renders through real Three.js WebGL (aliased as `T`) onto `gameCanvas`: a `PerspectiveCamera` at `(0, 4.6, 3.2)` looking at `(0, 0, -0.4)`, ACES filmic tone mapping, sRGB output, PCF soft shadows, a procedural PMREM environment map for reflections, and three-point lighting (warm key with shadows, cool fill, rim). That pipeline is genuinely solid — better than most jam-quality Three.js games. Every visible object, though, is hand-built from primitives at runtime: `BoxGeometry`/`CylinderGeometry`/`SphereGeometry`/`CapsuleGeometry` stacked into a table, rods, goals, and player figures. There are no imported models, no GLB/GLTF loader anywhere in the file, and no environment beyond a gradient sky dome and a green floor plane — the table floats in empty space.

This is the key finding: **the engineering (lighting, tone mapping, shadows, IBL, visual feedback systems) is already commercial-grade. The asset fidelity is not.** That mismatch — polished renderer, primitive-built content — is very likely what "does not meet expectations" was pointing at. A reviewer sees blocky peg-people and a floating table before they ever notice the good tone mapping.

## What's already good — do not break this

The physics/input feel (rod offsets, charged shots, lofted shots, hold/pass ability system with cooldown UI) is layered and clearly play-tested. The lighting rig, shadow setup, and color pipeline are correct PBR practice. The bot AI, kit auto-selection (contrast-based, avoids same-color kit clashes), and per-team color data for 47 nations are all solid systems work. None of this needs touching — the brief is right to fence off controls, physics, ball speed, hitboxes, rod spacing, goal dimensions, and camera angle, and the roadmap below never touches `CFG`, `ROD_DEFS_2V2`, `P` (pitch layout), or camera position/lookAt.

## Issues, ranked by severity

**Critical — almost certainly why it was rejected**

1. No environment. The table sits in a gradient void with a floor disc; no stadium, stands, crowd, or advertising boards. Nothing tells the player "this is a place." This is the single biggest gap between what exists and what CrazyGames' bar for "commercial HTML5 game" looks like.
2. Player figures are abstract primitive stacks — a capsule torso, cylinder shorts, sphere head, a hair blob — with flat team-color materials and no jersey graphics, numbers, or facial features beyond two eye dots. From the game's own camera distance they read as generic pegs, not footballers.
3. Goal nets are `LineSegments` wireframe, not a net mesh. It's a reasonable cost-saving trick from far away but reads as a placeholder up close, and nets are one of the first things a reviewer's eye goes to on a goal replay.
4. The only "trophy" and in-scene national flags are emoji in 2D overlays — there's no 3D trophy asset and no flags/banners in the 3D scene itself, despite the brief calling both out as expected props.

**High**

5. Table, rods, and goal frames are flat-colored `MeshStandardMaterial` with only two procedural canvas textures in the whole scene (a wood-grain gradient and a grass tint). No wear, no team branding on the table apron/skirt, no scuffs — everything reads slightly too clean/plastic for a "played-in" arcade table.
6. UI has no illustrated identity: no logo mark, no custom icon set, no display typeface — it's system fonts (`Segoe UI, Arial`) plus emoji for every icon (🏆⚽🇧🇷⭐✋). Emoji render differently per OS/browser (Windows vs. Mac vs. mobile show completely different glyph art for the same character), which is a red flag for platform reviewers specifically because it looks unfinished/inconsistent by definition.
7. Flag treatment is inconsistent: the team-select grid and HUD swap in real PNG flags once a team is picked, but default/placeholder states show emoji flags (🇧🇷/🇩🇪). Mixed vector-emoji-and-raster-photo flags next to each other reads as unpolished.
8. Ball is a flat white sphere with a handful of tiny black spheres scattered on it for "panels" — from a distance it reads as a golf ball, not a football, because there's no actual pentagon/hexagon panel geometry or texture.

**Medium**

9. SFX for kicks, wall hits, and the whistle are procedural sine-wave tones (`AUDIO.tone()`), not sampled sounds — recognizable "beep" placeholder-audio character despite the mp3 assets already covering music/whistle/applause/countdown. No crowd ambience bed plays during a live match, so the pitch feels silent under the sparse tones.
10. No post-processing beyond tone mapping — no bloom, vignette, or grain/color-grade pass. Given the lighting is already correct, a light post pass would be a very cheap, very high-impact addition.
11. The menu tagline says "32 Nations" but the roster (`TEAMS` array) actually has 47 entries — a small but visible content-accuracy bug a reviewer could hit in under 10 seconds.

**Low**

12. No LOD or instancing for the ~22 player figures (fine today at this poly count; would matter if crowd geometry is added later — worth building crowd as instanced/billboarded from the start).
13. Two stacked canvases (WebGL + 2D overlay) with no offscreen/worker split — not currently a bottleneck, but worth re-checking after adding any environment geometry.

## Production roadmap

The scope in the brief (every visual asset, in Blender, wired back into the code) is realistically several sequential build passes, not one. Proposed order, closest-to-camera and highest-impact first:

**Phase 1 — Hero gameplay assets.** Ball (proper panel geometry + seams), player figures (jersey with number, shorts, boots, face, hair, per team-color material slots that the existing recoloring code can still drive), rods + handles, table body/apron with real wood PBR texture, goal frame + a real net mesh (low-poly quad net, not lines). These sit inches from the camera every second of play — biggest perceived-quality return per hour of work.

**Phase 2 — Environment & atmosphere.** A stadium shell around the table (stand geometry, roof line), a crowd (billboarded/instanced impostors, not simulated individuals — keeps performance safe), stadium floodlights as actual fixtures (not just directional lights with no visible source), advertising boards around the pitch edge, replacing the flat gradient sky with a proper stadium backdrop.

**Phase 3 — Meta/UI presentation.** A real logo mark and icon set to replace emoji throughout menu/HUD/overlays, a 3D trophy render for the end screen, fixing the flag inconsistency (real PNGs everywhere, no emoji fallback state visible to the player), a display typeface for headers.

**Phase 4 — Polish pass.** Bloom/vignette/color-grade post-processing, replacing sine-tone SFX with sampled kick/whistle/crowd-cheer audio and adding a crowd ambience bed, small idle/celebration animation beats for figures, then a cross-device performance and visual QA pass (the roster/tagline mismatch from item 11 gets fixed here too).

Each asset follows the same loop: build in Blender at the exact in-game scale (table/rod/goal dimensions are read directly from `CFG`/`ROD_DEFS_2V2`/goal H×W in the code, not guessed), unwrap and bake PBR textures, export GLB, load via `GLTFLoader` (currently absent from the project — this is a new dependency to add alongside `three.min.js`), swap the corresponding `_build*()` method in `RENDERER` to load the model instead of constructing primitives, re-point the existing team-recolor logic at the new mesh's material slots so kit-switching keeps working, and verify in-browser before moving to the next asset.

---

## Implementation log

### Pipeline note (GLB → local data files)
The project's `three.min.js` is the deprecated global/UMD build, and Three r160 only ships `GLTFLoader` as an ES module — so a standard GLB import was not a clean fit, and the ES-module files could not be self-hosted this session (CDN fetch limits + sandbox unavailable). Instead the assets ship as **dependency-free local `.js` data files** (`models/*.model.js`), each assigning `window.MODEL_XXXX` a plain `{position, normal, color}` array authored in Blender. A new `RENDERER._geoFromModel()` helper turns these into real `THREE.BufferGeometry`. This keeps the game 100% self-contained (no third-party scripts — CrazyGames-compliant), needs no build step, and every swap has a graceful fallback to the original primitive if a file fails to load.

### Phase 1 — Hero gameplay assets (done)
- **Ball** → `models/ball.model.js`: real truncated-icosahedron (12 pentagons + 20 hexagons), flat-shaded panel colours baked as vertex colours. Replaces the sphere-with-dots. `_buildBall`.
- **Player figure** → `models/player.model.js`: sculpted footballer split by material slot (jersey+sleeves / shorts / skin / hair / boots). The existing per-frame team recolour still drives `bodyMat`/`capMat`/`srtMat`; pivot, foot height and rod-socket axis preserved exactly. `_buildRods`.
- **Rod handles** → `models/handle.model.js`: ergonomic ridged grip with rounded end cap (rod itself stays a perfect cylinder — Blender can't improve that). `_buildRods`.
- **Table** → `models/post.model.js`: chrome corner posts added at the four cabinet corners; wood cabinet given a bump map. Goal-mouth geometry left untouched to preserve tuned alignment. `_buildTable`.
- **Goal net** → real alpha-textured net **mesh** panels (procedural diamond-lattice alpha) with a subtly sagging back panel, replacing the `LineSegments` wireframe. `_buildGoals`.

### Phase 2 — Environment & atmosphere (done)
- **Stadium** → `models/stadium.model.js`: tiered oval bowl, ~2,600-spectator packed crowd (colored quads), roof ring and an advertising-board ring at pitch edge — one vertex-coloured mesh (~14k tris). `_buildStadium`.
- **Floodlights**: four corner pylons with emissive lamp banks (presentational, no extra shadow lights). `_buildFloodlights`.
- Backdrop is now the stadium itself; the gradient sky fills above it.

### Phase 3 — Meta / UI presentation (done)
- **3D trophy** rendered to `models/trophy.png` (transparent) — replaces the 🏆 emoji on the loading, menu and end screens (OS-consistent, no more per-platform emoji art).
- **Ball icon** rendered to `models/ball_icon.png` — replaces the ⚽ emoji on the menu.
- **Flag consistency**: emoji-flag defaults/fallbacks in the team preview and HUD swapped for the real PNG flags (only the intentional "opponent not chosen yet" placeholder remains a glyph).
- **Content fix**: menu tagline corrected from "32 Nations" to "47 Nations".

### Phase 4 — Polish (partial)
- **Cinematic vignette** overlay added over the pitch (cheap post-process substitute; real bloom/EffectComposer needs the ES-module build that couldn't be self-hosted this session).
- **Deferred (blocked by assets/toolchain, not code):** sampled kick/whistle SFX and a crowd-ambience bed (no sound samples available to author — Blender can't produce audio; the procedural sine tones remain), and EffectComposer bloom (needs the ES-module Three build).

### Player redesign (reference-matched)
The figure was rebuilt in Blender to match a supplied premium foosball-figure reference: large rounded jersey torso, **cylindrical rod bore through the shoulders** (dark recessed disk + body-colour boss rim), V-neck collar, chest badge, chest securing-pin hole, white shorts band, a **one-piece skin lower body into a team-colour base block**, and a molded head with a simple stylized face (eyes, eyebrows, nose, mouth) and dark swept-back hair. Kept low-poly for HTML5 (~2.1k tris/figure) and, importantly, the six slot geometries are **built once and shared across all 22 figures** (only jersey/shorts/hair colour vary per figure) so memory and draw cost stay low. **Orientation fixed:** each figure now stands upright and faces horizontally toward the opponent — p1 looks +X, p2 looks −X (mirrored) — so the two teams face each other across the table instead of looking upward; this is team-based so it is correct on every row. Model at `models/player.model.js` (slots body/shorts/skin/hair/dark/badge); `_buildRods` and the fallback path updated accordingly, and the per-frame team recolour still drives the jersey/shorts materials.

### Player revision 2 — readability from the gameplay camera
An in-game screenshot revealed the first redesign read as fat, squat blobs from the steep top-down camera: wide shoulders dominated, the leg was hidden straight down under the torso, and white-kit figures blended into the white rods. Re-tuned specifically for that camera: **much slimmer and taller** torso (shoulder width cut from ~0.38 to ~0.24), and a **single kicking leg angled forward into a dark boot** so the leg reads from above and every figure carries dark anchors (boot, hair, eyes) that stop it blending on any kit. Verified by rendering from the exact in-game camera transform (not just a flattering side angle). Still ~1.7k tris/figure, shared geometry; slot structure unchanged so no code change was needed beyond the new `player.model.js`.

### Player revision 3 — two legs + Nintendo-style character
Fixed the single-leg model (it literally had one kicking leg) and redesigned the figure in a Nintendo Switch Sports / Mii direction for personality: a big rounded head with an expressive cute face (large eyes with white highlights, friendly arched eyebrows, a smile arc, small nose), tidy hair covering the crown, short team-colour sleeves, tucked arm stubs, and **two legs spaced along the rod axis with dark shoes** so both read clearly from the top-down camera. Added a `white` material slot (eye highlights) to the model and the `_buildRods` shared-material set. Two important process fixes were locked in here: (1) all object transforms are baked before export (an earlier build shipped un-baked transforms → huge black blobs), and (2) hair/smile cuts are done after applying transforms so world-space slicing is correct. Every export is now verified by rebuilding a mesh from the shipped arrays and rendering it, not by trusting the Blender scene. ~3.5k tris/figure, shared geometry.

### Team jerseys — pattern + identity
Moved the jersey from a flat single colour to a proper textured kit. The jersey mesh is UV-unwrapped cylindrically (front chest at U=0.5, height = V), exported in the body slot. A per-nation `JERSEY_STYLES` table defines each country's iconic look (solid / vertical stripes / checkerboard / hoops / sash / chest-band, plus a collar+hem trim colour), and `RENDERER._buildJerseyTexture` renders it to a cached canvas texture in the kit's colours. The per-frame recolour now assigns that texture to each figure's jersey material instead of a flat colour (white base so the texture shows true). Away kits render solid so the existing kit-contrast selection still prevents clashes. Verified in Blender with the exported UVs: Argentina's blue/white vertical stripes and Croatia's red/white checkerboard both map cleanly and read from the game camera distance. Textures are built lazily and cached (≈2 per match).

### Lighting rework — kill the washed-out look
The scene was over-bright/washed because a bright procedural IBL environment (sky dome + soft-box cards) flooded every material with ambient, on top of bright fog and a near-white floor. Reworked for contrast and depth: the IBL dome is tinted down (~0.5) and the soft-box cards dimmed, so surfaces get soft reflections without the flat wash (the single biggest fix); tone-mapping exposure pulled to 0.92; ambient dropped (0.14→0.09) and the key raised (2.0→2.55) with fill/rim trimmed, widening the key-to-fill ratio so shadows have depth; fog deepened and pushed back (0x8ea6bb, 30–62) so the pitch isn't hazed; sky deepened to a richer blue and the floor darkened so the vivid pitch pops; turf green enriched with stronger mow stripes; and a light CSS colour-grade (saturate 1.14 / contrast 1.05) on the 3D canvas only (not the UI/indicator layer) for a punchy finish. Values are conservative and easy to nudge after an in-game look.

### Table / field / stadium overhaul (four features)
- **Premium table:** Blender-modeled chrome bolts and L-brackets (shared geometry, instanced along the rails), gold inner edge-banding framing the pitch, and lacquered materials (MeshPhysicalMaterial clearcoat on the red rails + wood) for a varnished cabinet finish. Gameplay dimensions and goal mouths untouched.
- **Living grass:** ~7,000 instanced blades over the pitch driven by a custom shader — wind sway plus a ball-interaction term that bends blades away from the ball as it rolls through (ball position fed as a uniform each frame). Wrapped in try/catch with the flat felt underneath, so a shader failure on any GPU degrades gracefully instead of breaking the game. No fragile tone-map includes (ShaderMaterial doesn't get those uniforms), colours output sRGB-tuned directly.
- **Celebrating crowd:** the crowd was split into its own mesh (`crowd.model.js`) with a per-spectator phase; a MeshStandardMaterial `onBeforeCompile` injection gives constant gentle sway and a big cheer-bounce ramped by `triggerCrowdCheer()`, which fires from the goal event alongside a 150-piece confetti burst that rains over the pitch and the existing applause.
- **Richer background:** a festive bunting/pennant ring over the stands, a jumbotron big-screen at the far end (canvas-textured broadcast graphic), and two flagpoles flying the competing nations' actual flag PNGs (loaded per match, rippling in the breeze).

### Verification (this pass — VM recovered)
The sandbox came back, so beyond the usual Blender previews I ran real checks: the inline game script parses with zero syntax errors (`new Function`); all eight model files parse as valid JS with correct attribute counts (player body UVs match vertex count, crowd phase matches vertex count, all 7 player slots present); every new method is defined once and called consistently; and the entire module scope executes under a stubbed DOM with no reference errors (APP/GAME/RENDERER defined, 47 teams, 47 jersey styles, cheer + grass hooks present). What still needs a real browser is the GPU render itself (shader compile, final look) — that remains the user's spot-check.

### Turf realism + visible packed crowd (from in-game feedback)
- **Turf:** a detailed procedural turf texture now drives the pitch surface (baked mow stripes, soft colour-variation patches, ~42k fine blade streaks, tip highlights, plus a bump map) so the top-down view reads as real dense grass instead of a flat green with dark specks. The 3D blades were recoloured to bright greens and densified to 16k so they blend as a grass carpet and carry the ball ripple, instead of reading as debris.
- **Crowd visible at last:** the root cause was that the stadium sat at radius ~10–18 — entirely outside the close camera's view, so the background was just white. The stadium was rebuilt much closer (inner ~5.4×4.1) and taller, and — crucially — the crowd is now **camera-facing billboards** (baked toward the fixed game camera) so every spectator reads as a person instead of an edge-on sliver. 4,500 bigger, brighter spectators (body + head) now wrap the pitch, framed by a colourful advertising-board ring. Verified by reconstructing the shipped stadium/crowd files in Blender and rendering from the exact game camera. All prop positions (floodlights, jumbotron, flagpoles, bunting) were moved in to match, and the goal cheer-bounce amplitude was more than doubled.

### Turf rebuilt from scratch in Blender (baked texture)
The instanced 3D blades read as scattered pins/flecks from the top-down camera, so they were removed entirely. Instead the turf is now a **Blender bake**: ~90,000 tilted grass blades with green colour variation and baked mow stripes were built on an 8×5 ground and rendered top-down orthographic (flat emission) to a single texture (`models/turf.jpg`, 388 KB). That texture is mapped 1:1 onto the flat pitch plane (no tiling → no seams) with a fine bump for light response. Result: a smooth, dense, cohesive, realistic football surface with near-zero runtime cost (one textured plane vs 16k instanced blades). Verified by rendering the texture on a flat plane from the exact game camera. Note: removing the 3D blades also removes the per-blade ball-ripple; a subtle flat-plane ripple near the ball can be re-added on request without bringing back the pin look.

### Turf rework — deep stadium look + normal-based mow stripes
The baked turf was too light/flat. Rebuilt in Blender from ~95k curved, drooping, tapered blades in blended **dark** greens (forest/olive/desaturated + rare highlight) with large-scale patch variation, baked flat top-down to a rich dark albedo (`models/turf_albedo.jpg`, 348 KB) — no painted stripes. The mow stripes and depth now come from a **tangent-space normal map** (generated in JS): a smooth alternating per-stripe lean plus soft undulation, so the game's key light reflects differently off blades leaning toward vs away from it — the physically-correct way real pitch stripes work, with clean soft transitions and no painted-rectangle look. The pitch material was rebalanced for a premium, non-washed result (roughness 0.92, envMapIntensity 0.4, normalScale 1.15). Verified in Blender by lighting a plane with the albedo + an identical normal map under the game's key-light direction from the game camera: deep rich green with visible light-driven stripes, not overexposed. Runtime cost stays a single textured plane.

### Bugfix — image textures never loaded (crossOrigin)
The pitch came up white and image-file textures were silently failing because Three's `TextureLoader` forces `crossOrigin='anonymous'`, which fails for same-origin `file://` loads (no server to answer the CORS request). This meant the turf and the 3D flagpole flags never actually textured — what looked like "flat light-green" turf was always the material's fallback colour, not the baked image. Replaced those loads with a small `_loadTex` helper that uses a plain `<img>` (no crossOrigin — the same way the working HUD flags load), and gave the pitch a deep-green fallback colour so it can never render white. The baked dark turf albedo + normal-map stripes now actually appear.

### Bugfix — black pitch (over-strong normal map)
After the crossOrigin fix the albedo loaded, but the pitch rendered black: the normal map's stripe lean was far too strong (amp 0.5 + normalScale 1.15), tilting the flat surface's normal ~55° sideways so it caught almost none of the overhead key light. Fixed by making the lean subtle (amp 0.13, normalScale 0.5, nz floored at 0.5) so the surface stays facing up and lit, with gentle light-driven stripes. Also kept the deep-green fallback base colour, so the two failure modes are now both impossible: it can't be white (texture load has a green fallback) and it can't be black (normals stay near-vertical). Verified with a faithful Blender replica of the pitch material + the game's three-point light rig + game camera → a rich dark-green pitch, confirmed not black.

**Testing limitation (important):** this sandbox cannot run a real browser — Puppeteer/Playwright Chromium downloads are network-blocked and the Chrome extension isn't connected — so I cannot screenshot the actual WebGL page. Verification is done via (a) Node syntax/parse of the full inline script, (b) validation of every model file's data, and (c) accurate Blender replicas of materials/lighting/camera. These catch structural and material/lighting bugs but not GPU-specific rendering. The green fallback + subtle normal are deliberate safeguards so the worst realistic case is a plain green pitch, never a broken white/black one.

### Grass — SOLVED (verified live in-browser)
Connected the browser and finally saw the real render, which let me fix the grass properly instead of guessing:
- **Black cause:** the game's ACES tone-mapping crushed the dark albedo. Fix: the pitch material drives an **emissive floor** from the same texture (`emissiveMap`, intensity 0.22) so the grass colour always shows regardless of the tone-mapping, while diffuse (`map`) still receives player shadows. Green diffuse+emissive fallbacks so it can't go white/black.
- **Load cause:** `TextureLoader` forced `crossOrigin='anonymous'` (fails offline/file). Fix: `_loadTex` uses a plain `<img>`.
- **Look:** re-baked the albedo bright→deep emerald (my earlier "dark rich" read was wrong for this bright reference), then added BOLD clean broad mow stripes (sharpened alternating bands, ~1.28×/0.72× contrast). Exposure back to 1.0 for the reference's brightness; rods to metalness 0.98.
Runs via a local server (`python -m http.server`) so the browser extension can read it (also fixes the file:// crossOrigin quirks). No console errors; texture confirmed loading.

### Visual overhaul — live-verified in-browser (Claude in Chrome + local server)
With the browser connected (game served at `http://localhost:8000` so the extension can read it and asset caching behaves), each change below was screenshotted and confirmed live:
- **Grass:** dark natural palette (#2E5D22/#3F6F2C/#557F39) baked at 2K, roughness map, max anisotropy, emissive-floor safety. User-confirmed "perfect."
- **Rods:** env map given a dark ground half + brighter soft-box cards so metal reflects dark-below/bright-above; rod metalness 1.0, roughness 0.14, envMap 3.4 → reads as chrome instead of flat white.
- **Background:** removed the busy bunting; muted + desaturated the crowd via a shader tweak → cleaner, softer, broadcast-style stands.
- **Players:** rebuilt as chunky, well-proportioned toy footballers (moderate head, substantial torso, real legs+shoes, molded face) instead of Mii blobs; re-exported the body with cylindrical UVs so team jersey patterns map again (Argentina stripes etc.); warmer skin + slight sheen on shoes/dark parts. Numbers intentionally skipped (shared jersey texture would put the same number on every figure — per-figure numbers available on request).

Cache note: `Ctrl+Shift+R` (hard reload) is needed to pick up changed model/texture files during iteration.

### Verification status
All edits were validated by close code review with safe fallbacks, and every asset was verified visually in Blender before export. The game itself was **not** run in a browser this session because both runtime paths were unavailable (sandbox VM down; Chrome extension not connected). Recommended next step: open `index.html`, and if anything looks off, capture the browser console — every asset swap is isolated and reversible via its fallback.
