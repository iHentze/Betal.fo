import { describe, expect, it } from "vitest";
import {
  getEygaCompany,
  parseEygaSnapshot,
  searchEygaCompanies,
} from "~/lib/onboarding/eyga";
import type { ServiceFetcher } from "~/lib/db/types";

function service(handler: (request: Request) => Response): ServiceFetcher {
  return {
    async fetch(input) {
      return handler(input instanceof Request ? input : new Request(input));
    },
  };
}

const detail = {
  id: "10",
  registryNumber: "10",
  name: "P/F Føroya Banki",
  legalForm: "P/F",
  companyType: "P/F Partafelag",
  status: "active",
  statusLabel: "Virkið",
  address: "Oknarvegur 5",
  postalCode: "110",
  city: "Tórshavn",
  updatedAt: "2026-04-10",
  sourceUrl: "https://eyga.fo/felag/10",
  owners: [
    {
      name: "Føroya Landsstýri",
      kind: "entity",
      reference: "eind/17515",
      description: "Landstýrið · Føroyar",
      ownershipBps: 3482,
      role: null,
    },
  ],
  beneficialOwners: [],
  management: [],
};

describe("Eyga API client", () => {
  it("searches through the private Worker binding", async () => {
    const api = service((request) => {
      expect(request.url).toBe("https://eyga.internal/v1/companies?query=banki&limit=8");
      return Response.json({
        results: [
          {
            id: "10",
            name: "P/F Føroya Banki",
            companyType: "P/F",
            location: "110 Tórshavn",
            registryNumber: "10",
            status: "active",
            statusLabel: "Virkið",
            href: "https://eyga.fo/felag/10",
          },
        ],
      });
    });

    const results = await searchEygaCompanies({ EYGA_API: api }, "banki");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "10", status: "active" });
  });

  it("loads ownership and company facts as JSON", async () => {
    const api = service((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/companies/10");
      return Response.json(detail);
    });

    const company = await getEygaCompany({ EYGA_API: api }, "10");
    expect(company.companyType).toBe("P/F Partafelag");
    expect(company.address).toBe("Oknarvegur 5");
    expect(company.owners[0]?.ownershipBps).toBe(3482);
    expect(parseEygaSnapshot(JSON.stringify(company))?.registryNumber).toBe("10");
  });

  it("fails clearly when the API binding is not configured", async () => {
    await expect(searchEygaCompanies({}, "banki")).rejects.toEqual(
      expect.objectContaining({
        name: "EygaApiError",
        message: "Eyga API er ikki sett upp",
        status: 503,
      }),
    );
  });
});
