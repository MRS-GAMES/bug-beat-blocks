const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const noop = () => {};
const context2d = new Proxy({}, {
    get(target, key) {
        if (!(key in target)) target[key] = noop;
        return target[key];
    },
    set(target, key, value) {
        target[key] = value;
        return true;
    }
});
const element = {
    classList: { add: noop, remove: noop },
    getContext: () => context2d,
    innerText: '',
    width: 240,
    height: 432
};
const sandbox = {
    assert,
    console,
    performance: { now: () => 0 },
    document: { getElementById: () => element },
    Image: class Image {},
    setTimeout: noop,
    clearTimeout: noop
};
vm.createContext(sandbox);

function load(relativePath) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox, { filename: relativePath });
}

load('js/config.js');
vm.runInContext(`
    var isDragging = false;
    var holdTimer = null;
    var fastBtn = { classList: { add() {}, remove() {} } };
    function changeScreen() {}
`, sandbox);
load('js/game.js');

vm.runInContext(`
    const expectedCounts = [1, 2, 3, 4, 5, 5, 6, 6, 7, 7, 7, 7, 7, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    for (let level = 31; level <= 100; level++) expectedCounts.push(22 + (level - 30));
    assert.equal(MAX_SELECTABLE_LEVEL, 30);
    assert.equal(MAX_PLAYABLE_LEVEL, 100);
    assert.equal(MAX_LEVEL, 100);
    assert.equal(getNextLevel(30), 31);
    assert.equal(getNextLevel(49), 50);
    assert.equal(getNextLevel(50), 51);
    assert.equal(getNextLevel(99), 100);
    assert.equal(getNextLevel(100), null);

    for (let level = 1; level <= MAX_LEVEL; level++) {
        const config = getLevelConfig(level);
        assert.equal(config.enemyCount, expectedCounts[level - 1]);
        assert.ok(config.guaranteed.length <= config.enemyCount);
        assert.ok(config.randomPool.length > 0);

        for (const randomValue of [0.01, 0.5, 0.99]) {
            Math.random = () => randomValue;
            setupStage(level);

            const occupied = [];
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (board[r][c] >= 8) occupied.push({ r, c, type: board[r][c] });
                }
            }

            assert.equal(occupied.length, config.enemyCount, 'enemy count at level ' + level);
            assert.equal(remainingEnemies, config.enemyCount);
            assert.equal(new Set(occupied.map(cell => cell.r + ',' + cell.c)).size, occupied.length);
            assert.equal(occupied.every(cell => cell.r >= 0 && cell.r < ROWS), true);
            if (level <= 28) {
                assert.equal(new Set(batBugs.map(bat => bat.row)).size, batBugs.length, 'bat rows at level ' + level);
            } else {
                const minPlacementRow = getEndlessPlacementMinRow(level);
                assert.equal(occupied.every(cell => cell.r >= minPlacementRow), true, 'random placement rows at level ' + level);
            }

            if (level >= 21) {
                assert.ok(occupied.filter(cell => cell.type === EGG_BUG).length <= config.limits.eggs);
                assert.ok(batBugs.length <= config.limits.bats);
            }
        }
    }

    for (let level = 1; level <= 5; level++) {
        assert.equal(getLevelConfig(level).guaranteed.some(kind => ['metal', 'batWhite', 'batColor', 'batMetal', 'egg'].includes(kind)), false);
    }
    for (let level = 6; level <= 10; level++) {
        assert.equal(getLevelConfig(level).guaranteed.includes('metal'), true);
        assert.equal(getLevelConfig(level).guaranteed.includes('egg'), false);
    }
    assert.deepEqual(
        [11, 12, 13, 14, 15].map(level => getLevelConfig(level).guaranteed.filter(kind => kind === 'egg').length),
        [1, 1, 2, 2, 3]
    );
    assert.deepEqual(
        [16, 17, 18, 19, 20].map(level => getLevelConfig(level).enemyCount),
        [8, 9, 10, 11, 12]
    );
    assert.deepEqual(
        [21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(level => getLevelConfig(level).enemyCount),
        [13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
    );
    assert.deepEqual(
        [31, 40, 50, 51, 100].map(level => getLevelConfig(level).enemyCount),
        [23, 32, 42, 43, 92]
    );
    assert.deepEqual(
        [51, 58, 59, 66, 67, 98, 99, 100].map(getEndlessPlacementMinRow),
        [6, 6, 5, 5, 4, 1, 0, 0]
    );

    const finalKinds = new Set(getLevelConfig(20).guaranteed);
    ['white', 'color', 'metal', 'egg', 'batWhite', 'batColor', 'batMetal'].forEach(kind => {
        assert.equal(finalKinds.has(kind), true, 'level 20 includes ' + kind);
    });
`, sandbox);

console.log('stage-balance tests passed');
