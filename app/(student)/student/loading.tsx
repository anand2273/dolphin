import { Spinner } from "@/components/ui/spinner";
import { Page } from "@/components/page";

export default function StudentLoading() {
  return (
    <Page className="items-center justify-center py-24">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner size="lg" />
        Loading your classes…
      </div>
    </Page>
  );
}
