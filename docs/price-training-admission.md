# Completed-trip price training admission

`/train/price` fits the existing StandardScaler and GradientBoostingRegressor
on completed-trip rows. A row is usable only when its coordinates, converted
kilogram weight, and selected price are finite, weight and price are positive,
and latitude/longitude are within [-90,90]/[-180,180]. Missing or unusable
values are skipped before feature extraction; numeric conversion overflow is
also unusable. Great-circle rounding is clamped at antipodes after domain
validation. Zero-distance trips remain excluded.

Negotiated `bid_amount` retains precedence. `total_amount` is selected only
when the bid is absent; an invalid present bid does not silently substitute a
larger price. Feature order, vehicle/cargo mapping and the 100-valid-trip
minimum remain the same. If too few valid rows remain, the established
PriceModelDataUnavailableError occurs before model publication, preserving
an existing generation.

Run the focused native checks from the repository root:

```sh
python -m venv /tmp/truxify-price-training-env
/tmp/truxify-price-training-env/bin/pip install -r tools/price-training-tests/requirements.txt
/tmp/truxify-price-training-env/bin/python -m pytest backend/ml/tests/test_price_training_admission.py -q
/tmp/truxify-price-training-env/bin/ruff check backend/ml/tests/test_price_training_admission.py
```

The tests use the actual scaler/regressor and artifact save/load code in a
private temporary directory, with only database loading and weather replaced
by local boundaries. No production database/provider is accessed. This does
not repair historical rows, change the SQL sampling limit, infer missing
values, impose new business maxima on otherwise finite prices/weights, or
change request-side validation. Other estimator failures still propagate;
this is not a guarantee that arbitrary finite extreme business data is safe
for every floating-point intermediate.
