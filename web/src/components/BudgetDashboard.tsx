import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Budget, Category, CategorizedTransaction } from '../types/budget';
import { LinkBank } from './LinkBank';
import { SyncButton } from './SyncButton';

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

export const BudgetDashboard: React.FC = () => {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<CategorizedTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [budgetsData, categoriesData, transactionsData] = await Promise.all([
        apiCall('/budgets'),
        apiCall('/categories'),
        apiCall('/transactions?limit=20')
      ]);
      setBudgets(budgetsData);
      setCategories(categoriesData);
      setTransactions(transactionsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-sm">Loading dashboard...</div>;
  }

  // Calculate spending by category for current month
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const currentMonthTransactions = transactions.filter(tx =>
    tx.date.startsWith(currentMonth) && tx.amount < 0
  );

  const spendingByCategory = currentMonthTransactions.reduce((acc, tx) => {
    const categoryId = tx.category || 'uncategorized';
    acc[categoryId] = (acc[categoryId] || 0) + Math.abs(tx.amount);
    return acc;
  }, {} as Record<string, number>);

  const totalSpent = Object.values(spendingByCategory).reduce((sum, amount) => sum + amount, 0);
  const totalBudget = budgets.reduce((sum, budget) => sum + budget.totalBudget, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Quick Actions */}
      <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
        <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Quick Actions</h3>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <LinkBank />
          <SyncButton />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
          <h3 className="text-base sm:text-lg font-medium text-gray-900">Total Spent</h3>
          <p className="text-2xl sm:text-3xl font-bold text-red-600">${(totalSpent / 100).toFixed(2)}</p>
          <p className="text-xs sm:text-sm text-gray-500">This month</p>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
          <h3 className="text-base sm:text-lg font-medium text-gray-900">Total Budget</h3>
          <p className="text-2xl sm:text-3xl font-bold text-blue-600">${(totalBudget / 100).toFixed(2)}</p>
          <p className="text-xs sm:text-sm text-gray-500">Monthly limit</p>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow sm:col-span-2 lg:col-span-1">
          <h3 className="text-base sm:text-lg font-medium text-gray-900">Remaining</h3>
          <p className={`text-2xl sm:text-3xl font-bold ${(totalBudget - totalSpent) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${((totalBudget - totalSpent) / 100).toFixed(2)}
          </p>
          <p className="text-xs sm:text-sm text-gray-500">This month</p>
        </div>
      </div>

      {/* Budget Progress */}
      <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
        <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Budget Progress</h3>
        <div className="space-y-3 sm:space-y-4">
          {budgets.map((budget) => {
            const budgetSpent = budget.categories.reduce((sum, cat) => {
              return sum + (spendingByCategory[cat.id] || 0);
            }, 0);

            const remaining = budget.totalBudget - budgetSpent;
            const percentUsed = budget.totalBudget > 0 ? (budgetSpent / budget.totalBudget) * 100 : 0;

            return (
              <div key={budget.id} className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-0">
                  <span className="font-medium text-sm sm:text-base">{budget.name}</span>
                  <span className="text-xs sm:text-sm text-gray-500">
                    ${(budgetSpent / 100).toFixed(2)} / ${(budget.totalBudget / 100).toFixed(2)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      percentUsed > 100 ? 'bg-red-500' : percentUsed > 80 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(percentUsed, 100)}%` }}
                  ></div>
                </div>
                <div className="text-xs text-gray-500">
                  {percentUsed.toFixed(1)}% used • ${(remaining / 100).toFixed(2)} remaining
                </div>
              </div>
            );
          })}
          {budgets.length === 0 && (
            <p className="text-gray-500 text-center py-4 text-sm">No budgets set up yet</p>
          )}
        </div>
      </div>

      {/* Category Spending Breakdown */}
      {Object.keys(spendingByCategory).length > 0 && (
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Spending by Category</h3>
          <div className="space-y-3">
            {Object.entries(spendingByCategory)
              .sort(([,a], [,b]) => b - a)
              .map(([categoryId, amount]) => {
                const category = categories.find(c => c.id === categoryId);
                const categoryName = category?.name || 'Uncategorized';
                const budgetLimit = category?.amount || 0;
                const percentOfBudget = budgetLimit > 0 ? (amount / budgetLimit) * 100 : 0;

                return (
                  <div key={categoryId} className="space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
                      <span className="font-medium text-sm sm:text-base">{categoryName}</span>
                      <span className="text-xs sm:text-sm text-gray-500">
                        ${(amount / 100).toFixed(2)}
                        {budgetLimit > 0 && ` / $${(budgetLimit / 100).toFixed(2)}`}
                      </span>
                    </div>
                    {budgetLimit > 0 && (
                      <div className="w-full bg-gray-200 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full ${
                            percentOfBudget > 100 ? 'bg-red-500' : percentOfBudget > 80 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(percentOfBudget, 100)}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
        <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Recent Transactions</h3>

        {currentMonthTransactions.length === 0 ? (
          <p className="text-gray-500 text-center py-4 text-sm">No transactions this month</p>
        ) : (
          <div className="space-y-2">
            {currentMonthTransactions.slice(0, 10).map((transaction) => {
              const amount = Math.abs(transaction.amount) / 100;
              const category = categories.find(c => c.id === transaction.category);
              return (
                <div key={transaction.transaction_id} className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-gray-100 last:border-b-0 gap-2 sm:gap-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm sm:text-base truncate">{transaction.name}</div>
                    <div className="text-xs sm:text-sm text-gray-600">
                      {transaction.merchant_name && `${transaction.merchant_name} • `}
                      {new Date(transaction.date).toLocaleDateString()}
                    </div>
                    {transaction.categoryName && (
                      <div className="text-xs sm:text-sm text-blue-600">📁 {transaction.categoryName}</div>
                    )}
                  </div>
                  <div className="text-right sm:text-left">
                    <div className="font-semibold text-red-600 text-sm sm:text-base">
                      ${amount.toFixed(2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
