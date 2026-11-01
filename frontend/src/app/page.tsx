import { Dashboard } from "@/components/Dashboard";
import type { Assembly } from "@/types/assembly";
import demoAssembly from "../../../data/assemblies/demo-lego.json";

// Single source of truth, imported on the server and type-checked at build time.
const assembly: Assembly = demoAssembly;

export default async function Home({ searchParams }: {
  searchParams: Promise<{ project?: string | string[]; step?: string | string[] }>;
}) {
  const params = await searchParams;
  return <Dashboard initialStepId={typeof params.step === "string" ? params.step : ""} assembly={assembly} initialProjectId={typeof params.project === "string" ? params.project : ""} />;
}
