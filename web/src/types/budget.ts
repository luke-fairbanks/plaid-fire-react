// Budget and Category Types
export interface Category {
  id: string;
  name: string;
  amount: number; // budgeted amount in cents
  keywords: string[];
  budgetId?: string; // reference to budget
  color?: string; // for UI display
  createdAt?: any; // Firestore timestamp
  updatedAt?: any; // Firestore timestamp
}

export interface Budget {
  id: string;
  name: string;
  categories: Category[]; // populated from API
  totalBudget: number; // calculated from categories in cents
  createdAt?: any; // Firestore timestamp
  updatedAt?: any; // Firestore timestamp
}

// Transaction with category assignment
export interface CategorizedTransaction {
  id?: string; // Firestore document ID
  transaction_id: string; // Plaid transaction ID
  account_id: string;
  date: string;
  name: string;
  merchant_name?: string;
  city?: string;
  amount: number; // in cents
  outflow?: number;
  inflow?: number;
  currency: string;
  pending: boolean;
  pf_category?: string; // Plaid's personal finance category
  category?: string; // Our assigned category ID
  categoryName?: string; // Our assigned category name
  keywords?: string[]; // keywords that matched
  updatedAt?: any; // Firestore timestamp
}

// For searching and assigning keywords
export interface TransactionSearchResult {
  transaction: CategorizedTransaction;
  suggestedKeywords: string[];
  suggestedCategory?: string;
}
