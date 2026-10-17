# Foundation weights and vocabulary generations

The public foundation service now saves each model version with its own vocabulary. The versioned `truxify.foundation.weights-vocabulary.v1` artifact contains owned native weights, configuration, word IDs and a timestamp. Saving writes a temporary sibling, flushes and syncs it, then replaces the selected destination. Ordinary serialization failure preserves the previous file. This does not guarantee directory durability across power loss.

## Restore contract

Load admits the entire configuration, vocabulary and native tensor dictionary before staging a private Transformer and trainer. Shapes, keys, float32/float64 dtypes and finite values must match the currently configured service architecture. Vocabulary IDs must be unique contiguous integers from zero within embedding capacity; boolean IDs, empty words and words longer than 1024 characters are rejected. An empty vocabulary is permitted for an unprepared model. A checkpoint is bounded to 1 GiB and 200 million tensor values, and serialized vocabulary to 10 MB. These are admission policies, not measured peak memory or latency guarantees.

Only a complete candidate replaces the service model/config/trainer/processor references. An ordinary failed restore leaves the previous trained generation intact. The artifact contains **weights, not optimizer history**: successful restore starts fresh native AdamW and cosine scheduler state, reported as `training_state: fresh_adamw_scheduler`. It is not a training-resume checkpoint.

For legacy artifacts without a format marker, load stages the selected weights and the existing `models/vocab.json` together. It reports `vocabulary_source: legacy_selected_file`; historical semantic pairing cannot be verified. New bundles report `bundled` and require no second vocabulary file. Unknown formats are rejected. The existing service path allowlist is retained. Standalone Python trainer `save`/`load` calls remain unchanged and do not provide this service contract.

## Service ownership

Preparation, training, prediction, metadata and persistence share a native reentrant fence. Blocking model/file operations execute in workers, so an admitted operation retains ownership even if its requesting coroutine is cancelled. A restore waits for an admitted prediction or training operation; consumers cannot observe half-published vocabulary/model aliases. This serializes service operations and can delay concurrent requests. Direct external mutation, custom native hooks, other processes and RNG recovery are outside this guarantee.

The finetuning, MLM and prediction padding algorithms are unchanged. Open #17799 repairs task-aware finetuning separately; both route edits must be reconciled without restoring shared epoch mutation. No claim of numerical training recovery, physical quality, providers, CUDA testing or full default heavyweight bootstrap is made.

## Native verification

Run with CPU Torch 2.8 and the pinned workflow dependencies:

```sh
OMP_NUM_THREADS=1 PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_foundation_checkpoint_generation.py backend/ml/tests/test_foundation.py backend/ml/tests/test_foundation_attention_masks.py backend/ml/tests/test_foundation_mlm_objective.py backend/ml/tests/test_foundation_validation.py -q
```

Controls use a genuinely trained small Transformer, native AdamW/scheduler and actual tokenizer/files. They verify predictions after roundtrip, fresh optimizer binding and learning, complete malformed candidate preservation, legacy JSON failure, separately saved vocabulary versions, captured snapshot ownership, destination preservation after actual serialization, mounted worker concurrency and existing attention/MLM/upload consumers. Mounted tests reduce only bootstrap dimensions; native operators and optimizer results are not mocked.
