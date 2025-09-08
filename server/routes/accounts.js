const express = require('express');
const router = express.Router();
const { plaidClient, CountryCode } = require('../utils/plaid');
const { tokensDoc, accountsCol, txCol } = require('../utils/firestore');
const { verifyToken } = require('../middleware/auth');
const admin = require('firebase-admin');

// Get accounts
router.get('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const accountsSnap = await accountsCol(uid).get();
    const accounts = accountsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Group accounts by institution
    const institutions = {};
    accounts.forEach(account => {
      const institutionId = account.institution_id;
      if (!institutions[institutionId]) {
        institutions[institutionId] = {
          institution_id: institutionId,
          institution_name: account.institution_name,
          institution_logo: account.institution_logo,
          accounts: []
        };
      }
      institutions[institutionId].accounts.push(account);
    });

    res.json({
      institutions: Object.values(institutions),
      accounts: accounts
    });
  } catch (error) {
    console.error('Get accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get accounts from Plaid and store them
router.post('/sync', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const tokenDoc = await tokensDoc(uid).get();
    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Bank not linked' });
    }

    const { access_token } = tokenDoc.data();

    const response = await plaidClient.accountsGet({ access_token });

    console.log('Account sync response:', response.data);

    // Get institution info from the item
    const institution = {
      institution_id: response.data.item.institution_id,
      name: response.data.item.institution_name
    };

    // Try to get institution logo
    try {
      const institutionResponse = await plaidClient.institutionsGetById({
        institution_id: institution.institution_id,
        country_codes: [CountryCode.Us, CountryCode.Ca],
      });
      institution.logo = institutionResponse.data.institution.logo;
    } catch (error) {
      console.log('Could not fetch institution logo:', error.message);
    }

    // Get existing accounts to check for duplicates
    const existingAccountsSnap = await accountsCol(uid).get();
    const existingAccountIds = new Set(existingAccountsSnap.docs.map(doc => doc.data().account_id));

    // Store accounts in Firestore (only new ones or updates)
    const batch = admin.firestore().batch();
    let addedCount = 0;
    let updatedCount = 0;

    response.data.accounts.forEach(account => {
      const ref = accountsCol(uid).doc(account.account_id);
      const accountData = {
        account_id: account.account_id,
        name: account.name || account.official_name || 'Account',
        official_name: account.official_name || null,
        mask: account.mask || null,
        subtype: account.subtype || null,
        type: account.type || null,
        institution_id: institution.institution_id,
        institution_name: institution.name,
        institution_logo: institution.logo || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (existingAccountIds.has(account.account_id)) {
        // Account exists, update it
        batch.set(ref, accountData, { merge: true });
        updatedCount++;
      } else {
        // New account, add it
        batch.set(ref, accountData);
        addedCount++;
      }
    });

    if (addedCount > 0 || updatedCount > 0) {
      await batch.commit();
    }

    console.log(`Accounts processed: ${addedCount} added, ${updatedCount} updated`);

    res.json({
      ok: true,
      count: response.data.accounts.length,
      added: addedCount,
      updated: updatedCount
    });
  } catch (error) {
    console.error('Sync accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete account
router.delete('/:accountId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { accountId } = req.params;
    const { deleteTransactions = false } = req.body;

    // Get the account
    const accountDoc = await accountsCol(uid).doc(accountId).get();
    if (!accountDoc.exists) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountDoc.data();

    // If deleteTransactions is true, delete all transactions for this account
    if (deleteTransactions) {
      const transactionsSnap = await txCol(uid).where('account_id', '==', accountId).get();
      const batch = admin.firestore().batch();
      transactionsSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`Deleted ${transactionsSnap.docs.length} transactions for account ${accountId}`);
    }

    // Delete the account
    await accountDoc.ref.delete();

    res.json({
      message: 'Account deleted successfully',
      transactionsDeleted: deleteTransactions ? true : false
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
