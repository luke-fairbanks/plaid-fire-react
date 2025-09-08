const express = require('express');
const router = express.Router();
const { budgetsCol, categoriesCol } = require('../utils/firestore');
const { verifyToken } = require('../middleware/auth');
const admin = require('firebase-admin');

// Get all budgets
router.get('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const budgetsSnap = await budgetsCol(uid).get();
    const budgets = [];

    for (const doc of budgetsSnap.docs) {
      const budget = doc.data();
      // Get categories for this budget
      const categoriesSnap = await categoriesCol(uid).where('budgetId', '==', doc.id).get();
      const categories = categoriesSnap.docs.map(cat => ({ id: cat.id, ...cat.data() }));

      budgets.push({
        id: doc.id,
        ...budget,
        categories,
        totalBudget: categories.reduce((sum, cat) => sum + (cat.amount || 0), 0)
      });
    }

    res.json(budgets);
  } catch (error) {
    console.error('Get budgets error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create budget
router.post('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { name, categories = [] } = req.body;

    // Check if user already has a budget
    const existingBudgets = await budgetsCol(uid).get();
    if (!existingBudgets.empty) {
      return res.status(400).json({ error: 'User can only have one budget for now' });
    }

    const budgetRef = budgetsCol(uid).doc();
    const budget = {
      name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await budgetRef.set(budget);

    // Create categories
    const categoryRefs = [];
    for (const category of categories) {
      const catRef = categoriesCol(uid).doc();
      await catRef.set({
        ...category,
        budgetId: budgetRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      categoryRefs.push({ id: catRef.id, ...category });
    }

    res.json({
      id: budgetRef.id,
      ...budget,
      categories: categoryRefs,
      totalBudget: categoryRefs.reduce((sum, cat) => sum + (cat.amount || 0), 0)
    });
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update budget
router.put('/:budgetId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { budgetId } = req.params;
    const { name } = req.body;

    await budgetsCol(uid).doc(budgetId).update({
      name,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Update budget error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete budget
router.delete('/:budgetId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { budgetId } = req.params;

    // Delete budget
    await budgetsCol(uid).doc(budgetId).delete();

    // Delete associated categories
    const categoriesSnap = await categoriesCol(uid).where('budgetId', '==', budgetId).get();
    const batch = admin.firestore().batch();
    categoriesSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    res.json({ ok: true });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Re-categorize all transactions
router.post('/recategorize', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const result = await require('../utils/categorization').recategorizeAllTransactions(uid);

    res.json({
      ok: true,
      message: `Re-categorized ${result.updated} out of ${result.total} transactions`,
      updated: result.updated,
      total: result.total
    });
  } catch (error) {
    console.error('Re-categorize error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
