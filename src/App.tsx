import { useState } from 'react';
import { AppProvider } from './store';
import { AppShell } from './components/AppShell';
import type { Route } from './components/AppShell';
import {
  LedgerPage,
  HoldingsPage,
  AssessmentPage,
  ScenariosPage,
  ReviewPage,
  RulingsPage,
} from './components/Views';

function Routes() {
  const [route, setRoute] = useState<Route>('ledger');

  return (
    <AppShell route={route} onRoute={setRoute}>
      <div key={route} className="animate-fade">
        {route === 'ledger' && <LedgerPage />}
        {route === 'wealth' && <HoldingsPage />}
        {route === 'assessment' && <AssessmentPage onRoute={setRoute} />}
        {route === 'scenarios' && <ScenariosPage onRoute={setRoute} />}
        {route === 'review' && <ReviewPage onRoute={setRoute} />}
        {route === 'rulings' && <RulingsPage />}
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes />
    </AppProvider>
  );
}
