import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { HelpPage } from "@/pages/HelpPage";
import { setLastAccountId } from "@/lib/accountStorage";

function mockIndex(body: Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => body);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * jsdom implements no `scrollIntoView` at all, so it cannot be spied on: it is installed for
 * the test and removed again. Its absence is exactly what the page guards against.
 */
function stubScrollIntoView(): { scrolled: Element[]; restore: () => void } {
  // `Element` declares scrollIntoView as required, so the prototype is reached through a
  // shape that makes it optional: jsdom leaves it out, and the stub has to be removable.
  const proto = Element.prototype as unknown as { scrollIntoView?: (this: Element, arg?: unknown) => void };
  const had = "scrollIntoView" in proto;
  const scrolled: Element[] = [];
  proto.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  return {
    scrolled,
    restore: () => {
      if (!had) delete proto.scrollIntoView;
    },
  };
}

const ORIGIN = window.location.origin; // jsdom: http://localhost:3000

describe("HelpPage", () => {
  it("opens on what the application is, then the two data sources, then the agent, and ends on the server", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    const titles = [...container.querySelectorAll("[data-slot=card-title]")].map((el) => el.textContent);
    // Five sections, not eleven: everything about the optional agent lives inside the third one,
    // so a newcomer does not read six installation cards as prerequisites. The server comes
    // last: a fallback and an option, never a step on the way in.
    expect(titles).toEqual([
      "L'application",
      "1. Obtenir un relevé d'activité",
      "2. Configurer une Flex Query",
      "3. L'agent local, facultatif",
      "4. Le serveur, facultatif",
    ]);
  });

  it("keeps the agent's steps, the terminal first and then six lettered, in order, inside that one section", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    const agentCard = (await screen.findByText("3. L'agent local, facultatif")).closest("[data-slot=card]");
    expect(agentCard).toBeInstanceOf(HTMLElement);
    const steps = [...(agentCard as HTMLElement).querySelectorAll("p.font-heading")].map((el) => el.textContent);
    expect(steps).toEqual([
      "Avant de commencer : le terminal",
      "A. Installer uv",
      "B. Installer l'agent",
      "C. Le configurer et le lancer",
      "D. Régler l'API de TWS",
      "E. La permission du navigateur",
      "F. Renseigner le port",
    ]);
    // The steps are inside the agent card, so they are not cards of their own.
    expect(container.querySelectorAll("[data-slot=card]")).toHaveLength(5);
  });

  // The three sources and what each can and cannot do: a newcomer choosing between them needs
  // the limits, not just the names.
  it("names the three data sources with the limit of each, and urges a full history", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/en filtrant automatiquement les doublons/)).toBeInTheDocument();
    expect(screen.getByText(/que vous chargez dans l'application à la main/)).toBeInTheDocument();
    expect(screen.getByText(/ne peuvent pas importer de données au-delà de 365 jours/)).toBeInTheDocument();
    expect(screen.getByText(/Il ne permet pas de récupérer un historique/)).toBeInTheDocument();
    expect(screen.getByText(/fortement recommandé d'importer l'ensemble de l'historique/)).toBeInTheDocument();
  });

  // The drawing comes on top of that text, in the same card, never in its place.
  it("draws the three modes inside the application's card, after its text", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    const card = (await screen.findByText("L'application")).closest("[data-slot=card]") as HTMLElement;
    const history = within(card).getByText(/fortement recommandé d'importer/);
    const modes = within(card).getByTestId("help-modes");
    expect(history.compareDocumentPosition(modes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  function features(): Record<string, string> {
    const list = screen.getByTestId("help-modes-features");
    return Object.fromEntries(
      [...list.querySelectorAll("li")].map((li) => [li.dataset.feature, li.lastElementChild?.textContent ?? ""]),
    );
  }

  // Both drawings, wide and narrow, are in the page — CSS shows one — and must light the same boxes.
  function activeNodes(): string[] {
    const lit = (layout: string) =>
      [...screen.getByTestId("help-modes").querySelectorAll(`svg[data-layout=${layout}] [data-node][data-active=true]`)]
        .map((node) => node.getAttribute("data-node") ?? "")
        .sort();
    expect(lit("narrow")).toEqual(lit("wide"));
    return lit("wide");
  }

  it("opens the diagram on the recommended mode, the local agent", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    const group = await screen.findByRole("group", { name: "Choisir un mode de fonctionnement" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(buttons[1]).toHaveTextContent("Recommandé");
    expect(activeNodes()).toEqual(["agent", "app", "ib", "tws"]);
    expect(features()).toEqual({
      freshness: "presque instantanée",
      update: "automatique",
      charts: "oui",
      dayValues: "oui",
      serverAccount: "non requis",
      serverSees: "rien",
    });
  });

  // Only the agent's mode draws the price charts: the two others stop at yesterday.
  it("switches to the manual import: a statement by hand, no charts, no server", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /1\. Import manuel/ }));
    expect(screen.getByRole("button", { name: /1\. Import manuel/ })).toHaveAttribute("aria-pressed", "true");
    expect(activeNodes()).toEqual(["app", "file", "ib"]);
    expect(features()).toMatchObject({ freshness: "date du relevé", update: "à la main", charts: "non", dayValues: "non", serverSees: "rien" });
    expect(screen.getAllByRole("img", { name: /vous l'importez à la main/ })).toHaveLength(2);
  });

  it("switches to the server's relay, called a fallback, and says what the server sees", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    const button = await screen.findByRole("button", { name: /3\. Automatique par le serveur/ });
    expect(button).toHaveTextContent("Mode dégradé");
    fireEvent.click(button);
    expect(activeNodes()).toEqual(["app", "ib", "server"]);
    expect(features()).toMatchObject({
      freshness: "clôture de la veille",
      charts: "non",
      serverAccount: "connexion requise",
      serverSees: "le jeton et la réponse Flex, en transit",
    });
  });

  // A newcomer does not know either name; both are spelled out where they first appear.
  it("spells out what TWS and the Client Portal are", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/TWS, pour Trader Workstation, est l'application de bureau/)).toBeInTheDocument();
    expect(screen.getByText(/Le Client Portal est le site d'Interactive Brokers/)).toBeInTheDocument();
  });

  it("gives example socket ports for several TWS instances", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/7501 pour le premier, 7502 pour le second/)).toBeInTheDocument();
  });

  it("anchors the two sections the first-step card points at", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    expect(container.querySelector("#statement")).not.toBeNull();
    expect(container.querySelector("#flex")).not.toBeNull();
  });

  // The ids alone promise nothing: the router carries no `ScrollRestoration`, so without the
  // page's own effect `/help#statement` lands at the top of the page.
  it("scrolls the section the hash names into view", async () => {
    mockIndex(new Response("", { status: 404 }));
    const stub = stubScrollIntoView();
    try {
      const { container } = render(
        <MemoryRouter initialEntries={["/help#statement"]}><HelpPage /></MemoryRouter>,
      );
      await screen.findByText("L'application");
      expect(stub.scrolled).toEqual([container.querySelector("#statement")]);
    } finally {
      stub.restore();
    }
  });

  it("scrolls nothing, and throws nothing, for a hash that names no section", async () => {
    mockIndex(new Response("", { status: 404 }));
    const stub = stubScrollIntoView();
    try {
      render(<MemoryRouter initialEntries={["/help#nowhere"]}><HelpPage /></MemoryRouter>);
      await screen.findByText("L'application");
      expect(stub.scrolled).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  // Without the `?.` on `scrollIntoView`, this render throws in jsdom — and so would every
  // other test on this page the day one of them carried a hash.
  it("renders on a hash even where the browser has no scrollIntoView", async () => {
    mockIndex(new Response("", { status: 404 }));
    expect("scrollIntoView" in Element.prototype).toBe(false);
    render(<MemoryRouter initialEntries={["/help#statement"]}><HelpPage /></MemoryRouter>);
    expect(await screen.findByText("L'application")).toBeInTheDocument();
  });

  // Listing columns one by one would be long to follow and wrong the day the parser reads one
  // more; Corporate Actions is named because nothing warns when it is missing.
  it("tells the user to select all of each section, and names the five", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Select All/)).toBeInTheDocument();
    for (const section of ["Trades", "Cash Transactions", "Corporate Actions", "Open Positions", "Cash Report"]) {
      // getAllByText: "Corporate Actions" legitimately appears twice — once as a section
      // name, once in the sentence explaining why it is named (nothing warns when it is
      // missing) — so uniqueness is not the point, presence is.
      expect(screen.getAllByText(new RegExp(section)).length).toBeGreaterThan(0);
    }
  });

  it("builds the install and origin commands from the current origin and the served index", async () => {
    mockIndex(new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(`uv tool install ${ORIGIN}/agent/ib_tws_agent-0.1.0-py3-none-any.whl`)).toBeInTheDocument();
    expect(screen.getByText(`ib-tws-agent origin add ${ORIGIN}`)).toBeInTheDocument();
    expect(screen.getByText("ib-tws-agent", { selector: "code" })).toBeInTheDocument();
  });

  // For someone who has never opened a terminal: where it is, how to paste, when to go on.
  it("says what a terminal is and how to open one on each platform", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/une fenêtre où l'on écrit des instructions à l'ordinateur au lieu de cliquer/)).toBeInTheDocument();
    expect(screen.getByText(/^macOS : ouvrez Spotlight/)).toBeInTheDocument();
    expect(screen.getByText(/^Windows : ouvrez le menu Démarrer, tapez « PowerShell »/)).toBeInTheDocument();
    expect(screen.getByText(/^Linux : Ctrl \+ Alt \+ T/)).toBeInTheDocument();
    expect(screen.getByText(/attendez que le terminal vous rende la main/)).toBeInTheDocument();
  });

  it("says what uv is, to reopen the terminal after installing it, and how to check", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/uv est un outil gratuit, publié par la société Astral/)).toBeInTheDocument();
    expect(screen.getByText(/fermez le terminal et ouvrez-en un nouveau/)).toBeInTheDocument();
    expect(screen.getByText("uv --version", { selector: "code" })).toBeInTheDocument();
  });

  it("says how to fix the PATH, update and uninstall, next to the install command", async () => {
    mockIndex(new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText("uv tool update-shell", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText(/Si elle répond « is already installed », vous avez déjà cette version/)).toBeInTheDocument();
    expect(screen.getByText("uv tool uninstall ib-tws-agent", { selector: "code" })).toBeInTheDocument();
  });

  it("says the running agent prints nothing, must stay open, and stops on Ctrl + C", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Il n'affiche rien et le terminal ne vous rend pas la main : c'est normal/)).toBeInTheDocument();
    expect(screen.getByText(/appuyez sur Ctrl \+ C dans cette fenêtre/)).toBeInTheDocument();
    expect(screen.getByText(/la section affiche « Agent détecté »/)).toBeInTheDocument();
  });

  it("copies a command to the clipboard from its button, and says so", async () => {
    mockIndex(new Response("", { status: 404 }));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      render(<MemoryRouter><HelpPage /></MemoryRouter>);
      const block = (await screen.findByText("uv --version", { selector: "code" })).closest("pre")?.parentElement as HTMLElement;
      fireEvent.click(within(block).getByRole("button", { name: "Copier" }));
      expect(writeText).toHaveBeenCalledWith("uv --version");
      expect(await within(block).findByRole("button", { name: "Copié" })).toBeInTheDocument();
      // Every grey command has its button.
      expect(screen.getAllByRole("button", { name: "Copier" }).length).toBe(document.querySelectorAll("pre code").length - 1);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  // A page served over plain http off localhost has no clipboard API: no button that would do nothing.
  it("shows no copy button where the browser offers no clipboard", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("uv --version", { selector: "code" });
    expect(screen.queryByRole("button", { name: "Copier" })).not.toBeInTheDocument();
  });

  it("says when this server does not serve the package", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText("Ce serveur ne sert pas le paquet de l'agent : en développement, lancez pnpm build:agent.")).toBeInTheDocument();
    expect(screen.queryByText(/uv tool install/)).not.toBeInTheDocument();
    // Fixing the PATH and updating belong to the install command: without it, they have nothing to act on.
    expect(screen.queryByText("uv tool update-shell")).not.toBeInTheDocument();
  });

  it("lists the four TWS settings and the uv commands for both platforms", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Enable ActiveX and Socket Clients/)).toBeInTheDocument();
    expect(screen.getByText(/Trusted IPs/)).toBeInTheDocument();
    expect(screen.getByText("curl -LsSf https://astral.sh/uv/install.sh | sh")).toBeInTheDocument();
    expect(screen.getByText(/irm https:\/\/astral.sh\/uv\/install.ps1/)).toBeInTheDocument();
  });

  it("links to the Sources page of the last opened account", async () => {
    mockIndex(new Response("", { status: 404 }));
    setLastAccountId("beta");
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Ouvrir Sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
  });

  it("says the agent also relays Flex Query, and that the port is only for live data", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/relaie aussi les appels Flex Query de l'application vers Interactive Brokers/)).toBeInTheDocument();
    expect(screen.getByText(/le jeton Flex ne passe jamais par le serveur/)).toBeInTheDocument();
    expect(screen.getByText(/pas pour relayer Flex Query/)).toBeInTheDocument();
  });

  it("says a Flex Query needs a relay, the local agent first, the server as a fallback", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/il faut un relais/)).toBeInTheDocument();
    expect(screen.getByText(/L'agent local \(recommandé\)/)).toBeInTheDocument();
    expect(screen.getByText(/le serveur peut relayer, en mode dégradé — voir la section 4/)).toBeInTheDocument();
  });

  it("explains the server last: an optional relay in fallback mode, and an encrypted backup", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    const card = (await screen.findByText("4. Le serveur, facultatif")).closest("[data-slot=card]") as HTMLElement;
    const steps = [...card.querySelectorAll("p.font-heading")].map((el) => el.textContent);
    expect(steps).toEqual(["Relayer Flex Query par le serveur : un mode dégradé", "Sauvegarder vos données, chiffrées"]);
    expect(within(card).getByText(/L'application n'a pas besoin du serveur/)).toBeInTheDocument();
    expect(within(card).getByText(/sans y être journalisés ni conservés/)).toBeInTheDocument();
    expect(within(card).getByText(/Tout à fait facultative/)).toBeInTheDocument();
    expect(within(card).getByText(/chiffrées dans votre navigateur avant de partir/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Ouvrir les Paramètres" })).toHaveAttribute("href", "/settings");
  });

  it("says the agent talks to the application in the browser, never to the server", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/transmet ce qu'il lit à l'application qui tourne dans votre navigateur/)).toBeInTheDocument();
    expect(screen.getByText(/L'agent ne parle qu'à l'application ouverte dans votre navigateur et à Interactive Brokers, jamais au serveur/)).toBeInTheDocument();
  });

  it("says the day's move and P&L come from the local agent", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Var\. jour et P&L jour viennent de l'agent local/)).toBeInTheDocument();
    expect(screen.getByText(/comme un contrat acheté ou vendu le jour même/)).toBeInTheDocument();
  });
});
