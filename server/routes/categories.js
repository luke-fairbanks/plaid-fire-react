const express = require('express');
const router = express.Router();
const { categoriesCol } = require('../utils/firestore');
const { verifyToken } = require('../middleware/auth');
const { recategorizeAllTransactions } = require('../utils/categorization');
const admin = require('firebase-admin');

// Get all categories
router.get('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const categoriesSnap = await categoriesCol(uid).get();
    const categories = categoriesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create category
router.post('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { name, amount, keywords = [], budgetId, color } = req.body;

    const categoryRef = categoriesCol(uid).doc();
    const categoryData = {
      name,
      amount: amount || 0,
      keywords,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Only add optional fields if they are defined
    if (budgetId !== undefined) {
      categoryData.budgetId = budgetId;
    }
    if (color !== undefined) {
      categoryData.color = color;
    }

    await categoryRef.set(categoryData);

    // Re-categorize all transactions after creating new category
    const recategorizeResult = await recategorizeAllTransactions(uid);

    res.json({
      id: categoryRef.id,
      ...categoryData,
      recategorized: recategorizeResult.updated
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update category
router.put('/:categoryId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { categoryId } = req.params;
    const { name, amount, keywords, color } = req.body;

    await categoriesCol(uid).doc(categoryId).update({
      ...(name && { name }),
      ...(amount !== undefined && { amount }),
      ...(keywords && { keywords }),
      ...(color && { color }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Re-categorize all transactions after category update
    const recategorizeResult = await recategorizeAllTransactions(uid);

    res.json({ ok: true, recategorized: recategorizeResult.updated });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete category
router.delete('/:categoryId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { categoryId } = req.params;

    await categoriesCol(uid).doc(categoryId).delete();

    // Re-categorize all transactions after category deletion
    const recategorizeResult = await recategorizeAllTransactions(uid);

    res.json({ ok: true, recategorized: recategorizeResult.updated });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
