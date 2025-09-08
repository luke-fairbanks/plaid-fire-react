import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';

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

interface Account {
  id: string;
  account_id: string;
  name: string;
  official_name?: string;
  mask?: string;
  subtype?: string;
  type: string;
  institution_id: string;
  institution_name: string;
  institution_logo?: string;
}

interface Institution {
  institution_id: string;
  institution_name: string;
  institution_logo?: string;
  accounts: Account[];
}

export const AccountManager: React.FC = () => {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTransactions, setDeleteTransactions] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await apiCall('/accounts');
      setInstitutions(data.institutions);
      setAccounts(data.accounts);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingAccount) return;

    try {
      await apiCall(`/accounts/${deletingAccount.account_id}`, {
        method: 'DELETE',
        body: JSON.stringify({ deleteTransactions })
      });

      // Refresh accounts
      await loadAccounts();
      setShowDeleteConfirm(false);
      setDeletingAccount(null);
      setDeleteTransactions(false);
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert('Failed to delete account');
    }
  };

  const getAccountTypeDisplay = (type: string, subtype?: string) => {
    if (subtype) {
      return `${type.charAt(0).toUpperCase() + type.slice(1)} • ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`;
    }
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  if (loading) {
    return <div className="p-4 text-center text-sm">Loading accounts...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-semibold">Account Manager</h2>
        <p className="text-sm text-gray-600">
          Manage your linked bank accounts and institutions
        </p>
      </div>

      {institutions.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Accounts Linked</h3>
          <p className="text-gray-600 mb-4">
            Connect your bank accounts to start tracking transactions and managing your budget.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {institutions.map((institution) => (
            <div key={institution.institution_id} className="border rounded-lg p-4 sm:p-6">
              <div className="flex items-center gap-3 mb-4">
                {institution.institution_logo ? (
                  <img
                    src={`data:image/png;base64,${institution.institution_logo}`}
                    alt={institution.institution_name}
                    className="w-8 h-8 rounded"
                  />
                ) : (
                  <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold">{institution.institution_name}</h3>
                  <p className="text-sm text-gray-600">
                    {institution.accounts.length} account{institution.accounts.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {institution.accounts.map((account) => (
                  <div key={account.account_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm sm:text-base truncate">
                            {account.name}
                          </p>
                          <p className="text-xs sm:text-sm text-gray-600">
                            {getAccountTypeDisplay(account.type, account.subtype)}
                            {account.mask && ` ••••${account.mask}`}
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setDeletingAccount(account);
                        setShowDeleteConfirm(true);
                      }}
                      className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors ml-3"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deletingAccount && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md">
            <h3 className="text-lg sm:text-xl font-semibold mb-4">Delete Account</h3>
            <p className="text-gray-600 mb-4 text-sm sm:text-base">
              Are you sure you want to delete "{deletingAccount.name}"?
            </p>

            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={deleteTransactions}
                  onChange={(e) => setDeleteTransactions(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm">Also delete all transactions from this account</span>
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDeleteAccount}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium order-2 sm:order-1"
              >
                Delete Account
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletingAccount(null);
                  setDeleteTransactions(false);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium order-1 sm:order-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
