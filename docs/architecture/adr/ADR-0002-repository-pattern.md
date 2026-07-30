# ADR-0002: Repository Pattern for Database Access

## Status

Accepted

## Context

The backend uses Supabase (PostgreSQL) as its primary database. In the initial codebase, route handlers and services called `supabase.from('orders').select(...)` directly throughout the codebase. This caused several problems:

- **Tight coupling to Supabase**: Every file that needed database access imported `supabase` from `config/db.js`. Changing the database client or adding read-replicas would require changes in dozens of files.
- **Duplicated query logic**: The same `findOrderByAnyId` UUID-or-display-ID fallback pattern was replicated across routes, services, and validation logic.
- **No single point of change**: A schema change (e.g., renaming a column) required hunting down every inline query.
- **Mocking for tests was fragile**: Tests that needed to isolate business logic had to mock `supabase.from()` chains, which broke when the query pattern changed slightly.

## Decision

Introduce a `OrderRepository` class that encapsulates all database access for the orders domain.

```text
Service Layer
    │
    ▼
OrderRepository (single class)
    │
    ├── supabase.from('orders')
    ├── supabase.from('load_bids')
    ├── supabase.from('load_offers')
    ├── supabase.from('order_timeline')
    ├── supabase.from('profiles')
    ├── supabase.from('driver_details')
    ├── supabase.from('trucks')
    ├── supabase.from('delivery_otps')
    ├── supabase.from('wallet_transactions')
    ├── supabase.from('ratings')
    ├── supabase.from('reputation_failures')
    └── supabase.rpc(...)
```

### Design Decisions

1. **Single repository per domain**. Rather than creating one repository per table (OrderRepository, BidRepository, etc.), a single `OrderRepository` class exposes methods for all tables in the orders bounded context. This avoids premature fragmentation and keeps cross-table operations (e.g., accept bid → update bids + offers + orders) visible in one place.

2. **Methods map to business operations, not SQL operations**. Method names reflect what the caller wants, not the query pattern: `findOrderByAnyId()`, `updateOrderGuardStatus()`, `findLoadOfferByOrderDisplayId()`. This insulates callers from the UUID-vs-display-ID distinction and the Supabase filter syntax.

3. **RPC calls are explicit methods**. `executeRpc('accept_bid_tx', params)` lives in the repository alongside regular queries, keeping all database interactions in one layer. The RPC name and parameters are visible in the repository rather than scattered across services.

4. **The repository returns raw Supabase responses** (`{ data, error }`). It does not throw on errors — that is the service layer's responsibility. This keeps the repository agnostic about error-handling strategy.

## Consequences

### Positive

- All Supabase query patterns are documented in one file. A contributor can see every table, column, and filter used by the order domain without grepping the entire codebase.
- Services are decoupled from Supabase. Tests can mock the repository interface rather than the Supabase client.
- Schema changes are localised. If the `orders` table changes, only `orderRepository.js` needs updating.
- The UUID-vs-display-ID resolution logic (`findOrderByAnyId`) is defined once and reused everywhere.

### Trade-offs

- The single repository class is large (489 lines) and covers 11 tables. Some teams prefer one repository per aggregate root. We chose pragmatism over purity — the order domain is tightly coupled by nature, and splitting repositories would create circular dependencies.
- The repository returns raw Supabase response objects. This leaks the Supabase `{ data, error }` convention into the service layer. A future improvement could wrap responses in a `Result` type, but the current convention is consistent across the codebase.
- Some services bypass the repository entirely. `OrderValidationService` and `OrderTimelineService` call `supabase.from()` directly for certain queries, which undermines the pattern's consistency.

### Future Considerations

- If the project adds a second database (e.g., MySQL for reporting), the repository is the natural place to route queries by database. The service layer would not need to change.
- Consider migrating `OrderTimelineService` and `OrderValidationService` to use the repository for all database calls to eliminate the bypass pattern.

## Alternatives Considered

### Direct Supabase calls everywhere

Rejected because it duplicated query logic across 15+ files, made schema migrations error-prone, and forced every unit test to mock the Supabase query chain.

### One repository per table

Rejected because cross-table operations like `acceptBid` would require injecting 4–5 repositories into the service. The current single-repository approach keeps related queries colocated.

### Data Mapper pattern with ORM

Rejected because Supabase's JavaScript client is already a lightweight data mapper. Adding an ORM (Sequelize, Knex) would introduce schema duplication and configuration overhead without proportional benefit for a single-database project.
