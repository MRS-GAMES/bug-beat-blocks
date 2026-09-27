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
    const ipHashSalt = 'test-only-ip-hash-salt-32-characters-minimum';

    async function api(route, {
        method = 'GET',
        body,
        deviceIp = '192.0.2.1',
        includeIpHashSalt = true,
        origin = 'https://example.com'
    } = {}) {
        const request = new Request(`${origin}/api/${route}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                'CF-Connecting-IP': deviceIp
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const response = await onRequest({
            request,
            env: {
                RANKINGS_DB: db,
                ...(includeIpHashSalt ? { IP_HASH_SALT: ipHashSalt } : {})
            },
            params: { path: route.split('?')[0].split('/') }
        });
        return { status: response.status, data: await response.json() };
    }

    let response = await api('play/start', {
        method: 'POST',
        body: { deviceId: 'device-no-secret' },
        includeIpHashSalt: false
    });
    assert.equal(response.status, 503);
    assert.equal(response.data.code, 'SECURITY_NOT_CONFIGURED');

    response = await api('play/start', {
        method: 'POST',
        body: { deviceId: 'device-preview-only' },
        includeIpHashSalt: false,
        origin: 'https://test-preview.bug-beat-blocks.pages.dev'
    });
    assert.equal(response.status, 200, 'Pages preview can use its isolated test-only HMAC key');

    response = await api('play/start', {
        method: 'POST',
        body: { deviceId: 'device-production-no-secret' },
        includeIpHashSalt: false,
        origin: 'https://bug-beat-blocks.pages.dev'
    });
    assert.equal(response.status, 503, 'production still requires IP_HASH_SALT');
    assert.equal(response.data.code, 'SECURITY_NOT_CONFIGURED');

    const cleanupNow = Date.now();
    db.database.prepare(`
        INSERT INTO play_sessions
            (token_hash, month_key, device_hash, ip_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('expired-token', '2026-09', 'expired-device', 'expired-ip', cleanupNow - 10000, cleanupNow - 1);
    db.database.prepare(`
        INSERT INTO play_sessions
            (token_hash, month_key, device_hash, ip_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run('active-token', '2026-09', 'active-device', 'active-ip', cleanupNow, cleanupNow + 60000);

    response = await api('play/start', {
        method: 'POST',
        body: { deviceId: 'device-cleanup-test' },
        deviceIp: '192.0.2.4'
    });
    assert.equal(response.status, 200);
    assert.equal(
        db.database.prepare('SELECT token_hash FROM play_sessions WHERE token_hash = ?').get('expired-token'),
        undefined,
        'expired play sessions are deleted when a new play starts'
    );
    assert.equal(
        db.database.prepare('SELECT token_hash FROM play_sessions WHERE token_hash = ?').get('active-token').token_hash,
        'active-token',
        'unexpired play sessions are preserved'
    );

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

    response = await api('player-name', { method: 'POST', body: { deviceId: device1, playerName: 'mrs1' } });
    assert.equal(response.status, 200);
    assert.equal(response.data.playerName, 'MRS1');

    const storedPlayer = db.database.prepare(
        'SELECT claim_ip_hash FROM monthly_players WHERE player_name = ?'
    ).get('MRS1');
    const encoder = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(ipHashSalt),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const expectedIpHash = Buffer.from(
        await crypto.subtle.sign('HMAC', hmacKey, encoder.encode('192.0.2.1'))
    ).toString('hex');
    const plainIpHash = Buffer.from(
        await crypto.subtle.digest('SHA-256', encoder.encode('192.0.2.1'))
    ).toString('hex');
    assert.equal(storedPlayer.claim_ip_hash, expectedIpHash);
    assert.notEqual(storedPlayer.claim_ip_hash, plainIpHash);

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
