# UI-SPEC: Earnings Screen Redesign

**Phase:** Driver App - Earnings Enhancement
**Status:** draft
**Design System:** Flutter Material Design 3 + Truxify Custom Theme
**Tech Stack:** Flutter 3.x, Dart SDK >=3.3.0, Google Fonts DM Sans
**Target:** `apps/driver/lib/screens/earnings_screen.dart`
**Date:** 2026-05-27

---

## 1. Design Contract Summary

| Category | Value | Source |
|----------|-------|--------|
| Framework | Flutter (no shadcn — not applicable) | `pubspec.yaml` |
| Theme | Material Design 3 with `TruxifyTheme` | `app_theme.dart` |
| Colors | `TruxifyColors` — 35+ semantic colors | `app_theme.dart` |
| Typography | DM Sans — 4 sizes, 2 weights | Google Fonts |
| Spacing | 8-point scale (4, 8, 12, 16, 20, 24, 32) | Existing patterns |
| Shared Widgets | AppCard, SectionHeader, StatCard, ChipScroller, etc. | `common_widgets.dart` |
| Data | Static mock data (`weeklyEarnings`, `pendingPayments`) | `mock_data.dart` |
| Shell | Bottom nav tab (Index 2 in `ShellScreen`) | `shell_screen.dart` |

---

## 2. Current State Analysis

### 2.1 Current Architecture (earnings_screen.dart — 862 lines)

```
SafeArea > Scaffold
  ├── Top Bar (white bg, "Earnings" title)
  ├── 1px border separator
  └── SingleChildScrollView > Column
       ├── Period Selector (Today / This Week / This Month) — pill-style Row
       ├── Hero Total Card — gradient, goal progress, 3 stat columns
       ├── Earnings Story Card — 7-day bar chart, tap-to-select, detail badge
       ├── Breakdown Card — 3 rows with progress bars
       ├── Savings Comparison Card — two-column with Truxify vs Broker
       ├── Milestones Card — 3 rows with icons
       └── Pending Payments Card — list with initials avatars
```

### 2.2 Identified UI Problems

| # | Problem | Severity | Location |
|---|---------|----------|----------|
| P1 | **Bar chart bottom overflow** — fixed 80px max height, no overflow handling | CRITICAL | Lines 275-347 |
| P2 | **Not responsive** — hardcoded bar widths (24px), fixed padding | HIGH | Every card section |
| P3 | **Manual card styling** — each section builds its own Container with BoxDecoration instead of reusing `AppCard` | MEDIUM | Lines 100-716 |
| P4 | **Inconsistent spacing** — mix of margin/padding values (16, 20, 24, 12, 14) with no system | MEDIUM | Every card |
| P5 | **No loading/error/empty states** — hardcoded mock data, no state management | HIGH | Entire file |
| P6 | **Flat visual hierarchy** — no elevation, shadows, or depth between cards | MEDIUM | All cards |
| P7 | **Typography inconsistency** — manual GoogleFonts.dmSans calls instead of theme | MEDIUM | All text |
| P8 | **Period selector not data-driven** — Today/Week/Month tabs only change visual state, no data switching | LOW | Lines 67-97 |
| P9 | **No dark mode optimization** — hardcoded white backgrounds, no `TruxifyColors.dark*` usage | MEDIUM | All cards |
| P10 | **Hardcoded earnings data** — ₹18,400, ₹25,000 goal, breakdown percentages all static | MEDIUM | Lines 125, 154, 396-418 |

### 2.3 Existing Design Assets

The project already has a solid design foundation that the Earnings screen isn't fully leveraging:

**Available shared widgets** (`common_widgets.dart`):
- `AppCard` — reusable card with border, border-radius, optional onTap
- `SectionHeader` — title + optional subtitle + trailing widget
- `StatCard` — label + value pair with optional icon
- `ChipScroller` — horizontal chip filter bar (use for period selector)
- `StatusPill` — colored pill badge
- `InfoRow` — label/value row
- `SectionLabel` — section label with letter-spacing
- `Separator` — 1px vertical line divider
- `LivePulseDot` — animated pulsing dot for live indicators
- `PrimaryButton` — full-width accent button

**Existing theme tokens** (`app_theme.dart`):
- `TruxifyColors.accent` (#8B1A1A), `accentDark`, `accentLight`, `accentVeryLight`
- `TruxifyColors.primaryText`, `secondaryText`, `tertiaryText`, `hintText`
- `TruxifyColors.background`, `cardBackground`, `secondaryBackground`
- `TruxifyColors.success`, `warning`, `error`, `errorRed`
- `TruxifyColors.border`, `subtleBorder`, `strongBorder`
- Dark mode equivalents: `darkBackground`, `darkCardBackground`, `darkPrimaryText`, etc.

---

## 3. Design Contract

### 3.1 Spacing

Use the **8-point scale** consistent with the existing pattern:

| Token | Value | Usage |
|-------|-------|-------|
| `spacing-xxs` | 4px | Between icon and label |
| `spacing-xs` | 8px | Between related elements, bar chart gaps |
| `spacing-sm` | 12px | Between compact elements, progress bar margins |
| `spacing-md` | 16px | Card padding, section gaps (same as existing) |
| `spacing-lg` | 20px | Hero card inner padding |
| `spacing-xl` | 24px | Bottom section margins, large gaps |
| `spacing-2xl` | 32px | Between major page sections |

**Exception**: Icon-only touch targets use 44px minimum (accessibility).

### 3.2 Typography

Use DM Sans via `GoogleFonts.dmSans` — consistent with the rest of the app. **Do NOT call GoogleFonts.dmSans manually.** Use `Theme.of(context).textTheme` with the DM Sans text theme already applied in `TruxifyTheme`.

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Hero/Display | 38px | Bold (700) | 1.1 | Total earned amount |
| Title Large | 20px | Bold (700) | 1.2 | Card titles, milestone numbers |
| Title | 16px | SemiBold (600) | 1.3 | Section headers, "Earnings" title |
| Title Small | 14px | SemiBold (600) | 1.3 | Card subtitles, bar chart labels |
| Body | 13px | Regular (400) | 1.5 | Breakdown labels, pending payment rows |
| Body Small | 12px | Medium (500) | 1.4 | Pills, badges, footnotes |
| Caption | 10-11px | Regular (400) | 1.4 | Stat labels, percentage text, "TOTAL EARNED" label |

### 3.3 Color Contract

Follow the **60/30/10 rule** using the existing TruxifyColors palette:

| Role | Color | Token | Coverage |
|------|-------|-------|----------|
| **Dominant (60%)** | #F7F3F3 / #FFFFFF | `background` / `cardBackground` | Page background, cards |
| **Secondary (30%)** | #F0E8E8 / #FFF5F5 | `secondaryBackground` / `accentLight` | Dividers, subtle highlights, stat backgrounds |
| **Accent (10%)** | #8B1A1A | `accent` | Primary CTAs, selected states, key numbers, gradient hero card |
| **Destructive** | #E53935 | `errorRed` | Lost savings display (Broker comparison) |
| **Success** | #2E7D32 | `success` | Checkmarks, savings callout, completed milestones |
| **Warning** | #D4620A | `warning` | In-progress milestones, breakdown bar for short haul |

**Accent is reserved for:**
- Selected period pill (Today/This Week/This Month)
- Hero card gradient start
- Selected bar in chart
- Earnings amounts and key numbers
- CTA text and interactive elements
- Progress indicator fill
- "With Truxify" comparison column
- Pending payment amounts

### 3.4 Component Inventory

Map existing shared components to Earnings screen sections:

| Current Section | Recommended Replacement | Reason |
|----------------|------------------------|--------|
| Top Bar | `AppBarTheme` from `TruxifyTheme` | Already configured, no need for custom Container |
| Period Selector | `ChipScroller` from `common_widgets.dart` | Already exists, matches the pill pattern |
| Hero Total Card | Custom widget (not in common) | Unique gradient + stats layout |
| Earnings Story Card | Custom chart widget | Bar chart + interaction is unique |
| Breakdown Card | `AppCard` + custom rows | AppCard for wrapper, custom for progress bars |
| Savings Comparison Card | `AppCard` + custom two-column | AppCard for wrapper, comparison columns custom |
| Milestones Card | `AppCard` + `InfoRow` pattern | AppCard wrapper, reuse milestone row pattern |
| Pending Payments Card | `AppCard` + custom list | AppCard wrapper, list items custom |

**New components to create** (extract for reuse):
1. `EarningsChart` — the 7-day bar chart as a standalone widget
2. `EarningsPeriodSelector` — the Today/Week/Month pill switcher
3. `StatTrio` — Trips / Avg/trip / Hours row (used in hero card and potentially elsewhere)
4. `ProgressBreakdownRow` — label + progress bar + amount + percentage (reused in Breakdown)

### 3.5 States & Interactions

Every section must handle 3 states:

| State | What to Show |
|-------|-------------|
| **Loading** | Shimmer placeholders matching card dimensions |
| **Loaded** | Real data with animations (staggered fade-in, chart draw animation) |
| **Error** | Card with error icon + message + retry button, uses `TruxifyColors.error` |
| **Empty** | Card with illustration + "No data yet" message |

**Specific interaction contracts:**

| Element | Interaction | Visual Feedback |
|---------|-------------|-----------------|
| Period pill tabs | Tap | Selected: filled accent bg, white text. Unselected: white bg, border, hint text |
| Bar chart bars | Tap | Selection animation: bar grows 2px taller, shifts to darkest accent. Previously selected animates back. Detail badge updates with cross-fade |
| Pending payment items | Tap | Navigate to trip detail (future) — InkWell ripple |
| Milestone "View" | Tap | Navigate to achievements (future) — InkWell ripple |
| Savings comparison | None (static) | — |
| Goal progress | None (static) | Animated bar fill on load |

### 3.6 Copywriting Contract

| Element | Copy | Notes |
|---------|------|-------|
| Screen title | "Earnings" | From existing |
| Period labels | "Today" / "This Week" / "This Month" | From existing |
| Hero label | "TOTAL EARNED" | Uppercase, letter-spaced |
| Hero goal | "₹{X} more to reach your ₹{Y} goal" | Dynamic template |
| Chart header | "Your week at a glance" | From existing |
| Chart hint | "Tap any bar to see that day's details" | From existing |
| Breakdown header | "Where your money comes from" | From existing |
| Comparison header | "You vs broker system" | From existing |
| Comparison truxify | "WITH TRUXIFY" → "You keep 100%" | From existing |
| Comparison broker | "OLD BROKER SYSTEM" → "You'd lose ₹{X}" | Dynamic template |
| Savings callout | "Saved ₹{X} this week by going broker-free {emoji}" | Dynamic template |
| Milestones header | "Milestones" | From existing |
| Pending header | "Pending" | From existing |
| **Empty state** | "No earnings data yet. Complete your first trip to see your earnings." | NEW — for empty period |
| **Error state** | "Couldn't load earnings. Pull to refresh or try again." | NEW — for error condition |
| **Loading** | Shimmer animation | NEW — no text needed |

**Destructive actions:** None in this phase. Pending payments are view-only.

---

## 4. Layout Architecture (Redesign)

### 4.1 Screen Blueprint

```
SafeArea > Scaffold
  └── Column
       ├── AppBar (via theme — "Earnings")
       └── Expanded > RefreshIndicator > SingleChildScrollView
            └── Column (spacing: 16px between sections)
                 ├── 1. PeriodSelector (ChipScroller)
                 ├── 2. HeroEarningsCard (custom, gradient)
                 │    ├── "TOTAL EARNED" label
                 │    ├── ₹18,400 hero amount
                 │    ├── GoalProgressBar (animated)
                 │    └── StatTrio (Trips | Avg/trip | Hours)
                 ├── 3. EarningsChartCard (AppCard)
                 │    ├── SectionHeader("Your week at a glance", subtitle)
                 │    ├── EarningsChart (7 bars, tap-select, animated)
                 │    └── DayDetailBadge
                 ├── 4. EarningsBreakdownCard (AppCard)
                 │    ├── SectionHeader("Where your money comes from")
                 │    └── List<ProgressBreakdownRow>
                 ├── 5. SavingsComparisonCard (AppCard)
                 │    ├── SectionHeader("You vs broker system")
                 │    ├── Row [TruxifyColumn | BrokerColumn]
                 │    └── SavingsCallout
                 ├── 6. MilestonesCard (AppCard)
                 │    ├── SectionHeader("Milestones")
                 │    └── List<MilestoneRow>
                 └── 7. PendingPaymentsCard (AppCard)
                      ├── SectionHeader("Pending", trailing: amount)
                      └── List<PendingPaymentRow>
```

### 4.2 Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| < 400px (mobile) | Single column, full-width cards, padding 16px |
| 400-600px | Single column, max-width 480px, centered |
| 600-900px (tablet) | Two-column grid: hero + chart column 1, breakdown + savings column 2 |
| > 900px | Two-column wider, max-width 800px container, padded |

### 4.3 Key Accessibility Requirements

| Requirement | Implementation |
|-------------|----------------|
| Touch targets | Minimum 44x44px for period pills, bar chart tap areas |
| Color contrast | Text on hero gradient: white on dark maroon (meets WCAG AA). Chart bars: selected state distinguishable by shape + color |
| Font scaling | Use `TextScaler.of(context)` for dynamic type (Material 3 default) |
| Screen reader | Semantic labels on bar chart bars ("Monday: ₹1,200, 1 trip") |
| Reduced motion | Respect `MediaQuery.disableAnimations`: replace animated containers with instant transitions |

---

## 5. Registry & External Dependencies

| Dependency | Version | Purpose | Safety Gate |
|------------|---------|---------|-------------|
| `google_fonts` | ^8.1.0 | DM Sans font | Already in pubspec |
| `flutter` (SDK) | 3.x | Framework | Platform SDK |
| `intl` | — | Date/number formatting (if needed) | Not yet added — verify if needed |

**No third-party registries or blocks required.** This is a Flutter project with no shadcn/ui dependency.

---

## 6. Implementation Guidance

### 6.1 File Changes

| File | Change Type | Scope |
|------|-------------|-------|
| `lib/screens/earnings_screen.dart` | **Rewrite** | Full replacement of ~862 lines with modular ~400-500 lines |
| `lib/widgets/common_widgets.dart` | **Extend** | Add `EarningsChart`, `PeriodSelector`, `StatTrio` if reusable |
| `lib/widgets/earnings/` | **Create** | `/widgets/earnings/hero_card.dart`, `/widgets/earnings/chart.dart`, etc. (if extracting) |
| `lib/data/mock_data.dart` | **Minor** | Add mock for loading/error states if needed |
| `lib/models/app_models.dart` | **None** | Models already sufficient (`EarningDay`, `PendingPayment`, `Milestone`) |

### 6.2 Critical Fixes (Ordered)

1. **Bar chart overflow** → Use `LayoutBuilder` or `Flexible` instead of fixed 80px. Calculate bar heights relative to container, not hardcoded.
2. **Responsive layout** → Replace fixed widths with `FractionallySizedBox`, `Expanded`, or `LayoutBuilder`.
3. **State management** → Extract mock data into a service layer with Future-based loading to simulate loading/error/empty states.
4. **Dark mode** → Replace hardcoded `Colors.white` with `TruxifyColors.cardBackground` (which resolves based on brightness).
5. **Shared components** → Replace custom Containers with `AppCard`, `ChipScroller`, and other shared widgets.

### 6.3 Animation Spec

| Animation | Trigger | Duration | Curve |
|-----------|---------|----------|-------|
| Bar selection | Tap | 300ms | `Curves.easeInOut` (from existing) |
| Hero amount count-up | Initial render | 800ms | `Curves.easeOutCubic` |
| Goal progress bar fill | Initial render | 600ms | `Curves.easeOutSine` |
| Section fade-in | Scroll into view | 400ms stagger (100ms between) | `Curves.easeOut` |
| Detail badge cross-fade | Bar selection | 200ms | `Curves.easeInOut` |
| Pull-to-refresh | Swipe down | System default | System default |

---

## 7. Verification Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| V1 | Bar chart renders without overflow at 320px and 600px width | Run at both breakpoints |
| V2 | All cards use `AppCard` from common_widgets.dart (or justified exception) | Code review |
| V3 | Dark mode renders correctly — no hardcoded white backgrounds | Toggle dark mode |
| V4 | Period selector (Today/Week/Month) triggers data change, not just visual | Check `setState` |
| V5 | Loading state shows shimmer for each card section | Wrap data in FutureBuilder |
| V6 | Empty state shows for zero-data period | Mock empty data array |
| V7 | Error state shows error card with retry for failed fetch | Mock error in Future |
| V8 | Font sizes use theme text styles, not raw GoogleFonts calls (except hero amount) | Code review |
| V9 | All touch targets >= 44x44px | Inspect period pills, chart bars |
| V10 | Animation respects `disableAnimations` setting | System accessibility check |

---

## 8. Pre-population Audit

| Source | Decisions Used |
|--------|---------------|
| `pubspec.yaml` | Flutter/Dart stack, Google Fonts deps |
| `app.dart` | Shell routing, MaterialApp config |
| `app_theme.dart` | Full color palette, theme config, typography |
| `common_widgets.dart` | Available shared components to leverage |
| `app_models.dart` | Data models (`EarningDay`, `PendingPayment`, etc.) |
| `mock_data.dart` | Sample data structure, earnings patterns |
| `earnings_screen.dart` (current) | All identified problems and current architecture |
| `shell_screen.dart` | Earnings is tab index 2, bottom nav structure |
| `trips_screen.dart` | Pattern reference for stateful screen design |
| GitHub Issue Description | Requirements: responsive, modern, better chart, improved spacing |

---

## 9. gsd-ui-checker & gsd-code-fixer Deployment Strategy

### gsd-ui-checker (Validation)
The checker will validate the redesigned Earnings screen against these 6 quality dimensions:

| Dimension | What gsd-ui-checker checks |
|-----------|---------------------------|
| **1. Design token usage** | No hardcoded colors/fonts/spacing; uses TruxifyColors + theme |
| **2. Component reuse** | Uses AppCard, ChipScroller, SectionHeader instead of raw containers |
| **3. State coverage** | Loading/error/empty states present for all data-driven sections |
| **4. Responsive layout** | No overflow errors across 320-900px widths |
| **5. Accessibility** | Touch targets 44px+, color contrast WCAG AA, semantic labels |
| **6. Animation & interaction** | Selection feedback, transitions, reduce-motion respect |

### gsd-code-fixer (Code Fix)
The fixer will apply targeted fixes in this order:

1. **Bar chart overflow fix** → `LayoutBuilder` wrapping the chart row, calculating bar heights as `(itemAmount / maxAmount) * availableHeight`
2. **AppCard migration** → Replace all 7 manual card Containers with the `AppCard` widget from `common_widgets.dart`
3. **Theme-aware colors** → Replace `Colors.white` with `TruxifyColors.cardBackground`, `Colors.white.withOpacity(0.2)` with `TruxifyColors.accent.withOpacity(0.2)`
4. **Typography cleanup** → Replace direct `GoogleFonts.dmSans(...)` calls with `Theme.of(context).textTheme.*` where possible
5. **ChipScroller integration** → Replace the manual period selector Row with the `ChipScroller` widget
6. **State wrapper** → Wrap all data-driven sections with `FutureBuilder` or state-based loading/error/empty branching

---

## UI-SPEC COMPLETE

**Phase:** Driver App Earnings Screen Redesign
**Design System:** Flutter Material Design 3 + Truxify Custom Theme

### Contract Summary
- **Spacing:** 8-point scale (4, 8, 12, 16, 20, 24, 32)
- **Typography:** DM Sans — 6 levels (10px to 38px), 2 weights (Regular 400, Bold 700)
- **Color:** 60/30/10 split (cardBackground/background/accent), 3 semantic support colors
- **Components:** 4 new custom widgets extracted, 7 existing shared components reused
- **States:** 4-state coverage (Loading/Loaded/Error/Empty) for all sections
- **Interactions:** 6 animated transitions defined, pull-to-refresh, bar tap selection
- **Accessibility:** WCAG AA contrast, 44px touch targets, semantic labels, reduced-motion respect

### File Created
`apps/driver/lib/.ui-spec/earnings-redesign-UI-SPEC.md`

### Pre-Populated From
| Source | Decisions Used |
|--------|---------------|
| Codebase scan (15+ files) | Full design system, component inventory, pattern analysis |
| pubspec.yaml | Flutter/Dart stack, package dependencies |
| app_theme.dart | 35+ color tokens, light/dark theme config |
| common_widgets.dart | 12+ reusable component patterns |
| mock_data.dart | Data shape: EarningDay, PendingPayment models |
| GitHub Issue | Requirements: responsive, modern chart, improved spacing |

### Ready for Verification
UI-SPEC complete. gsd-ui-checker can now validate quality dimensions, and gsd-code-fixer can apply structured fixes in priority order.
