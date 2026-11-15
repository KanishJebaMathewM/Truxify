## Problem

The NoSQL sanitizer in `backend/api/src/middleware/mongoSanitize.js` removes keys starting with `$` and keys containing dots, but it allows `__proto__`, `constructor`, and `prototype`. A JSON body can therefore carry prototype-pollution keys through validation and into code that merges query objects or assigns properties recursively.

## Change

- Extend the prohibited-key predicate with `__proto__`, `constructor`, and `prototype`.
- Apply the same predicate in both the detection and stripping walks so they stay consistent.
- Preserve arrays and valid nested objects while removing prohibited keys.

## Verification

- Test each prohibited key at the top level and nested inside objects and arrays.
- Assert the detector reports a violation and the stripper removes the key without throwing.
- Assert ordinary dotted and operator keys are still removed.

Closes #19454
