/**
 * Businesses using Betal, shown in the reference slider on the home page.
 *
 * Deliberately empty: real customer names are the whole point of this section,
 * so it stays hidden until actual ones are added rather than shipping invented
 * logos. Drop each customer's mark in public/brand/clients/ and add an entry.
 *
 * `logo` is optional — entries without one render as a wordmark, which is fine
 * for customers who have no usable SVG.
 */
export interface Client {
  name: string;
  logo?: string;
}

export const clients: Client[] = [];
