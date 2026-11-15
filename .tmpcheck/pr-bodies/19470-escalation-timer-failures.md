## Problem

`EscalationHandler` in `backend/api/src/services/blockchain/escalationHandler.js` invokes `performEscalation()` from `setTimeout` callbacks without awaiting or catching the returned promise. A rejected route or store call becomes an unhandled rejection, which can terminate the process and stop escalation for every other tracked alert.

## Change

- Wrap each escalation invocation in a function that attaches `.catch()`.
- Log the alert ID and level and report the error to Sentry.
- Use the same wrapper for every escalation level.

## Verification

- Make `performEscalation()` reject and assert the timer callback logs and captures the error without an unhandled rejection.
- Assert subsequent timers still run.
- Run the escalation handler tests.

Closes #19470
