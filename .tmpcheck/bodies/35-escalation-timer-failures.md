## Problem

`EscalationHandler` in `backend/api/src/services/blockchain/escalationHandler.js` invokes `performEscalation()` from `setTimeout` callbacks without awaiting or catching the returned promise. A rejected route or store call becomes an unhandled rejection, which can terminate the process and stop escalation for every other tracked alert.

## Root cause

Timer callbacks are outside the promise chain. The handler calls an async method and discards its promise, so Node has no rejection handler for failures that occur after the timer fires.

## Impact

- One failed escalation can crash the process or trigger the global unhandled-rejection policy.
- Other alerts scheduled on the same timer never escalate, leaving incidents without on-call notification.
- The original error is lost instead of being logged and sent to Sentry.

## Proposed fix

- Wrap each escalation invocation in a function that attaches `.catch()`.
- Log the alert ID and level and report the error to Sentry.
- Use the same wrapper for every escalation level.

## Verification

- Make `performEscalation()` reject and assert the timer callback logs and captures the error without an unhandled rejection.
- Assert subsequent timers still run.
- Run the escalation handler tests.

Request: @Senthil455 please assign this issue.
