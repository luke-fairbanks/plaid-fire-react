import React from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, signIn, signOutUser } from "./firebase";
import { LinkBank } from "./components/LinkBank";
import { SyncButton } from "./components/SyncButton";
import { BudgetManager } from "./components/BudgetManager";
import { CategoryManager } from "./components/CategoryManager";
import { BudgetDashboard } from "./components/BudgetDashboard";
import { AccountManager } from "./components/AccountManager";

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'budgets' | 'categories' | 'accounts'>('overview');

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Initialize user account with default budget and categories
        try {
          const token = await user.getIdToken();
          const response = await fetch('http://localhost:3001/initialize-account', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            console.log('Account initialized:', data.message);
          } else if (response.status === 400) {
            // Account already initialized, that's fine
            console.log('Account already initialized');
          } else {
            console.error('Failed to initialize account');
          }
        } catch (error) {
          console.error('Error initializing account:', error);
        }
      }
    });

    return unsubscribe;
  }, []);

  const tabs = [
    { id: 'overview', label: 'Dashboard', component: BudgetDashboard },
    { id: 'budgets', label: 'Budget', component: BudgetManager },
    { id: 'categories', label: 'Categories', component: CategoryManager },
    { id: 'accounts', label: 'Accounts', component: AccountManager },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-4 sm:space-y-6">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-semibold">Plaid Budget App</h1>
          {user ? (
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-sm text-gray-600 truncate">{user.displayName}</span>
              <button className="px-3 py-1 rounded bg-gray-200 text-sm hover:bg-gray-300 transition-colors" onClick={signOutUser}>Sign out</button>
            </div>
          ) : (
            <button className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors w-full sm:w-auto" onClick={signIn}>Sign in</button>
          )}
        </header>

        {user ? (
          <div className="space-y-4 sm:space-y-6">
            {/* Navigation Tabs */}
            <div className="border-b">
              <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Active Tab Content */}
            <div>
              {activeTab === 'overview' && <BudgetDashboard />}
              {activeTab === 'budgets' && <BudgetManager />}
              {activeTab === 'categories' && <CategoryManager />}
              {activeTab === 'accounts' && <AccountManager />}
            </div>
          </div>
        ) : (
          <p className="text-gray-600 text-center py-8">Sign in to manage your budget.</p>
        )}
      </div>
    </div>
  );
}
