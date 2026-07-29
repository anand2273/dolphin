import { Spinner } from "@/components/ui/spinner";

export default function ClassLoading() {
  return (
    <main className="mx-auto flex max-w-3xl items-center justify-center gap-3 p-6 py-24 text-sm text-muted-foreground">
      <Spinner size="lg" />
      Loading this class…
    </main>
  );
}
