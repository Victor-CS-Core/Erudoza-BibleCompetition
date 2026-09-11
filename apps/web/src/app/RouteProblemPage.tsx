import { useAuth } from "../auth/AuthContext";
import { Button, LinkButton, PageHeader } from "../components/ui";
import "../styles/training-public.css";

export function RouteProblemPage({ notFound = false }: { notFound?: boolean }) {
  const { me } = useAuth();
  const home = me ? me.kind === "Student" ? "/student" : "/admin" : "/";
  return <main className="training-public public-recovery"><section>
    <PageHeader title={notFound ? "This page isn’t available" : "Something interrupted this page"} description={notFound ? "The link may be outdated. Return to your home page to continue." : "Try loading the page again. Your saved work is still available from your home page."} />
    <div className="public-actions">{!notFound && <Button onClick={() => window.location.reload()}>Reload page</Button>}<LinkButton variant={notFound ? "primary" : "secondary"} to={home}>Back to home</LinkButton></div>
  </section></main>;
}
