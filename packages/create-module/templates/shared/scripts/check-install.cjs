// Runs before dev, build and zip: a project whose packages were never installed says so,
// instead of "'vite' is not recognized".
if (!require("node:fs").existsSync("node_modules")) {
  console.error("Run {{install}} first: this project has no node_modules yet.");
  process.exit(1);
}
