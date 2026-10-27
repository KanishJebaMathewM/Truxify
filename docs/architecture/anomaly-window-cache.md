# Bounded per-entity anomaly windows

`AnomalyDetector(max_feature_buffers=4096)` bounds active temporal windows across all data types/entities on one instance. Capacity is a positive Python integer admitted before native model construction. The cache uses OrderedDict LRU operations; normal key lookup/promotion/oldest eviction require no full-cache scan. This bounds window count, not total process bytes/RSS or arbitrary model geometry.

Serving reads prior rows during calibrated native scoring but promotes/allocates/evicts only after complete input/scoring/report preparation succeeds. Rejected observations cannot evict or reorder an existing valid window. Rows retain their model's sequence-length order, and distinct type/entity keys remain independent. Successful retraining removes only affected normalization generations and preserves unaffected LRU order.

Native reports add `window_observations` (actual unpadded count) and `window_length` (required model length). A first observation, retraining reset or LRU eviction may make a window cold. The existing repeat-first-frame cold padding remains; eviction does not establish physical prediction quality or a full genuine history. Callers can recognize partial windows from these counts. Configure capacity for expected active cardinality/model geometry. No cross-process cache, global entity registry, dynamic resize or direct mutation of detector internals is supported.

The pending #18685 reporting/delivery repair is separate. Temporary composition of both actual sources passes83tests without embedding its production scope in this change.

## Native verification

10000direct native producer keys retain3windows in the capacity3 test, with at most3counted key operations per new key and no cache-key scan; retained float32 row bytes are24, excluding all other object/framework overhead. Real learned/calibrated TensorFlow observations verify LRU promotion, eviction/cold metadata, rejected input and post-native report-preparation failure preservation. Actual selective native retraining verifies remaining type/order/window identity. Existing generation/training and shared autoencoder consumers remain included.

```sh
PYTHONPATH=backend/ml TF_NUM_INTRAOP_THREADS=1 TF_NUM_INTEROP_THREADS=1 \
 OMP_NUM_THREADS=1 python -m pytest \
 backend/ml/tests/test_anomaly_window_cache.py \
 backend/ml/tests/test_anomaly_generation_contract.py \
 backend/ml/tests/test_autoencoder_shared_topology.py -q
```

Native framework deprecation warnings remain explicit. Test observations are synthetic; no production provider, sensor or vehicle controls are used.
