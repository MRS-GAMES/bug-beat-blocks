function resizeCanvas() {
    const playArea = document.getElementById('play-area');
    const containerW = playArea.clientWidth;
    const containerH = playArea.clientHeight;

    let sidePanelW = 82;
    let availableBoardW = containerW - sidePanelW - 8;

    let sizeFromW = Math.floor(availableBoardW / COLS);
    let sizeFromH = Math.floor(containerH / ROWS);

    BLOCK_SIZE = Math.max(1, Math.min(sizeFromW, sizeFromH));

    let boardWidth = COLS * BLOCK_SIZE;
    let boardHeight = ROWS * BLOCK_SIZE;

    canvas.width = boardWidth;
    canvas.height = boardHeight;

    canvas.style.width = `${boardWidth}px`;
    canvas.style.height = `${boardHeight}px`;

    const sidePanel = document.getElementById('side-panel');
    sidePanel.style.width = `${sidePanelW}px`;
    sidePanel.style.height = `${boardHeight}px`;
}

function changeScreen(state, options = {}) {
    gameState = state;
    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('how-to-screen').classList.add('hidden');
    document.getElementById('level-screen').classList.add('hidden');
    document.getElementById('ranking-screen').classList.add('hidden');
    document.getElementById('player-name-screen').classList.add('hidden');
    document.getElementById('overlay-screen').classList.add('hidden');
    document.getElementById('pause-screen').classList.add('hidden');
    document.getElementById('log-screen').classList.add('hidden');
    document.getElementById('game-header').classList.add('hidden');
    document.getElementById('side-panel').classList.add('hidden');

    if (state === 'TITLE') {
        document.getElementById('title-screen').classList.remove('hidden');
    } else if (state === 'HOW_TO') {
        document.getElementById('how-to-screen').classList.remove('hidden');
        document.querySelector('.how-to-content').scrollTop = 0;
    } else if (state === 'LEVEL_SELECT') {
        document.getElementById('level-screen').classList.remove('hidden');
        buildLevelGrid();
    } else if (state === 'RANKING') {
        document.getElementById('ranking-screen').classList.remove('hidden');
        refreshRankingScreen();
    } else if (state === 'PLAYER_NAME') {
        document.getElementById('player-name-screen').classList.remove('hidden');
    } else if (state === 'PLAYING') {
        document.getElementById('game-header').classList.remove('hidden');
        document.getElementById('side-panel').classList.remove('hidden');
        resizeCanvas();
    } else if (state === 'PAUSED') {
        document.getElementById('game-header').classList.remove('hidden');
        document.getElementById('pause-screen').classList.remove('hidden');
    } else if (state === 'LOGS') {
        document.getElementById('game-header').classList.remove('hidden');
        document.getElementById('log-screen').classList.remove('hidden');
        const container = document.getElementById('log-container');
        container.innerText = devLogs.join('\n') || 'ログはまだありません。';
        container.scrollTop = container.scrollHeight;
    } else if (state === 'GAMEOVER' || state === 'STAGECLEAR') {
        if (state === 'STAGECLEAR') {
            const unlockedLevel = getNextLevel(selectedLevel);
            if (unlockedLevel !== null) saveHighestEndlessLevel(unlockedLevel);
        }
        document.getElementById('overlay-screen').classList.remove('hidden');
        document.getElementById('game-header').classList.remove('hidden');
        document.getElementById('overlay-title').innerText = state === 'GAMEOVER' ? 'TRY AGAIN?' : 'CLEAR!';
        const isFinalLevelClear = state === 'STAGECLEAR' && getNextLevel(selectedLevel) === null;
        const isFinalResult = state === 'GAMEOVER' || isFinalLevelClear;
        const result = options.result || (isFinalResult ? recordLocalResult(score, selectedLevel) : {
            score,
            level: selectedLevel,
            bestScore: loadPlayerData().allTime.score,
            isNewScore: false,
            isNewLevel: false
        });
        window.currentGameResult = result;
        document.getElementById('result-level').innerText = `Lv${result.level}`;
        document.getElementById('result-score').innerText = formatGameScore(result.score);
        document.getElementById('result-best-score').innerText = formatGameScore(result.bestScore);
        document.getElementById('result-best-row').classList.toggle('hidden', !isFinalResult);
        document.getElementById('result-record-badge').classList.toggle('hidden', !(result.isNewScore || result.isNewLevel));
        document.getElementById('share-result-btn').classList.toggle('hidden', !isFinalResult);
        const rankingStatus = document.getElementById('result-ranking-status');
        rankingStatus.classList.toggle('hidden', state !== 'GAMEOVER');
        if (state === 'GAMEOVER') {
            rankingStatus.innerText = result.score >= MIN_RANKING_SCORE
                ? 'リトライまたはタイトルに戻る時にランキング登録できます'
                : `${formatGameScore(MIN_RANKING_SCORE)}点以上でランキング登録できます`;
        }
        document.getElementById('overlay-action-btn').innerText = state === 'GAMEOVER'
            ? 'RETRY'
            : (isFinalLevelClear ? 'LEVEL SELECT' : 'NEXT STAGE');
        document.getElementById('overlay-action-btn').className = state === 'GAMEOVER' ? 'btn coral' : 'btn mint';
        document.getElementById('overlay-title-btn').classList.toggle('hidden', state !== 'GAMEOVER');
        if (isFinalLevelClear && result.score >= MIN_RANKING_SCORE && !options.skipRankingPrompt) {
            setTimeout(() => openRankingResultNameScreen(result, {
                onComplete: () => changeScreen(state, { skipRankingPrompt: true, result }),
                onCancel: () => changeScreen(state, { skipRankingPrompt: true, result })
            }), 0);
        }
    }
}

/**
 * レベル選択には通常ステージのLv1〜30だけを表示する。
 */
function buildLevelGrid() {
    const grid = document.getElementById('level-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= MAX_SELECTABLE_LEVEL; i++) {
        const btn = document.createElement('div');
        btn.className = `lvl-btn`;
        const bugCount = getLevelConfig(i).enemyCount;
        btn.innerHTML = `${i}<span class="bug-count">●×${bugCount}</span>`;
        btn.onclick = () => {
            selectedLevel = i;
            score = 0;
            startOnlinePlay();
            setupStage(selectedLevel);
            changeScreen('PLAYING');
        };
        grid.appendChild(btn);
    }
    updateEndlessContinueButton();
}

const ENDLESS_LEVEL_STORAGE_KEY = 'bugBeatBlocksEndlessLevel';

function loadHighestEndlessLevel() {
    try {
        const savedLevel = Number(window.localStorage.getItem(ENDLESS_LEVEL_STORAGE_KEY));
        if (!Number.isInteger(savedLevel) || savedLevel < 31) return null;
        return Math.min(savedLevel, MAX_PLAYABLE_LEVEL);
    } catch (error) {
        return null;
    }
}

function saveHighestEndlessLevel(level) {
    if (level < 31 || level > MAX_PLAYABLE_LEVEL) return;
    try {
        const savedLevel = loadHighestEndlessLevel() || 30;
        window.localStorage.setItem(ENDLESS_LEVEL_STORAGE_KEY, String(Math.max(savedLevel, level)));
    } catch (error) {}
}

function updateEndlessContinueButton() {
    const button = document.getElementById('endless-continue-btn');
    const savedLevel = loadHighestEndlessLevel();
    button.classList.toggle('hidden', savedLevel === null);
    if (savedLevel !== null) button.innerText = `ENDLESS Lv${savedLevel}から再開`;
}

document.getElementById('endless-continue-btn').onclick = () => {
    const savedLevel = loadHighestEndlessLevel();
    if (savedLevel === null) return;
    selectedLevel = savedLevel;
    score = 0;
    startOnlinePlay();
    setupStage(selectedLevel);
    changeScreen('PLAYING');
};

document.getElementById('start-btn').onclick = () => {
    initAudio();
    addLog('Game Started: Level Select');
    changeScreen('LEVEL_SELECT');
};
document.getElementById('how-to-btn').onclick = () => changeScreen('HOW_TO');
document.getElementById('how-to-back-btn').onclick = () => changeScreen('TITLE');
document.getElementById('back-title-btn').onclick = () => changeScreen('TITLE');

function restartCurrentLevel() {
    discardActiveRankingPlay();
    score = 0;
    startOnlinePlay();
    setupStage(selectedLevel);
    changeScreen('PLAYING');
}

function returnToTitleFromPlay() {
    discardActiveRankingPlay();
    score = 0;
    changeScreen('TITLE');
}

function registerCurrentRunBefore(onComplete) {
    const result = recordLocalResult(score, selectedLevel);
    window.currentGameResult = result;
    if (result.score < MIN_RANKING_SCORE) {
        onComplete();
        return;
    }
    openRankingResultNameScreen(result, {
        onComplete,
        onCancel: onComplete
    });
}

function continueGameOverAfterRanking(onComplete) {
    const result = window.currentGameResult;
    if (!result || result.score < MIN_RANKING_SCORE || result.rankingFinalized) {
        onComplete();
        return;
    }
    openRankingResultNameScreen(result, {
        onComplete,
        onCancel: onComplete
    });
}

document.getElementById('overlay-action-btn').onclick = () => {
    if (gameState === 'GAMEOVER') {
        continueGameOverAfterRanking(restartCurrentLevel);
    } else if (gameState === 'STAGECLEAR') {
        const nextLevel = getNextLevel(selectedLevel);
        if (nextLevel === null) {
            changeScreen('LEVEL_SELECT');
            return;
        }
        selectedLevel = nextLevel;
        saveHighestEndlessLevel(selectedLevel);
        setupStage(selectedLevel);
        changeScreen('PLAYING');
    }
};

document.getElementById('overlay-title-btn').onclick = () => {
    if (gameState !== 'GAMEOVER') return;
    continueGameOverAfterRanking(returnToTitleFromPlay);
};

document.getElementById('share-result-btn').onclick = async () => {
    if (!window.currentGameResult) return;
    const button = document.getElementById('share-result-btn');
    try {
        const result = await shareGameResult(window.currentGameResult);
        if (result === 'copied') {
            button.innerText = 'コピーしました！';
            setTimeout(() => { button.innerText = '結果を共有'; }, 1600);
        }
    } catch (error) {
        if (error?.name !== 'AbortError') {
            button.innerText = '共有できませんでした';
            setTimeout(() => { button.innerText = '結果を共有'; }, 1600);
        }
    }
};

document.getElementById('pause-btn').onclick = () => {
    if (gameState === 'PLAYING') changeScreen('PAUSED');
};
document.getElementById('resume-btn').onclick = () => {
    if (gameState === 'PAUSED') changeScreen('PLAYING');
};
document.getElementById('pause-retry-btn').onclick = () => {
    if (!window.confirm('現在のスコアはリセットされます。\nやり直しますか？')) return;
    registerCurrentRunBefore(restartCurrentLevel);
};
document.getElementById('pause-title-btn').onclick = () => {
    if (!window.confirm('現在のスコアはリセットされます。\nタイトルに戻りますか？')) return;
    registerCurrentRunBefore(returnToTitleFromPlay);
};
document.getElementById('close-log-btn').onclick = () => {
    changeScreen('PAUSED');
};

document.getElementById('copy-log-btn').onclick = () => {
    const logText = devLogs.join('\n');
    if (!logText) return;

    const textArea = document.createElement('textarea');
    textArea.value = logText;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        const copyBtn = document.getElementById('copy-log-btn');
        copyBtn.innerText = 'コピー完了！';
        setTimeout(() => { copyBtn.innerText = 'コピー'; }, 1500);
    } catch(err) {}
    document.body.removeChild(textArea);
};

function rotatePiece() {
    if (gameState !== 'PLAYING' || isAnimating || !currentPiece) return;
    let oldShape = currentPiece.shape;
    let rotated = oldShape[0].map((_, i) => oldShape.map(row => row[i]).reverse());
    let oldX = currentPiece.x;

    currentPiece.shape = rotated;
    if (checkCollisionAt(currentPiece.x, currentPiece.y, currentPiece.shape)) {
        currentPiece.x -= 1;
        if (checkCollisionAt(currentPiece.x, currentPiece.y, currentPiece.shape)) {
            currentPiece.x += 2;
            if (checkCollisionAt(currentPiece.x, currentPiece.y, currentPiece.shape)) {
                currentPiece.x = oldX;
                currentPiece.shape = oldShape;
            }
        }
    }
}

function movePiece(dir) {
    if (gameState !== 'PLAYING' || isAnimating || !currentPiece) return;
    let nextX = currentPiece.x + dir;
    if (!checkCollisionAt(nextX, currentPiece.y, currentPiece.shape)) {
        currentPiece.x = nextX;
    }
}

document.getElementById('btn-rotate').onclick = (e) => { e.preventDefault(); rotatePiece(); };
document.getElementById('btn-left').onclick = (e) => { e.preventDefault(); movePiece(-1); };
document.getElementById('btn-right').onclick = (e) => { e.preventDefault(); movePiece(1); };

const fastBtn = document.getElementById('btn-fast');
const startFastDrop = (e) => {
    e.preventDefault();
    isFastDropping = true;
    fastBtn.classList.add('active');
};
const stopFastDrop = (e) => {
    e.preventDefault();
    isFastDropping = false;
    fastBtn.classList.remove('active');
};
fastBtn.addEventListener('pointerdown', startFastDrop);
fastBtn.addEventListener('pointerup', stopFastDrop);
fastBtn.addEventListener('pointercancel', stopFastDrop);
fastBtn.addEventListener('pointerleave', stopFastDrop);
