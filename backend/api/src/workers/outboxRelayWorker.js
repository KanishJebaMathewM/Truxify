        const noAdapterFailure =
          outcome?.adapterFailures === 0 &&
          (!outcome.adapterErrors ||
            (Array.isArray(outcome.adapterErrors) &&
              outcome.adapterErrors.length === 0));

        const delivered =
          Boolean(outcome) &&
          outcome.published === true &&
          !outcome.deduplicated &&
          outcome.adapterAttempted > 0 &&
          noAdapterFailure;

        if (delivered) {
          const settled = await outboxService.markPublished(
            event.event_id,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Delivery completed but claim acknowledgement was rejected:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
            continue;
          }

          logger.info("[OutboxRelay] Published event:", {
            eventId,
            type: event.event_type,
          });
        } else {
          const reason = !outcome
            ? "No outcome returned from EventBus"
            : outcome.deduplicated
              ? "Event deduplicated by EventBus"
              : outcome.published !== true
                ? "Publish outcome was unsuccessful"
                : outcome.adapterAttempted === 0
                  ? "No event consumer/adapters handled the event"
                  : `Adapter failures: ${
                      Array.isArray(outcome.adapterErrors) &&
                      outcome.adapterErrors.length > 0
                        ? outcome.adapterErrors.join("; ")
                        : "Adapter reported failure"
                    }`;

          const settled = await outboxService.markFailed(
            event.event_id,
            _workerId,
            reason,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Failed delivery could not settle its claim:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
            continue;
          }

          logger.error("[OutboxRelay] Event not delivered, marked failed:", {
            eventId: event.event_id,
            reason,
          });
        }
      } catch (err) {
        logger.error("[OutboxRelay] Failed to publish event:", {
          eventId: event.event_id || event.id,
          err: err.message,
        });

        try {
          const settled = await outboxService.markFailed(
            event.event_id,
            _workerId,
            err.message,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Failed delivery could not settle its claim:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
          }
        } catch (markErr) {
          logger.error("[OutboxRelay] Failed to mark event failed:", {
            eventId: event.event_id || event.id,
            err: markErr.message,
          });
        }
      }