import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { getAuth } from "firebase/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005';

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

export function usePlaid() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLink = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("Creating link token...");
      const response = await apiCall('/create-link-token');
      console.log("Received link token", response.link_token);
      setLinkToken(response.link_token);
    } catch (err: any) {
      console.error("Failed to create link token:", err);
      setError(err.message || "Failed to create link token");
    } finally {
      setLoading(false);
    }
  };

  const config: Parameters<typeof usePlaidLink>[0] = {
    token: linkToken || "",
    onSuccess: async (public_token) => {
      try {
        await apiCall('/exchange-public-token', { public_token });
        // After exchanging token, get and store account information
        await apiCall('/get-accounts');
        setLinkToken(null);
        console.log("Bank linked successfully!");
      } catch (error) {
        console.error("Failed to exchange public token:", error);
        // You might want to show an error message to the user here
      }
    },
    onExit: () => {
      console.log("Plaid Link exited");
    },
    onLoad: () => {
      console.log("Plaid Link loaded");
    },
  };

  const { open, ready, error: plaidError } = usePlaidLink(config);

  useEffect(() => {
    console.log("Plaid Link state:", { ready, linkToken, plaidError });
    if (ready && linkToken) {
      console.log("Opening Plaid Link...");
      open();
    }
  }, [ready, linkToken, open, plaidError]);

  // Also expose the open function for manual triggering
  return { createLink, loading, hasToken: !!linkToken, error: error || plaidError, open };
}
