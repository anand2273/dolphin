import { Spinner } from "@/components/ui/spinner";
import { Page } from "@/components/page";

export default function SessionLoading() {
  return (
    <Page className="items-center justify-center py-24">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner size="lg" />
        Loading this lesson…
      </div>
    </Page>
  );
}
