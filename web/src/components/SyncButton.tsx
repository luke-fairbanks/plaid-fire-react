import React, { useState } from "react";
import { getAuth } from "firebase/auth";

const API_BASE = 'http://localhost:3001';

async function apiCall(endpoint: string, data?: any) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API call failed');
  }

  return response.json();
}

export const SyncButton: React.FC = () => {
  const [status, setStatus] = useState<string>("");

  const sync = async () => {
    setStatus("Syncing…");
    try {
      await apiCall('/get-accounts');
      const res: any = await apiCall('/sync-transactions');
      console.log("Sync result:", res);
      let statusMessage = `Done. Added ${res.added}, Modified ${res.modified}, Removed ${res.removed}.`;
      if (res.recategorized > 0) {
        statusMessage += ` Re-categorized ${res.recategorized} transactions.`;
      }
      setStatus(statusMessage);
    } catch (e: any) {
      console.error("Sync failed:", e);
      setStatus(`Error: ${e.message || String(e)}`);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
      <button className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm font-medium w-full sm:w-auto" onClick={sync}>
        Sync Transactions
      </button>
      <span className="text-xs sm:text-sm text-neutral-600 break-words">{status}</span>
    </div>
  );
};
