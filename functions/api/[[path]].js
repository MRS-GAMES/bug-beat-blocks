const JSON_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
};
const MIN_RANKING_SCORE = 5000;

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getJstMonthKey(date = new Date()) {
    const shifted = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizePlayerName(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function validateDeviceId(value) {
    return typeof value === 'string' && value.length >= 8 && value.length <= 120;
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (error) {
        return null;
    }
}

function createSuggestionCandidates(baseName) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const candidates = new Set();
    for (const first of chars) {
        const single = baseName.length < 5 ? `${baseName}${first}` : `${baseName.slice(0, 4)}${first}`;
        candidates.add(single.slice(0, 5));
        for (const second of chars) {
            const prefix = baseName.slice(0, 3);
            candidates.add(`${prefix}${first}${second}`.slice(0, 5));
            if (candidates.size >= 180) return [...candidates];
        }
    }
    return [...candidates];
}

async function findAvailableSuggestions(db, monthKey, baseName) {
    const candidates = createSuggestionCandidates(baseName);
    const usedNames = new Set();
    const queryChunkSize = 50;
    for (let index = 0; index < candidates.length; index += queryChunkSize) {
        const chunk = candidates.slice(index, index + queryChunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const used = await db.prepare(
            `SELECT player_name FROM monthly_players WHERE month_key = ? AND player_name IN (${placeholders})`
        ).bind(monthKey, ...chunk).all();
        (used.results || []).forEach(row => usedNames.add(row.player_name));
    }
    return candidates.filter(name => !usedNames.has(name)).slice(0, 3);
}

async function nameTakenResponse(db, monthKey, playerName) {
    return json({
        code: 'NAME_TAKEN',
        message: 'その名前は今月すでに使われています',
        suggestions: await findAvailableSuggestions(db, monthKey, playerName)
    }, 409);
}

async function handlePlayerName(context) {
    if (context.request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await readJson(context.request);
    if (!body || !validateDeviceId(body.deviceId)) return json({ code: 'INVALID_DEVICE', message: '端末情報が不正です' }, 400);
    const playerName = normalizePlayerName(body.playerName);
    if (!/^[A-Z0-9]{1,5}$/.test(playerName)) {
        return json({ code: 'INVALID_NAME', message: '名前は英大文字・数字1〜5文字で入力してください' }, 400);
    }

    const db = context.env.RANKINGS_DB;
    const monthKey = getJstMonthKey();
    const deviceHash = await sha256(body.deviceId);
    const now = Date.now();
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256(ip);
    const existingPlayer = await db.prepare(
        'SELECT player_name FROM monthly_players WHERE month_key = ? AND device_hash = ?'
    ).bind(monthKey, deviceHash).first();
    const nameOwner = await db.prepare(
        'SELECT device_hash FROM monthly_players WHERE month_key = ? AND player_name = ?'
    ).bind(monthKey, playerName).first();
    if (nameOwner && nameOwner.device_hash !== deviceHash) {
        return nameTakenResponse(db, monthKey, playerName);
    }
    if (!existingPlayer) {
        const recentClaims = await db.prepare(`
            SELECT COUNT(*) AS count FROM monthly_players
            WHERE claim_ip_hash = ? AND created_at >= ?
        `).bind(ipHash, now - 60000).first();
        if (Number(recentClaims?.count || 0) >= 10) {
            return json({ code: 'RATE_LIMITED', message: '少し待ってから再試行してください' }, 429);
        }
    }
    try {
        await db.prepare(`
            INSERT INTO monthly_players (month_key, device_hash, player_name, claim_ip_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(month_key, device_hash) DO UPDATE SET
                player_name = excluded.player_name,
                updated_at = excluded.updated_at
        `).bind(monthKey, deviceHash, playerName, ipHash, now, now).run();
        return json({ monthKey, playerName });
    } catch (error) {
        const conflictingPlayer = await db.prepare(
            'SELECT device_hash FROM monthly_players WHERE month_key = ? AND player_name = ?'
        ).bind(monthKey, playerName).first();
        if (!conflictingPlayer || conflictingPlayer.device_hash === deviceHash) throw error;
        return nameTakenResponse(db, monthKey, playerName);
    }
}

async function handlePlayStart(context) {
    if (context.request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await readJson(context.request);
    if (!body || !validateDeviceId(body.deviceId)) return json({ code: 'INVALID_DEVICE' }, 400);
    const db = context.env.RANKINGS_DB;
    const monthKey = getJstMonthKey();
    const deviceHash = await sha256(body.deviceId);
    const now = Date.now();
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256(ip);
    const recent = await db.prepare(`
        SELECT COUNT(*) AS count FROM play_sessions
        WHERE created_at >= ? AND (device_hash = ? OR ip_hash = ?)
    `).bind(now - 60000, deviceHash, ipHash).first();
    if (Number(recent?.count || 0) >= 12) {
        return json({ code: 'RATE_LIMITED', message: '少し待ってから再試行してください' }, 429);
    }

    const playToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const tokenHash = await sha256(playToken);
    await db.prepare(`
        INSERT INTO play_sessions
            (token_hash, month_key, device_hash, ip_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind(tokenHash, monthKey, deviceHash, ipHash, now, now + (24 * 60 * 60 * 1000)).run();
    return json({ playToken, monthKey });
}

const UPSERT_RECORD_SQL = `
    INSERT INTO monthly_records (
        month_key, device_hash, best_score, score_run_level,
        best_level, level_run_score, score_recorded_at, level_recorded_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM play_sessions
    WHERE token_hash = ? AND used_at IS NULL
    ON CONFLICT(month_key, device_hash) DO UPDATE SET
        best_score = CASE
            WHEN excluded.best_score > monthly_records.best_score
              OR (excluded.best_score = monthly_records.best_score AND excluded.score_run_level > monthly_records.score_run_level)
            THEN excluded.best_score ELSE monthly_records.best_score END,
        score_run_level = CASE
            WHEN excluded.best_score > monthly_records.best_score
              OR (excluded.best_score = monthly_records.best_score AND excluded.score_run_level > monthly_records.score_run_level)
            THEN excluded.score_run_level ELSE monthly_records.score_run_level END,
        score_recorded_at = CASE
            WHEN excluded.best_score > monthly_records.best_score
              OR (excluded.best_score = monthly_records.best_score AND excluded.score_run_level > monthly_records.score_run_level)
            THEN excluded.score_recorded_at ELSE monthly_records.score_recorded_at END,
        best_level = CASE
            WHEN excluded.best_level > monthly_records.best_level
              OR (excluded.best_level = monthly_records.best_level AND excluded.level_run_score > monthly_records.level_run_score)
            THEN excluded.best_level ELSE monthly_records.best_level END,
        level_run_score = CASE
            WHEN excluded.best_level > monthly_records.best_level
              OR (excluded.best_level = monthly_records.best_level AND excluded.level_run_score > monthly_records.level_run_score)
            THEN excluded.level_run_score ELSE monthly_records.level_run_score END,
        level_recorded_at = CASE
            WHEN excluded.best_level > monthly_records.best_level
              OR (excluded.best_level = monthly_records.best_level AND excluded.level_run_score > monthly_records.level_run_score)
            THEN excluded.level_recorded_at ELSE monthly_records.level_recorded_at END,
        updated_at = excluded.updated_at
`;

async function getRecordRanks(db, monthKey, deviceHash) {
    const record = await db.prepare(
        `SELECT * FROM monthly_records
         WHERE month_key = ? AND device_hash = ? AND best_score >= ${MIN_RANKING_SCORE}`
    ).bind(monthKey, deviceHash).first();
    if (!record) return { scoreRank: null, levelRank: null };
    const [scoreAhead, levelAhead] = await Promise.all([
        db.prepare(`
            SELECT COUNT(*) AS count FROM monthly_records
            WHERE month_key = ? AND best_score >= ${MIN_RANKING_SCORE} AND (
                best_score > ? OR
                (best_score = ? AND score_run_level > ?) OR
                (best_score = ? AND score_run_level = ? AND score_recorded_at < ?) OR
                (best_score = ? AND score_run_level = ? AND score_recorded_at = ? AND device_hash < ?)
            )
        `).bind(monthKey, record.best_score, record.best_score, record.score_run_level,
            record.best_score, record.score_run_level, record.score_recorded_at,
            record.best_score, record.score_run_level, record.score_recorded_at, deviceHash).first(),
        db.prepare(`
            SELECT COUNT(*) AS count FROM monthly_records
            WHERE month_key = ? AND best_score >= ${MIN_RANKING_SCORE} AND (
                best_level > ? OR
                (best_level = ? AND level_run_score > ?) OR
                (best_level = ? AND level_run_score = ? AND level_recorded_at < ?) OR
                (best_level = ? AND level_run_score = ? AND level_recorded_at = ? AND device_hash < ?)
            )
        `).bind(monthKey, record.best_level, record.best_level, record.level_run_score,
            record.best_level, record.level_run_score, record.level_recorded_at,
            record.best_level, record.level_run_score, record.level_recorded_at, deviceHash).first()
    ]);
    return {
        scoreRank: Number(scoreAhead?.count || 0) + 1,
        levelRank: Number(levelAhead?.count || 0) + 1
    };
}

async function handleRecords(context) {
    if (context.request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await readJson(context.request);
    const score = Number(body?.score);
    const level = Number(body?.level);
    if (!body || !validateDeviceId(body.deviceId) || typeof body.playToken !== 'string') {
        return json({ code: 'INVALID_REQUEST' }, 400);
    }
    if (!Number.isInteger(score) || score < 0 || score > 1000000000 || !Number.isInteger(level) || level < 1 || level > 50) {
        return json({ code: 'INVALID_RESULT', message: '記録の値が不正です' }, 400);
    }
    if (score < MIN_RANKING_SCORE) {
        return json({
            code: 'MIN_SCORE_REQUIRED',
            message: `ランキングは${MIN_RANKING_SCORE}点以上から登録できます`
        }, 422);
    }

    const db = context.env.RANKINGS_DB;
    const tokenHash = await sha256(body.playToken);
    const deviceHash = await sha256(body.deviceId);
    const session = await db.prepare('SELECT * FROM play_sessions WHERE token_hash = ?').bind(tokenHash).first();
    if (!session || session.device_hash !== deviceHash) return json({ code: 'INVALID_PLAY', message: 'プレイ情報が無効です' }, 409);
    if (session.used_at) {
        if (Number(session.result_score) === score && Number(session.result_level) === level) {
            return json({ monthKey: session.month_key, ...(await getRecordRanks(db, session.month_key, deviceHash)) });
        }
        return json({ code: 'PLAY_ALREADY_USED', message: 'このプレイは送信済みです' }, 409);
    }
    if (Number(session.expires_at) < Date.now()) return json({ code: 'PLAY_EXPIRED', message: 'プレイ情報の期限が切れています' }, 409);

    const player = await db.prepare(
        'SELECT player_name FROM monthly_players WHERE month_key = ? AND device_hash = ?'
    ).bind(session.month_key, deviceHash).first();
    if (!player) return json({ code: 'NAME_REQUIRED' }, 409);
    const now = Date.now();
    await db.batch([
        db.prepare(UPSERT_RECORD_SQL).bind(
            session.month_key, deviceHash, score, level, level, score, now, now, now, tokenHash
        ),
        db.prepare(`
            UPDATE play_sessions SET used_at = ?, result_score = ?, result_level = ?
            WHERE token_hash = ? AND used_at IS NULL
        `).bind(now, score, level, tokenHash)
    ]);
    return json({ monthKey: session.month_key, ...(await getRecordRanks(db, session.month_key, deviceHash)) });
}

async function handleRankings(context) {
    if (context.request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(context.request.url);
    const type = url.searchParams.get('type') === 'level' ? 'level' : 'score';
    const deviceId = url.searchParams.get('deviceId');
    const deviceHash = validateDeviceId(deviceId) ? await sha256(deviceId) : null;
    const monthKey = getJstMonthKey();
    const order = type === 'score'
        ? 'r.best_score DESC, r.score_run_level DESC, r.score_recorded_at ASC, r.device_hash ASC'
        : 'r.best_level DESC, r.level_run_score DESC, r.level_recorded_at ASC, r.device_hash ASC';
    const rows = await context.env.RANKINGS_DB.prepare(`
        SELECT p.player_name, p.device_hash,
            r.best_score, r.score_run_level, r.best_level, r.level_run_score
        FROM monthly_records r
        JOIN monthly_players p ON p.month_key = r.month_key AND p.device_hash = r.device_hash
        WHERE r.month_key = ? AND r.best_score >= ${MIN_RANKING_SCORE}
        ORDER BY ${order}
        LIMIT 30
    `).bind(monthKey).all();

    const entries = (rows.results || []).map((row, index) => ({
        rank: index + 1,
        playerName: row.player_name,
        level: type === 'score' ? row.score_run_level : row.best_level,
        score: type === 'score' ? row.best_score : row.level_run_score,
        isOwn: Boolean(deviceHash && row.device_hash === deviceHash)
    }));

    let ownEntry = entries.find(entry => entry.isOwn) || null;
    if (!ownEntry && deviceHash) {
        const ranks = await getRecordRanks(context.env.RANKINGS_DB, monthKey, deviceHash);
        const own = await context.env.RANKINGS_DB.prepare(`
            SELECT p.player_name, r.* FROM monthly_records r
            JOIN monthly_players p ON p.month_key = r.month_key AND p.device_hash = r.device_hash
            WHERE r.month_key = ? AND r.device_hash = ? AND r.best_score >= ${MIN_RANKING_SCORE}
        `).bind(monthKey, deviceHash).first();
        if (own) {
            ownEntry = {
                rank: type === 'score' ? ranks.scoreRank : ranks.levelRank,
                playerName: own.player_name,
                level: type === 'score' ? own.score_run_level : own.best_level,
                score: type === 'score' ? own.best_score : own.level_run_score,
                isOwn: true,
                inTop30: false
            };
        }
    }
    if (ownEntry && ownEntry.inTop30 !== false) ownEntry = { ...ownEntry, inTop30: true };
    return json({ monthKey, type, entries, ownEntry });
}

export async function onRequest(context) {
    if (!context.env.RANKINGS_DB) return json({ code: 'DATABASE_NOT_CONFIGURED', message: 'ランキングは準備中です' }, 503);
    const path = Array.isArray(context.params.path) ? context.params.path.join('/') : String(context.params.path || '');
    try {
        if (path === 'player-name') return await handlePlayerName(context);
        if (path === 'play/start') return await handlePlayStart(context);
        if (path === 'records') return await handleRecords(context);
        if (path === 'rankings') return await handleRankings(context);
        return json({ code: 'NOT_FOUND' }, 404);
    } catch (error) {
        console.error('Ranking API error', error);
        return json({ code: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' }, 500);
    }
}
