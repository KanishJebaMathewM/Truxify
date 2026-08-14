import { GraphqlComplexityAnalyzer } from './complexity_analyzer.js';
import assert from 'assert';

console.log('Testing GraphQL Query Complexity Analyzer...');

const analyzer = new GraphqlComplexityAnalyzer(150);

const simpleQuery = `
  query GetOrder {
    order(id: "1") {
      id
      pickup
      drop
    }
  }
`;

const deeplyNestedQuery = `
  query GetDeepOrderDetails {
    order(id: "1") {
      id
      shipper {
        id
        profile {
          email
          preferences {
            notifications {
              emailEnabled
            }
          }
        }
      }
    }
  }
`;

const res1 = analyzer.processQuery(simpleQuery);
assert.strictEqual(res1.cached, false);
assert.strictEqual(res1.complexity < 150, true);

// Deeply nested query should exceed complexity threshold of 150 and throw Error
assert.throws(() => {
  analyzer.processQuery(deeplyNestedQuery);
}, /GraphQL Query Complexity Limit Exceeded/);

console.log('✅ GraphQL Complexity Analyzer tests passed successfully.');
