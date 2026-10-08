import { useState, type ReactNode } from "react";
import { Panel, SpinnablePatch } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import "./honor-patch-card.css";

/** Shared Laurel Honor back art revealed when an achievement patch spins. */
const PATCH_BACK_SRC = "/brand/honors/patch-back-256.webp";
const PATCH_BACK_SRCSET = "/brand/honors/patch-back-256.webp 256w, /brand/honors/patch-back-512.webp 512w";

/**
 * Art-first honor card shared by every honor collection in the app.
 * The patch artwork fills the card; the title and a status badge sit below it.
 * Tapping the artwork opens a modal with the full description, requirements
 * and the context action, so the art stays the hero on the card itself.
 */
export function HonorPatchCard({ title, artwork, status, detail }: {
  title: string;
  artwork: ReactNode;
  status?: ReactNode;
  detail: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <Panel as="article" className="honor-patch-card">
      <button type="button" className="honor-patch-card__art" onClick={() => setOpen(true)} aria-label={`${title}: view details`}>
        <SpinnablePatch front={artwork} back={<img src={PATCH_BACK_SRC} srcSet={PATCH_BACK_SRCSET} alt="" width={208} height={208} loading="lazy" decoding="async" draggable={false} />} />
      </button>
      <h2>{title}</h2>
      {status ? <div className="honor-patch-card__status">{status}</div> : null}
    </Panel>
    {open && <TrainingDialog open title={title} onClose={close} className="honor-patch-dialog">
      <div className="honor-patch-detail">{typeof detail === "function" ? detail(close) : detail}</div>
    </TrainingDialog>}
  </>;
}
