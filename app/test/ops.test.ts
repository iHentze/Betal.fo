import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceLead,
  captureLead,
  listLeads,
  openTicket,
  refreshTerminalActivity,
  replyToTicket,
  terminalHealth,
  upsertAcquiringApplication,
} from "~/lib/ops";
import { freshDatabase, seedMerchant, seedPointOfSale, type TestDatabase } from "./helpers/sqlite";

describe("lead pipeline", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("captures an enquiry from the contact form", async () => {
    await captureLead(db, {
      name: "Jógvan",
      email: "  JOGVAN@Handil.FO ",
      company: "Handil P/F",
      product: "stadnum",
      message: "Vit vilja taka ímóti korti á marknaðinum.",
    });

    const lead = db.query<Record<string, any>>("SELECT * FROM lead")[0]!;
    // Normalised so the same person submitting twice is recognisable.
    expect(lead.email).toBe("jogvan@handil.fo");
    expect(lead.state).toBe("new");
    expect(lead.product).toBe("stadnum");
  });

  it("moves a lead through the pipeline and links it to the merchant it became", async () => {
    seedMerchant(db);
    const id = await captureLead(db, {
      name: "Jógvan",
      email: "jogvan@handil.fo",
      message: "Hey",
    });

    await advanceLead(db, id, "contacted", { ownerEmail: "ingvar@betal.fo" });
    await advanceLead(db, id, "won", { merchantId: "m1" });

    const lead = db.query<Record<string, any>>("SELECT * FROM lead")[0]!;
    expect(lead.state).toBe("won");
    expect(lead.merchant_id).toBe("m1");
    // The owner set earlier is not lost when the state changes again.
    expect(lead.owner_email).toBe("ingvar@betal.fo");
  });

  it("records why a lead was lost, and clears it if revived", async () => {
    const id = await captureLead(db, { name: "A", email: "a@a.fo", message: "m" });
    await advanceLead(db, id, "lost", { lostReason: "Ov dýrt" });
    expect(
      db.query<{ lost_reason: string }>("SELECT lost_reason FROM lead")[0]!.lost_reason,
    ).toBe("Ov dýrt");

    await advanceLead(db, id, "qualified");
    expect(
      db.query<{ lost_reason: string | null }>("SELECT lost_reason FROM lead")[0]!
        .lost_reason,
    ).toBeNull();
  });

  it("filters by state", async () => {
    await captureLead(db, { name: "A", email: "a@a.fo", message: "m" });
    const id = await captureLead(db, { name: "B", email: "b@b.fo", message: "m" });
    await advanceLead(db, id, "won");

    expect(await listLeads(db, "new")).toHaveLength(1);
    expect(await listLeads(db, "won")).toHaveLength(1);
    expect(await listLeads(db)).toHaveLength(2);
  });
});

describe("acquiring applications", () => {
  it("tracks progress and mirrors it onto the merchant", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await upsertAcquiringApplication(db, {
      merchantId: "m1",
      acquirer: "clearhaus",
      state: "collecting",
    });
    await upsertAcquiringApplication(db, {
      merchantId: "m1",
      acquirer: "clearhaus",
      state: "submitted",
      externalRef: "EO-123",
    });

    let merchant = db.query<{ acquiring_status: string; acquirer: string | null }>(
      "SELECT acquiring_status, acquirer FROM merchant",
    )[0]!;
    expect(merchant.acquiring_status).toBe("submitted");
    // Not committed to an acquirer until approved.
    expect(merchant.acquirer).toBeNull();

    await upsertAcquiringApplication(db, {
      merchantId: "m1",
      acquirer: "clearhaus",
      state: "approved",
    });

    merchant = db.query<{ acquiring_status: string; acquirer: string | null }>(
      "SELECT acquiring_status, acquirer FROM merchant",
    )[0]!;
    expect(merchant.acquiring_status).toBe("approved");
    expect(merchant.acquirer).toBe("clearhaus");

    // One application row per merchant and acquirer, updated rather than duplicated.
    expect(db.query("SELECT * FROM acquiring_application")).toHaveLength(1);
  });

  it("keeps the submitted timestamp after a later decision", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    await upsertAcquiringApplication(db, {
      merchantId: "m1",
      acquirer: "nets",
      state: "submitted",
    });
    await upsertAcquiringApplication(db, {
      merchantId: "m1",
      acquirer: "nets",
      state: "approved",
    });

    const row = db.query<{ submitted_at: string; decided_at: string }>(
      "SELECT submitted_at, decided_at FROM acquiring_application",
    )[0]!;
    expect(row.submitted_at).not.toBeNull();
    expect(row.decided_at).not.toBeNull();
  });
});

describe("support tickets", () => {
  it("opens a ticket linked to a merchant and a transaction", async () => {
    const db = freshDatabase();
    seedMerchant(db);

    const ticketId = await openTicket(db, {
      subject: "Kundin fekk ikki endurgjald",
      merchantId: "m1",
      transactionId: "T1",
      openedBy: "kundi@handil.fo",
      body: "Vit endurgjaldu 15. august, men kundin sigur, at peningurin ikki er komin.",
    });

    const ticket = db.query<Record<string, any>>("SELECT * FROM ticket")[0]!;
    expect(ticket.transaction_id).toBe("T1");
    expect(ticket.state).toBe("open");
    expect(db.query("SELECT * FROM ticket_message")).toHaveLength(1);
    expect(ticketId).toBeTruthy();
  });

  it("keeps internal notes separate from what the merchant sees", async () => {
    const db = freshDatabase();
    const ticketId = await openTicket(db, {
      subject: "Spurningur",
      openedBy: "kundi@handil.fo",
      body: "Hey",
    });

    await replyToTicket(db, ticketId, {
      author: "ingvar@betal.fo",
      body: "Kanni hjá innloysaranum",
      internal: true,
    });
    await replyToTicket(db, ticketId, {
      author: "ingvar@betal.fo",
      body: "Vit kanna hetta og venda aftur",
    });

    const visible = db.query("SELECT * FROM ticket_message WHERE internal = 0");
    expect(visible).toHaveLength(2);
    expect(db.query("SELECT * FROM ticket_message WHERE internal = 1")).toHaveLength(1);
  });
});

describe("terminal liveness", () => {
  it("derives status from transaction flow, since ePay reports none", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    seedPointOfSale(db, "m1", "pos1");

    const now = Date.parse("2026-09-01T00:00:00Z");
    db.raw
      .prepare(
        `INSERT INTO terminal (id, merchant_id, point_of_sale_id, external_id,
                               description, created_at)
         VALUES ('t1','m1','pos1','term-1','Kassi 1','2026-01-01')`,
      )
      .run();

    // A payment yesterday.
    db.raw
      .prepare(
        `INSERT INTO txn (id, merchant_id, point_of_sale_id, state, type, amount,
                          surcharge, currency, created_at, created_at_ms, synced_at_ms)
         VALUES ('T1','m1','pos1','SUCCESS','PAYMENT',1000,0,'DKK','2026-08-31',?,?)`,
      )
      .run(now - 86_400_000, now);

    await refreshTerminalActivity(db);
    const health = await terminalHealth(db, "m1", () => now);

    expect(health[0]!.status).toBe("active");
    expect(health[0]!.description).toBe("Kassi 1");
  });

  it("distinguishes quiet from silent, without calling a slow week broken", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    seedPointOfSale(db, "m1", "pos1");
    const now = Date.parse("2026-09-01T00:00:00Z");

    db.raw
      .prepare(
        `INSERT INTO terminal (id, merchant_id, point_of_sale_id, description,
                               last_seen_at_ms, created_at)
         VALUES ('t1','m1','pos1','Marknaður', ?, '2026-01-01')`,
      )
      .run(now - 10 * 86_400_000);

    // Ten days without trade is a market stall between seasons, not a fault.
    expect((await terminalHealth(db, "m1", () => now))[0]!.status).toBe("quiet");

    db.raw
      .prepare("UPDATE terminal SET last_seen_at_ms = ?")
      .run(now - 60 * 86_400_000);
    expect((await terminalHealth(db, "m1", () => now))[0]!.status).toBe("silent");
  });

  it("reports unknown for a terminal that has never transacted", async () => {
    const db = freshDatabase();
    seedMerchant(db);
    db.raw
      .prepare(
        `INSERT INTO terminal (id, merchant_id, description, created_at)
         VALUES ('t1','m1','Nýggjur', '2026-01-01')`,
      )
      .run();

    expect((await terminalHealth(db, "m1"))[0]!.status).toBe("unknown");
  });
});
