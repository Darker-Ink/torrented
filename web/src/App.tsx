import { Suspense } from "react";
import { useRoutes } from "react-router-dom";
import routes from "~react-pages";
import AuthGate from "@/features/auth/components/AuthGate";
import AppShell from "@/features/layout/components/AppShell";
import Spinner from "@/features/ui/components/Spinner";
import Toaster from "@/features/ui/components/Toaster";

const App = () => {
  const element = useRoutes(routes);
  return (
    <AuthGate>
      <AppShell>
        <Suspense
          fallback={
            <div className="grid min-h-[60vh] place-items-center">
              <Spinner />
            </div>
          }
        >
          {element}
        </Suspense>
      </AppShell>
      <Toaster />
    </AuthGate>
  );
};

export default App;
