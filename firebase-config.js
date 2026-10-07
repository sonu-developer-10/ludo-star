// firebase-config.js
const firebaseConfig = {
  apiKey: "AIzaSyAly8obKiFe_PTUrR1Z4BqXUn6KMZqLcS0",
  authDomain: "ludo-star-2f7f9.firebaseapp.com",
  
  // 👉 Yahan exact URL lagayein (Asia region wali):
  databaseURL: "https://ludo-star-2f7f9-default-rtdb.asia-southeast1.firebasedatabase.app/",
  
  projectId: "ludo-star-2f7f9",
  storageBucket: "ludo-star-2f7f9.appspot.com",
  messagingSenderId: "797269449780",
  appId: "1:797269449780:web:1bf8830..."
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}