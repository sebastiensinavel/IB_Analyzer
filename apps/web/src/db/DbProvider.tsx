import { createContext, useContext, type ReactNode } from "react";
import { db, type AppDatabase } from "./schema";

const DbContext = createContext<AppDatabase>(db);

/**
 * Every hook and every writer reads its database here, never by import.
 *
 * The database belongs to the browser, never to a Django account: the server is optional
 * (spec §2), so nothing it says — or fails to say — may change what the app shows. Until
 * sub-project 25 this provider picked a per-user profile from the session, which meant an
 * expired cookie, a restarted server or merely a slow answer emptied the account list and
 * bounced the user to /accounts. The account now opens two doors only, the Flex proxy and
 * the encrypted backup, and touches no data.
 */
export function useDb(): AppDatabase {
  return useContext(DbContext);
}

export function DbProvider({ children }: { children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}
