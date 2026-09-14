// The merchant portal is a separate Cloudflare Worker (betal-app) on its own
// subdomain, so the marketing site links to it by URL rather than importing it.
const appUrl = "https://app.betal.fo";

export const site = {
  name: "betal",
  domain: "betal.fo",
  url: "https://betal.fo",
  email: "hey@betal.fo",
  appUrl,
  // Log in, then land straight on the onboarding application: /umbon creates one
  // if the merchant has none, or resumes the one in progress.
  onboardingUrl: `${appUrl}/innrita?next=${encodeURIComponent("/umbon")}`,
};
