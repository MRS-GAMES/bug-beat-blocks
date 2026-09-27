const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));

assert.match(html, /<title>BUG BEAT BLOCKS \| MRS GAMES<\/title>/);
assert.match(html, /name="description"/);
assert.match(html, /property="og:title"/);
assert.match(html, /property="og:image" content="https:\/\/bug-beat-blocks\.pages\.dev\/assets\/meta\/og-image\.png"/);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(html, /rel="apple-touch-icon"/);
assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);

function readPngSize(relativePath) {
    const data = fs.readFileSync(path.join(root, relativePath));
    assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a', `${relativePath} must be a PNG`);
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

assert.deepEqual(readPngSize('assets/meta/og-image.png'), { width: 1200, height: 630 });
assert.deepEqual(readPngSize('assets/meta/favicon-32.png'), { width: 32, height: 32 });
assert.deepEqual(readPngSize('assets/meta/apple-touch-icon.png'), { width: 180, height: 180 });
assert.deepEqual(readPngSize('assets/meta/icon-192.png'), { width: 192, height: 192 });
assert.deepEqual(readPngSize('assets/meta/icon-512.png'), { width: 512, height: 512 });
assert.equal(manifest.name, 'BUG BEAT BLOCKS');
assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);

console.log('metadata tests passed');
