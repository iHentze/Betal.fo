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

describe("Eyga API client", () => {
  it("searches through the private Worker binding", async () => {
    const api = service((request) => {
      expect(request.url).toBe("https://api.eyga.fo/v1/leita?q=banki&limit=8");
      expect(request.headers.get("authorization")).toBe("Bearer eyga-test-token");
      return Response.json({
        urslit: [
          {
            regnr: 10,
            navn: "P/F Føroya Banki",
            slag: "P/F",
            stoda: "virkid",
            heimstadur: { postnr: "110", bygd: "Tórshavn" },
          },
        ],
      });
    });

    const results = await searchEygaCompanies(
      { EYGA_API: api, EYGA_API_TOKEN: "eyga-test-token" },
      "banki",
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "10",
      companyType: "P/F Partafelag",
      status: "active",
      location: "110 Tórshavn",
    });
  });

  it("loads ownership and company facts as JSON", async () => {
    const api = service((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/eigarar")) {
        return Response.json({
          regnr: 10,
          eigarar: [
            {
              navn: "Føroya Landsstýri",
              slag: "Landstýrið",
              regnr: null,
              land: "Føroyar",
              partur_prosent: 34.82,
            },
          ],
          veruligir_eigarar: [],
          eigur: [],
        });
      }
      expect(path).toBe("/v1/felag/10");
      return Response.json({
        regnr: 10,
        navn: "P/F Føroya Banki",
        slag: "P/F",
        stoda: "virkid",
        heimstadur: {
          postnr: "110",
          bygd: "Tórshavn",
          adressa: "Oknarvegur 5",
          adressa_er_bustadur: false,
        },
        leidsla: [{ navn: "Anna Stjóri", leiklutur: "Stjóri", bygd: "Tórshavn" }],
        nevnd: [],
        endamal: "At reka handil.",
        tekningarreglur: "Felagið verður teknað av stjóranum.",
        kelda: { seinasta_kunngerd: "2026-04-10" },
      });
    });

    const company = await getEygaCompany(
      { EYGA_API: api, EYGA_API_TOKEN: "eyga-test-token" },
      "10",
    );
    expect(company.companyType).toBe("P/F Partafelag");
    expect(company.address).toBe("Oknarvegur 5");
    expect(company.owners[0]?.ownershipBps).toBe(3482);
    expect(company.management[0]?.role).toBe("Stjóri");
    expect(company.signingRules).toContain("stjóranum");
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
