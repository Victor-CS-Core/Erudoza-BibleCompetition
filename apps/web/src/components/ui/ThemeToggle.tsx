import { AppIcon } from "../AppIcon";
import { useTheme } from "../../theme";

/** Binary dark-mode switch in the top bar: a sun icon on the left, a moon icon
 *  on the right, and a real toggle track between them. Flipping it pins an
 *  explicit light/dark preference; until touched, the app follows the phone. */
export function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Dark theme is on. Switch to light theme." : "Dark theme is off. Switch to dark theme."}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="command-theme-toggle"
      onClick={() => setPreference(dark ? "light" : "dark")}
    >
      <AppIcon name="sun" />
      <span className="ds-switch-track" aria-hidden="true" />
      <AppIcon name="moon" />
    </button>
  );
}
