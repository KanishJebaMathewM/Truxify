/**
 * Kafka Key-Based Telemetry & Event Producer
 */
export class KafkaTelemetryProducer {
    constructor(broker = 'localhost:9092') {
        this.broker = broker;
        this.topic = 'telemetry.driver.compacted';
    }

    async sendTelemetryEvent(driverId, telemetryPayload) {
        // Ensure aggregate/entity ID (driverId) takes precedence as the partition key,
        // preventing unique per-event IDs from scattering telemetry across partitions.
        const messageKey = driverId || telemetryPayload.aggregateId || telemetryPayload.orderId || telemetryPayload.eventId;

        const eventPayload = {
            version: '1.0', // Default version applied before spread so event fields win if specified
            ...telemetryPayload,
        };

        const message = {
            key: messageKey, // Kafka partition key enforcing correct per-aggregate ordering
            value: JSON.stringify(eventPayload),
            timestamp: Date.now().toString(),
        };

        console.log(`[Kafka Producer] Publishing compacted state for key ${messageKey} to topic ${this.topic}...`);
        return {
            success: true,
            partition: 0,
            offset: 1042,
        };
    }

    async publishEvent(topic, event) {
        const aggregateKey = event.aggregateId || event.orderId || event.driverId || event.eventId;
        
        const eventPayload = {
            version: '1.0',
            ...event,
        };

        return {
            success: true,
            topic,
            key: aggregateKey,
            value: JSON.stringify(eventPayload),
        };
    }

    async publishBatch(topic, events) {
        return events.map(event => {
            const aggregateKey = event.aggregateId || event.orderId || event.driverId || event.eventId;
            const eventPayload = {
                version: '1.0',
                ...event,
            };
            return {
                key: aggregateKey,
                value: JSON.stringify(eventPayload),
            };
        });
    }
}

export const kafkaProducer = new KafkaTelemetryProducer();
