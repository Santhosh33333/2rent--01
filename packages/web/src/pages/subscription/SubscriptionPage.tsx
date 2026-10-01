import { useCallback, useEffect, useState } from "react";
import {
  subscriptionsApi,
  formatPrice,
  billingLabel,
  savingsPercent,
  isTrialState,
  formatDate,
  type SubscriptionPlan,
  type MySubscription,
} from "../../lib/subscriptions";
import { getCashfree, isSandbox } from "../../lib/cashfree";

export function SubscriptionPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [mine, setMine] = useState<MySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loggedIn = Boolean(localStorage.getItem("token"));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plansRes = await subscriptionsApi.getPlans();
      setPlans(plansRes.data.data.plans);
      if (loggedIn) {
        const meRes = await subscriptionsApi.getMe();
        setMine(meRes.data.data);
      }
    } catch {
      setError("Could not load plans. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loggedIn]);

  useEffect(() => {
    load();
  }, [load]);

  const subscribe = async (plan: SubscriptionPlan) => {
    if (!loggedIn) {
      setNotice("Sign in to start your trial.");
      return;
    }
    setBusy(plan.code);
    setError(null);
    try {
      const { data } = await subscriptionsApi.subscribe(plan.code);
      const sessionId = data.data.subscriptionSessionId;
      if (!sessionId) {
        setError("Payment session could not be created. Contact support if this persists.");
        return;
      }
      const cashfree = await getCashfree();
      const result = await cashfree.subscriptionsCheckout({
        subsSessionId: sessionId,
        redirectTarget: "_modal",
      });
      if (result?.error) {
        setError("Payment could not be started. Please try again.");
        return;
      }
      // Entitlement arrives via webhook, not from this response.
      setNotice("Payment received. Your plan activates once the bank confirms the mandate.");
      await load();
    } catch (err) {
      setError("Something went wrong starting your subscription.");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await subscriptionsApi.cancel("Cancelled from subscription screen");
      setNotice("Subscription cancelled. Your access continues until the period ends.");
      await load();
    } catch {
      setError("Could not cancel your subscription. Please contact support.");
    } finally {
      setBusy(null);
    }
  };

  const monthly = plans.find((p) => billingLabel(p) === "month");
  const yearly = plans.find((p) => billingLabel(p) === "year");
  const savings = savingsPercent(monthly, yearly);
  const trialActive = mine ? isTrialState(mine.state) : false;

  return (
    <div className="min-h-screen bg-slate-950 px-4 pb-24 text-white">
      <div className="mx-auto max-w-3xl py-10">
        <header className="text-center">
          <h1 className="text-3xl font-semibold">Unlock more of Nabri</h1>
          <p className="mt-2 text-sm text-slate-400">
            Prices are set by Nabri and shown exactly as configured.
          </p>
          <span className="mt-3 inline-block rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
            {isSandbox() ? "Sandbox mode" : "Live billing"}
          </span>
        </header>

        {error && (
          <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {mine && (
          <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-sm font-medium text-slate-400">Your subscription</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white/10 px-3 py-1 text-sm">
                {mine.plan?.name ?? "No plan"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm ${
                  mine.isActive
                    ? "bg-emerald-500/20 text-emerald-300"
                    : trialActive
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-slate-700 text-slate-300"
                }`}
              >
                {mine.isActive ? "Active" : mine.state.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>

            {mine.trialEndsAt && (
              <p className="mt-3 text-sm text-slate-400">
                Trial ends {formatDate(mine.trialEndsAt)}
              </p>
            )}
            {mine.nextBillingAt && mine.isActive && (
              <p className="mt-1 text-sm text-slate-400">
                Next billing {formatDate(mine.nextBillingAt)}
              </p>
            )}

            {mine.isActive && (
              <button
                onClick={cancel}
                disabled={busy === "cancel"}
                className="mt-5 rounded-full border border-slate-600 px-5 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel subscription"}
              </button>
            )}
          </section>
        )}

        {loading ? (
          <p className="mt-12 text-center text-sm text-slate-500">Loading plans…</p>
        ) : plans.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-slate-300">No plans are available right now.</p>
            <p className="mt-1 text-sm text-slate-500">
              Subscription pricing has not been configured.
            </p>
          </div>
        ) : (
          <section className="mt-10 grid gap-5 sm:grid-cols-2">
            {plans.map((plan) => {
              const isYearly = billingLabel(plan) === "year";
              return (
                <div
                  key={plan.code}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    isYearly
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <h2 className="text-lg font-semibold">{plan.name}</h2>
                    {isYearly && savings !== null && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">
                        Save {savings}%
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-3xl font-semibold">
                    {formatPrice(plan.price, plan.currency)}
                    <span className="text-base font-normal text-slate-400">
                      /{billingLabel(plan)}
                    </span>
                  </p>

                  {plan.trialDays > 0 && (
                    <p className="mt-2 text-sm text-amber-300">
                      {plan.trialDays}-day free trial included
                    </p>
                  )}

                  <p className="mt-3 text-xs text-slate-500">
                    Billed every {plan.durationDays} days. Cancel anytime.
                  </p>

                  <button
                    onClick={() => subscribe(plan)}
                    disabled={busy !== null}
                    className={`mt-6 rounded-full px-6 py-3 text-sm font-medium disabled:opacity-40 ${
                      isYearly
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "bg-white text-slate-900 hover:bg-slate-200"
                    }`}
                  >
                    {busy === plan.code
                      ? "Starting…"
                      : plan.trialDays > 0
                        ? "Start trial"
                        : "Subscribe"}
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section className="mt-10 space-y-2 text-sm text-slate-500">
          <p>· Prices are shown in INR and include any configured discount.</p>
          <p>· Your trial does not auto-charge unless you subscribe after it ends.</p>
          <p>· Payment is processed securely by Cashfree. We never see card details.</p>
        </section>
      </div>
    </div>
  );
}

export default SubscriptionPage;