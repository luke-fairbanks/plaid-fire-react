import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Category, CategorizedTransaction } from '../types/budget';

const API_BASE = 'http://localhost:3001';

async function apiCall(endpoint: string, options?: RequestInit) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API call failed');
  }

  return response.json();
}

export const CategoryManager: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<CategorizedTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [recategorizing, setRecategorizing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<CategorizedTransaction | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<CategorizedTransaction | null>(null);

  const recategorizeAll = async () => {
    setRecategorizing(true);
    try {
      const result = await apiCall('/recategorize', { method: 'POST' });
      alert(`Re-categorized ${result.updated} out of ${result.total} transactions`);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Failed to re-categorize:', error);
      alert('Failed to re-categorize transactions');
    } finally {
      setRecategorizing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [categoriesData, transactionsData] = await Promise.all([
        apiCall('/categories'),
        apiCall('/transactions')
      ]);
      setCategories(categoriesData);
      setTransactions(transactionsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const assignCategory = async (transactionId: string, categoryId: string, applyToSimilar: boolean = false) => {
    try {
      await apiCall(`/transactions/${transactionId}/categorize`, {
        method: 'POST',
        body: JSON.stringify({ categoryId, applyToSimilar })
      });
      await loadData(); // Refresh data
      setSelectedTransaction(null);
    } catch (error) {
      console.error('Failed to assign category:', error);
    }
  };

  const editTransaction = (transaction: CategorizedTransaction) => {
    setEditingTransaction(transaction);
  };

  const deleteTransaction = async (transactionId: string) => {
    if (!confirm('Are you sure you want to delete this transaction? This action cannot be undone.')) {
      return;
    }

    try {
      await apiCall(`/transactions/${transactionId}`, {
        method: 'DELETE'
      });
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      alert('Failed to delete transaction');
    }
  };

  const filteredTransactions = transactions.filter(tx =>
    tx.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (tx.merchant_name && tx.merchant_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return <div className="p-4">Loading categories and transactions...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-semibold">Category Manager</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={recategorizeAll}
            disabled={recategorizing}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            {recategorizing ? 'Re-categorizing...' : 'Re-categorize All'}
          </button>
          <CreateCategoryForm onCreated={loadData} />
        </div>
      </div>

      {/* Categories Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <CategoryCard key={category.id} category={category} onUpdate={loadData} />
        ))}
      </div>

      {/* Transaction Categorization */}
      <div className="border rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">Assign Categories to Transactions</h3>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredTransactions.slice(0, 20).map((transaction) => (
            <TransactionRow
              key={transaction.transaction_id}
              transaction={transaction}
              categories={categories}
              onAssignCategory={assignCategory}
              onSelect={setSelectedTransaction}
              onEdit={editTransaction}
              onDelete={deleteTransaction}
              isSelected={selectedTransaction?.transaction_id === transaction.transaction_id}
            />
          ))}
        </div>
      </div>

      {/* Edit Transaction Modal */}
      {editingTransaction && (
        <EditTransactionForm
          transaction={editingTransaction}
          categories={categories}
          onClose={() => setEditingTransaction(null)}
          onUpdated={() => {
            loadData();
            setEditingTransaction(null);
          }}
        />
      )}
    </div>
  );
};

interface CategoryCardProps {
  category: Category;
  onUpdate: () => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, onUpdate }) => {
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    try {
      const result = await apiCall(`/categories/${category.id}`, { method: 'DELETE' });
      if (result.recategorized > 0) {
        alert(`Category deleted. ${result.recategorized} transactions were re-categorized.`);
      }
      onUpdate();
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to delete category:', error);
      alert('Failed to delete category');
    }
  };

  return (
    <>
      <div className="border rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-0 mb-2">
          <h4 className="font-semibold text-sm sm:text-base">{category.name}</h4>
          <div className="flex gap-2 self-end sm:self-start">
            <button
              onClick={() => setShowEditForm(true)}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-gray-600">${(category.amount / 100).toFixed(2)} budgeted</p>
        {category.keywords.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500">Keywords:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {category.keywords.map((keyword, index) => (
                <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Form Modal */}
      {showEditForm && (
        <EditCategoryForm
          category={category}
          onClose={() => setShowEditForm(false)}
          onUpdated={() => {
            onUpdate();
            setShowEditForm(false);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md">
            <h3 className="text-lg sm:text-xl font-semibold mb-4">Delete Category</h3>
            <p className="text-gray-600 mb-4 text-sm sm:text-base">
              Are you sure you want to delete "{category.name}"? This will remove the category from all transactions that use it.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium order-2 sm:order-1"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium order-1 sm:order-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface TransactionRowProps {
  transaction: CategorizedTransaction;
  categories: Category[];
  onAssignCategory: (transactionId: string, categoryId: string, applyToSimilar?: boolean) => void;
  onSelect: (transaction: CategorizedTransaction | null) => void;
  onEdit: (transaction: CategorizedTransaction) => void;
  onDelete: (transactionId: string) => void;
  isSelected: boolean;
}

const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  categories,
  onAssignCategory,
  onSelect,
  onEdit,
  onDelete,
  isSelected
}) => {
  const amount = transaction.amount / 100;

  return (
    <div className={`border rounded p-3 ${isSelected ? 'bg-blue-50' : ''}`}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm sm:text-base truncate">{transaction.name}</div>
          <div className="text-xs sm:text-sm text-gray-600">
            {transaction.merchant_name && `${transaction.merchant_name} • `}
            {transaction.date}
          </div>
          {transaction.categoryName && (
            <div className="text-xs sm:text-sm text-green-600">Category: {transaction.categoryName}</div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-1">
          <div className={`font-semibold text-sm sm:text-base ${amount < 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${Math.abs(amount).toFixed(2)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onSelect(transaction)}
              className="text-xs sm:text-sm text-blue-600 hover:text-blue-800 transition-colors"
            >
              {transaction.category ? 'Change Category' : 'Assign Category'}
            </button>
            <button
              onClick={() => onEdit(transaction)}
              className="text-xs sm:text-sm text-orange-600 hover:text-orange-800 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(transaction.transaction_id)}
              className="text-xs sm:text-sm text-red-600 hover:text-red-800 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {isSelected && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => onAssignCategory(transaction.transaction_id, category.id)}
                className="px-3 py-1 bg-blue-600 text-white text-xs sm:text-sm rounded hover:bg-blue-700 transition-colors"
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => onAssignCategory(transaction.transaction_id, '', true)}
              className="px-3 py-1 bg-green-600 text-white text-xs sm:text-sm rounded hover:bg-green-700 transition-colors"
            >
              Apply to Similar Transactions
            </button>
            <button
              onClick={() => onSelect(null)}
              className="px-3 py-1 bg-gray-600 text-white text-xs sm:text-sm rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface CreateCategoryFormProps {
  onCreated: () => void;
}

const CreateCategoryForm: React.FC<CreateCategoryFormProps> = ({ onCreated }) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [loading, setLoading] = useState(false);

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingValue('');
    }
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditingValue(keywords[index]);
  };

  const saveEdit = () => {
    if (editingIndex !== null && editingValue.trim() && !keywords.includes(editingValue.trim())) {
      const newKeywords = [...keywords];
      newKeywords[editingIndex] = editingValue.trim();
      setKeywords(newKeywords);
    }
    setEditingIndex(null);
    setEditingValue('');
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingIndex !== null) {
        saveEdit();
      } else {
        addKeyword();
      }
    } else if (e.key === 'Escape' && editingIndex !== null) {
      cancelEdit();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const result = await apiCall('/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          amount: parseFloat(amount) * 100 || 0,
          keywords: keywords
        })
      });
      if (result.recategorized > 0) {
        alert(`Category created. ${result.recategorized} transactions were categorized.`);
      }
      onCreated();
      setShowForm(false);
      setName('');
      setAmount('');
      setKeywords([]);
      setNewKeyword('');
      setEditingIndex(null);
      setEditingValue('');
    } catch (error) {
      console.error('Failed to create category:', error);
      alert('Failed to create category');
    } finally {
      setLoading(false);
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm font-medium"
      >
        Create Category
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg sm:text-xl font-semibold mb-4">Create Category</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="e.g., Food & Dining"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Budget Amount ($)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Keywords</label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 p-2 border rounded text-sm"
                  placeholder="Add a keyword..."
                />
                <button
                  type="button"
                  onClick={addKeyword}
                  className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm font-medium"
                  disabled={!newKeyword.trim()}
                >
                  Add
                </button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                    >
                      {editingIndex === index ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyPress={handleKeyPress}
                          onBlur={saveEdit}
                          className="bg-white border-none outline-none text-xs w-20"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => startEditing(index)}
                          className="cursor-pointer"
                        >
                          {keyword}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeKeyword(index)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium order-1 sm:order-none"
            >
              {loading ? 'Creating...' : 'Create Category'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface EditCategoryFormProps {
  category: Category;
  onClose: () => void;
  onUpdated: () => void;
}

const EditCategoryForm: React.FC<EditCategoryFormProps> = ({ category, onClose, onUpdated }) => {
  const [name, setName] = useState(category.name);
  const [amount, setAmount] = useState((category.amount / 100).toString());
  const [keywords, setKeywords] = useState<string[]>(category.keywords);
  const [newKeyword, setNewKeyword] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [loading, setLoading] = useState(false);

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingValue('');
    }
  };

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditingValue(keywords[index]);
  };

  const saveEdit = () => {
    if (editingIndex !== null && editingValue.trim() && !keywords.includes(editingValue.trim())) {
      const newKeywords = [...keywords];
      newKeywords[editingIndex] = editingValue.trim();
      setKeywords(newKeywords);
    }
    setEditingIndex(null);
    setEditingValue('');
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingIndex !== null) {
        saveEdit();
      } else {
        addKeyword();
      }
    } else if (e.key === 'Escape' && editingIndex !== null) {
      cancelEdit();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const result = await apiCall(`/categories/${category.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          amount: parseFloat(amount) * 100 || 0,
          keywords: keywords
        })
      });
      if (result.recategorized > 0) {
        alert(`Category updated. ${result.recategorized} transactions were re-categorized.`);
      }
      onUpdated();
    } catch (error) {
      console.error('Failed to update category:', error);
      alert('Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg sm:text-xl font-semibold mb-4">Edit Category</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Category Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="e.g., Food & Dining"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Budget Amount ($)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Keywords</label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 p-2 border rounded text-sm"
                  placeholder="Add a keyword..."
                />
                <button
                  type="button"
                  onClick={addKeyword}
                  className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm font-medium"
                  disabled={!newKeyword.trim()}
                >
                  Add
                </button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                    >
                      {editingIndex === index ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyPress={handleKeyPress}
                          onBlur={saveEdit}
                          className="bg-white border-none outline-none text-xs w-20"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => startEditing(index)}
                          className="cursor-pointer"
                        >
                          {keyword}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeKeyword(index)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium order-1 sm:order-none"
            >
              {loading ? 'Updating...' : 'Update Category'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface EditTransactionFormProps {
  transaction: CategorizedTransaction;
  categories: Category[];
  onClose: () => void;
  onUpdated: () => void;
}

const EditTransactionForm: React.FC<EditTransactionFormProps> = ({ transaction, categories, onClose, onUpdated }) => {
  const [name, setName] = useState(transaction.name);
  const [merchantName, setMerchantName] = useState(transaction.merchant_name || '');
  const [amount, setAmount] = useState((Math.abs(transaction.amount) / 100).toFixed(2));
  const [date, setDate] = useState(transaction.date);
  const [category, setCategory] = useState(transaction.category || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const result = await apiCall(`/transactions/${transaction.transaction_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          merchant_name: merchantName.trim() || undefined,
          amount: Math.round(parseFloat(amount) * 100) * (transaction.amount < 0 ? -1 : 1), // Convert dollars to cents, preserve sign
          date: date,
          category: category || undefined
        })
      });
      onUpdated();
    } catch (error) {
      console.error('Failed to update transaction:', error);
      alert('Failed to update transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg sm:text-xl font-semibold mb-4">Edit Transaction</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Transaction Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="e.g., Coffee at Starbucks"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Merchant Name (optional)</label>
            <input
              type="text"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="e.g., Starbucks"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Amount ($)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              placeholder="0.00"
              step="0.01"
              min="0"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full p-2 border rounded text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category (optional)</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-2 border rounded text-sm"
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium order-1 sm:order-none"
            >
              {loading ? 'Updating...' : 'Update Transaction'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
