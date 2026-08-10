# ML Price Prediction Validation

Every ML price prediction passes through `validatePricePrediction()` before
the backend consumes it, preventing NaN, Infinity, negative prices, missing
fields, and schema anomalies from reaching pricing logic or the database.

## Validation rules

| Rule                        | Rejection reason        |
| --------------------------- | ----------------------- |
| Null / undefined response   | `null_response`         |
| Non-object response         | `unexpected_type`       |
| Missing `estimated_price`   | `missing_field`         |
| Non-number price            | `not_a_number`          |
| `NaN` price                 | `nan`                   |
| `Infinity` price            | `infinity`              |
| Zero price                  | `zero`                  |
| Negative price              | `negative`              |
| Below ₹100                  | `below_minimum`         |
| Above ₹500,000              | `above_maximum`         |
| Currency != `INR`           | `invalid_currency`      |
| Invalid `min_price`         | `invalid_min_price`     |
| Invalid `max_price` / band  | `invalid_max_price`     |
| Invalid `confidence`        | `invalid_confidence`    |

## Output

On success returns `{ ok: true, validated }` where `validated` carries
`estimated_price`, `min_price` / `max_price` (default ±15% band), `currency`,
and `confidence`.

## Helpers

- `convertToPaisa(priceInInr)` — rounds to integer paisa; returns `null` for
  non-finite input.
- `RejectionReason` — frozen object of machine-readable reason labels.

## Usage

```js
import { validatePricePrediction, convertToPaisa } from '../lib/predictionValidator.js';

const { ok, validated, reason } = validatePricePrediction(mlResponse);
if (!ok) {
  logger.warn({ reason }, 'Rejected ML price prediction');
}
```
