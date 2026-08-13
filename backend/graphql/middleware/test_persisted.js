import { persistedQueriesEngine } from './persisted_queries.js';
import assert from 'assert';

console.log('Testing GraphQL Persisted Queries Engine...');

const orderQuery = `
  query GetActiveOrder {
    orders {
      id
      status
    }
  }
`;

const mockHash = '7a2bfbc90c88cd26154699bf38dc0cf48c347f87bf36f90d1f7c11f7c00e1234';

// 1. Initial lookup should be a miss
const res1 = persistedQueriesEngine.processEdgeRequest(mockHash);
assert.strictEqual(res1.status, 'APQ_miss');

// 2. Register query with hash
const correctHash = persistedQueriesEngine.registerQuery(orderQuery);
const res2 = persistedQueriesEngine.processEdgeRequest(correctHash);
assert.strictEqual(res2.status, 'APQ_hit');
assert.strictEqual(res2.query, orderQuery);

console.log('✅ GraphQL Persisted Queries tests passed successfully.');
