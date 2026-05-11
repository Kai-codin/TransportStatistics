import CompletionClient from "./CompletionClient";

type CompletionPageProps = {
  searchParams?: Promise<{
    operator?: string;
    name?: string;
    code?: string;
  }>;
};

export default async function CompletionPage({ searchParams }: CompletionPageProps) {
  const params = (await searchParams) ?? {};

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 min-h-screen">
      <CompletionClient
        operatorSlug={params.operator ?? null}
        operatorName={params.name ?? ""}
        operatorCode={params.code ?? ""}
      />
    </div>
  );
}