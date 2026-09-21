import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "react-router";
import { SessionProvider } from "@/api/session";
import { BackupSync } from "@/db/backup/BackupSync";
import { DbProvider } from "@/db/DbProvider";
import i18n from "@/i18n";
import { router } from "@/routes/router";

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      {/* SessionProvider only informs on the server's reachability and the user's login
          state; it never blocks a route — the server is optional (spec §2). DbProvider does
          not read it: the database belongs to the browser (sub-project 25). */}
      <SessionProvider>
        <DbProvider>
          <BackupSync />
          <RouterProvider router={router} />
        </DbProvider>
      </SessionProvider>
    </I18nextProvider>
  );
}
