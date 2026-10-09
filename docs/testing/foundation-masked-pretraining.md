# Explicit foundation masked-token pretraining

`/foundation/pretrain` now uses `MaskedTokenTrainer`, rather than silently
training every record as classification class zero. `task='mlm'` returns
`[batch,tokens,vocabulary]` logits before pooling, using the existing generation
head. Existing classification, regression and pooled generation tasks keep their
return contracts and registered parameter/checkpoint topology. This is masked
reconstruction, not autoregressive text generation.

The processor reserves uppercase `[PAD]` and `[MASK]` entries without reindexing
existing lexical IDs. Its lexical tokenizer lowercases words, distinguishing
those special keys from literal lowercase spellings. Existing contiguous saved
vocabularies can gain the two IDs; embedding capacity must include them. Empty
or malformed text, duplicate/noncontiguous vocabulary IDs and invalid masking
policies reject. Records and metadata are owned copies. Token selection uses
independent 15% Bernoulli draws once when examples are prepared; selected tokens
are replaced by MASK, their original IDs are targets, and all unselected targets
are -100. This does not implement BERT's optional 80/10/10 replacement scheme.

The collator admits complete token/target arrays within vocabulary and positional
capacity. It pads with the record's PAD identity, ignores padding targets and
builds a separate valid-token attention mask. An ordinary lexical ID0 remains a
valid token. The public `[B,T]` MLM token mask is admitted and broadcast internally to
`[B,1,1,T]`, working on current main and with attention correction #17175. Sequence pooling
changes in that PR are not duplicated here.

Native cross-entropy is averaged over selected target tokens only. A batch with
no selected tokens skips model execution, optimizer and scheduler movement.
Training admits every train/validation record before the first update and owns
its data. Loss metrics are weighted by supervised token counts. Validation
restores module modes; scheduler moves once per epoch with at least one update.
`supervised_tokens_per_epoch` distinguishes no-supervision zero metrics from a
real measured loss. No-target examples are not forcibly masked, preserving the
stated selection distribution. Nonfinite logits/objective/gradients reject the
current update. Prior successful updates are not rolled back if execution later
fails; neither model replacement nor training is made concurrently safe.

## Verification

```
OMP_NUM_THREADS=1 PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_foundation_mlm_objective.py
python -m ruff check backend/ml/foundation/pretraining.py backend/ml/tests/test_foundation_mlm_objective.py
python -m ruff check backend/ml/foundation/data.py backend/ml/foundation/model.py backend/ml/routes/foundation_routes.py --select E9,F63,F7,F82
```

Native tests compare cross-entropy and generation-head gradients against explicit
logsumexp/selected-logit references, run actual AdamW updates, prove ignored and
padding exclusion, batch-partition validation invariance, parameter-preserving
no-supervision, special-ID/vocabulary ownership and existing checkpoint reload.
Three independent unchanged-main controls show discarded targets, missing
per-position logits and unchanged generation-head weights after “pretraining”.
Temporary actual-source composition with #17175 also passes the MLM suite.

Route wiring is reviewed; full default service boot/ASGI execution is not claimed.
The route's existing large default model/global lifecycle and legacy supervised
regression trainer limitations remain. A new AdamW session starts for each
pretraining call; optimizer state is not restored by existing weight checkpoints.
Save the vocabulary alongside matching weights: newly reserved embedding rows
need actual training. No pretrained logistics quality, calibrated forecasts,
production resource quota or deployment is claimed.
