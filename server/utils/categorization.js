const admin = require('firebase-admin');
const { categoriesCol } = require('../utils/firestore');

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
  const { txCol } = require('../utils/firestore');
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
  const batch = admin.firestore().batch();
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

module.exports = {
  recategorizeAllTransactions
};
