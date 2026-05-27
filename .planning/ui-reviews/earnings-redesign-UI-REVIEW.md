# Phase 1 — UI Review: Earnings Screen Redesign

**Audited:** 2026-05-27
**Baseline:** `earnings-redesign-UI-SPEC.md` (design contract)
**Screenshots:** Not captured (Flutter mobile app — no web dev server; code-only audit)
**Target File:** `apps/driver/lib/screens/earnings_screen.dart` (815 lines, rewritten)
**Supporting Files:** `app_theme.dart`, `common_widgets.dart`, `mock_data.dart`, `app_models.dart`

---

## Pillar Scores (1-10 scale)

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 6/10 | Most CTA copy matches spec, but zero empty/error state implementation |
| 2. Visuals | 7/10 | AppCard migration complete for 5/7 sections, but dark mode only 33% covered |
| 3. Color | 8/10 | 35+ tokens used correctly; 9 hardcoded `Colors.white` calls (acceptable on gradient) but opacity values not tokenized |
| 4. Typography | 7/10 | No direct GoogleFonts calls (excellent), but `fontSize: 9` override below spec minimum, missing `titleMedium` usage |
| 5. Spacing | 7/10 | 8-point scale mostly followed; 3 violations (6px x3, 2px x1), no 32px section gaps |
| 6. Experience Design | 3/10 | **BLOCKER**: Loading/Error/Empty states absent, bar chart overflow fix is broken, pull-to-refresh missing, minimal animations |

**Overall: 38/60 (63.3%) — FLAG with BLOCKER items**

---

## Top 3 Priority Fixes

1. **BLOCKER: Bar chart LayoutBuilder overflows (lines 311-388)** — LayoutBuilder is placed in an unconstrained Column context where `constraints.maxHeight` resolves to `double.infinity`. This causes `barHeight` to compute as `infinity` per bar, overflowing the 120px SizedBox wrapper. **Fix:** Wrap LayoutBuilder in a `SizedBox(height: 120)` so constraints are finite, then calculate bar heights as `(item.amount / maxAmount) * 80` (available chart height after overhead).

2. **BLOCKER: Zero state management — no loading/error/empty states anywhere** — Spec requires 4-state coverage (Loading/Loaded/Error/Empty) for all 7 sections. Current implementation has exactly 1 state: loaded with hardcoded mock data. No `FutureBuilder`, no shimmer/skeleton, no error card with retry, no empty-state illustration. **Fix:** Wrap each data-dependent section in a state-handling pattern (e.g., `EarningsState` enum + `when()` builder, or individual `FutureBuilder` per section).

3. **WARNING: Dark mode only handled in 1 of 7 sections** — Only the Savings Comparison card (lines 514, 530, 570) has `isDark` brightness checks. Hero card, chart card, breakdown, milestones, and pending payments all use `TruxifyColors.cardBackground` (resolves to white always) — fine in light mode but the `AppCard` default color `TruxifyColors.cardBackground` doesn't adapt to dark mode. **Fix:** Use `Theme.of(context).cardTheme.color` or pass section-appropriate dark-aware colors. For `Colors.white.withValues(alpha: 0.x)` in the hero card, replace with `TruxifyColors.accent.withValues(alpha: 0.x)`.

---

## Detailed Findings

### Pillar 1: Copywriting (6/10)

**What's correct:**
- Screen title "Earnings" — matches spec (line 76)
- Period labels "Today" / "This Week" / "This Month" — matches spec (lines 106, 116, 126)
- "TOTAL EARNED" — uppercase with letter-spacing, matches spec (line 200-205)
- "₹6,600 more to reach your ₹25,000 goal" — matches spec template (line 237)
- "Your week at a glance" / chart hint — matches spec (lines 301, 306)
- "Where your money comes from" — matches spec (line 424)
- "You vs broker system" — matches spec (line 520)
- "WITH TRUXIFY" / "You keep 100%" — matches spec (lines 539, 555)
- "OLD BROKER SYSTEM" / "You'd lose ₹5,520" — matches spec (lines 579, 596)
- "Saved ₹5,520 this week by going broker-free" — matches spec but **MISSING emoji** ({emoji} token in spec line 198)

**What's missing (WARNING):**
- **Empty state copy**: Spec line 201 defines "No earnings data yet. Complete your first trip to see your earnings." — NOT IMPLEMENTED
- **Error state copy**: Spec line 202 defines "Couldn't load earnings. Pull to refresh or try again." — NOT IMPLEMENTED
- **Loading state**: Spec line 203 describes shimmer animation with no text — NOT IMPLEMENTED
- **Savings callout emoji**: Spec requires an emoji (probably 🎉 or 💪) at end of "Saved ₹5,520 this week by going broker-free" — text present but emoji absent (line 611)

### Pillar 2: Visuals (7/10)

**What works well:**
- 5 of 7 sections now use `AppCard` from `common_widgets.dart` (lines 296, 419, 515, 626, 734) — major improvement over original manual Container+BoxDecoration
- Hero card correctly uses custom gradient Container (justified exception per spec §3.4)
- LayoutBuilder for chart area (line 311) — correct architectural intent, but implementation is wrong (see Pillar 6)
- TabBar replaces manual GestureDetector pills (line 90-131) — proper Material component
- `Expanded` widgets used for stat row (lines 246-258) and comparison columns (lines 526, 566)
- Dark mode awareness partially exists in Savings card via `isDark` check (lines 514, 530, 570)

**Issues (WARNING):**
- **Visual hierarchy is flat**: AppCard uses `elevation: 0` by default (line 16 in common_widgets.dart). No card shadow or depth between sections — spec P6 flagged this as a problem and it remains unfixed.
- **Tab background not responsive**: TabBar is wrapped in a plain Container with hardcoded color (line 88-89). No `MediaQuery` check for safe areas or notch. Could clash on devices with cutouts.
- **StatRow separators**: Lines 247-256 use raw `Container(width: 1, height: 28)` dividers — could use shared `Separator` widget from `common_widgets.dart` (line 340-347) for consistency.
- **Divider in milestones**: Lines 644, 654 use raw `Divider(color: TruxifyColors.border, height: 1)` — inconsistent with theme's `dividerTheme` which uses `TruxifyColors.subtleBorder` (app_theme.dart line 91).
- **Pending item avatar**: Line 762-777 builds a custom circular Container for initials. Could use a shared avatar pattern for consistency with the rest of the app.

### Pillar 3: Color (8/10)

**Token compliance:**
- `TruxifyColors.accent` (#8B1A1A) — used for bar chart colors, amounts, CTAs ✅
- `TruxifyColors.accentDark` (#6B0F0F) — used for selected bar, hero gradient ✅
- `TruxifyColors.accentLight` (#FDEAEA) — used for chart detail badge, comparison Truxify column, milestone icon bg ✅
- `TruxifyColors.secondaryBackground` (#F0E8E8) — used for broker comparison column (dark mode variant) ✅
- `TruxifyColors.hintText` (#999999) — used for hints, subtitles ✅
- `TruxifyColors.border` (#EDE4E4) — used for divider lines, progress backgrounds ✅
- `TruxifyColors.success` (#2E7D32) — used for checkmarks, breakdown multi-customer ✅
- `TruxifyColors.warning` (#D4620A) — used for breakdown short-haul bar ✅
- `TruxifyColors.warningLight` (#FFF3E8) — used for star icon bg ✅
- `TruxifyColors.errorRed` (#E53935) — used for broker "You'd lose" text ✅
- `TruxifyColors.subtleBorder` (#F0E8E8) — used for in-progress milestone icon bg ✅

**60/30/10 analysis:**
- Dominant (60%): `cardBackground` / `background` — correctly used via AppCard and Scaffold
- Secondary (30%): `accentLight`, `secondaryBackground` — correct coverage
- Accent (10%): `accent` — used only on declared elements ✅ — no accent overuse

**Issues (WARNING):**
- **9 calls to `Colors.white`** (lines 202, 211, 221, 229, 239, 250, 256, 273, 281):
  - Lines 202, 211, 239, 250, 256, 273, 281 — on hero gradient card: acceptable (white text on dark maroon gradient meets WCAG AA)
  - **Line 221**: `Colors.white.withValues(alpha: 0.2)` for goal progress background → spec says use `TruxifyColors.accent.withOpacity(0.2)` (or `.withValues`)
  - **Line 229**: `Colors.white` for goal progress fill → acceptable (white fill on dark bg), but could use `TruxifyColors.accentLight` for consistency
- **Hardcoded gradient colors**: Hero card gradient uses `TruxifyColors.accent` and `TruxifyColors.accentDark` (lines 183-185) — correct tokens ✅
- **Dark mode gap**: `TruxifyColors.cardBackground` returns `Color(0xFFFFFFFF)` always — does NOT adapt to dark mode. `AppCard`'s default color is `TruxifyColors.cardBackground` (common_widgets.dart line 13). In dark mode, this stays white, creating a visual disconnect against `darkBackground` (#121212).

### Pillar 4: Typography (7/10)

**Theme usage:**
- `displaySmall` — hero amount "₹18,400" (line 210) ✅
- `titleLarge` — comparison amounts (lines 548, 588) ✅
- `titleSmall` — section headers "Your week at a glance", "Where your money comes from", etc. ✅
- `bodyMedium` — breakdown labels, customer names ✅
- `labelMedium` — tab labels, detail badge, pending amount, savings callout ✅
- `labelSmall` — captions, hints, stat labels, day labels ✅

**Spec compliance matrix:**

| Spec Level | Size/Weight | Actual Style | Match |
|------------|-------------|--------------|-------|
| Hero/Display | 38px Bold | `displaySmall` (~36px Bold) | Close ✅ |
| Title Large | 20px Bold | `titleLarge` (~22px) | Close ✅ |
| Title | 16px SemiBold | `titleSmall` (14px SemiBold) | **NOTE: using 14px instead of 16px** |
| Title Small | 14px SemiBold | `titleSmall` (14px SemiBold) | ✅ |
| Body | 13px Regular | `bodyMedium` (~14px Regular) | Close ✅ |
| Body Small | 12px Medium | *Not used* | ❌ Missing usage |
| Caption | 10-11px Regular | `labelSmall` (~11px) | ✅ |

**Issues (WARNING):**
- **Line 340**: `fontSize: 9` — hardcoded override below spec minimum of 10px. This is the compact amount label above chart bars. Too small for readability. Should use spec's Caption (10-11px) or Body Small (12px).
- **Line 377**: `fontSize: 10` — hardcoded override for day labels. Should use `labelSmall` style directly without fontSize override.
- **Section headers use `titleSmall` (14px) instead of spec's Title (16px SemiBold)**: The spec defines section header as 16px SemiBold (`titleMedium`), but code uses `titleSmall` (14px) with `FontWeight.bold` (line 302, 425, 521, 632, 743). This reduces hierarchy distinction between headers and body text.
- **No `titleMedium` usage**: The theme's 16px SemiBold style is not used anywhere in this file.

### Pillar 5: Spacing (7/10)

**8-point scale compliance:**

| Token | Value | Expected | Actual Usage | Match |
|-------|-------|----------|--------------|-------|
| spacing-xxs | 4px | Between icon and label | Used 8x ✅ | ✅ |
| spacing-xs | 8px | Between related elements | Used 5x ✅ | ✅ |
| spacing-sm | 12px | Between compact elements | Used 10x ✅ | ✅ |
| spacing-md | 16px | Card padding, section gaps | Used 12x ✅ | ✅ |
| spacing-lg | 20px | Hero card inner padding | Used 2x ✅ | ✅ |
| spacing-xl | 24px | Bottom section margins | Used 1x ✅ | ✅ |
| spacing-2xl | 32px | Between major page sections | **Used 0x ❌** | ❌ |

**Violations (WARNING):**
1. **Lines 105, 115, 125**: `SizedBox(width: 6)` between Tab icon and label — off 8-point scale. Should be 8px (spacing-xs).
2. **Line 712**: `SizedBox(height: 2)` between milestone title and subtitle — off 8-point scale. Should be 4px (spacing-xxs).
3. **No spacing-2xl (32px) between sections**: Spec line 100 requires 32px between major page sections, but all section gaps use 16px (`SizedBox(height: 16)` in lines 143-163). Seven sections but all use the same gap — no differentiation between intra-section and inter-section spacing.

**Spacing pattern analysis:**
- Outer padding: `EdgeInsets.fromLTRB(16, 16, 16, 24)` — 16px sides, 24px bottom (line 137) ✅
- Hero card inner padding: `EdgeInsets.all(20)` (line 180) ✅ spacing-lg
- Comparison column inner padding: `EdgeInsets.all(12)` (lines 528, 568) ✅ spacing-sm
- Milestone row vertical padding: `EdgeInsets.symmetric(vertical: 12)` (line 689) ✅ spacing-sm

### Pillar 6: Experience Design (3/10) — **BLOCKER**

#### States Coverage: FAIL

| State | Spec Requirement | Implementation | Verdict |
|-------|-----------------|----------------|---------|
| **Loading** | Shimmer placeholders for each section ($3.5) | **NONE** — data loads synchronously from `const` mock data | ❌ |
| **Loaded** | Real data with staggered fade-in animation | Static rendering only — no animations on initial load | ⚠️ Partial |
| **Error** | Error icon + message + retry button ($3.5) | **NONE** — no try/catch, no `FutureBuilder`, no error widget | ❌ |
| **Empty** | "No data yet" illustration per section ($3.5) | **NONE** — hardcoded data always present | ❌ |

#### Critical Bug: Bar Chart Overflow Fix Is Broken

**File:** `earnings_screen.dart`, lines 311-388

The LayoutBuilder is placed directly inside a `Column` (via `AppCard > Column`). In Flutter, a Column provides **infinite** maxHeight to its children along the main axis.

```
LayoutBuilder(                                       // parent = Column → maxHeight = INFINITY
  builder: (context, constraints) {
    final double availableBarHeight =                // = (INF - overhead).clamp(20, INF) = INF
        (constraints.maxHeight - overhead).clamp(20, constraints.maxHeight);
    final double barHeight =                         // = (item.amount / safeMax) * INF = INF
        (item.amount.toDouble() / safeMax) * availableBarHeight;
    return SizedBox(
      height: 120,                                   // ← this SizedBox only constrains the Row, not the bar heights
      child: Row(
        children: [Expanded(child: Column(
          children: [
            // ...
            AnimatedContainer(height: barHeight),    // height = INF → OVERFLOW
```

**Root cause:** `constraints.maxHeight` = `double.infinity` in this context, so `availableBarHeight` and `barHeight` both evaluate to infinity. The `SizedBox(height: 120)` does NOT constrain the `LayoutBuilder` — it's the *return value*. This regresses the original P1 issue.

**Fix:** Wrap LayoutBuilder in `SizedBox(height: 120)` and remove the duplicate SizedBox inside:
```dart
SizedBox(
  height: 120,
  child: LayoutBuilder(
    builder: (context, constraints) {
      const double overhead = 12 + 4 + 6 + 20;
      final double availableBarHeight =
          (constraints.maxHeight - overhead).clamp(20, constraints.maxHeight);
      final double safeMax = maxAmount > 0 ? maxAmount : 1;
      return Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(...),
      );
    },
  ),
)
```

#### Interaction Coverage

| Interaction | Spec Requirement | Implementation | Verdict |
|-------------|-----------------|----------------|---------|
| Period tabs | Tap changes data (not just visual) | TabController + setState (lines 22-26) but data is hardcoded `weeklyEarnings` — visual-only change | ⚠️ |
| Bar chart bars | Selection animation: 2px taller, darkest accent, cross-fade badge | `AnimatedContainer` (300ms easeInOut) ✅ but no height-taller animation, no cross-fade on detail badge | ⚠️ |
| Pending payments | InkWell ripple, navigate to trip detail | No onTap handler, no InkWell | ❌ |
| Milestone "View" | InkWell ripple, navigate to achievements | No onTap handler, no InkWell | ❌ |
| Pull-to-refresh | System default behavior | **Not implemented** (`RefreshIndicator` missing from spec layout §4.1) | ❌ |

#### Animations

| Animation | Spec | Status |
|-----------|------|--------|
| Bar selection (300ms easeInOut) | ✅ Spec'd | ✅ Implemented (line 355-369) |
| Hero count-up (800ms easeOutCubic) | ✅ Spec'd | ❌ Missing |
| Goal progress fill (600ms easeOutSine) | ✅ Spec'd | ❌ Missing |
| Section fade-in (400ms stagger) | ✅ Spec'd | ❌ Missing |
| Detail badge cross-fade (200ms) | ✅ Spec'd | ❌ Missing — static Text widget |

#### Accessibility

| Requirement | Spec | Implementation | Verdict |
|-------------|------|----------------|---------|
| Touch targets ≥ 44x44px | ✅ | Tab items have icon+text (likely ≥44px) ✅. Bar chart bars are 24px wide — **below 44px** ❌ | ❌ |
| Color contrast WCAG AA | ✅ | Hero: white on maroon ✅. Chart: selected state uses shape+color | ⚠️ Partial |
| Font scaling (TextScaler) | ✅ | Material 3 default ✅ | ✅ |
| Semantic labels on bar chart | ✅ | **NONE** — no `Semantics` widget, no `semanticsLabel` on bars | ❌ |
| Reduced motion respect | ✅ | **NONE** — no `MediaQuery.disableAnimations` check wrapping `AnimatedContainer` | ❌ |
| Tooltips | — | Only 1 tooltip: "Filter period" (line 81) | ⚠️ |

---

## Files Audited

| File | Lines | Role |
|------|-------|------|
| `apps/driver/lib/screens/earnings_screen.dart` | 815 | Primary target — rewritten earnings screen |
| `apps/driver/lib/theme/app_theme.dart` | 335 | TruxifyColors (35+ tokens) + TruxifyTheme (DM Sans, Material 3) |
| `apps/driver/lib/widgets/common_widgets.dart` | 579 | AppCard, SectionHeader, StatCard, ChipScroller, InfoRow, etc. |
| `apps/driver/lib/data/mock_data.dart` | 609 | Mock data providers (weeklyEarnings, pendingPayments) |
| `apps/driver/lib/models/app_models.dart` | 370 | EarningDay, PendingPayment, Milestone data models |
| `apps/driver/lib/.ui-spec/earnings-redesign-UI-SPEC.md` | 398 | Design contract for the redesign |
| `apps/driver/lib/screens/trips_screen.dart` | (reference) | Pattern reference for state management patterns |

---

## Summary

| Category | Count |
|----------|-------|
| BLOCKER findings | 3 (bar chart overflow, zero state mgmt, dark mode gap) |
| WARNING findings | 10+ (missing emoji, fontSize:9, 6px spacing, no 32px gaps, no semantic labels, flat hierarchy, etc.) |
| MINOR recommendations | 4 (Separator reuse, Divider theme, pending avatar, stat font sizes) |

**Verdict: FLAG** — The structural refactoring (AppCard migration, TabBar, theme text styles) is a meaningful improvement over the original, but three BLOCKER-level issues (broken chart overflow fix, complete absence of loading/error/empty states, and missing dark mode adaptation) prevent this from shipping. The chart overflow is particularly critical — the `LayoutBuilder` fix is non-functional and regresses to the original P1 behavior.
