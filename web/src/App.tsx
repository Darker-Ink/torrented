import { Suspense } from "react";
import { useRoutes } from "react-router-dom";
import routes from "~react-pages";
import AuthGate from "@/features/auth/components/AuthGate";
import AppShell from "@/features/layout/components/AppShell";
import Toaster from "@/features/ui/components/Toaster";

const App = () => {
  const element = useRoutes(routes);
  return (
    <AuthGate>
      <AppShell>
        <Suspense fallback={<div className="min-h-dvh" />}>
          {element}
        </Suspense>
      </AppShell>
      <Toaster />
    </AuthGate>
  );
};

export default App;
