import { useRunTempDir } from "./test-temp.ts";

// Runs once before the workers start, so they inherit the run's temp folder.
export default function setup(): () => void {
  return useRunTempDir();
}
