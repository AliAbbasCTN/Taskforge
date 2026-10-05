import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ApiError } from './services/http';
import App from './App';
import './index.css';

/**
 * Retrying makes sense for hiccups (a dropped connection, a 500) but never
 * for a definite answer: a 404, 403 or 409 will give the same answer again,
 * so retrying would only delay showing the error.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        failureCount < 2 &&
        !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * The PROVIDER ORDER matters: AuthProvider uses the query client (to clear
 * cached data on logout), and routing is needed by everything inside App.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
