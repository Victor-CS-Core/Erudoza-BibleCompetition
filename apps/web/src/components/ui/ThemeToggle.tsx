import { AppIcon } from "../AppIcon";
import { Button } from "./index";
import { useTheme, type ThemePreference } from "../../theme";

const LABELS: Record<ThemePreference, string> = {
  system: "Automatic — follows this phone's theme",
  light: "Light",
  dark: "Dark",
};

const NEXT: Record<ThemePreference, string> = {
  system: "Light",
  light: "Dark",
  dark: "Automatic",
};

/** Theme switch in the top bar beside the notification bell. Cycles
 *  Automatic → Light → Dark; Automatic tracks the phone's dark mode. */
export function ThemeToggle() {
  const { preference, resolved, cycle } = useTheme();
  return (
    <Button
      variant="ghost"
      className="command-theme ds-button-mobile-icon"
      aria-label={`Theme: ${LABELS[preference]}. Switch to ${NEXT[preference]}.`}
      title={`Theme: ${LABELS[preference]}`}
      onClick={cycle}
    >
      <AppIcon name={resolved === "dark" ? "moon" : "sun"} />
      <span className="command-bell-label">{preference === "system" ? "Auto" : preference === "light" ? "Light" : "Dark"}</span>
    </Button>
  );
}
