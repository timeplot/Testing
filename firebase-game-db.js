// firebase-game-db.js - COMPLETE GAME DATABASE SYSTEM FOR among-ussy

// Check Firebase availability
if (typeof firebase === 'undefined') {
    console.error('Firebase not loaded! Check script order.');
    throw new Error('Firebase SDK not loaded');
}

const GameConfig = {
    TOTAL_PLAYERS: 8,
    IMPOSTOR_COUNT: 2,
    MAX_KILLS_PER_ROUND: 3,
    REQUIRED_TASKS_TO_WIN: 3,
    MAX_FAILED_ATTEMPTS: 3,
    KILL_COOLDOWN: 30, // seconds
    SABOTAGE_COOLDOWNS: {
        comms: 60,
        lights: 45,
        oxygen: 90,
        reactor: 120
    }
};

// Utility Functions
function generateId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

function getCurrentTimestamp() {
    return Date.now();
}

// Core Database Operations
async function getData(path = '') {
    const snapshot = await firebase.database().ref(path).once('value');
    return snapshot.val() || {};
}

async function updateData(updates) {
    await firebase.database().ref().update(updates);
}

async function getPlayers() {
    return await getData('players');
}

async function getPlayer(playerId) {
    return await getData(`players/${playerId}`);
}

async function getGameState() {
    return await getData('gameState');
}

// Player Management
async function registerPlayer(username, password) {
    const players = await getPlayers();
    const playerId = generateId();
    
    const playerData = {
        id: playerId,
        username: username,
        password: password,
        role: 'crewmate',
        score: 0,
        status: 'online',
        currentTask: 0,
        completedTasks: [],
        failedChallenges: [],
        isVulnerable: false,
        joinedAt: getCurrentTimestamp(),
        lastActive: getCurrentTimestamp()
    };
    
    await firebase.database().ref(`players/${playerId}`).set(playerData);
    
    // Check if we should assign roles
    const totalPlayers = Object.keys(players).length + 1;
    if (totalPlayers >= GameConfig.TOTAL_PLAYERS) {
        await assignRoles();
    }
    
    return playerData;
}

async function authenticate(username, password) {
    const players = await getPlayers();
    for (const [playerId, player] of Object.entries(players)) {
        if (player.username === username && player.password === password) {
            await updatePlayerStatus(playerId, 'online');
            return player;
        }
    }
    return null;
}

async function updatePlayerStatus(playerId, status) {
    await firebase.database().ref(`players/${playerId}`).update({
        status: status,
        lastActive: getCurrentTimestamp()
    });
}

// Role Assignment System
async function assignRoles() {
    const players = await getPlayers();
    const playerIds = Object.keys(players);
    
    if (playerIds.length < 2) {
        throw new Error('Need at least 2 players to assign roles');
    }
    
    // Clear previous roles
    const updates = {};
    playerIds.forEach(playerId => {
        updates[`players/${playerId}/role`] = 'crewmate';
        updates[`players/${playerId}/isVulnerable`] = false;
        updates[`players/${playerId}/completedTasks`] = [];
        updates[`players/${playerId}/failedChallenges`] = [];
    });
    
    await updateData(updates);
    
    // Select impostors randomly
    const impostorCount = Math.min(GameConfig.IMPOSTOR_COUNT, Math.max(1, Math.floor(playerIds.length / 4)));
    const shuffledPlayers = [...playerIds].sort(() => Math.random() - 0.5);
    const impostorIds = shuffledPlayers.slice(0, impostorCount);
    
    // Assign impostor roles
    for (const impostorId of impostorIds) {
        await firebase.database().ref(`players/${impostorId}/role`).set('impostor');
    }
    
    // Initialize game state
    await initializeGameState();
    
    await logActivity(`Roles assigned! ${impostorCount} impostor(s) among ${playerIds.length} players`, 'role_assignment');
    
    return {
        impostors: impostorIds.map(id => players[id].username),
        crewmates: playerIds.filter(id => !impostorIds.includes(id)).map(id => players[id].username)
    };
}

// Game State Management
async function initializeGameState() {
    const players = await getPlayers();
    const gameState = {
        currentRound: 1,
        killsThisRound: 0,
        gameStatus: 'playing',
        winReason: '',
        sabotageCooldowns: {},
        meetingCalled: false,
        voteInProgress: false,
        rolesAssigned: true,
        gameStartTime: getCurrentTimestamp(),
        totalPlayers: Object.keys(players).length
    };
    
    await firebase.database().ref('gameState').set(gameState);
    return gameState;
}

// Kill System
async function performKill(impostorId, targetId) {
    const gameState = await getGameState();
    const players = await getPlayers();
    
    // Check game status
    if (gameState.gameStatus !== 'playing') {
        return { success: false, reason: 'Game is not in progress' };
    }
    
    // Check kill limit
    if (gameState.killsThisRound >= GameConfig.MAX_KILLS_PER_ROUND) {
        return { 
            success: false, 
            reason: `Maximum kills (${GameConfig.MAX_KILLS_PER_ROUND}) reached this round` 
        };
    }
    
    // Validate target
    const target = players[targetId];
    const impostor = players[impostorId];
    
    if (!target || !impostor) {
        return { success: false, reason: 'Invalid player' };
    }
    
    if (target.role === 'impostor') {
        return { success: false, reason: 'Cannot eliminate fellow impostor' };
    }
    
    if (target.status === 'eliminated') {
        return { success: false, reason: 'Target already eliminated' };
    }
    
    // Check cooldown
    const lastKillTime = impostor.lastKillTime || 0;
    const cooldownRemaining = Math.max(0, GameConfig.KILL_COOLDOWN - Math.floor((getCurrentTimestamp() - lastKillTime) / 1000));
    
    if (cooldownRemaining > 0) {
        return { 
            success: false, 
            reason: `Kill cooldown: ${cooldownRemaining}s remaining` 
        };
    }
    
    // Execute kill
    await firebase.database().ref(`players/${targetId}`).update({
        status: 'eliminated',
        eliminatedBy: impostorId,
        eliminatedAt: getCurrentTimestamp()
    });
    
    // Update kill count and cooldown
    const newKillCount = gameState.killsThisRound + 1;
    await firebase.database().ref('gameState/killsThisRound').set(newKillCount);
    await firebase.database().ref(`players/${impostorId}/lastKillTime`).set(getCurrentTimestamp());
    
    // Log activity
    await logActivity(`🔪 ${impostor.username} eliminated ${target.username}`, 'kill');
    
    // Check win conditions
    await checkWinConditions();
    
    return {
        success: true,
        message: `Successfully eliminated ${target.username}`,
        killsRemaining: GameConfig.MAX_KILLS_PER_ROUND - newKillCount
    };
}

async function getKillCooldown(impostorId) {
    const player = await getPlayer(impostorId);
    if (!player || !player.lastKillTime) return 0;
    
    const cooldownRemaining = Math.max(0, GameConfig.KILL_COOLDOWN - Math.floor((getCurrentTimestamp() - player.lastKillTime) / 1000));
    return cooldownRemaining;
}

// Task System
async function updatePlayerTask(playerId, taskId, completed) {
    const player = await getPlayer(playerId);
    
    if (completed) {
        // Add to completed tasks if not already there
        if (!player.completedTasks.includes(taskId)) {
            const newCompletedTasks = [...player.completedTasks, taskId];
            await firebase.database().ref(`players/${playerId}/completedTasks`).set(newCompletedTasks);
            
            await logActivity(`✅ ${player.username} completed task ${taskId}`, 'task_complete');
            
            // Check if this completes all required tasks
            if (newCompletedTasks.length >= GameConfig.REQUIRED_TASKS_TO_WIN) {
                await logActivity(`🎉 ${player.username} has completed all required tasks!`, 'milestone');
                await checkWinConditions();
            }
        }
    } else {
        // Add to failed challenges
        const newFailedChallenges = [...player.failedChallenges, taskId];
        await firebase.database().ref(`players/${playerId}/failedChallenges`).set(newFailedChallenges);
        
        // Mark as vulnerable if failed 3 times
        if (newFailedChallenges.length >= GameConfig.MAX_FAILED_ATTEMPTS) {
            await firebase.database().ref(`players/${playerId}/isVulnerable`).set(true);
            await logActivity(`🔴 ${player.username} is now VULNERABLE after failing ${GameConfig.MAX_FAILED_ATTEMPTS} challenges`, 'vulnerable');
        }
        
        await checkWinConditions();
    }
}

async function markChallengeCompleted(playerId, challengeId) {
    return await updatePlayerTask(playerId, challengeId, true);
}

// Attempts System
async function getPlayerAttempts(playerId, challengeId) {
    const player = await getPlayer(playerId);
    const attempts = player.failedChallenges.filter(id => id === challengeId).length;
    return {
        count: attempts,
        remaining: GameConfig.MAX_FAILED_ATTEMPTS - attempts,
        completed: player.completedTasks.includes(challengeId)
    };
}

async function incrementAttempts(playerId, challengeId) {
    const player = await getPlayer(playerId);
    
    // Only increment if not already completed
    if (!player.completedTasks.includes(challengeId)) {
        const newFailedChallenges = [...player.failedChallenges, challengeId];
        await firebase.database().ref(`players/${playerId}/failedChallenges`).set(newFailedChallenges);
        
        // Mark as vulnerable if reached max attempts
        if (newFailedChallenges.length >= GameConfig.MAX_FAILED_ATTEMPTS) {
            await firebase.database().ref(`players/${playerId}/isVulnerable`).set(true);
        }
        
        return newFailedChallenges.length;
    }
    
    return player.failedChallenges.length;
}

// Sabotage System
async function triggerSabotage(impostorId, sabotageType) {
    const gameState = await getGameState();
    const player = await getPlayer(impostorId);
    
    if (!player || player.role !== 'impostor') {
        return { success: false, message: 'Only impostors can sabotage' };
    }
    
    // Check cooldown
    const cooldownEnd = gameState.sabotageCooldowns?.[sabotageType] || 0;
    if (getCurrentTimestamp() < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - getCurrentTimestamp()) / 1000);
        return { success: false, message: `Sabotage on cooldown: ${remaining}s remaining` };
    }
    
    // Set cooldown
    const cooldownDuration = GameConfig.SABOTAGE_COOLDOWNS[sabotageType] * 1000;
    const newCooldownEnd = getCurrentTimestamp() + cooldownDuration;
    
    await firebase.database().ref(`gameState/sabotageCooldowns/${sabotageType}`).set(newCooldownEnd);
    
    // Trigger sabotage effect
    await firebase.database().ref(`sabotages/active`).set({
        type: sabotageType,
        triggeredBy: impostorId,
        startTime: getCurrentTimestamp(),
        duration: cooldownDuration
    });
    
    await logActivity(`⚡ ${player.username} triggered ${sabotageType} sabotage`, 'sabotage');
    
    return { 
        success: true, 
        message: `${sabotageType.toUpperCase()} sabotage activated!` 
    };
}

// Win Condition System
async function checkWinConditions() {
    const players = await getPlayers();
    const gameState = await getGameState();
    
    if (gameState.gameStatus !== 'playing') return;
    
    const crewmates = Object.values(players).filter(p => p.role === 'crewmate' && p.status !== 'eliminated');
    const impostors = Object.values(players).filter(p => p.role === 'impostor' && p.status !== 'eliminated');
    
    // Crewmate Win Conditions
    // 1. All impostors eliminated
    if (impostors.length === 0 && crewmates.length > 0) {
        await endGame('crewmate_win', 'All impostors have been eliminated!');
        return;
    }
    
    // 2. All crewmates completed all tasks
    const crewmatesWithAllTasks = crewmates.filter(p => p.completedTasks.length >= GameConfig.REQUIRED_TASKS_TO_WIN);
    if (crewmates.length > 0 && crewmatesWithAllTasks.length === crewmates.length) {
        await endGame('crewmate_win', 'All tasks completed successfully!');
        return;
    }
    
    // Impostor Win Conditions
    // 1. No crewmates left alive
    if (crewmates.length === 0 && impostors.length > 0) {
        await endGame('impostor_win', 'All crewmates have been eliminated!');
        return;
    }
    
    // 2. Crewmates cannot complete tasks (all vulnerable or failed)
    const canCrewmatesWin = crewmates.some(crewmate => 
        crewmate.failedChallenges.length < GameConfig.MAX_FAILED_ATTEMPTS
    );
    
    if (!canCrewmatesWin && crewmates.length > 0) {
        await endGame('impostor_win', 'Crewmates failed to complete their tasks!');
        return;
    }
}

async function endGame(winningTeam, reason) {
    await firebase.database().ref('gameState').update({
        gameStatus: winningTeam,
        winReason: reason,
        gameEndTime: getCurrentTimestamp()
    });
    
    await logActivity(`🎮 GAME OVER: ${reason}`, 'game_end');
    await updateScores(winningTeam);
}

async function updateScores(winningTeam) {
    const players = await getPlayers();
    
    for (const [playerId, player] of Object.entries(players)) {
        let scoreChange = 0;
        
        if (winningTeam === 'crewmate_win' && player.role === 'crewmate') {
            // Base win + task completion bonus
            scoreChange = 100 + (player.completedTasks.length * 50);
        } else if (winningTeam === 'impostor_win' && player.role === 'impostor') {
            // Base win + kill bonus
            scoreChange = 150;
        }
        
        if (scoreChange > 0) {
            const newScore = (player.score || 0) + scoreChange;
            await firebase.database().ref(`players/${playerId}/score`).set(newScore);
        }
    }
}

// Meeting and Voting System
async function canCallMeeting(playerId) {
    const player = await getPlayer(playerId);
    const gameState = await getGameState();
    
    if (gameState.meetingCalled) {
        return { canCall: false, reason: 'Meeting already in progress' };
    }
    
    if (player.status === 'eliminated') {
        return { canCall: false, reason: 'Eliminated players cannot call meetings' };
    }
    
    return { canCall: true, reason: '' };
}

async function callMeeting(playerId) {
    const canCall = await canCallMeeting(playerId);
    if (!canCall.canCall) return canCall;
    
    await firebase.database().ref('gameState').update({
        meetingCalled: true,
        meetingStartTime: getCurrentTimestamp(),
        meetingCalledBy: playerId
    });
    
    const player = await getPlayer(playerId);
    await logActivity(`🚨 ${player.username} called an emergency meeting!`, 'meeting');
    
    return { success: true, message: 'Emergency meeting called!' };
}

// Activity Logging
async function logActivity(message, type = 'info') {
    const activity = {
        message: message,
        type: type,
        timestamp: getCurrentTimestamp()
    };
    
    const activityId = generateId();
    await firebase.database().ref(`activities/${activityId}`).set(activity);
    
    // Keep only last 50 activities
    const activities = await getData('activities');
    if (Object.keys(activities).length > 50) {
        const sorted = Object.entries(activities).sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = sorted.slice(0, sorted.length - 50);
        for (const [id] of toDelete) {
            await firebase.database().ref(`activities/${id}`).remove();
        }
    }
}

async function getRecentActivities(limit = 10) {
    const activities = await getData('activities');
    return Object.values(activities)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
}

// Real-time Listeners
function onDataChange(callback) {
    return firebase.database().ref().on('value', (snapshot) => {
        callback(snapshot.val() || {});
    });
}

// Impostor Dashboard
async function getImpostorDashboardData() {
    const players = await getPlayers();
    const gameState = await getGameState();
    
    const onlinePlayers = Object.values(players).filter(p => p.status === 'online');
    const impostors = Object.values(players).filter(p => p.role === 'impostor');
    const vulnerablePlayers = Object.values(players).filter(p => p.isVulnerable && p.role === 'crewmate' && p.status !== 'eliminated');
    
    // Calculate crewmate progress
    const crewmatePlayers = Object.values(players).filter(p => p.role === 'crewmate');
    const totalTasks = crewmatePlayers.reduce((sum, player) => sum + player.completedTasks.length, 0);
    const maxPossibleTasks = crewmatePlayers.length * GameConfig.REQUIRED_TASKS_TO_WIN;
    const crewmateProgress = maxPossibleTasks > 0 ? Math.min(100, (totalTasks / maxPossibleTasks) * 100) : 0;
    
    return {
        players: players,
        gameState: gameState,
        onlineCount: onlinePlayers.length,
        totalPlayers: Object.keys(players).length,
        impostorCount: impostors.length,
        vulnerableCount: vulnerablePlayers.length,
        crewmateProgress: crewmateProgress,
        recentActivities: await getRecentActivities(10),
        killsRemaining: GameConfig.MAX_KILLS_PER_ROUND - (gameState.killsThisRound || 0)
    };
}

// Reset Game
async function resetGame() {
    const players = await getPlayers();
    
    // Reset players
    const updates = {};
    for (const [playerId, player] of Object.entries(players)) {
        updates[`players/${playerId}/status`] = 'online';
        updates[`players/${playerId}/currentTask`] = 0;
        updates[`players/${playerId}/completedTasks`] = [];
        updates[`players/${playerId}/failedChallenges`] = [];
        updates[`players/${playerId}/isVulnerable`] = false;
        // Keep score and role for now
    }
    
    await updateData(updates);
    
    // Reassign roles
    await assignRoles();
    
    await logActivity('Game has been reset - new round starting!', 'game_reset');
}

// Export functions
window.firebaseDB = {
    // Player Management
    registerPlayer,
    authenticate,
    updatePlayerStatus,
    getPlayer,
    getPlayers,
    
    // Game Systems
    assignRoles,
    getGameState,
    initializeGameState,
    resetGame,
    
    // Kill System
    performKill,
    getKillCooldown,
    
    // Task System
    updatePlayerTask,
    markChallengeCompleted,
    getPlayerAttempts,
    incrementAttempts,
    
    // Sabotage System
    triggerSabotage,
    
    // Meeting System
    canCallMeeting,
    callMeeting,
    
    // Win Conditions
    checkWinConditions,
    
    // Dashboard
    getImpostorDashboardData,
    
    // Utilities
    onDataChange,
    logActivity,
    getRecentActivities,
    getData,
    updateData
};

console.log('Firebase Game DB loaded successfully for among-ussy!');