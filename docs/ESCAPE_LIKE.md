# SQL LIKE Escape Helper

## Overview

The Truxify backend escapes user input before it is embedded in SQL `LIKE` patterns. The helper (`lib/escapeLike.js`) neutralizes the wildcard characters that would otherwise change the meaning of the pattern.

---

## Location

```
backend/api/src/lib/escapeLike.js
```

---

## Behavior

`escapeLike(value)` escapes, in order:

1. Backslashes (`\` → `\\`) — so the escape character itself is not ambiguous.
2. Percent signs (`%` → `\%`) — so a literal `%` cannot widen the match.
3. Underscores (`_` → `\_`) — so a literal `_` cannot stand for any single character.

Non-string inputs are returned unchanged, and `null`/`undefined` pass through.

| Input | Output |
|-------|--------|
| `hello%world` | `hello\%world` |
| `user_name` | `user\_name` |
| `50%_test` | `50\%\_test` |
| `path\to` | `path\\to` |

---

## Why It Exists

`LIKE` patterns are a classic injection surface: a search for `50%` without escaping matches every row. Escaping the wildcards makes user input match literally while keeping the pattern syntax intact.

---

## Usage

```js
import { escapeLike } from '../lib/escapeLike.js';

const pattern = `%${escapeLike(searchTerm)}%`;
// → SELECT ... WHERE name LIKE $1 (bound as a parameter)
```

---

## Testing

Automated tests verify:

- `%`, `_`, and `\` are each escaped.
- Combinations and consecutive wildcards are handled.
- Empty strings and non-string inputs pass through unchanged.
