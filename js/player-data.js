const PLAYER_DATA_STORAGE_KEY = 'bugBeatBlocksPlayerData';

function getJstMonthKey(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit'
        }).formatToParts(date);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        if (year && month) return `${year}-${month}`;
    } catch (error) {}
    const shifted = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function createDeviceId() {
    try {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function createDefaultPlayerData() {
    return {
        version: 1,
        deviceId: createDeviceId(),
        playerName: '',
        playerNameMonth: '',
        allTime: { score: 0, level: 0 },
        monthly: { monthKey: getJstMonthKey(), score: 0, level: 0 },
        pendingSubmissions: []
    };
}

function normalizePlayerData(value) {
    const defaults = createDefaultPlayerData();
    if (!value || typeof value !== 'object') return defaults;
    const currentMonth = getJstMonthKey();
    const monthly = value.monthly?.monthKey === currentMonth
        ? {
            monthKey: currentMonth,
            score: Math.max(0, Number(value.monthly.score) || 0),
            level: Math.max(0, Number(value.monthly.level) || 0)
        }
        : defaults.monthly;
    return {
        version: 1,
        deviceId: typeof value.deviceId === 'string' && value.deviceId ? value.deviceId : defaults.deviceId,
        playerName: typeof value.playerName === 'string' ? value.playerName : '',
        playerNameMonth: typeof value.playerNameMonth === 'string' ? value.playerNameMonth : '',
        allTime: {
            score: Math.max(0, Number(value.allTime?.score) || 0),
            level: Math.max(0, Number(value.allTime?.level) || 0)
        },
        monthly,
        pendingSubmissions: Array.isArray(value.pendingSubmissions) ? value.pendingSubmissions.slice(-5) : []
    };
}

function loadPlayerData() {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(PLAYER_DATA_STORAGE_KEY));
        const data = normalizePlayerData(parsed);
        savePlayerData(data);
        return data;
    } catch (error) {
        return createDefaultPlayerData();
    }
}

function savePlayerData(data) {
    try {
        window.localStorage.setItem(PLAYER_DATA_STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (error) {
        return false;
    }
}

function saveRegisteredPlayerName(playerName, monthKey = getJstMonthKey()) {
    const data = loadPlayerData();
    data.playerName = playerName;
    data.playerNameMonth = monthKey;
    savePlayerData(data);
    return data;
}

function getCurrentPlayerName() {
    const data = loadPlayerData();
    return data.playerNameMonth === getJstMonthKey() ? data.playerName : '';
}

function queuePendingSubmission(submission) {
    const data = loadPlayerData();
    data.pendingSubmissions = data.pendingSubmissions.filter(item => item.playToken !== submission.playToken);
    data.pendingSubmissions.push(submission);
    data.pendingSubmissions = data.pendingSubmissions.slice(-5);
    savePlayerData(data);
}

function removePendingSubmission(playToken) {
    const data = loadPlayerData();
    data.pendingSubmissions = data.pendingSubmissions.filter(item => item.playToken !== playToken);
    savePlayerData(data);
}

function recordLocalResult(resultScore, reachedLevel) {
    const data = loadPlayerData();
    const safeScore = Math.max(0, Math.floor(Number(resultScore) || 0));
    const safeLevel = Math.max(1, Math.min(MAX_PLAYABLE_LEVEL, Math.floor(Number(reachedLevel) || 1)));
    const isNewScore = safeScore > data.allTime.score;
    const isNewLevel = safeLevel > data.allTime.level;
    const isNewMonthlyScore = safeScore > data.monthly.score;
    const isNewMonthlyLevel = safeLevel > data.monthly.level;

    data.allTime.score = Math.max(data.allTime.score, safeScore);
    data.allTime.level = Math.max(data.allTime.level, safeLevel);
    data.monthly.score = Math.max(data.monthly.score, safeScore);
    data.monthly.level = Math.max(data.monthly.level, safeLevel);
    savePlayerData(data);

    return {
        score: safeScore,
        level: safeLevel,
        bestScore: data.allTime.score,
        bestLevel: data.allTime.level,
        monthlyBestScore: data.monthly.score,
        monthlyBestLevel: data.monthly.level,
        isNewScore,
        isNewLevel,
        isNewMonthlyScore,
        isNewMonthlyLevel
    };
}

function formatGameScore(value) {
    return Math.max(0, Number(value) || 0).toLocaleString('ja-JP');
}

function buildResultShareText(result) {
    const lines = [
        'BUG BEAT BLOCKS',
        '',
        `到達レベル：Lv${result.level}`,
        `SCORE：${formatGameScore(result.score)}`,
        `自己ベスト：${formatGameScore(result.bestScore)}`
    ];
    if (Number.isInteger(result.scoreRank)) lines.push(`月間ハイスコア順位：${result.scoreRank}位`);
    lines.push('', 'ゲームに挑戦！');
    return lines.join('\n');
}

async function shareGameResult(result) {
    const text = buildResultShareText(result);
    const url = window.location.href.split('#')[0].split('?')[0];
    if (navigator.share) {
        await navigator.share({ title: 'BUG BEAT BLOCKS', text, url });
        return 'shared';
    }
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        return 'copied';
    }
    const textArea = document.createElement('textarea');
    textArea.value = `${text}\n${url}`;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    return 'copied';
}
