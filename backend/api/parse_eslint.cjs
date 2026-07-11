const fs = require('fs');
const data = JSON.parse(fs.readFileSync('eslint_output.json', 'utf8'));

const messages = data[0].messages;

for (const msg of messages) {
    if (msg.message.includes('has already been declared')) {
        console.log(`Line ${msg.line}: ${msg.message}`);
    }
}
