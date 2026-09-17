# @ib/ui

Composants shadcn (style base-nova, primitives base-ui) partagés par les applications.
Le thème et les jetons de couleur vivent dans `apps/web/src/index.css`.

Après un `pnpm dlx shadcn@latest add <composant>` dans ce dossier, réécrire les alias
`@/…` du fichier généré en imports relatifs, l'alias `@` appartient aux applications :

```bash
sed -i 's#from "@/lib/utils"#from "../../lib/utils"#; s#from "@/hooks/use-mobile"#from "../../hooks/use-mobile"#; s#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' src/components/ui/<composant>.tsx
```

Import côté application : `import { Button } from "@ib/ui/button";`.
