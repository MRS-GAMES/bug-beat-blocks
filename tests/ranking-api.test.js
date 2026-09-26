const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');

class BoundStatement {
    constructor(statement, values) {
        this.statement = statement;
        this.values = values;
    }

    run() {
        return this.statement.run(...this.values);
    }

    first() {
        return this.statement.get(...this.values) || null;
    }

    all() {
        return { results: this.statement.all(...this.values) };
    }
}

class D1StatementMock {
    constructor(statement) {
        this.statement = statement;
    }

    bind(...values) {
        return new BoundStatement(this.statement, values);
    }
}

class D1Mock {
    constructor() {
        this.database = new DatabaseSync(':memory:');
        this.database.exec('PRAGMA foreign_keys = ON');
        this.database.exec(fs.readFileSync(path.join(root, 'migrations/0001_monthly_rankings.sql'), 'utf8'));
    }

    prepare(sql) {
        return new D1StatementMock(this.database.prepare(sql));
    }

    batch(statements) {
        this.database.exec('BEGIN');
        try {
            const results = statements.map(statement => statement.run());
            this.database.exec('COMMIT');
            return results;
        } catch (error) {
            this.database.exec('ROLLBACK');
            throw error;
        }
    }
}

async function main() {
    const moduleUrl = `${pathToFileURL(path.join(root, 'functions/api/[[path]].js')).href}?test=${Date.now()}`;
    const { onRequest } = await import(moduleUrl);
    const db = new D1Mock();

    async function api(route, { method = 'GET', body, deviceIp = '192.0.2.1' } = {}) {
        const request = new Request(`https://example.com/api/${route}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                'CF-Connecting-IP': deviceIp
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const response = await onRequest({
            request,
            env: { RANKINGS_DB: db },
            params: { path: route.split('?')[0].split('/') }
        });
        return { status: response.status, data: await response.json() };
    }

    const device1 = 'device-00000001';
    const device2 = 'device-00000002';
    const anonymousDevice = 'device-anonymous-0001';
    const anonymousStart = await api('play/start', {
        method: 'POST',
        body: { deviceId: anonymousDevice },
        deviceIp: '192.0.2.3'
    });
    assert.equal(anonymousStart.status, 200, 'name is registered when the result is finalized');
    let anonymousResult = await api('records', {
        method: 'POST',
        body: { deviceId: anonymousDevice, playToken: anonymousStart.data.playToken, score: 5000, level: 1 }
    });
    assert.equal(anonymousResult.status, 409);
    assert.equal(anonymousResult.data.code, 'NAME_REQUIRED');

    let response = await api('player-name', { method: 'POST', body: { deviceId: device1, playerName: 'mrs1' } });
    assert.equal(response.status, 200);
    assert.equal(response.data.playerName, 'MRS1');

    response = await api('player-name', { method: 'POST', body: { deviceId: device2, playerName: 'MRS1' } });
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'NAME_TAKEN');
    assert.equal(response.data.suggestions.length, 3);
    const secondName = response.data.suggestions[0];

    response = await api('player-name', { method: 'POST', body: { deviceId: device2, playerName: secondName } });
    assert.equal(response.status, 200);

    const start1 = await api('play/start', { method: 'POST', body: { deviceId: device1 }, deviceIp: '192.0.2.1' });
    const start2 = await api('play/start', { method: 'POST', body: { deviceId: device2 }, deviceIp: '192.0.2.2' });
    assert.equal(start1.status, 200);
    assert.equal(start2.status, 200);

    const result1 = { deviceId: device1, playToken: start1.data.playToken, score: 10000, level: 5 };
    const result2 = { deviceId: device2, playToken: start2.data.playToken, score: 12000, level: 4 };
    response = await api('records', { method: 'POST', body: { ...result1, score: 4999 } });
    assert.equal(response.status, 422);
    assert.equal(response.data.code, 'MIN_SCORE_REQUIRED');
    response = await api('records', { method: 'POST', body: result1 });
    assert.equal(response.status, 200);
    response = await api('records', { method: 'POST', body: result2 });
    assert.equal(response.status, 200);

    const scoreRanking = await api(`rankings?type=score&deviceId=${device1}`);
    assert.equal(scoreRanking.status, 200);
    assert.deepEqual(scoreRanking.data.entries.map(entry => entry.score), [12000, 10000]);
    assert.equal(scoreRanking.data.ownEntry.rank, 2);

    const levelRanking = await api(`rankings?type=level&deviceId=${device1}`);
    assert.equal(levelRanking.status, 200);
    assert.deepEqual(levelRanking.data.entries.map(entry => entry.level), [5, 4]);
    assert.equal(levelRanking.data.ownEntry.rank, 1);

    response = await api('records', { method: 'POST', body: result1 });
    assert.equal(response.status, 200, 'same result submission is idempotent');
    response = await api('records', { method: 'POST', body: { ...result1, score: 9999 } });
    assert.equal(response.status, 409, 'used play token cannot submit another result');

    response = await api('player-name', { method: 'POST', body: { deviceId: device1, playerName: 'NEW1' } });
    assert.equal(response.status, 200);
    const renamedRanking = await api('rankings?type=level');
    assert.equal(renamedRanking.data.entries[0].playerName, 'NEW1');

    console.log('ranking-api tests passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
