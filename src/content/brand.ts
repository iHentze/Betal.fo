export const productIcons = {
  alnetinum: { src: "/brand/icon-basket.svg", alt: "Betal kurv" },
  stadnum: { src: "/brand/icon-phone.svg", alt: "Betal á staðnum" },
  hald: { src: "/brand/icon-wallet.svg", alt: "Betal hald" },
} as const;

export type ProductIconId = keyof typeof productIcons;
