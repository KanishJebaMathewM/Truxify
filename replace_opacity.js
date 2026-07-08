const fs = require('fs');
const path = require('path');

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else if (filePath.endsWith('.dart')) {
      results.push(filePath);
    }
  });
  return results;
}

const appsDir = path.join(__dirname, 'apps');
const dartFiles = walkDir(appsDir);

let changed = 0;
dartFiles.forEach((file) => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('.withOpacity(')) {
    content = content.replace(/\.withOpacity\(([^)]+)\)/g, '.withValues(alpha: $1)');
    fs.writeFileSync(file, content, 'utf8');
    changed++;
  }
});
console.log(`Replaced in ${changed} files.`);
