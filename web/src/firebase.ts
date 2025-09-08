import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirestore } from "firebase/firestore";

// TODO: replace with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyDLEMses3l6I_jFVpBjVvgq3yYNarxYPX0",
  authDomain: "plaid-fire-react.firebaseapp.com",
  projectId: "plaid-fire-react",
  storageBucket: "plaid-fire-react.firebasestorage.app",
  messagingSenderId: "649349134669",
  appId: "1:649349134669:web:33a260f9b572017b805f04",
  measurementId: "G-0QSQ3QZZNE"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

export const callCreateLinkToken = httpsCallable(functions, "createLinkToken");
export const callExchangePublicToken = httpsCallable(functions, "exchangePublicToken");
export const callSyncTransactions = httpsCallable(functions, "syncTransactions");
export const callGetAccounts = httpsCallable(functions, "getAccounts");

export async function signIn() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}
export async function signOutUser() { await signOut(auth); }
