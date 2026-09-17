# Supabase Mocking Strategy for Backend Tests

## Overview
Testing the Truxify backend requires extensive interaction with the Supabase PostgREST API. To ensure tests are fast, deterministic, and isolated from network failures, we use a comprehensive in-memory mock of the Supabase client.

This document outlines the usage of `MockQueryBuilder` and `createSupabaseMock` located in `backend/api/test/helpers/supabaseQueryMock.js`.

## The Problem: Mock Drift (Issue #10103)
Previously, our mocks only implemented a subset of the Supabase fluent API (e.g., `.select()`, `.eq()`). When production code introduced pagination using `.range(from, to)`, the test suite broke with `TypeError: ...range is not a function`. 

This is known as **mock drift**: the mock no longer accurately reflects the surface area of the real dependency.

## The Solution: Chainable Mock Builder
The `MockQueryBuilder` class implements the full fluent API chain used by our services. Every method returns `this`, allowing arbitrary chaining.

### Supported Methods
- **Selection**: `.select(columns)`
- **Filtering**: `.eq()`, `.neq()`, `.gt()`, `.lt()`, `.gte()`, `.lte()`, `.in()`, `.contains()`
- **Sorting**: `.order(column, { ascending: boolean })`
- **Pagination**: `.range(from, to)`, `.limit(count)`
- **Row Constraints**: `.single()`, `.maybeSingle()`

### Resolution
The mock implements the `then(resolve, reject)` method, making it "thenable". This means you can `await` the query builder directly, exactly like the real Supabase client:

```javascript
const { data, error } = await supabaseAdmin
  .from('fraud_stats')
  .select('*')
  .eq('severity', 'high')
  .order('created_at', { ascending: false })
  .range(0, 49);
```

## Usage in Tests

### 1. Basic Setup
```javascript
import { createSupabaseMock } from '../helpers/supabaseQueryMock.js';

const mockClient = createSupabaseMock({
  tables: {
    users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    orders: []
  }
});

// Inject into your service or module
dbConfig.supabaseAdmin = mockClient;
```

### 2. Simulating Errors
You can force specific tables to return errors to test your service's error handling paths:

```javascript
const errorClient = createSupabaseMock({
  tables: { users: [] },
  errors: { 
    users: { code: '23505', message: 'duplicate key value violates unique constraint' } 
  }
});
```

### 3. Testing Pagination
When testing functions that use `.range()`, ensure your mock dataset is larger than the page size to verify boundary conditions:

```javascript
const largeDataset = Array.from({ length: 250 }, (_, i) => ({ id: i }));
const client = createSupabaseMock({ tables: { items: largeDataset } });

// The mock will correctly slice the array based on .range(50, 99)
const { data } = await client.from('items').select('*').range(50, 99);
expect(data.length).toBe(50);
```

## Best Practices
1. **Never mock the mock**: Do not use `vi.spyOn(mockClient, 'from')`. Let the builder do its job.
2. **Keep datasets small**: Only generate as much data as needed to test the logic (e.g., 100 rows for pagination tests).
3. **Reset state**: Use `beforeEach` to re-instantiate the mock client to prevent state leakage between tests.
4. **Match production queries**: If your service uses `.maybeSingle()`, your test should verify the behavior of `.maybeSingle()` in the mock.

## Maintenance
If the Supabase JS client introduces new query methods (e.g., `.ilike()`, `.textSearch()`), they **must** be added to `MockQueryBuilder.js` immediately to prevent future mock drift issues like #10103.
