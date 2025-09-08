import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Budget, Category } from '../types/budget';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005';

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

export const BudgetManager: React.FC = () => {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBudgetData();
  }, []);

  const loadBudgetData = async () => {
    try {
      const [budgetsData, transactionsData] = await Promise.all([
        apiCall('/budgets'),
        apiCall('/transactions?limit=100')
      ]);
      setBudgets(budgetsData);
      setTransactions(transactionsData);
    } catch (error) {
      console.error('Failed to load budget data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-sm">Loading budget...</div>;
  }

  if (budgets.length === 0) {
    return (
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="text-center py-8 sm:py-12">
          <h2 className="text-xl sm:text-2xl font-semibold mb-3 sm:mb-4">No Budget Found</h2>
          <p className="text-gray-600 mb-4 sm:mb-6 text-sm sm:text-base">
            It looks like your account hasn't been initialized yet. This should happen automatically when you sign in.
          </p>
          <button
            onClick={loadBudgetData}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const budget = budgets[0]; // Since we only allow one budget

  // Calculate spending by category for current month
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const currentMonthTransactions = transactions.filter((tx: any) =>
    tx.date.startsWith(currentMonth) && tx.amount < 0
  );

  const spendingByCategory: { [key: string]: number } = {};
  currentMonthTransactions.forEach((tx: any) => {
    const categoryId = tx.category || 'uncategorized';
    spendingByCategory[categoryId] = (spendingByCategory[categoryId] || 0) + Math.abs(tx.amount);
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
        <h2 className="text-xl sm:text-2xl font-semibold">{budget.name}</h2>
        <div className="text-xs sm:text-sm text-gray-500">
          Total Budget: ${(budget.totalBudget / 100).toFixed(2)}
        </div>
      </div>

      {/* Category Spending Breakdown */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base sm:text-lg font-medium">Spending by Category (This Month)</h3>

        {budget.categories.length === 0 ? (
          <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No categories found in your budget.</p>
        ) : (
          <div className="grid gap-3 sm:gap-4">
            {budget.categories.map((category) => {
              const spent = spendingByCategory[category.id] || 0;
              const budgetAmount = category.amount;
              const percentUsed = budgetAmount > 0 ? (spent / budgetAmount) * 100 : 0;
              const remaining = budgetAmount - spent;

              return (
                <div key={category.id} className="bg-white p-3 sm:p-4 rounded-lg shadow border">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-1 sm:gap-0">
                    <h4 className="font-medium text-sm sm:text-base">{category.name}</h4>
                    <div className="text-xs sm:text-sm text-gray-500">
                      ${(spent / 100).toFixed(2)} / ${(budgetAmount / 100).toFixed(2)}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2 sm:h-3 mb-2">
                    <div
                      className={`h-2 sm:h-3 rounded-full ${
                        percentUsed > 100 ? 'bg-red-500' : percentUsed > 80 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(percentUsed, 100)}%` }}
                    ></div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:justify-between text-xs sm:text-sm gap-1 sm:gap-0">
                    <span className={remaining >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {remaining >= 0 ? 'Remaining' : 'Over budget'}: ${(Math.abs(remaining) / 100).toFixed(2)}
                    </span>
                    <span className="text-gray-500">
                      {percentUsed.toFixed(1)}% used
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
        <h3 className="font-medium mb-3 text-sm sm:text-base">Monthly Summary</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold text-blue-600">
              ${(budget.totalBudget / 100).toFixed(0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-500">Budget</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold text-red-600">
              ${(Object.values(spendingByCategory).reduce((sum, amount) => sum + amount, 0) / 100).toFixed(0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-500">Spent</div>
          </div>
          <div className="text-center">
            <div className={`text-xl sm:text-2xl font-bold ${
              (budget.totalBudget - Object.values(spendingByCategory).reduce((sum, amount) => sum + amount, 0)) >= 0
                ? 'text-green-600' : 'text-red-600'
            }`}>
              ${((budget.totalBudget - Object.values(spendingByCategory).reduce((sum, amount) => sum + amount, 0)) / 100).toFixed(0)}
            </div>
            <div className="text-xs sm:text-sm text-gray-500">Remaining</div>
          </div>
          <div className="text-center">
            <div className="text-xl sm:text-2xl font-bold text-gray-600">
              {currentMonthTransactions.length}
            </div>
            <div className="text-xs sm:text-sm text-gray-500">Transactions</div>
          </div>
        </div>
      </div>
    </div>
  );
};
