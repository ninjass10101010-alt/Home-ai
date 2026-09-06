# DESIGN.md — Consuela (Home-ai)

<!-- impeccable:design-schema 1 -->

## Dashboard world (established, inherited)

- **Pastel-bento warm glass:** translucent frosted `widget-glass` surfaces on a soft warm gradient; 10-color accent system (`--color-accent-*`) with one selected accent (`--color-accent-selected`); high-contrast toggle supported.
- **Type:** Apple SF Pro stack utilities only. No paid or downloaded fonts.
- **Bento grid:** Home uses `auto-rows-[350px]`; widgets are 1×1 or 2×1 and must never spill their cell (contained scroll or `+N more` footer).
- **Visuals:** CSS/SVG/emoji only — no stock imagery, no icon libraries, no WebGL.
- **Motion:** CSS animations only (no framer-motion); state-driven, never decorative infinite loops; pause when tab hidden; every animation has a `prefers-reduced-motion` fallback.
- **Emoji as iconography:** liberal, lightweight, consistent with family-member emoji avatars.
- **Emergency + dialogs:** the floating emergency shield is locked to `--color-accent-rose` (rose means alarm only — never decoration); the shared `Modal` carries real dialog semantics (`role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, focus-return to the trigger) for every consumer.

## Weather card world — "(Not Boring), Consuela-style" (replacement world, 2026-08-27)

The weather card alone speaks (Not Boring) Weather's interface language, in Consuela's palette. Every other widget stays pastel-bento.

### Grammar
- Huge temperature as the hero object: SF Pro weight 800–900, tight tracking, `tabular-nums`.
- Data-true scene: cloud count/opacity track `cloud_cover`, particle velocity/drift track wind speed/direction, rain density tracks precipitation probability, fog tracks humidity, sun position tracks the real sun arc. No element decorates without data.
- One shared timeline: card day-strip preview and modal scrubber render through the same hour-state path.
- Minimal chrome; details live in dotted-leader rows (`HUMIDITY ··· 62%`) with tracked-uppercase labels and rounded metric pills.
- One accent per state: the skin's accent colors strip, rain ticks, and interactive elements only.

### Palettes
- **Day skins, auto-keyed to season (no user picker):**
  - Spring — pastel lemon + soft lilac
  - Summer — pastel guava (soft coral) + peach
  - Autumn — soft red pastel + warm amber
  - Winter — pastel ice blue + silver white
- **Night — full Not Boring:** near-black `#0A0A0A` base, white numerals, one condition accent (soft red / amber / cyan). Keyed to real `is_day`/sunset from the API, never a fixed clock time.
- Both palettes must hold AA contrast for all text at all times of day.

### Scene system
- Layered SVG/CSS: sky gradient (skin), sun/moon disc riding the sun arc, cloud forms, particle precipitation, fog layer, lightning flash for storm codes.
- Season changes the skin tint, not the illustration. Holiday overlays persist on top.
- Scene changes crossfade; values count up; hard cuts are banned.

### Interaction
- Card: press-and-drag the day strip to preview any hour (scene, temp, condition follow); release animates back to now. Tap elsewhere on the card → modal.
- Modal: 24h scrubber (`role="slider"` with spoken `aria-valuetext`), exploded metric rows, UV 5-dot scale, pressure, sun arc, hourly/daily toggle.
- Missing data hides rows; it never fakes values.

## Ask Consuela chat — "Consuela's kitchen table" (accent unification, 2026-09-04)

The chat surface joins the dashboard's accent system completely; its former fixed-violet identity is retired. Violet survives only as the default value of `--color-accent-selected` — pick another accent in Accent Studio and the whole chat follows.

### Grammar
- **The opening is the family's day, not a mascot screen.** Arrival order: who's speaking → dinner → next up → Consuela's open loops → composer. The orb is a ~72px companion beside the greeting; it swells (140px + ripple rings) only while thinking, then hands off to the thread.
- **Every tap is a draft.** Brief cards, open-loop chips, and suggestion chips fill the composer as editable text; nothing on this surface writes family data in one tap (kid-safety rule).
- **Open loops are real.** The chip row renders the suggestion engine's pending notices (kid-filtered via `visibleSuggestionsForRole`); static category drafts appear only as the empty-state fallback.
- **The thread tells its own story.** Telegram-mirrored messages wear a `via Telegram · {member}` origin label; the active thread keeps a one-line today strip (speaker · dinner · next) above the messages.
- **Zero raw palette literals.** All tints derive from `color-mix(in srgb, var(--color-accent-selected) N%, transparent)` — bubbles (18%/8%), chips (14–16%/5–6%), avatars (30%/15%), glows and ripples likewise. White-on-`--color-accent-button` for user bubbles only (the WCAG-safe white-text token).

### Honesty rules (carried from the polish pass)
- Signed-out chat says so (amber banner, thread-specific copy) — guest AI still answers, and silence would lie about the family thread.
- Empty states are real: "Nothing planned yet" dinner, "Quiet rest of day" events, engine-quiet fallback chips. Never invented data.
- **The orb can speak.** A 44px 🔊 companion beside the today-strip reads the last reply aloud for pre-readers (system voice, stripped of markdown/emoji); error replies are never read; it stops on tap. **The brief is alive** — it re-reads on the family data pulse and counts down to what's next. **Do-it is confirm-gated** — actionable loops carry a separate accent button through the shared PIN flow; the primary tap still drafts.

## Kid mode (wired 2026-09-04)

The kid experience is a mode, not a parallel app: `KidHome` renders behind `mode === "kid"` (any signed-in non-parent) on the same Home route, with kid-specific styling scoped in `src/modes/modes.css` (kid-scoped selectors only — no global overrides). The capsule nav gains a 🎁 Rewards entry (House is swapped out; both modes stay 7 items so the ≥44px-at-390px sizing holds). Quest completion runs through the shared PIN flow (`verifyPinRemote` — server-side verification, PINs never client-side), rewards redeem through `RewardsShop` with the same >100pts parent-approval gate as the Tasks page, and the celebration fires only after a real, confirmed success.

## Calendar truth + honest failures (wired 2026-09-04)

- **Google events wear their calendar's color.** Every synced event carries its owning calendar's Google `colorRgb` (`colorHex` from `src/lib/calendar/google-mapping.ts`) on rows and month dots — cyan is the fallback, never a guess. Color is data, not decoration.
- **A PIN failure says which kind it is.** The shared seam `verifyPinRemote` (`src/modes/kid/kid-store.ts`) returns `ok | wrongPin | unreachable`; every gate (kid quest, redeem, parent approval, all seven Tasks gates) distinguishes "Couldn't reach Consuela" from "Wrong PIN" and clears the input on both paths. Offline is never blamed on the user.
- **The calendar-member roster is live-primed.** `src/lib/calendar-member-snapshot.ts` primes its cached snapshot at subscribe time, so events that fired while a surface was unmounted are recovered, not lost. Contract for any future surface using it: subscribe → prime → re-read on dispatch, and pass the CLIENT snapshot as `useSyncExternalStore` arg 2 (the deterministic server fallback is arg 3 — swapping them silently pins the UI to placeholders forever).
