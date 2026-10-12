# World Cup: Babyfoot Edition — Tutorial Plan

A plan for teaching a brand-new player how the game works, in under ~90 seconds, without getting in the way of players who already know it.

---

## 1. Why we need it

A new player currently lands in a live match against the bot with a dense controls panel in the corner. Foosball looks familiar, but the game has depth that isn't obvious: a charge shot, a lofted shot, ball-holding, and a limited passing system. If the player doesn't discover these, the game feels shallow and frustrating — which is exactly the kind of first impression that got the game rejected. A short, skippable tutorial fixes that.

**Goal:** by the end, the player understands the objective and can move, shoot, charge, loft, hold, and pass — and knows those systems exist.

---

## 2. What the tutorial must teach (the actual mechanics)

Pulled from the current build so the tutorial matches the game exactly:

| # | Mechanic | Input | Notes to teach |
|---|----------|-------|----------------|
| 1 | **Objective** | — | Score in the opponent's goal, defend yours, most goals before the timer wins. |
| 2 | **Move rods** | `W` / `S` (or `↑` / `↓`) | Slides your rows of players up and down to block and strike. |
| 3 | **Shoot** | Tap `Space` (or Left-click) | A quick kick when a player is near the ball. |
| 4 | **Charge Shot** | Hold Left-click, release | Power builds over ~1.2s (meter fills). Released power scales from 7.5 → 19. The signature "Power Kick". |
| 5 | **Lofted Shot** | Right-click | Arcs the ball over the pitch to clear defenders. |
| 6 | **Hold Ball** | Hold `Space` | Traps/controls the ball. Has a cooldown (shown by the ring on the HUD card). |
| 7 | **Pass** | `Q` (up ▲) / `E` (down ▼) | Moves the ball between your rods. Limited to 3 charges (the pips on the HUD card), then they recharge. |

Everything above already has a HUD indicator (bottom-left controls list, bottom-right ability cards), so the tutorial can point straight at real UI.

---

## 3. Recommended approach — a hybrid

Two complementary pieces, so we get quick value now and depth later:

**A. "How to Play" reference screen** (always available)
A single Persona-styled panel reachable from the **Main Menu** and the **Pause menu**. Shows the control diagram, the ability cards, and one-line tips. Low effort, permanent reference, and it's what returning players want ("what was the loft button again?").

**B. Interactive first-time tutorial** (guided, skippable)
A short, hands-on walkthrough in a calm practice arena that gates each step on the player actually doing the thing. Offered automatically the first time the player launches, and replayable from the "How to Play" screen.

> Recommendation: build **A first** (it's small and immediately useful), then **B**. Both share the same Persona visual language and the same content, so A doubles as the tutorial's reference card.

---

## 4. Interactive tutorial — flow

Runs in a **practice arena**: the bot is passive (won't attack or score), there's no match clock, and the ball can be re-served on command. A dimmed overlay with a text bubble + a highlight "spotlight" on the relevant UI, plus a progress row of dots and a persistent **Skip Tutorial** button.

1. **Welcome / Objective** — "Knock the ball into the blue goal. Keep it out of yours." Camera rests on the pitch; a marker pulses on the target goal. → *Continue*
2. **Move** — "Press **W / S** to slide your players." Highlight the W/S control. → *advances once the player moves the rods a few times.*
3. **Shoot** — Ball is served to a front player. "Tap **Space** to kick." Highlight the Space/tap chip. → *advances on first kick.*
4. **Charge Shot** — "Hold **Left-click** to charge a Power Kick — the longer you hold, the harder it flies. Release to fire." Highlight the charge meter as it fills. → *advances on a release above ~60% charge.*
5. **Lofted Shot** — "**Right-click** to loft the ball over defenders." A dummy defender is placed in the lane. → *advances on a loft (optional / skippable).*
6. **Pass** — "Use **Q** and **E** to pass between your rods." Highlight the Pass card + its charge pips. → *advances after one pass.*
7. **Hold** — "Hold **Space** to trap the ball and set up a shot." Highlight the Hold card + cooldown ring. → *advances after one hold (optional).*
8. **Score to finish** — "Now score to finish training!" → *on goal:* "You're ready — good luck!" with a **Play** button.

Design rules: every step is **skippable**, the whole thing is **skippable**, steps 5 & 7 are marked optional so impatient players can breeze through in ~30s, and nothing blocks input except the final "Continue" gates.

---

## 5. UX / visual design

- **Coach-mark overlay:** dim the screen (~55%), cut a "spotlight" hole (CSS `box-shadow` ring) around the highlighted HUD element, and float a kinetic Persona text bubble (skewed panel, red/gold accents) next to it — matching the UI we just built.
- **Progress:** a row of step dots at the top; **Skip Tutorial** (bordered) and **Next** (gold angled) buttons, same styling as the menu/end buttons.
- **Feedback:** when a step's action is detected, flash the highlighted card gold + a short SFX, then advance — so the player feels the game confirm "yes, that's it."
- **Entry points:** `How to Play` button on the Main Menu; `How to Play` in the Pause menu; auto-offer on first launch ("New here? Quick tutorial? — Yes / Skip").
- **Don't nag:** store a `tutorialDone` flag in `localStorage`; only auto-offer once. Always replayable on demand.

---

## 6. Technical implementation (fits the current codebase)

- **New `TUTORIAL` module** — a small state machine: an ordered `steps[]`, each step `{ text, highlightSelector, optional, setup(), isComplete() }`. A driver advances when `isComplete()` returns true or the player hits Next/Skip.
- **Practice mode flag on `GAME`** — `GAME.practice = true` disables the match timer, disables bot offense (bot idles/defends only), and lets the tutorial re-serve the ball (`GAME.serveBallTo(rod)`).
- **Action detection** — reuse existing input paths: watch `W/S` movement, the kick handler, `_releaseGroundShot(frac)` (charge), `_releaseLoftedShot()` (loft), the `Q/E` pass handlers, and the hold-ball state to satisfy each step. These functions already exist, so hooks are lightweight.
- **Overlay reuse** — build the coach-mark overlay from the existing `.overlay` + Persona classes; add one `#tutorial-overlay` with a text bubble and a highlight ring element positioned over the target via `getBoundingClientRect()`.
- **Fullscreen-safe** — the overlay lives inside `#wrap`, so it scales with the existing `applyViewport()` logic and works in fullscreen (and Esc still pauses, now that that's fixed).
- **Menu/Pause hooks** — add `How to Play` buttons that call `TUTORIAL.startReference()` (screen A) or `TUTORIAL.startInteractive()` (screen B).

No changes to core physics, hitboxes, rod spacing, or goal dimensions — the tutorial only reads game state and serves balls.

---

## 7. Phasing & effort

- **Phase 1 — "How to Play" screen (MVP).** Static Persona panel with the control diagram, ability cards, and tips; wired to Main Menu + Pause. *Small.* Ships immediate value.
- **Phase 2 — Interactive tutorial.** Practice arena + step machine + coach-mark overlay + first-launch offer + `localStorage` flag. *Medium.* The real teaching tool.
- **Phase 3 — Polish.** Per-step SFX/animation, an optional "tips on first real match" nudge, and analytics on where players skip. *Small–medium.*

---

## 8. Considerations / open questions

- **Touch / mobile:** the current scheme is keyboard + mouse. If CrazyGames mobile is a target, the tutorial (and controls) need touch equivalents — worth deciding before Phase 2.
- **Charge vs. tap on one button:** Left-click both taps and charges (hold). The tutorial should make the tap-vs-hold distinction explicit so players don't accidentally always charge.
- **Length:** target ~60–90s for the full run, ~30s if optional steps are skipped.
- **Localization:** keep tutorial copy in a small strings object so it can be translated later.

---

## 9. Acceptance criteria

- A first-time player can, unaided, learn objective + move + shoot + charge + pass within ~90 seconds.
- Tutorial is skippable at any point and replayable from the menu.
- "How to Play" reference is reachable from Main Menu and Pause.
- Auto-offer appears only on first launch; never nags afterward.
- Works in windowed and fullscreen; no impact on normal matches or core gameplay.
