import { Link } from "react-router-dom";
import { InstallApp } from "../../features/install/InstallApp";
import { CoffeeFooter } from "../../features/support/CoffeeWidget";
import "./app-footer.css";

type Props = {
  variant?: "workspace" | "public" | "account";
  supportEnabled?: boolean;
};

/** Shared page ending; account pages use a compact version beside the form. */
export function AppFooter({ variant = "workspace", supportEnabled = false }: Props) {
  return <footer className={`app-footer app-footer-${variant}`}>
    <div className="app-footer-inner">
      <div className="app-footer-brand">
        {variant !== "account" && <span className="ds-brand-name">Erudoza</span>}
        <p className="ds-caption">Pathfinder Bible Experience training</p>
      </div>
      <nav className="app-footer-legal" aria-label="Legal">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        {variant === "workspace"
          ? <Link to="/help">Help</Link>
          : <Link to="/wiki">Wiki / Help</Link>}
      </nav>
      <div className="app-footer-actions">
        <InstallApp />
        <CoffeeFooter enabled={supportEnabled} />
      </div>
    </div>
  </footer>;
}