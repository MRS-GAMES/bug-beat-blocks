const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();

function createElement() {
    const classes = new Set();
    let innerHTML = '';
    const element = {
        children: [],
        className: '',
        innerText: '',
        style: {},
        clientWidth: 320,
        clientHeight: 432,
        scrollTop: 0,
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
            contains: name => classes.has(name)
        },
        appendChild(child) { this.children.push(child); },
        removeChild(child) { this.children = this.children.filter(value => value !== child); },
        addEventListener() {},
        getContext: () => new Proxy({}, { get: () => () => {} }),
        select() {}
    };
    Object.defineProperty(element, 'innerHTML', {
        get: () => innerHTML,
        set(value) {
            innerHTML = value;
            if (value === '') element.children = [];
        }
    });
    return element;
}

function getElement(id) {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
}

const storage = new Map();
const sandbox = {
    assert,
    console,
    Image: class Image {},
    document: {
        getElementById: getElement,
        createElement,
        querySelector: () => createElement(),
        execCommand: () => true,
        body: createElement()
    },
    window: {
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        }
    },
    setTimeout() {},
    clearTimeout() {}
};
vm.createContext(sandbox);

function load(relativePath) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox, { filename: relativePath });
}

load('js/config.js');
load('js/player-data.js');
vm.runInContext(`
    var setupCalls = [];
    function setupStage(level) { setupCalls.push(level); }
    function checkCollisionAt() { return false; }
    function submitCurrentRankingResult() {}
    function openRankingResultNameScreen(result, options) {
        if (typeof options.onComplete === 'function') options.onComplete();
    }
    function startOnlinePlay() {}
    function refreshRankingScreen() {}
`, sandbox);
load('js/ui-controls.js');

vm.runInContext(`
    buildLevelGrid();
    assert.equal(document.getElementById('level-grid').children.length, 30);
    assert.equal(document.getElementById('endless-continue-btn').classList.contains('hidden'), true);

    document.getElementById('best-score-btn').onclick();
    assert.equal(gameState, 'BEST_SCORE');
    assert.equal(document.getElementById('personal-best-score').innerText, '0');
    assert.equal(document.getElementById('personal-best-level').innerText, '―');
    document.getElementById('best-score-back-btn').onclick();
    assert.equal(gameState, 'TITLE');

    recordLocalResult(12345, 42);
    document.getElementById('best-score-btn').onclick();
    assert.equal(document.getElementById('personal-best-score').innerText, '12,345');
    assert.equal(document.getElementById('personal-best-level').innerText, 'Lv42');

    resetRunProgress();
    selectedLevel = 30;
    score = 100;
    changeScreen('GAMEOVER');
    assert.equal(window.currentGameResult.level, 0, 'an uncleared starting level is not saved as a best level');
    assert.equal(window.currentGameResult.clearedStages, 0);
    assert.equal(document.getElementById('result-level').innerText, '―');
    assert.match(document.getElementById('result-ranking-status').innerText, /1ステージ以上/);

    resetRunProgress();
    selectedLevel = 30;
    changeScreen('STAGECLEAR');
    assert.equal(highestClearedLevelThisRun, 30);
    assert.equal(clearedStagesThisRun, 1);
    assert.equal(loadHighestEndlessLevel(), 31);
    assert.equal(document.getElementById('overlay-action-btn').innerText, 'NEXT STAGE');
    document.getElementById('overlay-action-btn').onclick();
    assert.equal(selectedLevel, 31);
    assert.deepEqual(setupCalls, [31]);

    changeScreen('LEVEL_SELECT');
    assert.equal(document.getElementById('level-grid').children.length, 30);
    assert.equal(document.getElementById('endless-continue-btn').classList.contains('hidden'), false);
    assert.equal(document.getElementById('endless-continue-btn').innerText, 'ENDLESS Lv31から再開');

    saveHighestEndlessLevel(40);
    saveHighestEndlessLevel(35);
    assert.equal(loadHighestEndlessLevel(), 40);

    selectedLevel = 50;
    changeScreen('STAGECLEAR');
    assert.equal(document.getElementById('overlay-action-btn').innerText, 'NEXT STAGE');
    document.getElementById('overlay-action-btn').onclick();
    assert.equal(selectedLevel, 51);
    assert.deepEqual(setupCalls, [31, 51]);

    selectedLevel = 99;
    changeScreen('STAGECLEAR');
    assert.equal(document.getElementById('overlay-action-btn').innerText, 'NEXT STAGE');
    document.getElementById('overlay-action-btn').onclick();
    assert.equal(selectedLevel, 100);
    assert.deepEqual(setupCalls, [31, 51, 100]);

    selectedLevel = 100;
    changeScreen('STAGECLEAR');
    assert.equal(document.getElementById('overlay-title').innerText, 'Congratulations!');
    assert.equal(document.getElementById('overlay-sub').innerText, 'ALL 100 LEVELS CLEARED!');
    assert.equal(document.getElementById('overlay-sub').classList.contains('hidden'), false);
    assert.equal(document.getElementById('overlay-action-btn').innerText, 'LEVEL SELECT');
    document.getElementById('overlay-action-btn').onclick();
    assert.equal(gameState, 'LEVEL_SELECT');
    assert.deepEqual(setupCalls, [31, 51, 100]);
`, sandbox);

console.log('endless-progression tests passed');
