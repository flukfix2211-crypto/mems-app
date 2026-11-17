const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(projectRoot)
  .filter(file => file.endsWith('.html'))
  .sort();

test('every application page loads the shared institutional footer', () => {
  assert.ok(htmlFiles.length > 0, 'expected application HTML files');

  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const stylesheetMatches = html.match(/\bhref="site-footer\.css(?:\?[^"]+)?"/g) || [];
    const scriptMatches = html.match(/\bsrc="site-footer\.js(?:\?[^"]+)?"/g) || [];

    assert.equal(stylesheetMatches.length, 1, `${file} should load the footer stylesheet once`);
    assert.equal(scriptMatches.length, 1, `${file} should load the footer script once`);
  }
});

test('shared footer is excluded from printed reports', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'site-footer.css'), 'utf8');
  assert.match(css, /@media print[\s\S]*?\.site-footer[\s\S]*?display:\s*none\s*!important/);
});
