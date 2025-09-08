import React from "react";
import { usePlaid } from "../hooks/usePlaidLink";

export const LinkBank: React.FC = () => {
  const { createLink, loading, error, hasToken, open } = usePlaid();

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
      <button
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium w-full sm:w-auto"
        onClick={createLink}
        disabled={loading}
      >
        {loading ? "Starting…" : "Connect Bank"}
      </button>
      {hasToken && (
        <button
          className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors text-sm font-medium w-full sm:w-auto sm:ml-2"
          onClick={() => open()}
        >
          Open Link
        </button>
      )}
      {error && <p className="text-red-500 text-xs sm:text-sm mt-2">{String(error)}</p>}
      {hasToken && <p className="text-green-500 text-xs sm:text-sm mt-2">Link token ready!</p>}
    </div>
  );
};
