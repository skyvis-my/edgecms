import { runMain } from "cf";

try {
  await runMain(process.argv.slice(2));
  process.exit(0);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") {
    process.exit(error.code);
  }
  process.exit(1);
}
