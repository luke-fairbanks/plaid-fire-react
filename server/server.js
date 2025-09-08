

const express = require('express');
const cors = require('cors');
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./firebase-key.json'); // You'll need to download this from Firebase Console
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://plaid-fire-react-default-rtdb.firebaseio.com" // Update with your Firebase project URL
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Plaid configuration
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';
const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Helper functions
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

// Comprehensive transaction re-categorization function
async function recategorizeAllTransactions(uid) {
  console.log('Starting re-categorization for user:', uid);

  // Get all categories
  const categoriesSnap = await categoriesCol(uid).get();
  const categories = categoriesSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  // Get all transactions
  const transactionsSnap = await txCol(uid).get();
  const transactions = transactionsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  console.log(`Found ${categories.length} categories and ${transactions.length} transactions`);

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

  // Batch for updates
  const batch = db.batch();
  let updatedCount = 0;

  // Process each transaction
  for (const transaction of transactions) {
    let assignedCategory = null;
    let categoryName = null;

    // First, try keyword matching
    assignedCategory = findCategoryByKeywords(transaction.name, transaction.merchant_name);

    // If no keyword match, try Plaid category mapping
    if (!assignedCategory && transaction.pf_category) {
      assignedCategory = findCategoryByPlaidCategory(transaction.pf_category);
    }

    // Check if category assignment changed
    const currentCategoryId = transaction.category || null;
    const newCategoryId = assignedCategory?.id || null;

    if (currentCategoryId !== newCategoryId) {
      const ref = txCol(uid).doc(transaction.id);
      batch.update(ref, {
        category: newCategoryId,
        categoryName: assignedCategory?.name || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    await batch.commit();
    console.log(`Updated ${updatedCount} transactions with new categories`);
  } else {
    console.log('No transactions needed re-categorization');
  }

  return { updated: updatedCount, total: transactions.length };
}

// Middleware to verify Firebase token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No authorization header or invalid format');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    console.log('Token verified for user:', decodedToken.uid);
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.post('/create-link-token', verifyToken, async (req, res) => {
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

app.post('/exchange-public-token', verifyToken, async (req, res) => {
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('Tokens stored successfully');
    res.json({ ok: true });
  } catch (error) {
    console.error('Exchange public token error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/sync-transactions', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Get stored tokens
    const tokenDoc = await tokensDoc(uid).get();
    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Bank not linked' });
    }

    const { access_token, cursor: savedCursor } = tokenDoc.data();

    // Initialize Firestore batch
    const batch = db.batch();

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

app.post('/get-accounts', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const tokenDoc = await tokensDoc(uid).get();
    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Bank not linked' });
    }

    const { access_token } = tokenDoc.data();

    const response = await plaidClient.accountsGet({ access_token });


    // Get institution info from the item
    const institution = {
      institution_id: response.data.item.institution_id,
      name: response.data.item.institution_name
    };

    const request = {
        institution_id: institution.institution_id,
        country_codes: ['US'],
    };

    const institutionResponse = await plaidClient.institutionsGetById(request);

    console.log('Institution response:', institutionResponse.data);

    institution.institution_logo = institutionResponse.data.logo;

    console.log('Institution info:', institution);

    // Get existing accounts to check for duplicates
    const existingAccountsSnap = await accountsCol(uid).get();
    const existingAccountIds = new Set(existingAccountsSnap.docs.map(doc => doc.data().account_id));

    // Store accounts in Firestore (only new ones or updates)
    const batch = db.batch();
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
        institution_logo: institution.institution_logo || '',
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
    console.error('Get accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all linked accounts
app.get('/accounts', verifyToken, async (req, res) => {
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

// Delete account
app.delete('/accounts/:accountId', verifyToken, async (req, res) => {
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
      const batch = db.batch();
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

// ---- Budget Management Endpoints ----

// Initialize user account with default budget and categories
app.post('/initialize-account', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

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

// Get all budgets
app.get('/budgets', verifyToken, async (req, res) => {
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
app.post('/budgets', verifyToken, async (req, res) => {
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
app.put('/budgets/:budgetId', verifyToken, async (req, res) => {
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
app.delete('/budgets/:budgetId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { budgetId } = req.params;

    // Delete budget
    await budgetsCol(uid).doc(budgetId).delete();

    // Delete associated categories
    const categoriesSnap = await categoriesCol(uid).where('budgetId', '==', budgetId).get();
    const batch = db.batch();
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

// ---- Category Management Endpoints ----

// Get all categories
app.get('/categories', verifyToken, async (req, res) => {
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
app.post('/categories', verifyToken, async (req, res) => {
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
app.put('/categories/:categoryId', verifyToken, async (req, res) => {
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
app.delete('/categories/:categoryId', verifyToken, async (req, res) => {
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

// ---- Transaction Categorization ----

// Manually trigger re-categorization of all transactions
app.post('/recategorize', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const result = await recategorizeAllTransactions(uid);

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

// Get transactions with categories
app.get('/transactions', verifyToken, async (req, res) => {
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
app.post('/transactions/:transactionId/categorize', verifyToken, async (req, res) => {
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

// Search transactions for keyword assignment
app.get('/transactions/search', verifyToken, async (req, res) => {
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

// Edit transaction
app.put('/transactions/:transactionId', verifyToken, async (req, res) => {
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
app.delete('/transactions/:transactionId', verifyToken, async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${PLAID_ENV}`);
});
