import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { ContextPropagator } from './ContextPropagator.js';
import { TraceContext } from './TraceContext.js';
import spanFactory, { STANDARD_ATTRIBUTES } from './SpanFactory.js';

export class QueueTracer {
  static wrapProducer(produceFn, topic) {
    return async function tracedProduce(message, ...rest) {
      return spanFactory.withQueueProduceSpan(topic, async () => {
        const enriched = ContextPropagator.injectIntoKafkaMessage(message);
        const result = await produceFn(enriched, ...rest);
        return result;
      }, {
        attributes: {
          'messaging.system': 'kafka',
          'messaging.operation': 'produce',
          'messaging.destination': topic,
        },
      });
    };
  }

  static wrapConsumer(handler, options = {}) {
    return async function tracedConsume(topic, message, rawMessage) {
      const parentCtx = message?.headers
        ? ContextPropagator.extractFromKafkaHeaders(message.headers)
        : undefined;

      const startOptions = {
        attributes: {
          'messaging.system': 'kafka',
          'messaging.operation': 'consume',
          'messaging.destination': topic,
          [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
          [STANDARD_ATTRIBUTES.KAFKA_PARTITION]: rawMessage?.partition,
          [STANDARD_ATTRIBUTES.KAFKA_OFFSET]: rawMessage?.offset,
          [STANDARD_ATTRIBUTES.KAFKA_CONSUMER_GROUP]: options.consumerGroup,
        },
      };

      if (parentCtx) {
        startOptions.parentContext = parentCtx;
      }

      const span = spanFactory.startSpan('kafka.consume', startOptions);

      try {
        const result = await context.with(trace.setSpan(context.active(), span), async () => {
          return await handler(topic, message, rawMessage);
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        spanFactory.recordError(span, error);
        span.end();
        throw error;
      }
    };
  }

  static wrapConsumerHandler(topic, handler, options = {}) {
    return async function tracedHandler(message, rawMessage) {
      const parentCtx = message?.headers
        ? ContextPropagator.extractFromKafkaHeaders(message.headers)
        : undefined;

      const startOptions = {
        attributes: {
          [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
          [STANDARD_ATTRIBUTES.KAFKA_CONSUMER_GROUP]: options.consumerGroup,
          'messaging.system': 'kafka',
          'messaging.operation': 'process',
        },
      };

      if (parentCtx) {
        startOptions.parentContext = parentCtx;
      }

      return spanFactory.withSpan(`kafka.process.${topic}`, async () => {
        return await handler(message, rawMessage);
      }, startOptions);
    };
  }

  static createProducerTracer(topic) {
    return {
      trace: async (fn) => spanFactory.withQueueProduceSpan(topic, fn, {
        attributes: { 'messaging.system': 'kafka' },
      }),
    };
  }

  static createConsumerTracer(topic, consumerGroup) {
    return {
      trace: (message, rawMessage, fn) => {
        const parentCtx = message?.headers
          ? ContextPropagator.extractFromKafkaHeaders(message.headers)
          : undefined;

        return spanFactory.withSpan('kafka.consume', async () => {
          return await fn();
        }, {
          parentContext: parentCtx,
          attributes: {
            [STANDARD_ATTRIBUTES.KAFKA_TOPIC]: topic,
            [STANDARD_ATTRIBUTES.KAFKA_CONSUMER_GROUP]: consumerGroup,
            [STANDARD_ATTRIBUTES.KAFKA_PARTITION]: rawMessage?.partition,
            [STANDARD_ATTRIBUTES.KAFKA_OFFSET]: rawMessage?.offset,
            'messaging.system': 'kafka',
          },
        });
      },
    };
  }
}
