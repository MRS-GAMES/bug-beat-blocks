function getGhostY() {
    if (!currentPiece) return 0;
    let gy = currentPiece.y;
    while (!checkCollisionAt(currentPiece.x, gy + 1, currentPiece.shape)) {
        gy++;
    }
    return gy;
}

function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState !== 'PLAYING' && gameState !== 'CLEARING' && gameState !== 'PAUSED' && gameState !== 'GAMEOVER' && gameState !== 'STAGECLEAR') return;

    ctx.fillStyle = '#1a0f3d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * BLOCK_SIZE, 0);
        ctx.lineTo(c * BLOCK_SIZE, ROWS * BLOCK_SIZE);
        ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c]) {
                let px = c * BLOCK_SIZE;
                let py = r * BLOCK_SIZE;
                let gId = groupBoard[r][c];

                let scale = 1.0;
                if (animPhase === 'WAIT_CLEAR' && pendingClearBlocks[r][c]) {
                    const clearDuration = pendingRainbowColors.length > 0
                        ? RAINBOW_CLEAR_DURATION
                        : normalDropInterval / 2;
                    let progress = Math.min(1, animTimer / clearDuration);
                    if (pendingRainbowClearBlocks[r][c]) {
                        const shrinkProgress = Math.max(0, (progress - 0.72) / 0.28);
                        scale = Math.max(0, 1.0 - shrinkProgress);
                    } else {
                        scale = Math.max(0.2, 1.0 - progress * 0.8);
                    }
                }

                if (board[r][c] === EGG_BUG || board[r][c] === CRACKED_EGG_BUG) {
                    drawEggBug(px, py, r, c, board[r][c], scale);
                } else if (board[r][c] >= 8 && board[r][c] <= 13) {
                    drawBug(px, py, scale, board[r][c]);
                } else if (board[r][c] < 8) {
                    let t = (r > 0 && groupBoard[r - 1][c] === gId);
                    let b = (r < ROWS - 1 && groupBoard[r + 1][c] === gId);
                    let l = (c > 0 && groupBoard[r][c - 1] === gId);
                    let rRight = (c < COLS - 1 && groupBoard[r][c + 1] === gId);
                    const rainbowMix = getRainbowConversionProgress(r, c);
                    const rainbowFlash = getRainbowPreFlash(r, c);
                    drawConnectedCell(px, py, board[r][c], t, b, l, rRight, scale, rainbowMix, rainbowFlash);
                }
            }
        }
    }

    batBugs.forEach(b => {
        let px = b.posX * BLOCK_SIZE;
        let py = b.row * BLOCK_SIZE;
        let scale = 1.0;
        if (animPhase === 'WAIT_CLEAR' && pendingClearBugs[b.row][Math.round(b.posX)]) {
            const clearDuration = pendingRainbowColors.length > 0
                ? RAINBOW_CLEAR_DURATION
                : normalDropInterval / 2;
            let progress = animTimer / clearDuration;
            scale = Math.max(0, 1.0 - progress * 0.8);
        }
        drawBatBug(px, py, scale, b.dir, b.type);
    });

    fallingGroups.forEach(g => {
        g.cells.forEach(cell => {
            let px = cell.c * BLOCK_SIZE;
            let py = (cell.r + g.currentOffsetY) * BLOCK_SIZE;

            if (cell.type >= 8 && cell.type <= 13) {
                drawBug(px, py, 1.0, cell.type);
            } else if (cell.type >= 14) {
                drawBatBug(px, py, 1.0, 1, cell.type);
            } else {
                let r = cell.r, c = cell.c, gId = cell.groupId;
                let t = g.cells.some(other => other.r === r - 1 && other.c === c && other.groupId === gId);
                let b = g.cells.some(other => other.r === r + 1 && other.c === c && other.groupId === gId);
                let l = g.cells.some(other => other.r === r && other.c === c - 1 && other.groupId === gId);
                let rRight = g.cells.some(other => other.r === r && other.c === c + 1 && other.groupId === gId);
                drawConnectedCell(px, py, cell.type, t, b, l, rRight, 1.0);
            }
        });
    });

    if (currentPiece && gameState === 'PLAYING' && !isAnimating) {
        let ghostY = getGhostY();
        let shape = currentPiece.shape;

        shape.forEach((row, r) => {
            row.forEach((val, c) => {
                if (val) drawGhostCell(currentPiece.x + c, ghostY + r);
            });
        });

        shape.forEach((row, r) => {
            row.forEach((val, c) => {
                if (val) {
                    let px = (currentPiece.x + c) * BLOCK_SIZE;
                    let py = (currentPiece.y + r) * BLOCK_SIZE;
                    let t = (r > 0 && shape[r - 1][c] > 0);
                    let b = (r < shape.length - 1 && shape[r + 1][c] > 0);
                    let l = (c > 0 && shape[r][c - 1] > 0);
                    let rRight = (c < row.length - 1 && shape[r][c + 1] > 0);
                    drawConnectedCell(px, py, val, t, b, l, rRight, 1.0);
                }
            });
        });
    }

    particles.forEach(p => {
        let t = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, t);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    popTexts.forEach(pt => {
        let t = 1 - pt.age / pt.life;
        ctx.globalAlpha = Math.max(0, t);
        ctx.font = '700 20px "Fredoka", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = pt.color;
        ctx.strokeStyle = '#2a1550';
        ctx.lineWidth = 4;
        ctx.strokeText(pt.text, pt.x, pt.y);
        ctx.fillText(pt.text, pt.x, pt.y);
    });
    ctx.globalAlpha = 1;

    if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(255,217,61,${flashAlpha * 0.22})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (gameState === 'PAUSED') {
        ctx.fillStyle = 'rgba(20,10,45,0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
}

function getRainbowConversionProgress(row, col) {
    if (board[row]?.[col] === RAINBOW_BLOCK) return 1;
    if (animPhase !== 'WAIT_CLEAR' || !pendingRainbowClearBlocks[row]?.[col]) return 0;

    const overallProgress = Math.min(1, animTimer / RAINBOW_CLEAR_DURATION);
    const nearestDistance = pendingRainbowSourceCells.length > 0
        ? Math.min(...pendingRainbowSourceCells.map(cell => Math.abs(cell.r - row) + Math.abs(cell.c - col)))
        : 0;
    const maxDistance = ROWS + COLS - 2;
    const waveDelay = (nearestDistance / maxDistance) * 0.38;
    return Math.max(0, Math.min(1, (overallProgress - waveDelay) / 0.28));
}

function getRainbowPreFlash(row, col) {
    if (animPhase !== 'WAIT_CLEAR' || !pendingRainbowClearBlocks[row]?.[col]) return 0;
    if (board[row]?.[col] === RAINBOW_BLOCK) return 0;

    const overallProgress = Math.min(1, animTimer / RAINBOW_CLEAR_DURATION);
    if (overallProgress >= 0.16) return 0;
    return Math.sin((overallProgress / 0.16) * Math.PI) * 0.75;
}

function drawConnectedCell(px, py, type, top, bottom, left, right, scale = 1.0, rainbowMix = type === RAINBOW_BLOCK ? 1 : 0, preFlash = 0) {
    let base = COLORS[type];
    let radius = Math.max(3, BLOCK_SIZE * 0.24);

    let rTL = (!top && !left) ? radius : 0;
    let rTR = (!top && !right) ? radius : 0;
    let rBR = (!bottom && !right) ? radius : 0;
    let rBL = (!bottom && !left) ? radius : 0;

    let pad = 0.5;
    let x = px + (left ? -pad : 1.5);
    let y = py + (top ? -pad : 1.5);
    let w = BLOCK_SIZE - (left ? 0 : 1.5) - (right ? 0 : 1.5) + ((left ? pad : 0) + (right ? pad : 0));
    let h = BLOCK_SIZE - (top ? 0 : 1.5) - (bottom ? 0 : 1.5) + ((top ? pad : 0) + (bottom ? pad : 0));

    ctx.save();
    if (scale !== 1.0) {
        ctx.translate(px + BLOCK_SIZE / 2, py + BLOCK_SIZE / 2);
        ctx.scale(scale, scale);
        ctx.translate(-(px + BLOCK_SIZE / 2), -(py + BLOCK_SIZE / 2));
    }

    const pulse = 0.65 + Math.sin(performance.now() / 130) * 0.25;
    if (rainbowMix > 0) {
        ctx.shadowColor = `rgba(255,255,255,${pulse * rainbowMix})`;
        ctx.shadowBlur = BLOCK_SIZE * (0.15 + 0.22 * rainbowMix);
    }

    drawCustomRoundRect(x, y, w, h, rTL, rTR, rBR, rBL);
    ctx.fillStyle = type === RAINBOW_BLOCK ? createRainbowGradient(ctx, x, y, w, h) : base;
    ctx.fill();

    if (rainbowMix > 0 && type !== RAINBOW_BLOCK) {
        ctx.save();
        ctx.globalAlpha = rainbowMix;
        drawCustomRoundRect(x, y, w, h, rTL, rTR, rBR, rBL);
        ctx.fillStyle = createRainbowGradient(ctx, x, y, w, h, (performance.now() / 3000) % 1);
        ctx.fill();
        ctx.restore();
    }

    if (preFlash > 0) {
        ctx.save();
        ctx.globalAlpha = preFlash;
        drawCustomRoundRect(x, y, w, h, rTL, rTR, rBR, rBL);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    drawCustomRoundRect(x + 1.5, y + 1.5, w - 3, Math.max(2, h * 0.35), rTL * 0.7, rTR * 0.7, 0, 0);
    ctx.fill();

    if (rainbowMix > 0) {
        drawCustomRoundRect(x, y, w, h, rTL, rTR, rBR, rBL);
        ctx.clip();
        const shinePosition = ((performance.now() / 650) % 1.8) - 0.4;
        const shineX = x + w * shinePosition;
        const shine = ctx.createLinearGradient(shineX - w * 0.2, y, shineX + w * 0.2, y + h);
        shine.addColorStop(0, 'rgba(255,255,255,0)');
        shine.addColorStop(0.5, `rgba(255,255,255,${0.75 * rainbowMix})`);
        shine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, w, h);
    }

    ctx.strokeStyle = rainbowMix > 0 ? `rgba(255,255,255,${0.75 + pulse * 0.25})` : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = rainbowMix > 0 ? 2 : 1.2;
    drawCustomRoundRect(x, y, w, h, rTL, rTR, rBR, rBL);
    ctx.stroke();

    ctx.restore();
}

function drawCustomRoundRect(x, y, w, h, rtl, rtr, rbr, rbl) {
    ctx.beginPath();
    ctx.moveTo(x + rtl, y);
    ctx.lineTo(x + w - rtr, y);
    if (rtr) ctx.arcTo(x + w, y, x + w, y + rtr, rtr); else ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rbr);
    if (rbr) ctx.arcTo(x + w, y + h, x + w - rbr, y + h, rbr); else ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + rbl, y + h);
    if (rbl) ctx.arcTo(x, y + h, x, y + h - rbl, rbl); else ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rtl);
    if (rtl) ctx.arcTo(x, y, x + rtl, y, rtl); else ctx.lineTo(x, y);
    ctx.closePath();
}

function drawNormalBugAsset(px, py, scale = 1.0, bugType = 8, animateIdle = true) {
    const s = BLOCK_SIZE;
    const isSquashed = animateIdle && Math.floor(performance.now() / 500) % 2 === 1;
    const idleScaleY = isSquashed ? 0.95 : 1.0;
    const drawHeight = s * idleScaleY;

    ctx.save();
    ctx.translate(px + s / 2, py + s / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(px + s / 2), -(py + s / 2));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
        normalBugImages[bugType],
        px,
        py + s - drawHeight,
        s,
        drawHeight
    );
    ctx.restore();
}

function drawBug(px, py, scale = 1.0, bugType = 8) {
    if (normalBugImageReady[bugType]) {
        drawNormalBugAsset(px, py, scale, bugType);
        return;
    }

    let s = BLOCK_SIZE;
    ctx.save();

    ctx.translate(px + s / 2, py + s / 2);
    let baseScale = (s / 36) * scale;
    ctx.scale(baseScale, baseScale);

    let faceColor = BUG_FACE_COLORS[bugType] || '#fbf5eb';

    ctx.fillStyle = faceColor;
    ctx.strokeStyle = '#3d312a';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(-5, -7);
    ctx.lineTo(-11, -15);
    ctx.lineTo(-15, -4);
    ctx.quadraticCurveTo(-16, 7, -10, 13);
    ctx.quadraticCurveTo(0, 16, 10, 13);
    ctx.quadraticCurveTo(16, 7, 15, -4);
    ctx.lineTo(11, -15);
    ctx.lineTo(5, -7);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = (bugType === 13) ? '#ff3b30' : '#3d312a';

    ctx.beginPath();
    ctx.ellipse(-6, 2, 2.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 2, 2.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = (bugType === 13) ? '#ff9500' : '#ffffff';
    ctx.fillRect(-7, -0.5, 2, 2);
    ctx.fillRect(5, -0.5, 2, 2);

    ctx.restore();
}

function drawEggBug(px, py, row, col, bugType, scale = 1) {
    const s = BLOCK_SIZE;
    const action = eggTransitionActions.find(item => item.r === row && item.c === col);
    const progress = action && animPhase === 'EGG_TRANSITION'
        ? Math.min(1, animTimer / EGG_TRANSITION_DURATION)
        : 0;
    const pulse = bugType === CRACKED_EGG_BUG
        ? 1 + Math.sin(performance.now() / 120) * 0.035
        : 1;
    const shakeStrength = action
        ? (action.kind === 'hatch' ? 2.2 : 3.2) * Math.sin(progress * Math.PI) * Math.sin(progress * Math.PI * 12)
        : 0;

    if (action?.kind === 'hatch' && progress > 0.58) {
        const hatchProgress = (progress - 0.58) / 0.42;
        const targetScale = 0.35 + hatchProgress * 0.65;
        ctx.save();
        ctx.globalAlpha = hatchProgress;
        if (action.toType >= 14 && action.toType <= 19) {
            drawBatBug(px + shakeStrength, py, targetScale, 1, action.toType);
        } else {
            drawBug(px + shakeStrength, py, targetScale, action.toType);
        }
        ctx.restore();
    } else {
        ctx.save();
        ctx.translate(px + s / 2 + shakeStrength, py + s / 2);
        ctx.scale(pulse * scale, pulse * scale);
        const imageType = action?.kind === 'crack' && progress > 0.55 ? CRACKED_EGG_BUG : bugType;
        const fade = action?.kind === 'hatch' ? Math.max(0.15, 1 - progress * 0.9) : 1;
        ctx.globalAlpha = fade;
        if (eggBugImageReady[imageType]) {
            ctx.drawImage(eggBugImages[imageType], -s / 2, -s / 2, s, s);
        } else {
            ctx.fillStyle = imageType === CRACKED_EGG_BUG ? '#ff9de2' : '#fbf5eb';
            ctx.beginPath();
            ctx.ellipse(0, 1, s * 0.36, s * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawBatBug(px, py, scale = 1.0, dir = 1, bugType = 14) {
    let s = BLOCK_SIZE;
    const bodyBugType = bugType - 6;

    if (
        normalBugImageReady[bodyBugType] &&
        batWingImageReady.up &&
        batWingImageReady.down
    ) {
        const wingFrame = Math.floor(performance.now() / 250) % 2 === 0 ? 'up' : 'down';
        const wingWidth = s * 1.8;
        const wingHeight = wingWidth / 2;

        ctx.save();
        ctx.translate(px + s / 2, py + s / 2);
        ctx.scale(scale, scale);
        ctx.translate(-(px + s / 2), -(py + s / 2));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            batWingImages[wingFrame],
            px + (s - wingWidth) / 2,
            py + (s - wingHeight) / 2,
            wingWidth,
            wingHeight
        );
        ctx.restore();

        drawNormalBugAsset(px, py, scale, bodyBugType, false);
        return;
    }

    ctx.save();

    ctx.translate(px + s / 2, py + s / 2);
    let baseScale = (s / 36) * scale;
    ctx.scale(baseScale, baseScale);

    // 視認性の高い、大きく明るいコウモリの羽
    ctx.fillStyle = '#6b5b95';
    ctx.strokeStyle = '#2a1550';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.lineTo(-28, -18);
    ctx.lineTo(-20, -5);
    ctx.lineTo(-30, 6);
    ctx.lineTo(-14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(28, -18);
    ctx.lineTo(20, -5);
    ctx.lineTo(30, 6);
    ctx.lineTo(14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    let faceColor = BUG_FACE_COLORS[bugType] || '#fbf5eb';

    ctx.fillStyle = faceColor;
    ctx.strokeStyle = '#3d312a';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(-5, -7);
    ctx.lineTo(-11, -15);
    ctx.lineTo(-15, -4);
    ctx.quadraticCurveTo(-16, 7, -10, 13);
    ctx.quadraticCurveTo(0, 16, 10, 13);
    ctx.quadraticCurveTo(16, 7, 15, -4);
    ctx.lineTo(11, -15);
    ctx.lineTo(5, -7);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = (bugType === 19) ? '#ff3b30' : '#3d312a';
    ctx.beginPath();
    ctx.ellipse(-6, 2, 2.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 2, 2.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = (bugType === 19) ? '#ff9500' : '#ffffff';
    ctx.fillRect(-7, -0.5, 2, 2);
    ctx.fillRect(5, -0.5, 2, 2);

    ctx.restore();
}

function drawGhostCell(c, r) {
    let px = c * BLOCK_SIZE;
    let py = r * BLOCK_SIZE;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    drawCustomRoundRect(px + 2, py + 2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 3, 3, 3, 3);
    ctx.stroke();
    ctx.setLineDash([]);
}
