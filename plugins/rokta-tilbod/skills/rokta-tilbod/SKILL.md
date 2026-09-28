---
name: rokta-tilbod
description: Use when building or changing Røkta tilboð, the Betal feature that turns a product on sale into a finished Facebook and Instagram post. Covers the merchant flow, poster rules, Faroese copy, sizes, and the payment link.
---

# Røkta tilboð

Røkta tilboð lives in this plugin. The marketing site stays the public face of Betal. Do not fold this flow into the marketing pages unless Ingvar asks.

The merchant never opens a blank design tool. Canva is an optional "open to tweak" later, not the product. A Faroese shop owner gets a finished post.

## Flow

Three screens, on the phone.

1. **Tilboð.** A list of what is on sale. Each row is the photo, the name, and both prices. The first version has no shop connection. "Nýtt tilboð" asks for a name, two prices, an end date, and a photo they already have.
2. **Plakat.** Three layouts of the same offer, in the shop's logo and colors. Layouts differ. The offer does not. Sizes are Instagram feed 4:5 (1080×1350), square 1:1 (1080×1080), and story 9:16 (1080×1920).
3. **Opslag.** The poster sits in a phone frame, once as Instagram and once as Facebook. The Faroese caption is already written and includes a Betal payment link. Actions are "Kopiera tekst" and "Tak niður myndir". Do not post to Meta until an app review exists.

## Poster rules

- The photo is the merchant's photo. Do not invent a product.
- Price, name, and the word TILBOÐ are set as real text in the template. An image model must not paint letters or digits. Faroese and prices will be wrong if it does.
- An AI background is a later switch, only when they have no photo. The price still stays in the template.
- The post sells through a Betal payment link. A pretty picture without that link is not this product.

## Copy

Merchant UI is Faroese, in the same plain voice as `src/content/fo.ts`. Do not invent a second brand. Colors are navy `#0d0033` and green `#7ad966`, type is Poppins.

## Out of scope for the first version

- Shopify as a source of offers. The list can be fed from there later.
- Scheduling and direct publishing to Facebook or Instagram.
- Canva as the editor. Export there only if a merchant asks to move a logo.
