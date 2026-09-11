import { useEffect, useState } from "react";
import { onboardingApi, type CoachOptions } from "../../api/onboarding";

export function useCoachOptions() {
  const [options, setOptions] = useState<CoachOptions | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOptions(null);
    void onboardingApi.options().then(value => { if (active) setOptions(value); })
      .catch(() => { if (active) setOptions({ available: false, turnstileSiteKey: null }); });
    return () => { active = false; };
  }, [attempt]);
  return { options, retry: () => setAttempt(value => value + 1) };
}
