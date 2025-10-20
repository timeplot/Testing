// firebase-config.js - VERCEL COMPATIBLE
const firebaseConfig = {
  apiKey: "AIzaSyBDFrTtHCun1AcmSgw53MINjI5INw7HmNs",
  authDomain: "among-ussy.firebaseapp.com",
  databaseURL: "https://among-ussy-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "among-ussy",
  storageBucket: "among-ussy.firebasestorage.app",
  messagingSenderId: "1099157307947",
  appId: "1:1099157307947:web:daabc0acf85dbbec4a206e",
  measurementId: "G-5GK3JHG9T7"
};

// Initialize when Firebase is available
function initializeFirebase() {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            try {
                firebase.initializeApp(firebaseConfig);
                console.log('✅ Firebase initialized on Vercel!');
                console.log('📊 Database URL:', firebaseConfig.databaseURL);
                
                // Test connection
                firebase.database().ref('.info/connected').on('value', (snap) => {
                    if (snap.val() === true) {
                        console.log('✅ Firebase Realtime Database connected!');
                    }
                });
            } catch (error) {
                console.error('❌ Firebase initialization error:', error);
            }
        } else {
            console.log('🔄 Using existing Firebase app');
        }
    } else {
        console.log('⏳ Waiting for Firebase SDK...');
        setTimeout(initializeFirebase, 100);
    }
}

// Start initialization when in browser
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeFirebase);
    } else {
        initializeFirebase();
    }
}

// Global test function
window.testFirebaseConnection = async function() {
    if (typeof firebase === 'undefined') {
        return { success: false, error: 'Firebase not loaded' };
    }
    
    try {
        await firebase.database().ref('connectionTest').set({
            timestamp: Date.now(),
            message: 'Vercel test successful'
        });
        return { success: true, message: 'Firebase working on Vercel!' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};