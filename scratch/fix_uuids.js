const fs = require('fs');
const path = require('path');

const files = [
  'backend/api/test/integration/bids.test.js',
  'backend/api/test/integration/loadOffers.test.js',
  'backend/api/test/integration/orders.test.js'
];

let idCounter = 1;

function getUUID(str) {
  // deterministic map based on string
  const hash = str.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  const hashStr = Math.abs(hash).toString(16).padStart(12, '0');
  return `f0000000-0000-4000-a000-${hashStr}`;
}

const map = {};

for (const file of files) {
  const filePath = path.join(path.join(__dirname, '..'), file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Find all order-*, load-*, bid-* that are not UUIDs
  // e.g., 'order-1', 'bid-escrow', 'load-claimed'
  // But be careful not to replace parts of a URL like '/api/orders'
  
  // Actually, we can use a simpler approach.
  content = content.replace(/(['"])(order-[a-zA-Z0-9\-]+)(['"])/g, (match, p1, p2, p3) => {
    if (!map[p2]) map[p2] = getUUID(p2);
    return `${p1}${map[p2]}${p3}`;
  });

  content = content.replace(/(['"])(load-[a-zA-Z0-9\-]+)(['"])/g, (match, p1, p2, p3) => {
    if (!map[p2]) map[p2] = getUUID(p2);
    return `${p1}${map[p2]}${p3}`;
  });

  content = content.replace(/(['"])(bid-[a-zA-Z0-9\-]+)(['"])/g, (match, p1, p2, p3) => {
    if (!map[p2]) map[p2] = getUUID(p2);
    return `${p1}${map[p2]}${p3}`;
  });
  
  // Also fix aaaa0004-0000-4000-a000-000000000000 etc if needed
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log('Replaced IDs with valid UUIDs.');
