import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import tracing from '../../tracing/tracing.js';

const SPAN_NAMES = {
  WORKER_EXECUTION: 'worker.execution',
  WORKER_RETRY: 'worker.retry',
  QUEUE_PRODUCE: 'queue.produce',
  QUEUE_CONSUME: 'queue.consume',
  EVENT_PUBLISH: 'event.publish',
  EVENT_SUBSCRIBE: 'event.subscribe',
  EVENT_HANDLER: 'event.handler',
  SCHEDULER_TASK: 'scheduler.task',
  RETRY_ATTEMPT: 'retry.attempt',
  KAFKA_PRODUCE: 'kafka.produce',
  KAFKA_CONSUME: 'kafka.consume',
  HTTP_OUTGOING: 'http.outgoing',
};

const STANDARD_ATTRIBUTES = {
  SERVICE_NAME: 'service.name',
  WORKER_NAME: 'worker.name',
  WORKER_ATTEMPT: 'worker.attempt',
  WORKER_MAX_ATTEMPTS: 'worker.max_attempts',
  QUEUE_NAME: 'queue.name',
  QUEUE_OPERATION: 'queue.operation',
  QUEUE_MESSAGE_SIZE: 'queue.message_size',
  EVENT_TYPE: 'event.type',
  EVENT_SOURCE: 'event.source',
  EVENT_ID: 'event.id',
  CORRELATION_ID: 'correlation.id',
  KAFKA_TOPIC: 'kafka.topic',
  KAFKA_PARTITION: 'kafka.partition',
  KAFKA_OFFSET: 'kafka.offset',
  KAFKA_CONSUMER_GROUP: 'kafka.consumer_group',
  RETRY_OPERATION: 'retry.operation',
  RETRY_ATTEMPT: 'retry.attempt',
  RETRY_MAX_ATTEMPTS: 'retry.max_attempts',
  RETRY_DELAY_MS: 'retry.delay_ms',
  SCHEDULER_PRIORITY: 'scheduler.priority',
  SCHEDULER_TASK_ID: 'scheduler.task_id',
  ERROR_TYPE: 'error.type',
  ERROR_MESSAGE: 'error.message',
  DURATION_MS: 'duration.ms',
};

class SpanFactory {
  constructor() {
    this._tracerName = 'truxify-telemetry';
  }

  getTracer() {
    return tracing.getTracer(this._tracerName);
  }

  startSpan(name, options = {}) {
    const tracer = this.getTracer();
    const parentContext = options.parentContext || context.active();
    const span = tracer.startSpan(name, {
      attributes: {
        [STANDARD_ATTRIBUTES.SERVICE_NAME]: 'truxify-api',
        ...options.attributes,
      },
      kind: options.kind,
    }, parentContext);
    return span;
  }

  startWorkerSpan(workerName, options = {}) {
    return this.startSpan(SPAN_NAMES.WORKER_EXECUTION, {
      attributes: {
        [STANDARD_ATTRIBUTES.WORKER_NAME]: workerName,
        [STANDARD_ATTRIBUTES.WORKER_ATTEMPT]: options.attempt ?? 0,
        [STANDARD_ATTRIBUTES.WORKER_MAX_ATTEMPTS]: options.maxAttempts ?? 1,
        ...options.attributes,
      },
      ...options,
    });
  }

  startRetrySpan(operation, attempt, maxAttempts, options = {}) {
    return this.startSpan(SPAN_NAMES.RETRY_ATTEMPT, {
      attributes: {
        [STANDARD_ATTRIBUTES.RETRY_OPERATION]: operation,
        [STANDARD_ATTRIBUTES.RETRY_ATTEMPT]: attempt,
        [STANDARD_ATTRIBUTES.RETRY_MAX_ATTEMPTS]: maxAttempts,
        ...options.attributes,
      },
      ...options,
    });
  }

  startQueueProduceSpan(topic, options = {}) {
    return this.startSpan(SPAN_NAMES.QUEUE_PRODUCE, {
      attributes: {
        [STANDARD_ATTRIBUTES.QUEUE_NAME]: topic,
        [STANDARD_ATTRIBUTES.QUEUE_OPERATION]: 'produce',
        [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
        ...options.attributes,
      },
      ...options,
    });
  }

  startQueueConsumeSpan(topic, options = {}) {
    return this.startSpan(SPAN_NAMES.QUEUE_CONSUME, {
      attributes: {
        [STANDARD_ATTRIBUTES.QUEUE_NAME]: topic,
        [STANDARD_ATTRIBUTES.QUEUE_OPERATION]: 'consume',
        [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
        [STANDARD_ATTRIBUTES.KAFKA_PARTITION]: options.partition,
        [STANDARD_ATTRIBUTES.KAFKA_OFFSET]: options.offset,
        [STANDARD_ATTRIBUTES.KAFKA_CONSUMER_GROUP]: options.consumerGroup,
        ...options.attributes,
      },
      ...options,
    });
  }

  startEventPublishSpan(eventType, options = {}) {
    return this.startSpan(SPAN_NAMES.EVENT_PUBLISH, {
      attributes: {
        [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
        [STANDARD_ATTRIBUTES.EVENT_SOURCE]: options.source || 'unknown',
        [STANDARD_ATTRIBUTES.EVENT_ID]: options.eventId,
        ...options.attributes,
      },
      ...options,
    });
  }

  startEventSubscribeSpan(eventType, options = {}) {
    return this.startSpan(SPAN_NAMES.EVENT_SUBSCRIBE, {
      attributes: {
        [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
        [STANDARD_ATTRIBUTES.EVENT_SOURCE]: options.source || 'unknown',
        ...options.attributes,
      },
      ...options,
    });
  }

  startEventHandlerSpan(eventType, handlerName, options = {}) {
    return this.startSpan(SPAN_NAMES.EVENT_HANDLER, {
      attributes: {
        [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
        'handler.name': handlerName,
        ...options.attributes,
      },
      ...options,
    });
  }

  startSchedulerTaskSpan(taskName, options = {}) {
    return this.startSpan(SPAN_NAMES.SCHEDULER_TASK, {
      attributes: {
        [STANDARD_ATTRIBUTES.WORKER_NAME]: taskName,
        [STANDARD_ATTRIBUTES.SCHEDULER_PRIORITY]: options.priority,
        [STANDARD_ATTRIBUTES.SCHEDULER_TASK_ID]: options.taskId,
        ...options.attributes,
      },
      ...options,
    });
  }

  recordError(span, error) {
    if (!span) return;
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message || String(error),
    });
    span.setAttributes({
      [STANDARD_ATTRIBUTES.ERROR_TYPE]: error.name || 'Error',
      [STANDARD_ATTRIBUTES.ERROR_MESSAGE]: error.message || String(error),
    });
  }

  addEvent(span, eventName, attributes = {}) {
    if (!span) return;
    span.addEvent(eventName, attributes);
  }

  setAttributes(span, attributes) {
    if (!span) return;
    span.setAttributes(attributes);
  }

  endSpan(span, durationMs) {
    if (!span) return;
    if (durationMs !== undefined) {
      span.setAttributes({ [STANDARD_ATTRIBUTES.DURATION_MS]: durationMs });
    }
    span.end();
  }

  async withSpan(name, fn, options = {}) {
    const span = this.startSpan(name, options);
    const startTime = Date.now();
    try {
      const result = await context.with(trace.setSpan(context.active(), span), fn);
      this.endSpan(span, Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordError(span, error);
      this.endSpan(span, Date.now() - startTime);
      throw error;
    }
  }

  async withWorkerSpan(workerName, fn, options = {}) {
    return this.withSpan(SPAN_NAMES.WORKER_EXECUTION, fn, {
      attributes: {
        [STANDARD_ATTRIBUTES.WORKER_NAME]: workerName,
        [STANDARD_ATTRIBUTES.WORKER_ATTEMPT]: options.attempt ?? 0,
        [STANDARD_ATTRIBUTES.WORKER_MAX_ATTEMPTS]: options.maxAttempts ?? 1,
        ...options.attributes,
      },
    });
  }

  async withQueueConsumeSpan(topic, fn, options = {}) {
    return this.withSpan(SPAN_NAMES.QUEUE_CONSUME, fn, {
      attributes: {
        [STANDARD_ATTRIBUTES.QUEUE_NAME]: topic,
        [STANDARD_ATTRIBUTES.QUEUE_OPERATION]: 'consume',
        [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
        [STANDARD_ATTRIBUTES.KAFKA_PARTITION]: options.partition,
        [STANDARD_ATTRIBUTES.KAFKA_OFFSET]: options.offset,
        [STANDARD_ATTRIBUTES.KAFKA_CONSUMER_GROUP]: options.consumerGroup,
        ...options.attributes,
      },
    });
  }

  async withQueueProduceSpan(topic, fn, options = {}) {
    return this.withSpan(SPAN_NAMES.QUEUE_PRODUCE, fn, {
      attributes: {
        [STANDARD_ATTRIBUTES.QUEUE_NAME]: topic,
        [STANDARD_ATTRIBUTES.QUEUE_OPERATION]: 'produce',
        [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
        ...options.attributes,
      },
    });
  }

  async withEventPublishSpan(eventType, fn, options = {}) {
    return this.withSpan(SPAN_NAMES.EVENT_PUBLISH, fn, {
      attributes: {
        [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
        [STANDARD_ATTRIBUTES.EVENT_SOURCE]: options.source || 'unknown',
        [STANDARD_ATTRIBUTES.EVENT_ID]: options.eventId,
        ...options.attributes,
      },
    });
  }

  async withSchedulerTaskSpan(taskName, fn, options = {}) {
    return this.withSpan(SPAN_NAMES.SCHEDULER_TASK, fn, {
      attributes: {
        [STANDARD_ATTRIBUTES.WORKER_NAME]: taskName,
        [STANDARD_ATTRIBUTES.SCHEDULER_PRIORITY]: options.priority,
        [STANDARD_ATTRIBUTES.SCHEDULER_TASK_ID]: options.taskId,
        ...options.attributes,
      },
    });
  }
}

const spanFactory = new SpanFactory();

export { SpanFactory, SPAN_NAMES, STANDARD_ATTRIBUTES };
export default spanFactory;
