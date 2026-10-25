import net from 'node:net';
import { MongoClient, BSON } from 'mongodb';

// A scripted Mongo wire peer, not a database engine. The actual driver builds
// its own native bulk results/errors from these responses and splits batches.
export async function mongoBulkWire(replies, { maxBatchSize = 100000 } = {}) {
  const sockets = new Set(), batches = []; let nextReply = 0;
  const send = (socket, requestId, body, legacy) => {
    const doc = BSON.serialize(body), prefix = legacy ? Buffer.alloc(20) : Buffer.alloc(5);
    if (legacy) prefix.writeInt32LE(1, 16); else prefix[4] = 0;
    const packet = Buffer.alloc(16 + prefix.length + doc.length);
    packet.writeInt32LE(packet.length); packet.writeInt32LE(123, 4);
    packet.writeInt32LE(requestId, 8); packet.writeInt32LE(legacy ? 1 : 2013, 12);
    prefix.copy(packet, 16); doc.copy(packet, 16 + prefix.length); socket.write(packet);
  };
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffered = Buffer.alloc(0);
    socket.on('data', data => {
      buffered = Buffer.concat([buffered, data]);
      while (buffered.length >= 16) {
        const size = buffered.readInt32LE(0); if (buffered.length < size) return;
        const packet = buffered.subarray(0, size); buffered = buffered.subarray(size);
        const op = packet.readInt32LE(12), requestId = packet.readInt32LE(4);
        let offset = op === 2004 ? packet.indexOf(0, 20) + 9 : 21;
        const bodySize = packet.readInt32LE(offset);
        const command = BSON.deserialize(packet.subarray(offset, offset + bodySize));
        offset += bodySize;
        if (command.ismaster || command.hello) {
          send(socket, requestId, { ok: 1, ismaster: true, helloOk: true, minWireVersion: 0, maxWireVersion: 25,
            maxBsonObjectSize: 16777216, maxMessageSizeBytes: 48000000, maxWriteBatchSize: maxBatchSize }, op === 2004);
        } else if (command.insert) {
          const docs = command.documents || [];
          while (offset < packet.length) {
            const kind = packet[offset++];
            if (kind !== 1) throw new Error('Unexpected Mongo fixture section');
            const sectionEnd = offset + packet.readInt32LE(offset); offset = packet.indexOf(0, offset + 4) + 1;
            while (offset < sectionEnd) {
              const length = packet.readInt32LE(offset);
              docs.push(BSON.deserialize(packet.subarray(offset, offset + length))); offset += length;
            }
          }
          batches.push({ ordered: command.ordered, docs });
          const reply = replies[nextReply++];
          if (reply === null) socket.destroy();
          else send(socket, requestId, reply || { ok: 1, n: docs.length }, false);
        } else send(socket, requestId, { ok: 1 }, false);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new MongoClient(`mongodb://127.0.0.1:${server.address().port}`, {
    directConnection: true, serverSelectionTimeoutMS: 1000, socketTimeoutMS: 1000, retryWrites: false,
  });
  try { await client.connect(); }
  catch (error) { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); throw error; }
  return { client, batches, async close() { await client.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); } };
}
