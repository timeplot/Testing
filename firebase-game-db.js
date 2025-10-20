// firebase-game-db.js - VERCEL COMPATIBLE VERSION

// Wait for Firebase to be available
function initializeFirebaseDB() {
    // Check if Firebase is loaded
    if (typeof firebase === 'undefined') {
        console.log('⏳ Waiting for Firebase to load...');
        setTimeout(initializeFirebaseDB, 100);
        return;
    }

    // Check if Firebase app is initialized
    if (!firebase.apps.length) {
        console.log('⏳ Waiting for Firebase app initialization...');
        setTimeout(initializeFirebaseDB, 100);
        return;
    }

    console.log('✅ Firebase loaded, initializing game DB...');

    const GameConfig = {
        TOTAL_PLAYERS: 8,
        IMPOSTOR_COUNT: 2,
        MAX_KILLS_PER_ROUND: 3,
        REQUIRED_TASKS_TO_WIN: 3,
        MAX_FAILED_ATTEMPTS: 3,
        KILL_COOLDOWN: 30,
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
        try {
            const snapshot = await firebase.database().ref(path).once('value');
            return snapshot.val() || {};
        } catch (error) {
            console.error('getData error:', error);
            return {};
        }
    }

    async function updateData(updates) {
        try {
            await firebase.database().ref().update(updates);
        } catch (error) {
            console.error('updateData error:', error);
        }
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
        try {
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
            console.log('✅ Player registered:', username);
            
            return playerData;
        } catch (error) {
            console.error('registerPlayer error:', error);
            throw error;
        }
    }

    async function authenticate(username, password) {
        try {
            const players = await getPlayers();
            for (const [playerId, player] of Object.entries(players)) {
                if (player && player.username === username && player.password === password) {
                    await updatePlayerStatus(playerId, 'online');
                    console.log('✅ Player authenticated:', username);
                    return player;
                }
            }
            return null;
        } catch (error) {
            console.error('authenticate error:', error);
            return null;
        }
    }

    async function updatePlayerStatus(playerId, status) {
        try {
            await firebase.database().ref(`players/${playerId}`).update({
                status: status,
                lastActive: getCurrentTimestamp()
            });
        } catch (error) {
            console.error('updatePlayerStatus error:', error);
        }
    }

    // Task System
    async function updatePlayerTask(playerId, taskId, completed) {
        try {
            const player = await getPlayer(playerId);
            if (!player) return;
            
            if (completed) {
                if (!player.completedTasks.includes(taskId)) {
                    const newCompletedTasks = [...player.completedTasks, taskId];
                    await firebase.database().ref(`players/${playerId}/completedTasks`).set(newCompletedTasks);
                    console.log('✅ Task completed:', taskId);
                }
            } else {
                const newFailedChallenges = [...player.failedChallenges, taskId];
                await firebase.database().ref(`players/${playerId}/failedChallenges`).set(newFailedChallenges);
                
                if (newFailedChallenges.length >= GameConfig.MAX_FAILED_ATTEMPTS) {
                    await firebase.database().ref(`players/${playerId}/isVulnerable`).set(true);
                    console.log('🔴 Player vulnerable:', player.username);
                }
            }
        } catch (error) {
            console.error('updatePlayerTask error:', error);
        }
    }

    async function markChallengeCompleted(playerId, challengeId) {
        return await updatePlayerTask(playerId, challengeId, true);
    }

    async function getPlayerAttempts(playerId, challengeId) {
        try {
            const player = await getPlayer(playerId);
            if (!player) return { count: 0, remaining: 3, completed: false };
            
            const attempts = player.failedChallenges ? player.failedChallenges.filter(id => id === challengeId).length : 0;
            const completedTasks = player.completedTasks || [];
            
            return {
                count: attempts,
                remaining: GameConfig.MAX_FAILED_ATTEMPTS - attempts,
                completed: completedTasks.includes(challengeId)
            };
        } catch (error) {
            console.error('getPlayerAttempts error:', error);
            return { count: 0, remaining: 3, completed: false };
        }
    }

    async function incrementAttempts(playerId, challengeId) {
        try {
            const player = await getPlayer(playerId);
            if (!player) return 0;
            
            const completedTasks = player.completedTasks || [];
            if (!completedTasks.includes(challengeId)) {
                const failedChallenges = player.failedChallenges || [];
                const newFailedChallenges = [...failedChallenges, challengeId];
                await firebase.database().ref(`players/${playerId}/failedChallenges`).set(newFailedChallenges);
                
                if (newFailedChallenges.length >= GameConfig.MAX_FAILED_ATTEMPTS) {
                    await firebase.database().ref(`players/${playerId}/isVulnerable`).set(true);
                }
                
                return newFailedChallenges.length;
            }
            
            return player.failedChallenges ? player.failedChallenges.length : 0;
        } catch (error) {
            console.error('incrementAttempts error:', error);
            return 0;
        }
    }

    // Real-time Listeners
    function onDataChange(callback) {
        try {
            return firebase.database().ref().on('value', (snapshot) => {
                callback(snapshot.val() || {});
            });
        } catch (error) {
            console.error('onDataChange error:', error);
        }
    }

    // Meeting System
    async function canCallMeeting(playerId) {
        try {
            const player = await getPlayer(playerId);
            const gameState = await getGameState();
            
            if (!player) {
                return { canCall: false, reason: 'Player not found' };
            }
            
            if (gameState && gameState.meetingCalled) {
                return { canCall: false, reason: 'Meeting already in progress' };
            }
            
            if (player.status === 'eliminated') {
                return { canCall: false, reason: 'Eliminated players cannot call meetings' };
            }
            
            return { canCall: true, reason: '' };
        } catch (error) {
            console.error('canCallMeeting error:', error);
            return { canCall: false, reason: 'Error checking meeting status' };
        }
    }

    // Activity Logging
    async function logActivity(message, type = 'info') {
        try {
            const activity = {
                message: message,
                type: type,
                timestamp: getCurrentTimestamp()
            };
            
            const activityId = generateId();
            await firebase.database().ref(`activities/${activityId}`).set(activity);
        } catch (error) {
            console.error('logActivity error:', error);
        }
    }

    // Export functions to global scope
    window.firebaseDB = {
        // Player Management
        registerPlayer,
        authenticate,
        updatePlayerStatus,
        getPlayer,
        getPlayers,
        
        // Game Systems
        getGameState,
        getData,
        updateData,
        
        // Task System
        updatePlayerTask,
        markChallengeCompleted,
        getPlayerAttempts,
        incrementAttempts,
        
        // Real-time Listeners
        onDataChange,
        
        // Meeting System
        canCallMeeting,
        
        // Activity Logging
        logActivity,
        
        // Utility
        GameConfig
    };

    console.log('✅ Firebase Game DB initialized successfully!');
    console.log('🎮 Game functions ready:', Object.keys(window.firebaseDB));
}

// Start initialization when in browser
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initializeFirebaseDB, 500);
        });
    } else {
        setTimeout(initializeFirebaseDB, 500);
    }
}