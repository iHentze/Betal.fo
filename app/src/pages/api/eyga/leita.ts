import type { APIRoute } from "astro";
import { env } from "~/lib/env";
import { EygaApiError, searchEygaCompanies } from "~/lib/onboarding/eyga";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2 && !/^\d{1,5}$/.test(query)) {
    return Response.json({ results: [] });
  }

  try {
    const results = await searchEygaCompanies(env, query);
    return Response.json(
      { results },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    const apiError = error instanceof EygaApiError ? error : null;
    return Response.json(
      { error: apiError?.message ?? "Eyga svarar ikki beint nú", results: [] },
      { status: apiError?.status ?? 502 },
    );
  }
};
