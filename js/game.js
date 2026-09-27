function setupStage(level) {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    groupBoard = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    batBugs = [];
    eggTransitionActions = [];
    eggTurnCheckPending = false;
    eggBatSequence = 0;
    nextGroupId = 1;

    const levelConfig = getLevelConfig(level);
    const enemyTypes = buildStageEnemyTypes(levelConfig);
    const placements = createEnemyPlacements(enemyTypes, level);
    const bugCount = levelConfig.enemyCount;
    remainingEnemies = bugCount;

    placements.forEach(({ x, y, bugType }, index) => {
        if (isBatBugType(bugType)) {
            batBugs.push({
                id: `bat_${index}`,
                row: y,
                posX: x,
                dir: Math.random() < 0.5 ? 1 : -1,
                speed: 1.8,
                minX: Math.max(0, x - 2),
                maxX: Math.min(COLS - 1, x + 2),
                type: bugType
            });
        }
        board[y][x] = bugType;
        groupBoard[y][x] = -1;
    });

    normalDropInterval = 1000;
    currentPiece = new Piece(Math.floor(Math.random() * 7) + 1);
    nextPiece = new Piece(Math.floor(Math.random() * 7) + 1);
    dropCounter = 0;
    dropInterval = 1000;
    lastTime = performance.now();
    particles = [];
    popTexts = [];
    flashAlpha = 0;
    pendingClearBlocks = [];
    pendingClearBugs = [];
    pendingRainbowClearBlocks = [];
    pendingRainbowColors = [];
    pendingRainbowSourceCells = [];
    fallingGroups = [];
    isAnimating = false;
    isFastDropping = false;
    animPhase = 'NONE';
    animTimer = 0;
    advanceAfterResolution = true;
    chainCount = 0;
    isDragging = false;
    clearTimeout(holdTimer);
    holdTimer = null;
    fastBtn.classList.remove('active');

    const eggCount = enemyTypes.filter(type => type === EGG_BUG).length;
    addLog(`Setup Stage ${level}: ${bugCount} bugs (Egg Bugs: ${eggCount}, Bat Bugs: ${batBugs.length})`);
}

function shuffleArray(values) {
    const shuffled = [...values];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function resolveEnemyKind(kind) {
    const fixedTypes = {
        white: 8,
        metal: 13,
        batWhite: 14,
        batMetal: 19,
        egg: EGG_BUG
    };
    if (kind === 'color') return Math.floor(Math.random() * 4) + 9;
    if (kind === 'batColor') return Math.floor(Math.random() * 4) + 15;
    return fixedTypes[kind] || 8;
}

function buildStageEnemyTypes(levelConfig) {
    const enemyKinds = [...levelConfig.guaranteed];
    while (enemyKinds.length < levelConfig.enemyCount) {
        const eggCount = enemyKinds.filter(kind => kind === 'egg').length;
        const batCount = enemyKinds.filter(isBatEnemyKind).length;
        const availablePool = levelConfig.randomPool.filter(kind => {
            if (kind === 'egg' && eggCount >= (levelConfig.limits?.eggs ?? Infinity)) return false;
            if (isBatEnemyKind(kind) && batCount >= (levelConfig.limits?.bats ?? Infinity)) return false;
            return true;
        });
        const fallbackPool = ['white', 'color', 'metal'];
        const pool = availablePool.length > 0 ? availablePool : fallbackPool;
        const kind = pool[Math.floor(Math.random() * pool.length)];
        enemyKinds.push(kind);
    }
    return enemyKinds.map(resolveEnemyKind);
}

function isBatEnemyKind(kind) {
    return kind === 'batWhite' || kind === 'batColor' || kind === 'batMetal';
}

function isBatBugType(bugType) {
    return bugType >= 14 && bugType <= 19;
}

function createEnemyPlacements(enemyTypes, level) {
    if (level >= 29) {
        const randomSlots = [];
        const minPlacementRow = getEndlessPlacementMinRow(level);
        for (let y = minPlacementRow; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) randomSlots.push({ x, y });
        }
        const shuffledSlots = shuffleArray(randomSlots).slice(0, enemyTypes.length);
        const shuffledTypes = shuffleArray(enemyTypes);
        return shuffledSlots.map((slot, index) => ({ ...slot, bugType: shuffledTypes[index] }));
    }

    const placementRows = [17, 15, 13, 11, 9, 7, 16, 14, 12, 10];
    const slots = enemyTypes.map((_, index) => ({
        x: (index * 3 + 2) % COLS,
        y: placementRows[Math.floor(index / 2)]
    }));
    const batTypes = shuffleArray(enemyTypes.filter(isBatBugType));
    const groundedTypes = shuffleArray(enemyTypes.filter(type => !isBatBugType(type)));
    const placements = [];
    const availableSlots = [...slots];
    const availableRows = shuffleArray([...new Set(slots.map(slot => slot.y))]);

    batTypes.forEach(bugType => {
        const row = availableRows.shift();
        const rowSlots = availableSlots.filter(slot => slot.y === row);
        const slot = rowSlots[Math.floor(Math.random() * rowSlots.length)] || availableSlots[0];
        placements.push({ ...slot, bugType });
        availableSlots.splice(availableSlots.indexOf(slot), 1);
    });

    shuffleArray(availableSlots).forEach((slot, index) => {
        placements.push({ ...slot, bugType: groundedTypes[index] });
    });

    return placements;
}

function isObstacleAt(r, c, currentBatId, includeOtherBats = true) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;

    let cell = board[r][c];
    if (cell !== 0 && (cell < 14 || cell > 19)) return true;

    if (includeOtherBats) {
        for (let b of batBugs) {
            if (b.id === currentBatId) continue;
            if (b.row === r && Math.round(b.posX) === c) return true;
        }
    }

    if (currentPiece && gameState === 'PLAYING' && !isAnimating) {
        let shape = currentPiece.shape;
        for (let pr = 0; pr < shape.length; pr++) {
            for (let pc = 0; pc < shape[pr].length; pc++) {
                if (shape[pr][pc]) {
                    if (currentPiece.y + pr === r && currentPiece.x + pc === c) return true;
                }
            }
        }
    }

    for (let g of fallingGroups) {
        for (let cell of g.cells) {
            let fallR = Math.round(cell.r + g.currentOffsetY);
            if (fallR === r && cell.c === c) return true;
        }
    }

    return false;
}

function updateBatBugs(dt) {
    if (gameState !== 'PLAYING' || isAnimating) return;

    let sec = dt / 1000;
    let movedCellOut = false;

    batBugs.forEach(b => {
        let currentGridX = Math.round(b.posX);

        // 真上のコウモリは移動を妨げない。同じ段のコウモリ同士は従来どおり衝突させる。
        let hasBlockAbove = isObstacleAt(b.row - 1, currentGridX, b.id, false);
        if (hasBlockAbove && b.row > 0) {
            b.posX = currentGridX;
            if (board[b.row][currentGridX] === 0) {
                board[b.row][currentGridX] = b.type;
                groupBoard[b.row][currentGridX] = -1;
            }
            return;
        }

        let effMinX = b.minX;
        let effMaxX = b.maxX;

        for (let x = currentGridX - 1; x >= b.minX; x--) {
            if (isObstacleAt(b.row, x, b.id)) {
                effMinX = x + 1;
                break;
            }
        }
        for (let x = currentGridX + 1; x <= b.maxX; x++) {
            if (isObstacleAt(b.row, x, b.id)) {
                effMaxX = x - 1;
                break;
            }
        }

        if (effMinX >= effMaxX) {
            b.posX = currentGridX;
            if (board[b.row][currentGridX] === 0) {
                board[b.row][currentGridX] = b.type;
                groupBoard[b.row][currentGridX] = -1;
            }
            return;
        }

        let nextX = b.posX + b.dir * b.speed * sec;

        if (b.dir < 0 && nextX <= effMinX) {
            nextX = effMinX;
            b.dir = 1;
        } else if (b.dir > 0 && nextX >= effMaxX) {
            nextX = effMaxX;
            b.dir = -1;
        }

        b.posX = nextX;
        let newGridX = Math.round(b.posX);

        if (newGridX !== currentGridX) {
            let myType = board[b.row][currentGridX];
            if (myType >= 14 && myType <= 19) {
                board[b.row][currentGridX] = 0;
                groupBoard[b.row][currentGridX] = 0;
            }
            if (!isObstacleAt(b.row, newGridX, b.id)) {
                board[b.row][newGridX] = b.type;
                groupBoard[b.row][newGridX] = -1;
            } else {
                b.posX = currentGridX;
                board[b.row][currentGridX] = b.type;
                groupBoard[b.row][currentGridX] = -1;
            }
            movedCellOut = true;
        }
    });

    if (movedCellOut) {
        checkAndTriggerFloatingBlocksGravity();
    }
}

function checkAndTriggerFloatingBlocksGravity() {
    if (isAnimating) return;

    let hasFloating = false;
    for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS; c++) {
            let type = board[r][c];
            if (type >= 1 && type <= RAINBOW_BLOCK) {
                if (board[r + 1][c] === 0) {
                    hasFloating = true;
                    break;
                }
            }
        }
        if (hasFloating) break;
    }

    if (hasFloating) {
        setupGroupGravityAnimation(false);
    }
}

function updateUI() {
    document.getElementById('ui-level').innerText = selectedLevel;
    document.getElementById('ui-bugs').innerText = remainingEnemies;
    document.getElementById('ui-score').innerText = score;
    drawMiniPiece(nextCtx, nextCanvas, nextPiece);
}

function drawMiniPiece(targetCtx, targetCanvas, piece) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    if (!piece) return;
    let size = 15;
    let shape = piece.shape;
    let w = shape[0].length * size;
    let h = shape.length * size;
    let startX = (targetCanvas.width - w) / 2;
    let startY = (targetCanvas.height - h) / 2;

    shape.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val) {
                if (val === RAINBOW_BLOCK) {
                    const x = startX + c * size;
                    const y = startY + r * size;
                    const pulse = 0.65 + Math.sin(performance.now() / 150) * 0.25;
                    targetCtx.save();
                    targetCtx.shadowColor = `rgba(255,255,255,${pulse})`;
                    targetCtx.shadowBlur = 8;
                    targetCtx.fillStyle = createRainbowGradient(targetCtx, x, y, size, size, (performance.now() / 3000) % 1);
                    targetCtx.fillRect(x, y, size - 1, size - 1);
                    targetCtx.strokeStyle = 'rgba(255,255,255,0.95)';
                    targetCtx.lineWidth = 1.5;
                    targetCtx.strokeRect(x + 0.5, y + 0.5, size - 2, size - 2);
                    targetCtx.restore();
                } else {
                    targetCtx.fillStyle = COLORS[val];
                    targetCtx.fillRect(startX + c * size, startY + r * size, size - 1, size - 1);
                    targetCtx.strokeStyle = 'rgba(0,0,0,0.15)';
                    targetCtx.lineWidth = 1;
                    targetCtx.strokeRect(startX + c * size, startY + r * size, size - 1, size - 1);
                }
            }
        });
    });
}

function update(time = 0) {
    let dt = time - lastTime;
    lastTime = time;

    if (gameState === 'PLAYING') {
        updateBatBugs(dt);

        if (isAnimating) {
            updateAnimation(dt);
        } else {
            let activeInterval = isFastDropping ? fastDropInterval : normalDropInterval;
            dropCounter += dt;
            if (dropCounter > activeInterval) {
                currentPiece.y++;
                if (checkCollisionAt(currentPiece.x, currentPiece.y, currentPiece.shape)) {
                    currentPiece.y--;
                    mergePiece();
                    chainCount = 0;
                    processMatches();
                }
                dropCounter = 0;
            }
        }
        updateUI();
    }
    if (gameState === 'PLAYING' || gameState === 'CLEARING') {
        updateParticles(dt);
    }
    drawGame();
    requestAnimationFrame(update);
}

function checkCollisionAt(px, py, shape) {
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c]) {
                let nx = px + c;
                let ny = py + r;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
                if (ny >= 0 && board[ny][nx]) return true;
            }
        }
    }
    return false;
}

function mergePiece() {
    currentPiece.shape.forEach((row, r) => {
        row.forEach((val, c) => {
            if (val) {
                board[currentPiece.y + r][currentPiece.x + c] = val;
                groupBoard[currentPiece.y + r][currentPiece.x + c] = currentPiece.groupId;
            }
        });
    });
    addLog(`Piece Merged (GroupID:${currentPiece.groupId}) at X:${currentPiece.x}, Y:${currentPiece.y}`);

    for (let c = 0; c < COLS; c++) {
        if (board[0][c] !== 0) {
            addLog('Game Over: Block Reached Top Edge (Row 0)');
            changeScreen('GAMEOVER');
            return;
        }
    }
}

function processMatches(shouldAdvance = true) {
    advanceAfterResolution = shouldAdvance;
    let visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    let toClearBlocks = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    let toClearBugs = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    let rainbowClearBlocks = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    let rainbowMatchedColors = new Set();
    let matchedRainbowCells = new Set();

    const getNeighbors = (r, c) => [
        { r: r - 1, c }, { r: r + 1, c },
        { r, c: c - 1 }, { r, c: c + 1 }
    ].filter(cell => cell.r >= 0 && cell.r < ROWS && cell.c >= 0 && cell.c < COLS);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let color = board[r][c];
            if (color >= 1 && color <= 4 && !visited[r][c]) {
                let group = [];
                let queue = [{ r, c }];
                visited[r][c] = true;

                while (queue.length > 0) {
                    let curr = queue.pop();
                    group.push(curr);

                    for (let n of getNeighbors(curr.r, curr.c)) {
                        if (!visited[n.r][n.c] && board[n.r][n.c] === color) {
                            visited[n.r][n.c] = true;
                            queue.push(n);
                        }
                    }
                }

                if (group.length >= 4) {
                    group.forEach(cell => { toClearBlocks[cell.r][cell.c] = true; });
                }
            }
        }
    }

    // 虹色を各通常色の代わりとして個別に判定する。
    // 同じ虹色が赤と青の両方で条件を満たした場合は、両色とも全消去対象になる。
    for (let rainbowR = 0; rainbowR < ROWS; rainbowR++) {
        for (let rainbowC = 0; rainbowC < COLS; rainbowC++) {
            if (board[rainbowR][rainbowC] !== RAINBOW_BLOCK) continue;

            for (let color = 1; color <= 4; color++) {
                const colorVisited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
                const group = [];
                const queue = [{ r: rainbowR, c: rainbowC }];
                colorVisited[rainbowR][rainbowC] = true;
                let containsColor = false;

                while (queue.length > 0) {
                    const curr = queue.pop();
                    const currType = board[curr.r][curr.c];
                    group.push(curr);
                    if (currType === color) containsColor = true;

                    for (let n of getNeighbors(curr.r, curr.c)) {
                        const neighborType = board[n.r][n.c];
                        if (!colorVisited[n.r][n.c] && (neighborType === color || neighborType === RAINBOW_BLOCK)) {
                            colorVisited[n.r][n.c] = true;
                            queue.push(n);
                        }
                    }
                }

                if (containsColor && group.length >= 4) {
                    rainbowMatchedColors.add(color);
                    group.forEach(cell => {
                        if (board[cell.r][cell.c] === RAINBOW_BLOCK) {
                            matchedRainbowCells.add(`${cell.r},${cell.c}`);
                        }
                    });
                }
            }
        }
    }

    if (rainbowMatchedColors.size > 0) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (rainbowMatchedColors.has(board[r][c]) || matchedRainbowCells.has(`${r},${c}`)) {
                    toClearBlocks[r][c] = true;
                    rainbowClearBlocks[r][c] = true;
                }
            }
        }
    }

    let hasClear = false;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (toClearBlocks[r][c]) {
                hasClear = true;
                let blockColor = board[r][c];

                for (let n of getNeighbors(r, c)) {
                    let bugType = board[n.r][n.c];

                    if ((bugType >= 8 && bugType <= 19) || bugType === EGG_BUG || bugType === CRACKED_EGG_BUG) {
                        if (bugType === EGG_BUG || bugType === CRACKED_EGG_BUG) {
                            toClearBugs[n.r][n.c] = true;
                        } else if (rainbowClearBlocks[r][c]) {
                            toClearBugs[n.r][n.c] = true;
                        } else if (bugType === 8 || bugType === 13 || bugType === 14 || bugType === 19) {
                            toClearBugs[n.r][n.c] = true;
                        } else if (bugType >= 9 && bugType <= 12) {
                            if (bugType - 8 === blockColor) {
                                toClearBugs[n.r][n.c] = true;
                            }
                        } else if (bugType >= 15 && bugType <= 18) {
                            if (bugType - 14 === blockColor) {
                                toClearBugs[n.r][n.c] = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if (hasClear) {
        // 1ターン内で連鎖しても、タマゴの進行判定は最後に1回だけ行う。
        eggTurnCheckPending = true;
        chainCount++;
        pendingClearBlocks = toClearBlocks;
        pendingClearBugs = toClearBugs;
        pendingRainbowClearBlocks = rainbowClearBlocks;
        pendingRainbowColors = [...rainbowMatchedColors];
        pendingRainbowSourceCells = [...matchedRainbowCells].map(key => {
            const [r, c] = key.split(',').map(Number);
            return { r, c };
        });
        isAnimating = true;
        animPhase = 'WAIT_CLEAR';
        animTimer = 0;
        const rainbowLog = pendingRainbowColors.length > 0
            ? ` Rainbow colors: ${pendingRainbowColors.join(',')}`
            : '';
        addLog(`Match Found: Chain x${chainCount}.${rainbowLog}`);
    } else {
        if (advanceAfterResolution) {
            advancePiece();
        } else {
            isAnimating = false;
            animPhase = 'NONE';
        }
    }
}

function updateAnimation(dt) {
    animTimer += dt;

    if (animPhase === 'WAIT_CLEAR') {
        let clearWaitTime = pendingRainbowColors.length > 0
            ? RAINBOW_CLEAR_DURATION
            : normalDropInterval / 2;
        if (animTimer >= clearWaitTime) {
            let killed = 0;
            let clearedCount = 0;
            let centerSumX = 0, centerSumY = 0;

            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (pendingClearBlocks[r][c]) {
                        board[r][c] = 0;
                        groupBoard[r][c] = 0;
                        score += 10 * chainCount;
                        clearedCount++;
                        centerSumX += c * BLOCK_SIZE + BLOCK_SIZE / 2;
                        centerSumY += r * BLOCK_SIZE + BLOCK_SIZE / 2;
                        spawnClearSparkles(c * BLOCK_SIZE + BLOCK_SIZE / 2, r * BLOCK_SIZE + BLOCK_SIZE / 2);
                    }
                    if (pendingClearBugs[r][c]) {
                        let bugType = board[r][c];

                        if (bugType === 13 || bugType === 19) {
                            transformMetalBug(r, c, bugType);
                            score += 250 * chainCount;

                            spawnSquash(c * BLOCK_SIZE + BLOCK_SIZE / 2, r * BLOCK_SIZE + BLOCK_SIZE / 2);
                            spawnPopText(c * BLOCK_SIZE + BLOCK_SIZE / 2, r * BLOCK_SIZE + BLOCK_SIZE / 2, 'TRANSFORM!', '#ffd93d');
                        } else {
                            if (bugType >= 14 && bugType <= 18) {
                                batBugs = batBugs.filter(b => !(b.row === r && Math.round(b.posX) === c));
                            }
                            board[r][c] = 0;
                            groupBoard[r][c] = 0;
                            killed++;
                            score += 500 * chainCount;
                            spawnSquash(c * BLOCK_SIZE + BLOCK_SIZE / 2, r * BLOCK_SIZE + BLOCK_SIZE / 2);
                        }
                    }
                }
            }

            if (clearedCount > 0) {
                let popX = centerSumX / clearedCount;
                let popY = centerSumY / clearedCount;
                let textStr = pendingRainbowColors.length > 0
                    ? `RAINBOW x${pendingRainbowColors.length}!`
                    : (chainCount > 1 ? `${chainCount}x CHAIN!!` : 'BOOM!');
                let textColor = pendingRainbowColors.length > 0
                    ? '#ffffff'
                    : (chainCount > 1 ? '#ffd93d' : '#4fffb0');
                spawnPopText(popX, popY, textStr, textColor);
            }

            if (killed > 0) {
                remainingEnemies = Math.max(0, remainingEnemies - killed);
                flashAlpha = 0.6;
            }

            addLog(`Cleared ${clearedCount} blocks, Defeated ${killed} bugs (Chain x${chainCount}). Remaining: ${remainingEnemies}`);

            resplitDisconnectedGroups();
            setupGroupGravityAnimation(advanceAfterResolution);
        }
    } else if (animPhase === 'FALLING') {
        updateFallingGroups(dt);
    } else if (animPhase === 'EGG_TRANSITION') {
        updateEggTransition(dt);
    }
}

function transformMetalBug(row, col, bugType) {
    const isMetalBat = bugType === 19;
    const nextType = Math.random() < 0.4
        ? (isMetalBat ? 14 : 8)
        : Math.floor(Math.random() * 4) + (isMetalBat ? 15 : 9);

    board[row][col] = nextType;

    if (isMetalBat) {
        const bat = batBugs.find(item => item.row === row && Math.round(item.posX) === col);
        if (bat) bat.type = nextType;
    }

    return nextType;
}

function resplitDisconnectedGroups() {
    let visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let type = board[r][c];
            if (type >= 1 && type <= RAINBOW_BLOCK && !visited[r][c]) {
                let originalGId = groupBoard[r][c];
                let comp = [];
                let queue = [{ r, c }];
                visited[r][c] = true;

                while (queue.length > 0) {
                    let curr = queue.pop();
                    comp.push(curr);

                    let neighbors = [
                        { r: curr.r - 1, c: curr.c },
                        { r: curr.r + 1, c: curr.c },
                        { r: curr.r, c: curr.c - 1 },
                        { r: curr.r, c: curr.c + 1 }
                    ];

                    for (let n of neighbors) {
                        if (n.r >= 0 && n.r < ROWS && n.c >= 0 && n.c < COLS) {
                            if (!visited[n.r][n.c] && board[n.r][n.c] >= 1 && board[n.r][n.c] <= RAINBOW_BLOCK && groupBoard[n.r][n.c] === originalGId) {
                                visited[n.r][n.c] = true;
                                queue.push(n);
                            }
                        }
                    }
                }

                let newGId = nextGroupId++;
                comp.forEach(cell => {
                    groupBoard[cell.r][cell.c] = newGId;
                });
            }
        }
    }
}

function setupGroupGravityAnimation(triggerNextPiece = true) {
    fallingGroups = [];
    let compVisited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    let components = [];

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let type = board[r][c];
            if (type >= 1 && type <= RAINBOW_BLOCK && !compVisited[r][c]) {
                let targetGId = groupBoard[r][c];
                let compCells = [];
                let queue = [{ r, c }];
                compVisited[r][c] = true;

                while (queue.length > 0) {
                    let curr = queue.pop();
                    compCells.push({ r: curr.r, c: curr.c, type: board[curr.r][curr.c], groupId: targetGId });

                    let neighbors = [
                        { r: curr.r - 1, c: curr.c },
                        { r: curr.r + 1, c: curr.c },
                        { r: curr.r, c: curr.c - 1 },
                        { r: curr.r, c: curr.c + 1 }
                    ];

                    for (let n of neighbors) {
                        if (n.r >= 0 && n.r < ROWS && n.c >= 0 && n.c < COLS) {
                            let nType = board[n.r][n.c];
                            if (!compVisited[n.r][n.c] && nType >= 1 && nType <= RAINBOW_BLOCK && groupBoard[n.r][n.c] === targetGId) {
                                compVisited[n.r][n.c] = true;
                                queue.push(n);
                            }
                        }
                    }
                }
                components.push({
                    id: targetGId,
                    cells: compCells,
                    totalFall: 0
                });
            }
        }
    }

    if (components.length === 0) {
        if (triggerNextPiece) {
            advancePiece();
        } else {
            isAnimating = false;
            animPhase = 'NONE';
        }
        return;
    }

    let simB = Array.from({ length: ROWS }, (_, r) => [...board[r]]);
    let simG = Array.from({ length: ROWS }, (_, r) => [...groupBoard[r]]);

    if (!triggerNextPiece && currentPiece) {
        currentPiece.shape.forEach((row, r) => {
            row.forEach((val, c) => {
                if (!val) return;
                const boardR = currentPiece.y + r;
                const boardC = currentPiece.x + c;
                if (boardR >= 0 && boardR < ROWS && boardC >= 0 && boardC < COLS && simB[boardR][boardC] === 0) {
                    simB[boardR][boardC] = -2;
                }
            });
        });
    }

    let movedAny = true;
    while (movedAny) {
        movedAny = false;

        for (let comp of components) {
            let compSet = new Set(comp.cells.map(cell => `${cell.r},${cell.c}`));

            let canFall = true;
            for (let cell of comp.cells) {
                let nextR = cell.r + 1;
                if (nextR >= ROWS) {
                    canFall = false;
                    break;
                }
                if (!compSet.has(`${nextR},${cell.c}`) && simB[nextR][cell.c] !== 0) {
                    canFall = false;
                    break;
                }
            }

            if (canFall) {
                for (let cell of comp.cells) {
                    simB[cell.r][cell.c] = 0;
                    simG[cell.r][cell.c] = 0;
                }
                for (let cell of comp.cells) {
                    cell.r += 1;
                    simB[cell.r][cell.c] = cell.type;
                    simG[cell.r][cell.c] = cell.groupId;
                }
                comp.totalFall += 1;
                movedAny = true;
            }
        }
    }

    let anyGroupMoving = false;
    for (let comp of components) {
        if (comp.totalFall > 0) {
            anyGroupMoving = true;
            let origCells = comp.cells.map(cell => ({
                r: cell.r - comp.totalFall,
                c: cell.c,
                type: cell.type,
                groupId: cell.groupId
            }));

            fallingGroups.push({
                cells: origCells,
                targetOffsetY: comp.totalFall,
                currentOffsetY: 0
            });
        }
    }

    if (anyGroupMoving) {
        fallingGroups.forEach(g => {
            g.cells.forEach(cell => {
                board[cell.r][cell.c] = 0;
                groupBoard[cell.r][cell.c] = 0;
            });
        });

        isAnimating = true;
        advanceAfterResolution = triggerNextPiece;
        animPhase = 'FALLING';
        animTimer = 0;
        addLog(`Gravity Fall Triggered: ${fallingGroups.length} groups moving`);
    } else {
        if (triggerNextPiece) {
            advancePiece();
        } else {
            isAnimating = false;
            animPhase = 'NONE';
        }
    }
}

function updateFallingGroups(dt) {
    let allFinished = true;

    let fallSpeedPerMs = 1 / (normalDropInterval / 2);
    let step = dt * fallSpeedPerMs;

    fallingGroups.forEach(g => {
        if (g.currentOffsetY < g.targetOffsetY) {
            g.currentOffsetY += step;
            if (g.currentOffsetY >= g.targetOffsetY) {
                g.currentOffsetY = g.targetOffsetY;
            } else {
                allFinished = false;
            }
        }
    });

    if (allFinished) {
        fallingGroups.forEach(g => {
            let offset = g.targetOffsetY;
            g.cells.forEach(cell => {
                board[cell.r + offset][cell.c] = cell.type;
                groupBoard[cell.r + offset][cell.c] = cell.groupId;
            });
        });
        fallingGroups = [];

        processMatches(advanceAfterResolution);
    }
}

function advancePiece() {
    if (remainingEnemies <= 0) {
        eggTurnCheckPending = false;
        finishAdvancePiece();
        return;
    }

    if (eggTurnCheckPending) {
        eggTurnCheckPending = false;
        if (startEggTurnResolution()) return;
    }

    finishAdvancePiece();
}

function finishAdvancePiece() {
    isAnimating = false;
    animPhase = 'NONE';

    if (remainingEnemies <= 0) {
        gameState = 'CLEARING';
        addLog('All Bugs Defeated! Stage Clear');
        updateUI();
        setTimeout(() => {
            if (gameState === 'CLEARING') changeScreen('STAGECLEAR');
        }, 900);
        return;
    }

    currentPiece = nextPiece;
    nextPiece = new Piece(Math.floor(Math.random() * 7) + 1);

    if (checkCollisionAt(currentPiece.x, currentPiece.y, currentPiece.shape)) {
        addLog('Game Over: Spawn Block Collided');
        changeScreen('GAMEOVER');
    }
}

function getEggHatchCandidates() {
    const candidates = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    if (selectedLevel >= 15) candidates.push(19);
    return candidates;
}

function startEggTurnResolution() {
    const actions = [];
    const hatchCandidates = getEggHatchCandidates();

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const type = board[r][c];
            if (type === EGG_BUG && Math.random() < 0.5) {
                actions.push({ r, c, kind: 'crack', fromType: EGG_BUG, toType: CRACKED_EGG_BUG });
            } else if (type === CRACKED_EGG_BUG && Math.random() < 0.5) {
                const toType = hatchCandidates[Math.floor(Math.random() * hatchCandidates.length)];
                actions.push({ r, c, kind: 'hatch', fromType: CRACKED_EGG_BUG, toType });
            }
        }
    }

    if (actions.length === 0) return false;

    eggTransitionActions = actions;
    isAnimating = true;
    animPhase = 'EGG_TRANSITION';
    animTimer = 0;
    addLog(`Egg turn resolution: ${actions.filter(action => action.kind === 'crack').length} cracked, ${actions.filter(action => action.kind === 'hatch').length} hatched`);
    return true;
}

function registerHatchedBat(row, col, bugType) {
    batBugs.push({
        id: `egg_bat_${eggBatSequence++}`,
        row,
        posX: col,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 1.8,
        minX: Math.max(0, col - 2),
        maxX: Math.min(COLS - 1, col + 2),
        type: bugType
    });
}

function updateEggTransition() {
    if (animTimer < EGG_TRANSITION_DURATION) return;

    eggTransitionActions.forEach(action => {
        if (board[action.r][action.c] !== action.fromType) return;

        board[action.r][action.c] = action.toType;
        groupBoard[action.r][action.c] = -1;

        const centerX = action.c * BLOCK_SIZE + BLOCK_SIZE / 2;
        const centerY = action.r * BLOCK_SIZE + BLOCK_SIZE / 2;
        spawnClearSparkles(centerX, centerY);

        if (action.kind === 'hatch') {
            if (action.toType >= 14 && action.toType <= 19) {
                registerHatchedBat(action.r, action.c, action.toType);
            }
            spawnPopText(centerX, centerY, 'HATCH!', '#ffd93d');
        } else {
            spawnPopText(centerX, centerY, 'CRACK!', '#ff9de2');
        }
    });

    eggTransitionActions = [];
    finishAdvancePiece();
}

function spawnClearSparkles(cx, cy) {
    for (let i = 0; i < 14; i++) {
        particles.push({
            x: cx, y: cy,
            vx: (Math.random() - 0.5) * 5.0,
            vy: (Math.random() - 0.5) * 5.0,
            life: 400 + Math.random() * 250,
            age: 0,
            size: 2.5 + Math.random() * 3.5,
            color: [ '#ffd93d', '#ff9de2', '#4fffb0', '#4dd2ff', '#ffffff' ][i % 5]
        });
    }
}

function spawnSquash(cx, cy) {
    for (let i = 0; i < 16; i++) {
        particles.push({
            x: cx, y: cy,
            vx: (Math.random() - 0.5) * 4.5,
            vy: (Math.random() - 0.8) * 4.5,
            life: 500 + Math.random() * 250,
            age: 0,
            size: 3 + Math.random() * 3,
            color: [ '#ffd93d', '#ff9de2', '#4fffb0', '#4dd2ff' ][i % 4]
        });
    }
}

function spawnPopText(x, y, text, color) {
    popTexts.push({
        x: x, y: y,
        vy: -1.2,
        life: 700,
        age: 0,
        text: text,
        color: color
    });
}

function updateParticles(dt) {
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt / 220);
    particles.forEach(p => {
        p.age += dt;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1;
    });
    particles = particles.filter(p => p.age < p.life);

    popTexts.forEach(pt => {
        pt.age += dt;
        pt.y += pt.vy;
    });
    popTexts = popTexts.filter(pt => pt.age < pt.life);
}
