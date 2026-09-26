const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const sandbox = {
    assert,
    console,
    Intl,
    Date,
    Math,
    MAX_PLAYABLE_LEVEL: 50,
    window: {
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        },
        crypto: {
            randomUUID: () => '11111111-2222-4333-8444-555555555555'
        },
        location: { href: 'https://example.com/game?test=1#result' }
    },
    navigator: {
        clipboard: { writeText: async value => { sandbox.copiedText = value; } }
    },
    document: {
        createElement: () => ({ value: '', select() {} }),
        body: { appendChild() {}, removeChild() {} },
        execCommand: () => true
    }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/player-data.js'), 'utf8'), sandbox, { filename: 'js/player-data.js' });

vm.runInContext(`
    const first = recordLocalResult(1200, 8);
    assert.equal(first.isNewScore, true);
    assert.equal(first.isNewLevel, true);
    assert.equal(first.bestScore, 1200);
    assert.equal(first.bestLevel, 8);

    const lower = recordLocalResult(900, 6);
    assert.equal(lower.isNewScore, false);
    assert.equal(lower.isNewLevel, false);
    assert.equal(lower.bestScore, 1200);
    assert.equal(lower.bestLevel, 8);

    const split = recordLocalResult(1500, 7);
    assert.equal(split.isNewScore, true);
    assert.equal(split.isNewLevel, false);
    assert.equal(split.bestScore, 1500);
    assert.equal(split.bestLevel, 8);

    saveRegisteredPlayerName('MRS1', getJstMonthKey());
    assert.equal(getCurrentPlayerName(), 'MRS1');

    queuePendingSubmission({ playToken: 'abc', score: 10, level: 2 });
    queuePendingSubmission({ playToken: 'abc', score: 20, level: 3 });
    assert.equal(loadPlayerData().pendingSubmissions.length, 1);
    assert.equal(loadPlayerData().pendingSubmissions[0].score, 20);
    removePendingSubmission('abc');
    assert.equal(loadPlayerData().pendingSubmissions.length, 0);
`, sandbox);

(async () => {
    const result = await vm.runInContext(`shareGameResult({ score: 1500, level: 8, bestScore: 1500, scoreRank: 4 })`, sandbox);
    assert.equal(result, 'copied');
    assert.match(sandbox.copiedText, /月間ハイスコア順位：4位/);
    assert.match(sandbox.copiedText, /https:\/\/example.com\/game/);
    console.log('player-data tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
