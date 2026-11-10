# MTL classification objective and prediction contract

Classification heads retain their registered Softmax and public probability outputs. Training and validation use `forward_for_loss`: classification logits before Softmax, unchanged regression outputs, and one shared encoder evaluation. CrossEntropyLoss applies log-softmax internally. Feeding probabilities to it previously bounded a confidently wrong prediction's loss and suppressed its learning gradient.

Native example: logits `[10, -10]` with label 1 should have loss approximately 20; the old double-softmax path yielded approximately 1.313. Exact loss and parameter-gradient references cover both wrong classes, ordinary mixed labels, and extreme logits. Native Adam corrects the saturated wrong class. State dictionary keys and native save/load remain compatible. Model forward, single-task forward and trainer prediction keep probabilities.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_mtl_classification_logits.py
python -m ruff check backend/ml/mtl/model.py backend/ml/tests/test_mtl_classification_logits.py --select E9,F63,F7,F82
```

Ten local native tests pass, including a mounted actual ASGI train/predict route with the real mixed-task model and optimizer. The route control explicitly selects the native standard gradient path to isolate this objective from the separate PCGrad coordinate defect fixed in PR #17169. No provider, production fit or model-quality claim is involved. The unchanged source fails eight of these tests and passes two.

Temporary actual-source integration of this fix and PR #17169 passes all 30 combined native tests, with one pre-existing init test explicitly excluded because it omits the required tasks argument. The PR itself contains only the classification objective fix. Focused Linux CI runs the ten objective controls; broad backend CI is not claimed.
