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
        version: 3,
        deviceId: createDeviceId(),
        playerName: '',
        playerNameMonth: '',
        allTime: { score: 0, level: 0 },
        rankingBest: { score: 0, scoreRunLevel: 0, level: 0, levelRunScore: 0 },
        monthly: { monthKey: getJstMonthKey(), score: 0, level: 0 },
        pendingSubmissions: []
    };
}

function normalizePlayerData(value) {
    const defaults = createDefaultPlayerData();
    if (!value || typeof value !== 'object') return defaults;
    const storedVersion = Math.max(1, Number(value.version) || 1);
    const currentMonth = getJstMonthKey();
    const monthly = value.monthly?.monthKey === currentMonth
        ? {
            monthKey: currentMonth,
            score: Math.max(0, Number(value.monthly.score) || 0),
            level: storedVersion >= 3 ? Math.max(0, Number(value.monthly.level) || 0) : 0
        }
        : defaults.monthly;
    return {
        version: 3,
        deviceId: typeof value.deviceId === 'string' && value.deviceId ? value.deviceId : defaults.deviceId,
        playerName: typeof value.playerName === 'string' ? value.playerName : '',
        playerNameMonth: typeof value.playerNameMonth === 'string' ? value.playerNameMonth : '',
        allTime: {
            score: Math.max(0, Number(value.allTime?.score) || 0),
            level: storedVersion >= 3 ? Math.max(0, Number(value.allTime?.level) || 0) : 0
        },
        rankingBest: {
            score: storedVersion >= 3 ? Math.max(0, Number(value.rankingBest?.score) || 0) : 0,
            scoreRunLevel: storedVersion >= 3 ? Math.max(0, Number(value.rankingBest?.scoreRunLevel) || 0) : 0,
            level: storedVersion >= 3 ? Math.max(0, Number(value.rankingBest?.level) || 0) : 0,
            levelRunScore: storedVersion >= 3 ? Math.max(0, Number(value.rankingBest?.levelRunScore) || 0) : 0
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

function saveRegisteredPlayerName(playerName) {
    const data = loadPlayerData();
    data.playerName = playerName;
    data.playerNameMonth = '';
    savePlayerData(data);
    return data;
}

function getCurrentPlayerName() {
    return loadPlayerData().playerName;
}

function shouldOfferRankingEntry(result) {
    if (!result || result.rankingFinalized || Number(result.clearedStages) < 1) return false;
    if (!getCurrentPlayerName()) return true;
    return Boolean(result.isNewRankingScore || result.isNewRankingLevel);
}

function isBetterRankingScore(score, level, rankingBest) {
    return score > rankingBest.score
        || (score === rankingBest.score && level > rankingBest.scoreRunLevel);
}

function isBetterRankingLevel(score, level, rankingBest) {
    return level > rankingBest.level
        || (level === rankingBest.level && score > rankingBest.levelRunScore);
}

function rememberRankingSubmission(result) {
    const data = loadPlayerData();
    const score = Math.max(0, Math.floor(Number(result.score) || 0));
    const level = Math.max(1, Math.min(MAX_PLAYABLE_LEVEL, Math.floor(Number(result.level) || 1)));
    if (isBetterRankingScore(score, level, data.rankingBest)) {
        data.rankingBest.score = score;
        data.rankingBest.scoreRunLevel = level;
    }
    if (isBetterRankingLevel(score, level, data.rankingBest)) {
        data.rankingBest.level = level;
        data.rankingBest.levelRunScore = score;
    }
    savePlayerData(data);
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

function recordLocalResult(resultScore, clearedLevel, clearedStages = Number(clearedLevel) > 0 ? 1 : 0) {
    const data = loadPlayerData();
    const safeScore = Math.max(0, Math.floor(Number(resultScore) || 0));
    const safeLevel = Math.max(0, Math.min(MAX_PLAYABLE_LEVEL, Math.floor(Number(clearedLevel) || 0)));
    const safeClearedStages = Math.max(0, Math.floor(Number(clearedStages) || 0));
    const isRankingEligible = safeClearedStages >= 1 && safeLevel >= 1;
    const isNewScore = safeScore > data.allTime.score;
    const isNewLevel = safeLevel > data.allTime.level;
    const isNewMonthlyScore = safeScore > data.monthly.score;
    const isNewMonthlyLevel = safeLevel > data.monthly.level;
    const isNewRankingScore = isRankingEligible
        && isBetterRankingScore(safeScore, safeLevel, data.rankingBest);
    const isNewRankingLevel = isRankingEligible
        && isBetterRankingLevel(safeScore, safeLevel, data.rankingBest);

    data.allTime.score = Math.max(data.allTime.score, safeScore);
    data.allTime.level = Math.max(data.allTime.level, safeLevel);
    data.monthly.score = Math.max(data.monthly.score, safeScore);
    data.monthly.level = Math.max(data.monthly.level, safeLevel);
    savePlayerData(data);

    return {
        score: safeScore,
        level: safeLevel,
        clearedStages: safeClearedStages,
        bestScore: data.allTime.score,
        bestLevel: data.allTime.level,
        monthlyBestScore: data.monthly.score,
        monthlyBestLevel: data.monthly.level,
        isNewScore,
        isNewLevel,
        isNewRankingScore,
        isNewRankingLevel,
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
        `クリアレベル：${result.level > 0 ? `Lv${result.level}` : 'なし'}`,
        `SCORE：${formatGameScore(result.score)}`,
        `自己ベスト：${formatGameScore(result.bestScore)}`
    ];
    if (Number.isInteger(result.scoreRank)) lines.push(`歴代ハイスコア順位：${result.scoreRank}位`);
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
