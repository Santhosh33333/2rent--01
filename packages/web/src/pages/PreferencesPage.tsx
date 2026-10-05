import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Check,
  AlertCircle,
  Trash2,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { AnimatedPage } from "../components/AnimatedPage";
import { GlassCard } from "../components/GlassCard";
import {
  fetchPreferences,
  fetchPreferenceOptions,
  savePreferences,
  saveLocation,
  clearLocation,
  PreferenceValidationError,
} from "./dating/preferencesApi";
import type {
  OptionsResponse,
  PreferenceOption,
  Preferences,
} from "./dating/preferencesApi";

/**
 * Discovery preferences.
 *
 * Built as one form with one Save, rather than a settings row per option. Every
 * value here feeds a single ranking computation, and a form that saves
 * piecemeal can leave a person with a saved radius and an unsaved age range -
 * which is indistinguishable, from the outside, from the bug this page exists to
 * fix.
 *
 * All state lives on the server. There is no localStorage fallback: a preference
 * that only exists on one device is a preference the user will believe is set and
 * it will not be.
 */

const DEFAULT_FORM: Preferences = {
  distanceKm: 50,
  ageMin: 18,
  ageMax: 100,
  interests: [],
  languages: [],
  lifestyle: {},
};

/**
 * Toggleable chip.
 *
 * `type="button"`: these sit inside a form, and a bare button inside a form
 * submits it. A double-tap on a chip would otherwise save the form.
 */
function Chip({
  label,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
        selected
          ? "border-primary-500 bg-primary-500 text-white shadow-sm"
          : "border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:border-primary-300 hover:bg-surface-50 dark:hover:bg-surface-800"
      }`}
    >
      {selected && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
      {label}
    </button>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard variant="elevated" padding="lg">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h2>
        {description && (
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">{description}</p>
        )}
      </div>
      {children}
    </GlassCard>
  );
}

/** Inline field error. Rendered next to the control, not as a global banner. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mt-2" role="alert">
      <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function PreferencesPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState<Preferences>(DEFAULT_FORM);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [hasLocation, setHasLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // The catalogue and the saved record are fetched together: the form cannot be
      // rendered from one without the other, and fetching them in sequence would
      // show an empty form that then fills in.
      const [saved, catalogue] = await Promise.all([fetchPreferences(), fetchPreferenceOptions()]);
      setForm(saved.preferences);
      setHasLocation(saved.hasLocation);
      setOptions(catalogue);
    } catch {
      // Distinguish "could not load" from "loaded and empty". An empty form that
      // saves over real preferences is the worst possible failure for this page.
      setLoadError("We could not load your preferences. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issueFor = (field: string): string | undefined => issues[field];

  const toggleInList = (list: "interests" | "languages", value: string) => {
    setIssues((prev) => {
      const next = { ...prev };
      delete next[list];
      return next;
    });
    setForm((prev) => {
      const current = prev[list];
      return {
        ...prev,
        [list]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
      };
    });
  };

  const toggleLifestyle = (category: string, value: string) => {
    setIssues((prev) => {
      const next = { ...prev };
      delete next.lifestyle;
      return next;
    });
    setForm((prev) => {
      const current = prev.lifestyle[category] ?? [];
      const nextValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const lifestyle = { ...prev.lifestyle };
      // An emptied category is removed rather than stored as []: "no answers" and
      // "the empty list" have to be the same state, or every read has to special-case
      // both.
      if (nextValues.length) lifestyle[category] = nextValues;
      else delete lifestyle[category];
      return { ...prev, lifestyle };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setIssues({});
    try {
      const saved = await savePreferences(form);
      // Take the server's normalised copy, not what was sent. It contains canonical
      // values and any repairs, so the chips shown afterwards are what is actually
      // stored rather than what was asked for.
      setForm(saved);
      toast.success("Preferences saved");
    } catch (err) {
      if (err instanceof PreferenceValidationError) {
        const map: Record<string, string> = {};
        for (const issue of err.issues) {
          // First complaint per field wins: a field with three problems should show
          // one line, not three.
          if (!map[issue.field]) map[issue.field] = issue.message;
        }
        setIssues(map);
        toast.error(err.message);
      } else {
        toast.error("Could not save your preferences. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  /**
   * Ask the browser for a position, once, and store it for distance sorting.
   *
   * A refusal is a normal outcome, not an error: most people decline, and the page
   * still works without it (distance simply stops being rankable). So the failure
   * path says so plainly instead of showing an error the user cannot act on.
   */
  const handleUseLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await saveLocation(position.coords.latitude, position.coords.longitude);
          setHasLocation(true);
          toast.success("Location saved for distance sorting");
        } catch {
          toast.error("Could not save your location.");
        } finally {
          setLocating(false);
        }
      },
      (geoError) => {
        setLocating(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          toast("You can keep using preferences without sharing a location.", { icon: <MapPin /> });
        } else {
          toast.error("Could not read your location. Please try again.");
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const handleClearLocation = async () => {
    try {
      await clearLocation();
      setHasLocation(false);
      toast.success("Location removed");
    } catch {
      toast.error("Could not remove your location.");
    }
  };

  /** Distances offered, with the "Anywhere" sentinel turned into a labelled row. */
  const distanceChoices = useMemo(() => {
    if (!options) return [] as Array<{ value: number; label: string }>;
    return [
      ...options.distances.map((km) => ({ value: km, label: `${km} km` })),
      { value: options.anywhereKm, label: "Anywhere" },
    ];
  }, [options]);

  const ageRange = useMemo(
    () => ({ min: options?.limits.minAge ?? 18, max: options?.limits.maxAge ?? 100 }),
    [options],
  );

  /** Age values offered in the two selects: every year inside the legal range. */
  const ageChoices = useMemo(
    () => Array.from({ length: ageRange.max - ageRange.min + 1 }, (_, i) => ageRange.min + i),
    [ageRange],
  );

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 py-8">
        <div className="glass-card p-6 animate-pulse h-24" />
        <div className="glass-card p-6 animate-pulse h-40" />
        <div className="glass-card p-6 animate-pulse h-40" />
        <span className="sr-only">Loading your preferences</span>
      </div>
    );
  }

  if (loadError || !options) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <GlassCard variant="elevated" padding="lg">
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <AlertCircle className="w-8 h-8 text-red-500" aria-hidden="true" />
            <p className="text-surface-700 dark:text-surface-300">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 px-4 py-2 rounded-xl bg-primary-500 text-white font-medium text-sm hover:bg-primary-600 transition-colors"
            >
              Try again
            </button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const selectedInterestLabels = form.interests.length;
  const selectedLanguageLabels = form.languages.length;
  const lifestyleAnswerCount = Object.values(form.lifestyle).reduce((n, list) => n + list.length, 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>

      <AnimatedPage>
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Who you want to meet</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
            These decide who appears in your Discover feed and in what order.
          </p>
        </div>

        {/* Distance -------------------------------------------------------- */}
        <Section
          title="Distance"
          description="How far from you someone can be. Closer profiles are shown first."
        >
          <div className="flex flex-wrap gap-2">
            {distanceChoices.map((choice) => (
              <Chip
                key={choice.value}
                label={choice.label}
                selected={form.distanceKm === choice.value}
                onToggle={() => {
                  setForm((prev) => ({ ...prev, distanceKm: choice.value }));
                  setIssues((prev) => {
                    const next = { ...prev };
                    delete next.distanceKm;
                    return next;
                  });
                }}
              />
            ))}
          </div>
          <FieldError message={issueFor("distanceKm")} />

          <div className="mt-5 pt-4 border-t border-surface-100 dark:border-surface-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-surface-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-surface-500" aria-hidden="true" />
                  Use my location for distance
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                  {hasLocation
                    ? "Saved. Used only to sort your feed - never shown to other people."
                    : "Not shared. Without it, distance is not used to rank results."}
                </p>
              </div>
              {hasLocation ? (
                <button
                  type="button"
                  onClick={() => void handleClearLocation()}
                  className="shrink-0 inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleUseLocation}
                  disabled={locating}
                  className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 transition-colors"
                >
                  {locating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      Locating...
                    </>
                  ) : (
                    "Share"
                  )}
                </button>
              )}
            </div>
          </div>
        </Section>

        {/* Age ------------------------------------------------------------- */}
        <Section title="Age range" description="Who you want to see in your feed.">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">
                From
              </span>
              <select
                value={form.ageMin}
                onChange={(e) => {
                  const nextMin = Number(e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    ageMin: nextMin,
                    // Keep the range coherent as it is edited. Without this the form
                    // can hold min > max and only fail on save, which reads as the
                    // server being wrong rather than the control.
                    ageMax: Math.max(nextMin, prev.ageMax),
                  }));
                  setIssues((prev) => {
                    const next = { ...prev };
                    delete next.ageMin;
                    return next;
                  });
                }}
                className="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2.5 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              >
                {ageChoices.map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">
                To
              </span>
              <select
                value={form.ageMax}
                onChange={(e) => {
                  const nextMax = Number(e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    ageMax: nextMax,
                    ageMin: Math.min(prev.ageMin, nextMax),
                  }));
                  setIssues((prev) => {
                    const next = { ...prev };
                    delete next.ageMax;
                    return next;
                  });
                }}
                className="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2.5 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              >
                {ageChoices.map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FieldError message={issueFor("ageMin") ?? issueFor("ageMax")} />
        </Section>

        {/* Interests ------------------------------------------------------- */}
        <Section
          title="Interests"
          description="Pick as many as you like. Shared interests raise someone higher."
        >
          <div className="flex flex-wrap gap-2">
            {options.options.interests.map((option: PreferenceOption) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={form.interests.includes(option.value)}
                onToggle={() => toggleInList("interests", option.value)}
              />
            ))}
          </div>
          <FieldError message={issueFor("interests")} />
          {selectedInterestLabels > 0 && (
            <p className="text-xs text-surface-500 mt-3">
              {selectedInterestLabels} selected
            </p>
          )}
        </Section>

        {/* Languages ------------------------------------------------------- */}
        <Section
          title="Languages"
          description="A shared language is a strong signal - you can both actually talk."
        >
          <div className="flex flex-wrap gap-2">
            {options.options.languages.map((option: PreferenceOption) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={form.languages.includes(option.value)}
                onToggle={() => toggleInList("languages", option.value)}
              />
            ))}
          </div>
          <FieldError message={issueFor("languages")} />
          {selectedLanguageLabels > 0 && (
            <p className="text-xs text-surface-500 mt-3">{selectedLanguageLabels} selected</p>
          )}
        </Section>

        {/* Lifestyle ------------------------------------------------------- */}
        <Section
          title="Lifestyle"
          description="Optional. Only the questions you answer affect who you see."
        >
          <div className="space-y-5">
            {options.options.lifestyle.map((group) => (
              <div key={group.category}>
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200 mb-2">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option: PreferenceOption) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      selected={(form.lifestyle[group.category] ?? []).includes(option.value)}
                      onToggle={() => toggleLifestyle(group.category, option.value)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <FieldError message={issueFor("lifestyle")} />
          {lifestyleAnswerCount === 0 && options.options.lifestyle.length > 0 && (
            <p className="text-xs text-surface-500 mt-4">
              Skipping these is fine. Answered questions only ever narrow your feed.
            </p>
          )}
        </Section>
      </AnimatedPage>

      {/*
        Sticky footer rather than a button at the bottom of a long form: on a phone
        the last lifestyle group can sit below the fold, and a Save that requires
        scrolling back up is a Save that gets forgotten. pb-28 on the container keeps
        the last chip clear of this bar.
      */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/90 dark:bg-surface-900/90 backdrop-blur border-t border-surface-100 dark:border-surface-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-xs text-surface-500 dark:text-surface-400 min-w-0 truncate">
            {lifestyleAnswerCount > 0 || selectedInterestLabels > 0
              ? "Applies to your next Discover refresh"
              : "Nothing selected yet"}
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-white font-semibold text-sm hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                Save preferences
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PreferencesPage;