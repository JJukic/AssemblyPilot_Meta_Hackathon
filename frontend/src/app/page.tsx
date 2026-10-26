import { Dashboard } from "@/components/Dashboard";
import type { Assembly } from "@/types/assembly";
import demoAssembly from "../../../data/assemblies/demo-lego.json";

// Single source of truth, imported on the server and type-checked at build time.
const assembly: Assembly = demoAssembly;

export default function Home() {
  return <Dashboard assembly={assembly} />;
}
