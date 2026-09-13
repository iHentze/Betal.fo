import { describe, expect, it } from "vitest";
import {
  getEygaCompany,
  parseEygaSnapshot,
  searchEygaCompanies,
} from "~/lib/onboarding/eyga";
import type { ServiceFetcher } from "~/lib/db/types";
import { TestDatabase } from "./helpers/sqlite";

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

describe("Eyga live register", () => {
  function register() {
    const db = new TestDatabase();
    db.raw.exec(`
      CREATE TABLE company (
        regnr INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        legal_form TEXT,
        status TEXT NOT NULL,
        town TEXT,
        postcode TEXT,
        street TEXT,
        street_is_residential INTEGER NOT NULL DEFAULT 1,
        purpose TEXT,
        signing_rules TEXT,
        management_json TEXT,
        board_json TEXT,
        sgvs_id INTEGER,
        sgvs_seen TEXT,
        last_event_on TEXT,
        people_as_of TEXT,
        people_source TEXT
      );
      CREATE TABLE entity (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT,
        regnr INTEGER,
        country TEXT
      );
      CREATE TABLE edge (
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        cb_type_id INTEGER NOT NULL,
        cb_type_name TEXT NOT NULL,
        pct REAL,
        PRIMARY KEY (from_id, cb_type_id, to_id)
      );
    `);
    db.raw.exec(`
      INSERT INTO company (
        regnr, name, legal_form, status, town, postcode, street, street_is_residential,
        purpose, signing_rules, management_json, board_json, sgvs_id, sgvs_seen,
        last_event_on, people_as_of, people_source
      ) VALUES (
        10, 'P/F Føroya Banki', 'P/F', 'virkid', 'Tórshavn', '110', 'Oknarvegur 5', 0,
        'At reka bankavirksemi.', 'Bankin verður bundin av nevndini.',
        '[{"role":"Stjóri","name":"Turið Finnbogadóttir Arge","kind":"person"}]',
        '[{"role":"Nevndarformaður","name":"Birgir Durhuus","kind":"person"}]',
        1131, '2026-09-04', '2026-04-10', '2026-09-02', 'tekningarútskrift'
      ), (
        5534, 'P/F Betri Banki', 'P/F', 'virkid', 'Tórshavn', '110', 'Yviri við Strond 4', 0,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      ), (
        36, 'Sp/f Hólmur', 'Sp/f', 'virkid', 'Argir', '160', 'Heimavegur 1', 1,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO entity (id, name, kind, regnr, country) VALUES
        (17515, 'Føroya Landsstýri', 'company', NULL, 'Føroyar'),
        (67, 'Framherji', 'company', 1925, 'FO');
      INSERT INTO edge (from_id, to_id, cb_type_id, cb_type_name, pct) VALUES
        (17515, 1131, 1, 'Eigari 34.82%', 34.82),
        (67, 1131, 1, 'Eigari 5.07%', 5.07);
    `);
    return db;
  }

  it("searches the live register instead of a dummy one-company fixture", async () => {
    const db = register();
    const results = await searchEygaCompanies({ EYGA_CORE: db }, "banki");
    expect(results.map((row) => row.name)).toEqual([
      "P/F Føroya Banki",
      "P/F Betri Banki",
    ]);
    expect(results[0]?.status).toBe("active");
    await expect(searchEygaCompanies({ EYGA_CORE: db }, "lunetur")).resolves.toEqual([]);
    db.close();
  });

  it("loads official address, management and owners from the register", async () => {
    const db = register();
    const company = await getEygaCompany({ EYGA_CORE: db }, "10");
    expect(company.address).toBe("Oknarvegur 5");
    expect(company.management[0]).toMatchObject({
      name: "Turið Finnbogadóttir Arge",
      role: "Stjóri",
    });
    expect(company.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Føroya Landsstýri", ownershipBps: 3482 }),
      expect.objectContaining({ name: "Framherji", ownershipBps: 507 }),
    ]));
    db.close();
  });

  it("withholds a residential street from the merchant confirmation", async () => {
    const db = register();
    const company = await getEygaCompany({ EYGA_CORE: db }, "36");
    expect(company.address).toBe("");
    expect(company.city).toBe("Argir");
    db.close();
  });

  it("does not let a leftover localhost fixture win over the live register", async () => {
    const db = register();
    const api = service(() => {
      throw new Error("localhost fixture should not be used");
    });
    const results = await searchEygaCompanies(
      {
        EYGA_CORE: db,
        EYGA_API: api,
        EYGA_API_BASE_URL: "http://127.0.0.1:8788",
      },
      "betri",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.registryNumber).toBe("5534");
    db.close();
  });
});
