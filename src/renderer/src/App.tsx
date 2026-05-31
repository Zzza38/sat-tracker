import { Layout } from "./components/Layout";
import { useApp } from "./context/AppContext";
import { CatalogPage } from "./pages/CatalogPage";
import { DetailsPage } from "./pages/DetailsPage";
import { PassesPage } from "./pages/PassesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrackerPage } from "./pages/TrackerPage";

export default function App() {
  const { page, error } = useApp();

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
        <p className="mb-4 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {content}
    </Layout>
  );
}
