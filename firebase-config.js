// firebase-config.js - FOR YOUR among-ussy PROJECT
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

// Initialize Firebase for compatibility SDK
if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
        try {
            firebase.initializeApp(firebaseConfig);
            console.log('✅ Firebase initialized successfully for among-ussy!');
            console.log('📊 Database URL:', firebaseConfig.databaseURL);
            console.log('🎯 Project ID:', firebaseConfig.projectId);
            
            // Test connection immediately
            firebase.database().ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    console.log('✅ Firebase Realtime Database connected!');
                } else {
                    console.log('❌ Firebase Realtime Database disconnected');
                }
            });
            
        } catch (error) {
            console.error('❌ Firebase initialization error:', error);
        }
    } else {
        console.log('🔄 Using existing Firebase app');
        firebase.app(); // Use existing app
    }
} else {
    console.error('❌ Firebase SDK not loaded - check script order in HTML');
}

// Enhanced connection testing function
window.testFirebaseConnection = async function() {
    try {
        console.log('🧪 Testing Firebase connection...');
        
        // Test write operation
        await firebase.database().ref('connectionTest').set({
            timestamp: Date.now(),
            message: 'Connection test successful',
            project: 'among-ussy'
        });
        console.log('✅ Write test passed');
        
        // Test read operation
        const snapshot = await firebase.database().ref('connectionTest').once('value');
        const data = snapshot.val();
        console.log('✅ Read test passed:', data);
        
        // Test players path access
        const playersSnapshot = await firebase.database().ref('players').once('value');
        console.log('✅ Players path access:', playersSnapshot.exists() ? 'Exists' : 'Empty');
        
        return { success: true, data: data };
        
    } catch (error) {
        console.error('❌ Firebase connection test failed:', error);
        return { success: false, error: error.message };
    }
};

// Auto-test on load if in browser context
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(() => {
            if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
                console.log('🚀 Auto-testing Firebase connection...');
                window.testFirebaseConnection().then(result => {
                    if (result.success) {
                        console.log('🎉 Firebase is fully operational!');
                    } else {
                        console.error('💥 Firebase configuration issue detected');
                    }
                });
            }
        }, 1000);
    });
}