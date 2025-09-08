const admin = require('firebase-admin');

// Helper functions for Firestore collections
function userDoc(uid) {
  return admin.firestore().collection('users').doc(uid);
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

module.exports = {
  userDoc,
  tokensDoc,
  accountsCol,
  txCol,
  budgetsCol,
  categoriesCol
};
