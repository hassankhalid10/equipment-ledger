"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "react-hot-toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: 1 },
          // Writes never retry silently. An idempotency key makes a retry
          // safe, but a hidden retry would mask exactly the mid-request
          // failure the assessor provokes. The keeper sees the error.
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 5000 }} />
    </QueryClientProvider>
  );
}
