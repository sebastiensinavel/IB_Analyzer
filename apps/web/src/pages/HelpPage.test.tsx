import { render, screen } from "@testing-library/react";
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

const ORIGIN = window.location.origin; // jsdom: http://localhost:3000

describe("HelpPage", () => {
  it("opens on what the application is, then the two data sources, then the agent", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    const titles = [...container.querySelectorAll("[data-slot=card-title]")].map((el) => el.textContent);
    expect(titles).toEqual([
      "L'application",
      "1. Obtenir un relevé d'activité",
      "2. Configurer une Flex Query",
      "3. L'agent local",
      "4. Installer uv",
      "5. Installer l'agent",
      "6. Le configurer et le lancer",
      "7. Régler l'API de TWS",
      "8. La permission du navigateur",
      "9. Renseigner le port",
    ]);
  });

  it("anchors the two sections the first-step card points at", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    expect(container.querySelector("#statement")).not.toBeNull();
    expect(container.querySelector("#flex")).not.toBeNull();
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

  it("builds the install and init commands from the current origin and the served index", async () => {
    mockIndex(new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(`uv tool install ${ORIGIN}/agent/ib_tws_agent-0.1.0-py3-none-any.whl`)).toBeInTheDocument();
    expect(screen.getByText(`ib-tws-agent init --origin ${ORIGIN}`)).toBeInTheDocument();
    expect(screen.getByText("ib-tws-agent", { selector: "code" })).toBeInTheDocument();
  });

  it("says when this server does not serve the package", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText("Ce serveur ne sert pas le paquet de l'agent : en développement, lancez pnpm build:agent.")).toBeInTheDocument();
    expect(screen.queryByText(/uv tool install/)).not.toBeInTheDocument();
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
    expect(await screen.findByText(/relaie aussi les appels Flex Query de ce site vers Interactive Brokers/)).toBeInTheDocument();
    expect(screen.getByText(/le jeton Flex ne passe jamais par le serveur/)).toBeInTheDocument();
    expect(screen.getByText(/pas pour relayer Flex Query/)).toBeInTheDocument();
  });

  it("says the day's move and P&L come from the local agent", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Var\. jour et P&L jour viennent de l'agent local/)).toBeInTheDocument();
    expect(screen.getByText(/comme un contrat acheté ou vendu le jour même/)).toBeInTheDocument();
  });
});
