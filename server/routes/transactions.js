const express = require('express');
const router = express.Router();
const { plaidClient } = require('../utils/plaid');
const { tokensDoc, txCol, categoriesCol } = require('../utils/firestore');
const { verifyToken } = require('../middleware/auth');
const { recategorizeAllTransactions } = require('../utils/categorization');
const admin = require('firebase-admin');

// Sync transactions
router.post('/sync', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Get stored tokens
    const tokenDoc = await tokensDoc(uid).get();
    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Bank not linked' });
    }

    const { access_token, cursor: savedCursor } = tokenDoc.data();

    // Initialize Firestore batch
    const batch = admin.firestore().batch();

    // Sync transactions
    let added = [];
    let modified = [];
    let removed = [];
    let nextCursor = savedCursor || null;

    while (true) {
      const response = await plaidClient.transactionsSync({
        access_token,
        cursor: nextCursor || undefined,
        options: { include_personal_finance_category: true },
      });

      added = added.concat(response.data.added);
      modified = modified.concat(response.data.modified);
      removed = removed.concat(response.data.removed);
      nextCursor = response.data.next_cursor;

      if (!response.data.has_more) break;
    }

    // Load categories for auto-categorization
    const categoriesSnap = await categoriesCol(uid).get();
    const categories = categoriesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Function to find category by keywords
    const findCategoryByKeywords = (transactionName, merchantName) => {
      const searchText = `${transactionName} ${merchantName || ''}`.toLowerCase();

      for (const category of categories) {
        if (category.keywords && category.keywords.length > 0) {
          for (const keyword of category.keywords) {
            if (searchText.includes(keyword.toLowerCase())) {
              return category;
            }
          }
        }
      }
      return null;
    };

    // Function to find category by Plaid's personal finance category
    const findCategoryByPlaidCategory = (pfCategory) => {
      if (!pfCategory) return null;

      // Map common Plaid categories to our categories
      const plaidMappings = {
        'FOOD_AND_DRINK': ['food', 'restaurant', 'dining', 'grocery'],
        'TRANSPORTATION': ['gas', 'uber', 'lyft', 'transit', 'parking'],
        'ENTERTAINMENT': ['movie', 'theater', 'concert', 'game'],
        'SHOPPING': ['amazon', 'store', 'retail', 'mall'],
        'BILLS_AND_UTILITIES': ['utility', 'electric', 'water', 'internet', 'phone'],
        'HEALTHCARE': ['medical', 'doctor', 'pharmacy', 'hospital'],
        'EDUCATION': ['school', 'tuition', 'book', 'course'],
        'TRAVEL': ['hotel', 'flight', 'vacation', 'trip']
      };

      for (const [plaidCat, keywords] of Object.entries(plaidMappings)) {
        if (pfCategory.includes(plaidCat)) {
          for (const category of categories) {
            if (category.keywords && category.keywords.length > 0) {
              for (const keyword of category.keywords) {
                if (keywords.some(k => keyword.toLowerCase().includes(k))) {
                  return category;
                }
              }
            }
          }
        }
      }
      return null;
    };

    // Process added and modified transactions
    for (const t of [...added, ...modified]) {
      const docId = t.transaction_id;
      const ref = txCol(uid).doc(docId);

      // Try to categorize the transaction
      let assignedCategory = null;
      let categoryName = null;

      // First, try keyword matching
      assignedCategory = findCategoryByKeywords(t.name, t.merchant_name);

      // If no keyword match, try Plaid category mapping
      if (!assignedCategory) {
        assignedCategory = findCategoryByPlaidCategory(t.personal_finance_category?.primary);
      }

      if (assignedCategory) {
        categoryName = assignedCategory.name;
      }

      const outflow = t.amount > 0 ? t.amount * 100 : null;
      const inflow = t.amount < 0 ? -t.amount * 100 : null;

      const data = {
        transaction_id: t.transaction_id,
        account_id: t.account_id,
        date: t.date,
        name: t.name || '',
        merchant_name: t.merchant_name || '',
        city: t.location?.city || '',
        amount: t.amount * 100, // Convert dollars to cents
        outflow,
        inflow,
        currency: t.iso_currency_code || '',
        pending: !!t.pending,
        pf_category: t.personal_finance_category?.primary || null,
        category: assignedCategory?.id || null,
        categoryName: categoryName || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      batch.set(ref, data, { merge: true });
    }

    // Mark removed transactions
    for (const r of removed) {
      const ref = txCol(uid).doc(r.transaction_id);
      batch.set(ref, {
        removed: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // Update cursor
    batch.set(tokensDoc(uid), {
      cursor: nextCursor,
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();

    // Re-categorize all transactions to ensure consistency
    const recategorizeResult = await recategorizeAllTransactions(uid);

    res.json({
      ok: true,
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      recategorized: recategorizeResult.updated
    });
  } catch (error) {
    console.error('Sync transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transactions
router.get('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { limit = 50, offset = 0 } = req.query;

    const transactionsSnap = await txCol(uid)
      .orderBy('date', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const transactions = transactionsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(transactions);
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign category to transaction
router.post('/:transactionId/categorize', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { transactionId } = req.params;
    const { categoryId, applyToSimilar = false } = req.body;

    // Get the transaction
    const txDoc = await txCol(uid).doc(transactionId).get();
    if (!txDoc.exists) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = txDoc.data();

    // Get the category
    const categoryDoc = await categoriesCol(uid).doc(categoryId).get();
    if (!categoryDoc.exists) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category = categoryDoc.data();

    // Update transaction with category
    await txDoc.ref.update({
      category: categoryId,
      categoryName: category.name,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If applyToSimilar is true, add keywords to category
    if (applyToSimilar) {
      const newKeywords = [
        ...(category.keywords || []),
        transaction.name.toLowerCase(),
        ...(transaction.merchant_name ? [transaction.merchant_name.toLowerCase()] : [])
      ];

      // Remove duplicates
      const uniqueKeywords = [...new Set(newKeywords)];

      await categoryDoc.ref.update({
        keywords: uniqueKeywords,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Categorize transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Edit transaction
router.put('/:transactionId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { transactionId } = req.params;
    const { name, merchant_name, amount, date, category } = req.body;

    // Get the transaction
    const txDoc = await txCol(uid).doc(transactionId).get();
    if (!txDoc.exists) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Only update fields that are provided
    if (name !== undefined) updateData.name = name;
    if (merchant_name !== undefined) updateData.merchant_name = merchant_name;
    if (amount !== undefined) updateData.amount = parseInt(amount);
    if (date !== undefined) updateData.date = date;
    if (category !== undefined) {
      updateData.category = category;
      if (category) {
        // Get category name if category is provided
        const categoryDoc = await categoriesCol(uid).doc(category).get();
        if (categoryDoc.exists) {
          updateData.categoryName = categoryDoc.data().name;
        }
      } else {
        updateData.categoryName = null;
      }
    }

    await txDoc.ref.update(updateData);

    // Get updated transaction
    const updatedTxDoc = await txCol(uid).doc(transactionId).get();
    const updatedTransaction = {
      id: updatedTxDoc.id,
      ...updatedTxDoc.data()
    };

    res.json(updatedTransaction);
  } catch (error) {
    console.error('Edit transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction
router.delete('/:transactionId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { transactionId } = req.params;

    // Get the transaction
    const txDoc = await txCol(uid).doc(transactionId).get();
    if (!txDoc.exists) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Delete the transaction
    await txDoc.ref.delete();

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search transactions
router.get('/search', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { query, limit = 20 } = req.query;

    let queryRef = txCol(uid).orderBy('date', 'desc');

    if (query) {
      // Search by name or merchant
      queryRef = queryRef.where('name', '>=', query)
                         .where('name', '<=', query + '\uf8ff');
    }

    const transactionsSnap = await queryRef.limit(parseInt(limit)).get();

    const results = transactionsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        suggestedKeywords: [
          data.name.toLowerCase(),
          ...(data.merchant_name ? [data.merchant_name.toLowerCase()] : [])
        ].filter(k => k && k.length > 2)
      };
    });

    res.json(results);
  } catch (error) {
    console.error('Search transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
