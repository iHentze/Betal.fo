import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { Epay } from "~/lib/epay";
import { AuthorizationError, requireCapability } from "~/lib/audit";
import {
  assertReadyToRate,
  billableTransactions,
  freezePeriod,
  markRated,
  markIssued,
  reconcilePeriod,
  resolveDiscrepancy,
  type PeriodRow,
} from "~/lib/billing/period";
import { parsePricePlan, ratePeriod } from "~/lib/billing/rating";
import {
  approveInvoice,
  createDraftInvoice,
  issueInvoice,
} from "~/lib/billing/invoice";

export const prerender = false;

/**
 * Drives a billing period through the close.
 *
 * Each action is a separate step rather than one "do everything" button, because the
 * whole point of the close is that a human looks at the reconciliation before an
 * invoice is produced.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.actor;
  if (!actor || actor.kind !== "staff") {
    return new Response("forbidden", { status: 403 });
  }

  const db = env.DB;
  const periodId = params.id!;
  const form = await request.formData();
  const action = String(form.get("action") ?? "");

  try {
    await requireCapability(db, actor, "manage_billing", {
      action: "rate_period",
      subjectType: "billing_period",
      subjectId: periodId,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("forbidden", { status: 403 });
    }
    throw error;
  }

  const period = await db
    .prepare(`SELECT * FROM billing_period WHERE id = ?1`)
    .bind(periodId)
    .first<PeriodRow>();

  if (!period) return new Response("not found", { status: 404 });

  const back = (message?: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `/betal/tidarskeid/${encodeURIComponent(periodId)}${
          message ? `?boð=${encodeURIComponent(message)}` : ""
        }`,
      },
    });

  try {
    switch (action) {
      case "freeze": {
        await freezePeriod(db, period);
        return back();
      }

      case "reconcile": {
        const merchant = await db
          .prepare(`SELECT epay_account_id, environment FROM merchant WHERE id = ?1`)
          .bind(period.merchant_id)
          .first<{ epay_account_id: string; environment: string }>();

        if (!merchant) return back("Handilin finst ikki");

        const epay = new Epay({
          partnerKey: env.EPAY_PARTNER_KEY,
          tokens: env.TOKENS,
        });
        // Throttled: reconciliation walks the whole month and index endpoints allow
        // one request per five seconds.
        const client = epay.forMerchantThrottled(
          merchant.epay_account_id,
          merchant.environment === "live" ? "live" : "test",
        );

        const result = await reconcilePeriod(db, client, period);
        return back(
          result.complete
            ? `Avstemt: ${result.epayCount} hjá ePay, ${result.discrepancies} ósamsvar`
            : `Hildið á: ${result.epayCount} lisin, meira eftir`,
        );
      }

      case "resolve": {
        const discrepancyId = String(form.get("discrepancyId") ?? "");
        const resolution = String(form.get("resolution") ?? "Handviljað loyst");
        if (!discrepancyId) return back("Vantar ósamsvar");
        await resolveDiscrepancy(db, discrepancyId, actor.email, resolution);
        return back();
      }

      case "rate": {
        const ready = await assertReadyToRate(db, periodId);

        const planRow = await db
          .prepare(
            `SELECT * FROM price_plan
              WHERE merchant_id = ?1
                AND effective_from <= ?2
                AND (effective_to IS NULL OR effective_to > ?2)
              ORDER BY version DESC LIMIT 1`,
          )
          .bind(ready.merchant_id, new Date(ready.starts_at_ms).toISOString())
          .first<Record<string, any>>();

        if (!planRow) return back("Handilin hevur onga prísskipan");

        const ruleRows = await db
          .prepare(
            `SELECT id, position, kind, label, params FROM price_plan_rule
              WHERE price_plan_id = ?1 ORDER BY position`,
          )
          .bind(planRow.id)
          .all<Record<string, any>>();

        const plan = parsePricePlan(planRow as never, ruleRows.results as never);

        const [transactions, posCount, terminalCount] = await Promise.all([
          billableTransactions(db, ready, plan.billableStates, plan.billableTypes),
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM point_of_sale WHERE merchant_id = ?1`,
            )
            .bind(ready.merchant_id)
            .first<{ count: number }>(),
          db
            .prepare(`SELECT COUNT(*) AS count FROM terminal WHERE merchant_id = ?1`)
            .bind(ready.merchant_id)
            .first<{ count: number }>(),
        ]);

        const rating = ratePeriod(plan, transactions, {
          merchantId: ready.merchant_id,
          year: ready.year,
          month: ready.month,
          startsAtMs: ready.starts_at_ms,
          endsAtMs: ready.ends_at_ms,
          pointOfSaleCount: posCount?.count ?? 0,
          terminalCount: terminalCount?.count ?? 0,
        });

        await createDraftInvoice(db, {
          merchantId: ready.merchant_id,
          billingPeriodId: periodId,
          rating,
          createdBy: actor.email,
        });

        await markRated(db, ready, rating.billableCount, rating.grossMinor);
        return back(`Roknað: ${rating.billableCount} gjaldingar`);
      }

      case "issue": {
        const invoice = await db
          .prepare(
            `SELECT id, state FROM invoice
              WHERE billing_period_id = ?1 AND kind = 'invoice'`,
          )
          .bind(periodId)
          .first<{ id: string; state: string }>();

        if (!invoice) return back("Eingin rokning at senda");

        if (invoice.state === "draft") {
          await approveInvoice(db, invoice.id, actor.email);
        }
        const number = await issueInvoice(db, invoice.id, {});

        const rated = await db
          .prepare(`SELECT * FROM billing_period WHERE id = ?1`)
          .bind(periodId)
          .first<PeriodRow>();
        if (rated) await markIssued(db, rated);

        return back(`Rokning ${number} send`);
      }

      default:
        return back("Ókend gerð");
    }
  } catch (error) {
    // Surfaced rather than swallowed: a refused transition usually means somebody
    // tried to skip reconciliation, and they should be told so.
    return back(error instanceof Error ? error.message : String(error));
  }
};
