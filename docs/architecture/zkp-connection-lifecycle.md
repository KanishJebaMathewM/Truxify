# Rust verifier connection lifecycle

The verifier reserves an owned semaphore permit before accepting each TCP
connection. Default capacity is64; `ZKP_MAX_CONNECTIONS` may be1–1024. Invalid,
zero, or noninteger configuration fails startup rather than disabling the bound.

The accepted stream and permit move together into one handler task. The existing
30-second total deadline covers asynchronous header/body reads and response
writes. Completion, timeout, disconnect, task abort, or unwind releases the owned
permit. The accept loop also releases its reservation if cancelled or accept
fails. At idle, one permit is reserved by the pending accept; it transfers directly
to the next handler. No application queue of already-accepted sockets or tasks
waiting for permits is created.

When capacity is full, new connections wait in the operating system's listen
backlog. This is backpressure, not an HTTP503 response or a client-side queue
latency guarantee. Health and verification use the same capacity; health has no
reserved priority lane. Kernel backlog capacity and remote client timeouts are
outside the semaphore bound. The deadline does not preempt synchronous proof
computation, and capacity is not a precise total-process memory budget. Routing,
request size/overflow guards, and proof verification are unchanged.

`bash tools/zkp-http-tests/run.sh` copies the actual binary source into a fresh
locked Cargo package using the service's declared dependencies. It verifies the
binary without unrelated library modules; it is not a full service-library claim.
The23tests include the original deadline/health/proof checks, capacity parsing,
actual timeout/abort/disconnect/success reclamation, accept cancellation, and a
real capacity-one loopback server that holds a partial body, backpressures a
second health request, then recovers after the first disconnects. No deployed
service or production proof/client was used.
