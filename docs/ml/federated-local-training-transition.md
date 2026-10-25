# Native federated local training transition

The existing server-issued round RLock still owns receive, train and publication.
`train_local` now admits one complete owned finite feature/target/count/work tuple
before Keras fitting or `local_data` publication. The compiled binary model must
have ten features and one output. Inputs are copied to its float32/64 compute
dtype. Labels may be `[N]` or `[N,1]`, normalized to `[N,1]`, and finite soft labels
in `[0,1]` retain the existing binary crossentropy meaning. Boolean/string,
nonfinite, unrepresentable or misaligned observations are rejected.

Limits: 1..4096 rows, 1..16 integral epochs and 256 million estimated
`rows * epochs * native_parameter_count` work units before owned native-dtype copies/fitting.
Native batch size remains32. This is a conservative admission policy, not a
runtime/peak-memory guarantee. Oversized previously accepted fits now fail.
The default client registers its actual native Adam moments at construction,
preserving optimizer ownership before any accepted round trains.

Supported state is the actual built Keras Adam optimizer and compiled
`binary_crossentropy` objective. Native policy scalars, weights, optimizer
variables and metric counters must be finite. Ordinary failed complete fits
restore captured registered model weights, Adam variables/iterations and prior
metric counters without replacing their identities. Keras may lazily register
accuracy counters on its first fit; after failure these newly created counters
remain registered at zero. Seed-generator/global RNG and cached native traced
functions are not rolled back. Arbitrary optimizer topology, hooks/callback side
effects, asynchronous cancellation, direct external mutation and distributed
rollback are excluded.

This is a whole-fit publication boundary: earlier batches from a failed fit are
also recovered. Transient native candidates may have existed during fitting;
external readers bypassing the round lock are not isolated. Actual finite
loss/accuracy history is required for every requested epoch. Missing, malformed,
nonfinite or out-of-domain metrics fail and are recovered, replacing the old
fabricated loss0/accuracy1 defaults.

Only a successful complete candidate publishes separately owned `local_data`,
observed metrics and trained-round metadata. Once a round is already trained,
existing duplicate calls return its cached result without consuming new data or
retraining. Accepted server round, old notices, encrypted updates and retry
semantics remain unchanged. Receiving a new round does not reset the existing
client optimizer policy; no new cross-round optimizer algorithm is claimed.
There are no server, key rotation, DP, transport restart, provider, hardware or
physical quality changes. CPU TensorFlow2.16.2 is tested locally and declared
2.16.1 on Linux; accelerator behavior is unverified.

Focused evidence includes independent binary crossentropy/first-step native
Keras Adam references, actual complete source rejection before fitting, source
mutation during real fitting, actual finite-input/native policy candidate
failure, native post-fit failure/invalid metric recovery and same-round retries,
plus the existing actual TensorFlow/Fernet/private Redis/ASGI round protocol,
idempotent encrypted publication and concurrent delivery consumers.
