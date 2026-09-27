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
    function resetBatTestBoard() {
        board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        groupBoard = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        currentPiece = null;
        fallingGroups = [];
        gameState = 'PLAYING';
        isAnimating = false;
    }

    resetBatTestBoard();
    batBugs = [
        { id: 'lower', row: 10, posX: 3, dir: 1, speed: 1.8, minX: 1, maxX: 5, type: 14 },
        { id: 'upper', row: 9, posX: 3, dir: -1, speed: 1.8, minX: 1, maxX: 5, type: 14 }
    ];
    board[10][3] = 14;
    board[9][3] = 14;
    updateBatBugs(100);
    assert.ok(batBugs.find(bat => bat.id === 'lower').posX > 3, 'upper bat must not stop lower bat');

    for (const upperBugType of [8, 9, 13, EGG_BUG, CRACKED_EGG_BUG]) {
        resetBatTestBoard();
        batBugs = [
            { id: 'lower', row: 10, posX: 3, dir: 1, speed: 1.8, minX: 1, maxX: 5, type: 14 }
        ];
        board[10][3] = 14;
        board[9][3] = upperBugType;
        updateBatBugs(100);
        assert.ok(batBugs[0].posX > 3, 'grounded bug above must not stop bat: ' + upperBugType);
    }

    resetBatTestBoard();
    batBugs = [
        { id: 'lower', row: 10, posX: 3, dir: 1, speed: 1.8, minX: 1, maxX: 5, type: 14 }
    ];
    board[10][3] = 14;
    board[9][3] = 1;
    updateBatBugs(100);
    assert.equal(batBugs[0].posX, 3, 'normal block above must still stop bat');

    resetBatTestBoard();
    batBugs = [
        { id: 'left', row: 10, posX: 3, dir: 1, speed: 1.8, minX: 1, maxX: 5, type: 14 },
        { id: 'right', row: 10, posX: 4, dir: -1, speed: 1.8, minX: 2, maxX: 6, type: 14 }
    ];
    board[10][3] = 14;
    board[10][4] = 14;
    updateBatBugs(100);
    assert.notEqual(Math.round(batBugs[0].posX), Math.round(batBugs[1].posX), 'bats on same row must not overlap');
`, sandbox);

console.log('bat-movement tests passed');
