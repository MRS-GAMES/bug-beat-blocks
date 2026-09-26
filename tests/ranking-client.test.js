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
        value: '',
        disabled: false,
        classList: {
            add: (...values) => values.forEach(value => classes.add(value)),
            remove: (...values) => values.forEach(value => classes.delete(value)),
            toggle: (value, force) => force ? classes.add(value) : classes.delete(value),
            contains: value => classes.has(value)
        },
        appendChild(child) { this.children.push(child); },
        addEventListener(type, handler) { this[`on${type}`] = handler; },
        focus() {}
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
const fetchCalls = [];
const monthKey = '2026-09';
const sandbox = {
    assert,
    console,
    Intl,
    Date,
    Math,
    Promise,
    URLSearchParams,
    MAX_PLAYABLE_LEVEL: 50,
    MIN_RANKING_SCORE: 5000,
    window: {
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value)
        },
        crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
        location: { href: 'https://example.com/game' }
    },
    navigator: {},
    document: {
        getElementById: getElement,
        createElement,
        body: createElement(),
        execCommand: () => true
    },
    setTimeout: callback => callback(),
    clearTimeout() {},
    changeScreen: state => { sandbox.screenState = state; },
    addLog: message => { sandbox.lastLog = message; },
    fetch: async (url, options = {}) => {
        fetchCalls.push({ url, options });
        if (url === '/api/player-name') {
            const body = JSON.parse(options.body);
            return { ok: true, status: 200, json: async () => ({ monthKey, playerName: body.playerName }) };
        }
        if (url === '/api/play/start') {
            return { ok: true, status: 200, json: async () => ({ monthKey, playToken: 'play-token-1' }) };
        }
        if (url === '/api/records') {
            return { ok: true, status: 200, json: async () => ({ monthKey, scoreRank: 3, levelRank: 4 }) };
        }
        if (url.startsWith('/api/rankings?')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    monthKey,
                    entries: [{ rank: 1, playerName: 'AAA', level: 12, score: 5000, isOwn: false }],
                    ownEntry: null
                })
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    }
};
vm.createContext(sandbox);

function load(relativePath) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox, { filename: relativePath });
}

load('js/player-data.js');
load('js/ranking.js');

(async () => {
    await vm.runInContext('startOnlinePlay()', sandbox);
    vm.runInContext(`
        globalThis.resultFlowCompleted = false;
        openRankingResultNameScreen(
            { score: 12400, level: 9, bestScore: 12400 },
            { onComplete: () => { globalThis.resultFlowCompleted = true; } }
        );
    `, sandbox);
    assert.equal(sandbox.screenState, 'PLAYER_NAME');
    assert.equal(getElement('player-name-input').value, '');
    assert.match(getElement('player-name-prompt').innerText, /Lv9/);

    await vm.runInContext(`submitPlayerName('a-1')`, sandbox);
    assert.equal(vm.runInContext('getCurrentPlayerName()', sandbox), 'A1');
    assert.equal(sandbox.resultFlowCompleted, true);
    assert.equal(getElement('result-ranking-status').innerText, '月間 SCORE 3位 / LEVEL 4位');
    assert.equal(vm.runInContext('loadPlayerData().pendingSubmissions.length', sandbox), 0);

    await vm.runInContext('refreshRankingScreen()', sandbox);
    assert.equal(getElement('ranking-list').children.length, 1);
    assert.equal(getElement('ranking-message').classList.contains('hidden'), true);
    assert.equal(getElement('ranking-player-name').innerText, 'A1');

    assert.equal(fetchCalls.some(call => call.url === '/api/player-name'), true);
    assert.equal(fetchCalls.some(call => call.url === '/api/play/start'), true);
    assert.equal(fetchCalls.some(call => call.url === '/api/records'), true);
    console.log('ranking-client tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
