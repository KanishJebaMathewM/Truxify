## Problem

The NoSQL sanitizer in `backend/api/src/middleware/mongoSanitize.js` removes keys starting with `$` and keys containing dots, but it allows `__proto__`, `constructor`, and `prototype`. A JSON body can therefore carry prototype-pollution keys through validation and into code that merges query objects or assigns properties recursively.

## Root cause

The prohibited-key check was written for MongoDB operators only. It does not model JavaScript prototype semantics, and its recursive walk treats those keys as ordinary data.

## Impact

- Prototype pollution can alter object behavior globally, leading to authorization bypass or denial of service.
- Nested payloads can bypass the top-level key filter and reach merge or sanitization code with dangerous keys intact.
- Security logging and database adapters may process the polluted object differently from the validator.

## Proposed fix

- Extend the prohibited-key predicate with `__proto__`, `constructor`, and `prototype`.
- Apply the same predicate in both the detection and stripping walks so they stay consistent.
- Preserve arrays and valid nested objects while removing prohibited keys.

## Verification

- Test each prohibited key at the top level and nested inside objects and arrays.
- Assert the detector reports a violation and the stripper removes the key without throwing.
- Assert ordinary dotted and operator keys are still removed.

Request: @Senthil455 please assign this issue.
