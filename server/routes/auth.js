const express = require('express');
const router = express.Router();
const { plaidClient, Products, CountryCode } = require('../utils/plaid');
const { tokensDoc } = require('../utils/firestore');
const { verifyToken } = require('../middleware/auth');

// Create link token
router.post('/create-link-token', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'Plaid → Firestore',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: 'en',
    });

    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Create link token error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange public token
router.post('/exchange-public-token', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { public_token } = req.body;

    console.log('Exchange public token called for user:', uid);
    console.log('Public token received:', public_token ? 'Yes' : 'No');

    if (!public_token) {
      return res.status(400).json({ error: 'Missing public_token' });
    }

    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    console.log('Token exchange successful, storing in Firestore...');

    // Store tokens in Firestore
    await tokensDoc(uid).set({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
      updatedAt: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('Tokens stored successfully');
    res.json({ ok: true });
  } catch (error) {
    console.error('Exchange public token error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize user account
router.post('/initialize-account', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const admin = require('firebase-admin');
    const { budgetsCol, categoriesCol } = require('../utils/firestore');

    // Check if user already has a budget
    const existingBudgets = await budgetsCol(uid).get();
    if (!existingBudgets.empty) {
      return res.status(400).json({ error: 'Account already initialized' });
    }

    // Create default budget
    const budgetRef = budgetsCol(uid).doc();
    const budget = {
      name: 'My Budget',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await budgetRef.set(budget);

    // Default categories with keywords
    const defaultCategories = [
      {
        name: 'Food & Dining',
        amount: 50000, // $500 in cents
        keywords: ['restaurant', 'food', 'dining', 'lunch', 'dinner', 'cafe', 'coffee', 'starbucks', 'mcdonalds', 'burger', 'pizza', 'sushi', 'taco', 'subway', 'wendys', 'chipotle', 'panera', 'dunkin'],
        color: '#ef4444'
      },
      {
        name: 'Transportation',
        amount: 30000, // $300 in cents
        keywords: ['gas', 'fuel', 'uber', 'lyft', 'taxi', 'bus', 'train', 'subway', 'parking', 'toll', 'car', 'auto', 'oil', 'tire', 'repair', 'maintenance'],
        color: '#3b82f6'
      },
      {
        name: 'Shopping',
        amount: 20000, // $200 in cents
        keywords: ['amazon', 'target', 'walmart', 'store', 'mall', 'retail', 'clothing', 'shoes', 'electronics', 'home', 'furniture', 'department', 'costco', 'sams', 'ikea'],
        color: '#8b5cf6'
      },
      {
        name: 'Entertainment',
        amount: 15000, // $150 in cents
        keywords: ['movie', 'theater', 'cinema', 'netflix', 'hulu', 'spotify', 'concert', 'show', 'game', 'gaming', 'sports', 'event', 'party', 'bar', 'club'],
        color: '#f59e0b'
      },
      {
        name: 'Bills & Utilities',
        amount: 40000, // $400 in cents
        keywords: ['electric', 'gas', 'water', 'internet', 'phone', 'cable', 'utility', 'bill', 'payment', 'rent', 'mortgage', 'insurance', 'verizon', 'comcast', 'att'],
        color: '#10b981'
      },
      {
        name: 'Healthcare',
        amount: 25000, // $250 in cents
        keywords: ['medical', 'doctor', 'hospital', 'pharmacy', 'dentist', 'therapy', 'medicine', 'prescription', 'clinic', 'health', 'cvs', 'walgreens', 'kaiser'],
        color: '#06b6d4'
      },
      {
        name: 'Travel',
        amount: 20000, // $200 in cents
        keywords: ['hotel', 'flight', 'airline', 'vacation', 'trip', 'booking', 'expedia', 'airbnb', 'travel', 'vacation', 'resort', 'cruise', 'rental', 'car rental'],
        color: '#ec4899'
      },
      {
        name: 'Education',
        amount: 10000, // $100 in cents
        keywords: ['school', 'tuition', 'book', 'course', 'class', 'university', 'college', 'student', 'loan', 'textbook', 'online course', 'udemy', 'coursera'],
        color: '#84cc16'
      }
    ];

    // Create categories
    const categoryRefs = [];
    for (const category of defaultCategories) {
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
      budget: {
        id: budgetRef.id,
        ...budget,
        categories: categoryRefs,
        totalBudget: categoryRefs.reduce((sum, cat) => sum + (cat.amount || 0), 0)
      },
      message: 'Account initialized with default budget and categories'
    });
  } catch (error) {
    console.error('Initialize account error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
