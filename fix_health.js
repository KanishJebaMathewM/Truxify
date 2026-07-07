const fs = require('fs');
const path = 'backend/api/src/routes/healthRoutes.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Find the index of the first // GET /api/health/ready
let index = lines.findIndex(l => l.includes('GET /api/health/ready'));
if (index !== -1) {
    // Remove 3 lines
    lines.splice(index, 3);
}

fs.writeFileSync(path, lines.join('\n'));
