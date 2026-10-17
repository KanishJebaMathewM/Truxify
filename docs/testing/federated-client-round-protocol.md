# Native federated client round protocol

Upstream native TensorFlow/Fernet/private-Redis reproduction showed three client errors: participation with no downloaded model or key trained anyway and reported success despite failed publication; a malformed round17 model changed the round before Keras rejected its empty schema; valid round19 weights rolled back an accepted round20 model. The HTTP participate/train endpoints also wrapped these failures as success.

The client now owns a complete native model and nonnegative integer round as one accepted pair. Missing/invalid/stale/contradictory same-round envelopes preserve that pair. Duplicate identical notices leave locally trained weights intact. Legacy list envelopes require a valid Redis round tag. Envelopes are bounded at4MiB.

A reentrant process-local lock owns receive/train/publish and the whole participation call. Training requires an accepted pair; successful finite training is cached per round. Publication failures report failure and retain the trained round for retry without another fit. Completed publication is idempotent. Only a newer server-issued model advances the round; clients do not invent the next round. The two HTTP endpoints propagate their actual participation results.

## Native verification

The focused workflow pins Python3.11, TensorFlow2.16.1, Redis5.0.0, Fernet44, FastAPI0.116.1 and HTTPX0.27.0. Run its pytest command with native redis-server available; optionally set REDIS_SERVER to a private executable. New tests instantiate actual Keras models, train one real epoch, use real encrypted Redis storage and mount the actual FastAPI router. Only background pubsub subscription is excluded; concurrent direct delivery exercises the same receive method. Expected outcomes include preservation across invalid schemas/tags, stale rejection, encrypted round matching, once-only fit/publication, failure-and-retry without retraining, and newer delivery waiting for training/publication ownership. Existing key-refresh and round-sync contracts run with native TensorFlow imported first.

Two HTTP controls on the unchanged router failed with false success before the scoped response repair. Full new-source Ruff passes; legacy client/router have explicitly listed pre-existing ignored rule families.

## Boundaries

Publication success means the client stored/notified an update, not that the server accepted it or a GitHub PR merged. This is process-local ownership, not restart recovery or distributed acknowledgement. Existing pubsub lifecycle, key rotation, training data validation, optimizer recovery after failed/nonfinite fitting, provider connections and model calibration are outside scope. Nonfinite training/model outcomes are blocked from publication, but not automatically rolled back. Holding the lock during actual training delays newer notices until the owned cycle finishes. No production model, sensors, controls or paid provider was used.
