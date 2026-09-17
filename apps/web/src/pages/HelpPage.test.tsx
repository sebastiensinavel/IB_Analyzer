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
});
