"""Non-destructive federated inbox delivery and exact-envelope acknowledgement."""

import logging

from redis import RedisError

logger = logging.getLogger(__name__)

# Compare the bytes admitted by the native handler, not just a client/round tag.
# A replacement published during processing must survive this acknowledgement.
ACKNOWLEDGE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


def consume_pending(server, client_id):
    """Called under the server's round owner by both polling and Pub/Sub.

    Read/admission failures retain the original TTL. Ack errors also retain any
    still-pending envelope; subsequent delivery uses native round deduplication.
    Redis EVAL is required: never fall back to a separate GET followed by DEL.
    """
    if not isinstance(client_id, str) or client_id not in server.selected_clients:
        return False
    key = f'federated:update:{client_id}'
    try:
        encrypted = server.redis.get(key)
        if not encrypted:
            return False
        result = server.receive_client_update(client_id, encrypted)
    except RedisError:
        logger.warning('Federated pending update could not be admitted; retained for retry')
        return False
    if not isinstance(result, dict) or result.get('success') is not True:
        return False
    try:
        server.redis.eval(ACKNOWLEDGE, 1, key, encrypted)
    except RedisError:
        # A lost response may mean DEL succeeded. Never issue a blind retry or
        # report an accepted native contribution as unsuccessful processing.
        logger.warning('Federated update accepted; inbox acknowledgement unconfirmed')
    return not result.get('duplicate', False)
