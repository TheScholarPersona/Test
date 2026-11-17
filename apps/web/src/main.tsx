import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { LiveEventsProvider } from './live/events';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveEventsProvider>
        <BrowserRouter basename="/ui">
          <App />
        </BrowserRouter>
      </LiveEventsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
