import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSchema, graphql } from 'graphql';
import { mapOrder } from '../shared/orderMapping.js';

// Execute the production subgraph's SDL without starting Apollo's listener,
// gateway identity lookups or database connections. Only the Query result is
// supplied by the fixture; Order fields use GraphQL's actual completion rules.
const source = readFileSync(new URL('../services/order.service.js', import.meta.url), 'utf8');
const sdl = source.match(/const typeDefs = gql`([\s\S]*?)`;/)[1];
const schema = buildSchema(`
  directive @key(fields: String!) repeatable on OBJECT | INTERFACE
  directive @external on FIELD_DEFINITION
  type Query { _placeholder: Boolean }
  type Mutation { _placeholder: Boolean }
  type Driver { _placeholder: Boolean }
  type Payment { _placeholder: Boolean }
  type Trip { _placeholder: Boolean }
  ${sdl}
`);
const row = { id: 'order-1', customer_id: 'customer-1', total_amount: 12500 };
async function execute(field, rootValue) {
  return graphql({ schema, source: `{ ${field} }`, rootValue });
}

test('a persisted order without a currency column resolves the non-null currency', async () => {
  const result = await execute('order(id: "order-1") { id amount currency }', { order: () => mapOrder(row) });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.order.currency, 'INR');
  assert.equal(result.data.order.amount, 12500); // Preserve the existing stored paisa unit.
});
test('list mapping resolves currency for every order without changing zero amounts', async () => {
  const result = await execute('orders { amount currency }', { orders: () => [row, { ...row, total_amount: 0 }].map(mapOrder) });
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data.orders.map(value => ({ ...value })), [
    { amount: 12500, currency: 'INR' }, { amount: 0, currency: 'INR' },
  ]);
});
test('customer list results have the same currency contract', async () => {
  const result = await execute('ordersByCustomer(customerId: "customer-1") { currency }', {
    ordersByCustomer: () => [row].map(mapOrder),
  });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.ordersByCustomer[0].currency, 'INR');
});
test('null order results remain null', async () => {
  assert.equal(mapOrder(null), null);
  const result = await execute('order(id: "absent") { currency }', { order: () => mapOrder(null) });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.order, null);
});
