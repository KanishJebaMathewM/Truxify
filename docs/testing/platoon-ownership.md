# Native platoon session ownership

The existing coordinator is process-local scaffolding. Each instance now owns a private vehicle-to-session index and the original two membership identities. UUID session IDs prevent same-clock overwrite; synchronous admission/publication rejects self-pairs, invalid string IDs and either-role conflicts before claiming either vehicle. IDs are trimmed, case-sensitive strings; active conflicts return DomainError409 through the existing controller.

Normal disengagement and all three existing emergency triggers release the original owners. Terminal status is one-way: repeated safety evaluation returns ALREADY_DISENGAGED and does not request another separation; repeated disengagement retains EMERGENCY_SPLIT where applicable. Late telemetry remains read-only. Compare-owner release prevents old sessions from clearing newer membership. Retained historical sessions preserve existing summary access.

## Reproduce the focused gate

Use Node24. Install isolated dependencies (no production providers or database):

```sh
npm install --prefix /tmp/platoon-deps --ignore-scripts --no-audit --no-fund pino@10.3.1 eslint@9.39.5 @eslint/js@9.39.5 globals@17.12.0
ln -s /tmp/platoon-deps/node_modules backend/api/node_modules
NODE_ENV=production node --test backend/api/test/native/platoonOwnership.test.js
cd backend/api
node node_modules/eslint/bin/eslint.js src/services/platooningCoordinatorService.js test/native/platoonOwnership.test.js --max-warnings=0
```

Only create the dependency link in a checkout without an existing backend node_modules directory; alternatively install these packages in an isolated checkout. The28 tests use the actual service, logger module and controller, with a native independent membership/transition model over900 seeded operations,256 same-clock creations, conflicts in both roles, all release paths, rejoin/stale callbacks and prior gap/fuel/summary behavior. Unchanged main938da147 fails20/passes8 of these tests.

## Scope and compatibility

The previous timestamp ID layout changes to PLT-UUID; consumers must treat IDs as opaque. Blank/nonstring/self pairs now return400; already engaged vehicles return409. A normally requested disengagement no longer rewrites an earlier emergency outcome. Historical activeSessions and returned session objects retain their existing interface; arbitrary external mutation of session IDs/status or manual deletion of the Map is unsupported.

This does not provide distributed ownership across replicas/restarts, persistence, real vehicle control, certified separation or highway safety. Existing mock partner discovery, gap/fuel approximations and telemetry arithmetic remain unchanged. The old Vitest unit file has an unchanged duplicated backend/api import path; this native gate avoids that unrelated collection defect and does not claim a broad suite pass.
