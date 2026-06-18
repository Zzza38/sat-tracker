import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { useApp } from "./context/AppContext";

const CatalogPage = lazy(() => import("./pages/CatalogPage").then((module) => ({ default: module.CatalogPage })));
const DetailsPage = lazy(() => import("./pages/DetailsPage").then((module) => ({ default: module.DetailsPage })));
const PassesPage = lazy(() => import("./pages/PassesPage").then((module) => ({ default: module.PassesPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const TrackerPage = lazy(() => import("./pages/TrackerPage").then((module) => ({ default: module.TrackerPage })));

export default function App() {
  const { page, error, clearError, bootstrapping } = useApp();

  const content = {
    catalog: <CatalogPage />,
    tracker: <TrackerPage />,
    passes: <PassesPage />,
    details: <DetailsPage />,
    settings: <SettingsPage />
  }[page];

  return (
    <Layout>
      {error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--danger)]">
          <p>{error}</p>
          <button type="button" className="ghost shrink-0" onClick={clearError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : null}
      {bootstrapping ? (
        <div className="panel p-8" role="status">
          <p className="label">Catalog</p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--text)]">Loading orbital data</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Fetching configured TLE sources and preparing the catalog.</p>
        </div>
      ) : (
        <Suspense fallback={<div className="panel p-8 text-sm text-[var(--muted)]" role="status">Loading page...</div>}>
          {content}
        </Suspense>
      )}
      <Analytics />
    </Layout>
  );
}
