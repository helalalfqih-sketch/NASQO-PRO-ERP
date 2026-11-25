/** Stock uses thousandths; currency formatting would hide the third digit. */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 })
    .format(Number.isFinite(value) ? value : 0);
}
