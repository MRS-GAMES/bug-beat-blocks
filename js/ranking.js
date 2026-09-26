let currentRankingType = 'score';
let activePlayToken = null;
let playStartSequence = 0;
let activePlayStartPromise = Promise.resolve(null);
let playerNameFlow = null;

async function requestRankingApi(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let data = {};
    try {
        data = await response.json();
    } catch (error) {}
    if (!response.ok) {
        const apiError = new Error(data.message || '通信に失敗しました');
        apiError.status = response.status;
        apiError.code = data.code;
        apiError.suggestions = data.suggestions || [];
        throw apiError;
    }
    return data;
}

function normalizePlayerNameInput(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function formatRankingMonth(monthKey = getJstMonthKey()) {
    const [year, month] = monthKey.split('-');
    return `${year}年${Number(month)}月`;
}

function updateRankingPlayerName() {
    const button = document.getElementById('ranking-player-name');
    const playerName = getCurrentPlayerName();
    button.innerText = playerName || '名前を登録';
    button.classList.toggle('unregistered', !playerName);
}

async function reclaimSavedPlayerName() {
    const data = loadPlayerData();
    if (getCurrentPlayerName() || !data.playerName) return Boolean(getCurrentPlayerName());
    try {
        const response = await requestRankingApi('/api/player-name', {
            method: 'POST',
            body: JSON.stringify({ deviceId: data.deviceId, playerName: data.playerName })
        });
        saveRegisteredPlayerName(response.playerName, response.monthKey);
        return true;
    } catch (error) {
        return false;
    }
}

function openPlayerNameScreen(options = {}) {
    const data = loadPlayerData();
    const input = document.getElementById('player-name-input');
    input.value = data.playerName || '';
    document.getElementById('player-name-error').innerText = '';
    document.getElementById('player-name-suggestions').innerHTML = '';
    playerNameFlow = options.mode === 'result' ? options : { mode: 'ranking' };
    const isResultEntry = playerNameFlow.mode === 'result';
    document.getElementById('player-name-title').innerText = isResultEntry ? 'RANKING ENTRY' : 'PLAYER NAME';
    const prompt = document.getElementById('player-name-prompt');
    prompt.classList.toggle('hidden', !isResultEntry);
    prompt.innerText = isResultEntry
        ? `Lv${playerNameFlow.result.level} / ${formatGameScore(playerNameFlow.result.score)}点を登録します`
        : '';
    document.getElementById('player-name-actions').classList.toggle('result-entry-actions', isResultEntry);
    document.getElementById('player-name-save-btn').innerText = isResultEntry ? 'この名前で登録' : 'この名前にする';
    document.getElementById('player-name-cancel-btn').innerText = isResultEntry ? '登録しない' : '戻る';
    changeScreen('PLAYER_NAME');
    setTimeout(() => input.focus(), 50);
}

function openRankingResultNameScreen(result, options = {}) {
    openPlayerNameScreen({
        mode: 'result',
        result,
        onComplete: options.onComplete,
        onCancel: options.onCancel
    });
}

function renderNameSuggestions(suggestions) {
    const container = document.getElementById('player-name-suggestions');
    container.innerHTML = '';
    suggestions.forEach(name => {
        const button = document.createElement('button');
        button.type = 'button';
        button.innerText = name;
        button.onclick = () => {
            document.getElementById('player-name-input').value = name;
            submitPlayerName(name);
        };
        container.appendChild(button);
    });
}

async function submitPlayerName(inputValue) {
    const playerName = normalizePlayerNameInput(inputValue);
    const error = document.getElementById('player-name-error');
    const saveButton = document.getElementById('player-name-save-btn');
    if (!playerName) {
        error.innerText = '1〜5文字で入力してください';
        return;
    }
    const data = loadPlayerData();
    error.innerText = '確認中...';
    saveButton.disabled = true;
    try {
        const response = await requestRankingApi('/api/player-name', {
            method: 'POST',
            body: JSON.stringify({ deviceId: data.deviceId, playerName })
        });
        saveRegisteredPlayerName(response.playerName, response.monthKey);
        error.innerText = '';
        if (playerNameFlow?.mode === 'result') {
            const completedFlow = playerNameFlow;
            const submitted = await submitCurrentRankingResult(completedFlow.result);
            if (!submitted) {
                error.innerText = '記録を送信できませんでした。もう一度お試しください';
                return;
            }
            playerNameFlow = null;
            if (typeof completedFlow.onComplete === 'function') completedFlow.onComplete();
        } else {
            playerNameFlow = null;
            changeScreen('RANKING');
        }
    } catch (apiError) {
        error.innerText = apiError.status === 409
            ? 'その名前は今月すでに使われています'
            : '名前を登録できませんでした。通信を確認してください';
        renderNameSuggestions(apiError.suggestions || []);
    } finally {
        saveButton.disabled = false;
    }
}

function createRankingRow(entry, isOwn = false) {
    const row = document.createElement('div');
    row.className = `ranking-row${isOwn ? ' own' : ''}`;
    row.innerHTML = `<span>${entry.rank}</span><strong>${entry.playerName}</strong><span>Lv${entry.level}</span><span>${formatGameScore(entry.score)}</span>`;
    return row;
}

async function refreshRankingScreen() {
    await reclaimSavedPlayerName();
    updateRankingPlayerName();
    document.getElementById('ranking-month').innerText = formatRankingMonth();
    document.getElementById('ranking-score-tab').classList.toggle('active', currentRankingType === 'score');
    document.getElementById('ranking-level-tab').classList.toggle('active', currentRankingType === 'level');
    const list = document.getElementById('ranking-list');
    const message = document.getElementById('ranking-message');
    const ownRow = document.getElementById('ranking-own-row');
    const retryButton = document.getElementById('ranking-retry-btn');
    list.innerHTML = '';
    message.innerText = '読み込み中...';
    message.classList.remove('hidden');
    ownRow.classList.add('hidden');
    retryButton.classList.add('hidden');

    const data = loadPlayerData();
    try {
        await retryPendingRankingSubmissions();
        const query = new URLSearchParams({ type: currentRankingType, deviceId: data.deviceId });
        const response = await requestRankingApi(`/api/rankings?${query}`);
        message.classList.toggle('hidden', response.entries.length > 0);
        if (response.entries.length === 0) message.innerText = '今月の記録はまだありません';
        response.entries.forEach(entry => list.appendChild(createRankingRow(entry, entry.isOwn)));
        if (response.ownEntry && !response.ownEntry.inTop30) {
            ownRow.innerHTML = '';
            ownRow.appendChild(createRankingRow(response.ownEntry, true));
            ownRow.classList.remove('hidden');
        }
    } catch (error) {
        message.innerText = 'ランキングを読み込めませんでした';
        message.classList.remove('hidden');
        retryButton.classList.remove('hidden');
    }
}

async function startOnlinePlay() {
    const requestSequence = ++playStartSequence;
    activePlayToken = null;
    activePlayStartPromise = (async () => {
        await reclaimSavedPlayerName();
        const data = loadPlayerData();
        retryPendingRankingSubmissions();
        try {
            const response = await requestRankingApi('/api/play/start', {
                method: 'POST',
                body: JSON.stringify({ deviceId: data.deviceId })
            });
            if (requestSequence === playStartSequence) activePlayToken = response.playToken;
            return response.playToken;
        } catch (error) {
            addLog(`Ranking play start failed: ${error.message}`);
            return null;
        }
    })();
    return activePlayStartPromise;
}

async function sendRankingResult(submission) {
    const response = await requestRankingApi('/api/records', {
        method: 'POST',
        body: JSON.stringify(submission)
    });
    removePendingSubmission(submission.playToken);
    return response;
}

async function retryPendingRankingSubmissions() {
    const pending = loadPlayerData().pendingSubmissions;
    for (const submission of pending) {
        try {
            await sendRankingResult(submission);
        } catch (error) {
            if (error.status >= 400 && error.status < 500 && error.status !== 429) {
                removePendingSubmission(submission.playToken);
            }
        }
    }
}

async function submitCurrentRankingResult(result) {
    const status = document.getElementById('result-ranking-status');
    const data = loadPlayerData();
    if (result.score < MIN_RANKING_SCORE) {
        status.innerText = `ランキングは${formatGameScore(MIN_RANKING_SCORE)}点以上から登録できます`;
        status.classList.remove('hidden');
        return false;
    }
    if (!getCurrentPlayerName()) {
        status.innerText = '名前登録後のプレイからランキング対象';
        status.classList.remove('hidden');
        return false;
    }
    if (!activePlayToken) await activePlayStartPromise;
    if (!activePlayToken) {
        status.innerText = '今回はランキング通信の対象外です';
        status.classList.remove('hidden');
        return false;
    }
    const submission = {
        deviceId: data.deviceId,
        playToken: activePlayToken,
        score: result.score,
        level: result.level
    };
    activePlayToken = null;
    result.rankingFinalized = true;
    queuePendingSubmission(submission);
    status.innerText = '月間ランキングへ送信中...';
    status.classList.remove('hidden');
    try {
        const response = await sendRankingResult(submission);
        result.scoreRank = response.scoreRank;
        result.levelRank = response.levelRank;
        status.innerText = `月間 SCORE ${response.scoreRank}位 / LEVEL ${response.levelRank}位`;
    } catch (error) {
        status.innerText = '通信後にランキング送信を再試行します';
    }
    return true;
}

function cancelPlayerNameFlow() {
    if (playerNameFlow?.mode === 'result') {
        const cancelledFlow = playerNameFlow;
        playerNameFlow = null;
        if (typeof cancelledFlow.onCancel === 'function') cancelledFlow.onCancel();
        return;
    }
    playerNameFlow = null;
    changeScreen('RANKING');
}

function discardActiveRankingPlay() {
    playStartSequence += 1;
    activePlayToken = null;
    activePlayStartPromise = Promise.resolve(null);
}

document.getElementById('ranking-btn').onclick = () => changeScreen('RANKING');
document.getElementById('ranking-back-btn').onclick = () => changeScreen('TITLE');
document.getElementById('ranking-player-name').onclick = () => openPlayerNameScreen();
document.getElementById('ranking-retry-btn').onclick = refreshRankingScreen;
document.getElementById('ranking-score-tab').onclick = () => {
    currentRankingType = 'score';
    refreshRankingScreen();
};
document.getElementById('ranking-level-tab').onclick = () => {
    currentRankingType = 'level';
    refreshRankingScreen();
};
document.getElementById('player-name-input').addEventListener('input', event => {
    const normalized = normalizePlayerNameInput(event.target.value);
    if (event.target.value !== normalized) event.target.value = normalized;
});
document.getElementById('player-name-save-btn').onclick = () => {
    submitPlayerName(document.getElementById('player-name-input').value);
};
document.getElementById('player-name-cancel-btn').onclick = cancelPlayerNameFlow;
