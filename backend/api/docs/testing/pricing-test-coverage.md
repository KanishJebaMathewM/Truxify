# Pricing Engine Test Coverage

## Overview
This document describes the comprehensive unit test coverage for `backend/api/src/lib/pricing.js` — Truxify's core freight pricing engine.

**Issue #1513**: Added 100+ unit tests covering all financial calculation functions that were previously untested.

## Test File Location
- **Main test file**: `backend/api/test/unit/pricing.test.js`
- **Fixtures**: `backend/api/test/unit/fixtures/pricingFixtures.js`

## Running Tests

```bash
# Run all pricing tests
npm run test:unit -- backend/api/test/unit/pricing.test.js

# Run with coverage
npm run test:unit -- --coverage backend/api/test/unit/pricing.test.js

# Run specific describe block
npm run test:unit -- backend/api/test/unit/pricing.test.js -t "computeOrderPricing"
```

## Coverage Summary

### Functions Tested

| Function | Test Count | Status |
|----------|-----------|--------|
| `computeOrderPricing` | 45+ | ✅ Covered |
| `haversineKm` | 14 | ✅ Covered |
| `safePaisa` | 10 | ✅ Covered |
| `sanitizePrice` | 6 | ✅ Covered |
| `guardNonNegative` | 6 | ✅ Covered |
| `convertKmToMiles` | 7 | ✅ Covered |
| `readRateCard` | 8 | ✅ Covered |

### Test Categories

#### 1. Distance Calculation (`haversineKm`)
- ✅ Returns 0 for identical coordinates
- ✅ Accurate known distances (Delhi-Mumbai, Chennai-Bangalore)
- ✅ Antipodal points (max distance)
- ✅ Prime meridian / date line crossing
- ✅ Equator crossing
- ✅ TypeError for non-finite inputs
- ✅ Symmetry property (A→B = B→A)
- ✅ Triangle inequality

#### 2. Financial Safety (`safePaisa`, `sanitizePrice`)
- ✅ Negative values clamp to 0
- ✅ NaN returns 0
- ✅ Infinity returns 0
- ✅ Integer rounding (paisa precision)
- ✅ Ceiling clamping (₹10,00,000)
- ✅ String parsing

#### 3. Core Pricing Logic (`computeOrderPricing`)

**Input Validation:**
- ✅ Null/non-object input → TypeError
- ✅ Non-positive weight → RangeError
- ✅ Missing coordinates → TypeError
- ✅ Invalid rate card → RangeError

**Calculation Correctness:**
- ✅ `baseFreight = rate × weight × distance + handling`
- ✅ `tollEstimate = tollPerKm × distance × tollFactor`
- ✅ `platformFee = baseFreight × platformFeePct / 100`
- ✅ `totalAmount = baseFreight + tollEstimate + platformFee`
- ✅ `fuelCost = baseFreight × fuelCostPct / 100`
- ✅ `netProfit = baseFreight - fuelCost`

**Scaling Behavior:**
- ✅ Linear scaling with weight
- ✅ Linear scaling with distance
- ✅ Fragile multiplier application (default 1.5x)
- ✅ Stackable discount application (default 0.9x)
- ✅ Combined modifiers (multiplicative)

**Edge Cases:**
- ✅ Zero distance (same location)
- ✅ Very short distance (1 km)
- ✅ Very long distance (2000+ km)
- ✅ Very light cargo (0.1 tonnes)
- ✅ Very heavy cargo (50+ tonnes)
- ✅ Polar coordinates
- ✅ Invalid tollFactor fallback

**Financial Precision:**
- ✅ No floating point drift
- ✅ Integer paisa values
- ✅ Proper rounding behavior
- ✅ Net profit never exceeds base freight

#### 4. Environment Configuration (`readRateCard`)
- ✅ Default values when env vars unset
- ✅ Parsing all env var overrides
- ✅ Invalid env var fallback
- ✅ Negative env var fallback
- ✅ Empty string handling
- ✅ Float parsing (multipliers)

#### 5. Constants Validation
- ✅ Earth radius reasonable (6300-6400 km)
- ✅ DEFAULTS has all required fields
- ✅ DEFAULTS is frozen (immutable)
- ✅ DEFAULTS values are sensible

## Financial Scenarios Tested

### Scenario 1: Standard Delhi-Mumbai Shipment
- **Route**: Delhi → Mumbai (~1400 km)
- **Weight**: 10 tonnes
- **Cargo**: General freight
- **Expected**: ~₹70,000 base + ~₹28,000 toll + ~₹3,500 platform = ~₹1,01,500

### Scenario 2: Fragile Electronics (Short Haul)
- **Route**: Mumbai → Pune (~150 km)
- **Weight**: 2 tonnes
- **Cargo**: Fragile
- **Expected**: 1.5x fragile multiplier applied

### Scenario 3: Heavy Long Haul
- **Route**: Delhi → Chennai (~2200 km)
- **Weight**: 30 tonnes
- **Cargo**: Heavy machinery
- **Expected**: High base freight + significant toll

### Scenario 4: Stackable Bulk
- **Route**: Bangalore → Hyderabad (~570 km)
- **Weight**: 12 tonnes
- **Cargo**: Stackable
- **Expected**: 0.9x discount applied

## Regression Protection

These tests protect against:

1. **Silent financial bugs**: Wrong amounts without errors
2. **Rate card changes**: Accidental modification of pricing constants
3. **Floating point drift**: Currency precision issues
4. **Input validation gaps**: Missing error handling
5. **Environment misconfig**: Bad env vars breaking pricing

## Test Data Fixtures

The `pricingFixtures.js` module provides:
- 🗺️ **Indian city coordinates** (10 major cities)
- 🛣️ **Popular routes** (6 predefined routes with distances)
- 📦 **Cargo scenarios** (6 realistic cargo types)
- 📋 **Sample orders** (5 complete valid orders)
- 💰 **Rate cards** (5 pricing configurations)
- ⚠️ **Edge cases** (boundary conditions)
- 📊 **Expected ranges** (validation bounds)

## CI Integration

Tests run automatically in CI:
```yaml
# .github/workflows/ci.yml
- name: Run pricing unit tests
  run: npm run test:unit -- backend/api/test/unit/pricing.test.js
```

## Future Test Additions

Potential enhancements for future PRs:
- [ ] Snapshot tests for known order pricing
- [ ] Property-based tests (fuzzing with random inputs)
- [ ] Performance benchmarks (pricing calculation speed)
- [ ] Integration tests with order creation flow
- [ ] Currency conversion tests (paisa ↔ INR ↔ wei)

## Related Documentation
- [Pricing Architecture](../architecture/pricing-engine.md)
- [Rate Card Configuration](../configuration/rate-card.md)
- [Financial Precision Guide](../architecture/financial-precision.md)
