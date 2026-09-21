/**
 * Une seule ligne de graphe ouverte par page, quel que soit l'encart : ouvrir ailleurs ferme
 * la précédente. La clé est celle de la ligne, préfixée de l'identifiant de son encart - deux
 * encarts peuvent porter le même contrat.
 */
import { useCallback, useState } from "react";

export interface OpenChart {
  openKey: string | null;
  toggle: (key: string) => void;
  isOpen: (key: string) => boolean;
}

export function useOpenChart(): OpenChart {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = useCallback((key: string) => setOpenKey((current) => (current === key ? null : key)), []);
  const isOpen = useCallback((key: string) => openKey === key, [openKey]);
  return { openKey, toggle, isOpen };
}
