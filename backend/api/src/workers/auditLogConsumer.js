const { createClient } = require('redis');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createSupabaseClient(supabaseUrl, supabaseKey);

const STREAM_NAME = 'truxify:audit_events';
const CONSUMER_GROUP = 'audit_log_writers';
const CONSUMER_NAME = `worker-${process.pid}`;
const BATCH_SIZE = 50;

const initConsumerGroup = async () => {
  try {
    await redisClient.xGroupCreate(STREAM_NAME, CONSUMER_GROUP, '0', { MKSTREAM: true });
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      console.error('Error creating consumer group:', err.message);
    }
  }
};

const processBatch = async (events) => {
  if (!events || events.length === 0) return;

  const dbPayload = events.map((event) => {
    const message = event.message;
    return {
      idempotency_key: message.idempotencyKey,
      user_id: message.userId,
      action: message.action,
      entity_type: message.entityType,
      entity_id: message.entityId,
      details: message.details,
      created_at: message.timestamp,
    };
  });

  try {
    const { error } = await supabase
      .from('audit_logs')
      .upsert(dbPayload, { onConflict: 'idempotency_key' });

    if (error) throw error;

    const messageIds = events.map((e) => e.id);
    await redisClient.xAck(STREAM_NAME, CONSUMER_GROUP, messageIds);
    await redisClient.xDel(STREAM_NAME, messageIds);
    
    console.log(`Successfully processed and acknowledged ${events.length} audit events.`);
  } catch (err) {
    console.error('Failed to write audit batch to DB:', err.message);
  }
};

const startConsumer = async () => {
  await redisClient.connect();
  await initConsumerGroup();
  console.log(`Audit Log Consumer ${CONSUMER_NAME} started...`);

  while (true) {
    try {
      const response = await redisClient.xReadGroup(
        CONSUMER_GROUP,
        CONSUMER_NAME,
        [{ key: STREAM_NAME, id: '>' }],
        { COUNT: BATCH_SIZE, BLOCK: 5000 }
      );

      if (response && response.length > 0) {
        const messages = response[0].messages;
        await processBatch(messages);
      }
    } catch (err) {
      console.error('Consumer loop error:', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

if (require.main === module) {
  startConsumer().catch(console.error);
}

module.exports = { startConsumer, processBatch };
module.exports.redisClient = redisClient;
module.exports.supabase = supabase;
module.exports.STREAM_NAME = STREAM_NAME;
module.exports.CONSUMER_GROUP = CONSUMER_GROUP; 
