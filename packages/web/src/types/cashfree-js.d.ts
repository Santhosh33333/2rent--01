/**
 * Minimal types for `@cashfreepayments/cashfree-js`.
 *
 * The package ships no declarations. Declaring only the surface this app uses
 * is better than `any`: if Cashfree changes a name or an argument shape, the
 * build fails here instead of at a customer's checkout.
 *
 * `load` resolves to `null` in a non-browser context, which is why the call
 * sites treat the result as optional.
 */
declare module '@cashfreepayments/cashfree-js' {
  export interface CashfreeCheckoutOptions {
    /** Session id returned by Cashfree's Create Order API. */
    paymentSessionId: string
    /** `_self` (same tab) is what a wallet top-up needs: `_modal` traps focus. */
    redirectTarget?: '_self' | '_blank' | '_top' | '_modal' | string
    returnUrl?: string
  }

  export interface CashfreeCheckoutResult {
    redirect?: boolean
    error?: { message?: string }
  }

  export interface CashfreeInstance {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult | void>
    version?: string
  }

  export interface LoadOptions {
    /** "production" for live payments, "sandbox" for test data. */
    mode: 'production' | 'sandbox'
  }

  export function load(options: LoadOptions): Promise<CashfreeInstance | null>
}
