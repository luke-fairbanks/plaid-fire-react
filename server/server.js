
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://plaid-fire-react-default-rtdb.firebaseio.com"
});

const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(express.json());

// Import routes
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const budgetRoutes = require('./routes/budgets');

// Use routes
app.use('/', authRoutes);
app.use('/accounts', accountRoutes);
app.use('/transactions', transactionRoutes);
app.use('/categories', categoryRoutes);
app.use('/budgets', budgetRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper functions (shared across modules)
function userDoc(uid) {
  return db.collection('users').doc(uid);
}

function tokensDoc(uid) {
  return userDoc(uid).collection('private').doc('plaid');
}

function accountsCol(uid) {
  return userDoc(uid).collection('accounts');
}

function txCol(uid) {
  return userDoc(uid).collection('transactions');
}

function budgetsCol(uid) {
  return userDoc(uid).collection('budgets');
}

function categoriesCol(uid) {
  return userDoc(uid).collection('categories');
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.PLAID_ENV || 'sandbox'}`);
});
