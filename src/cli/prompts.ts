import * as p from "@clack/prompts";

export async function promptProjectSelection(
  projects: string[]
): Promise<string> {
  const choice = await p.select({
    message: "Multiple projects detected. Which one to analyze?",
    options: projects.map((name) => ({ value: name, label: name })),
  });
  if (p.isCancel(choice)) {
    p.cancel("Analysis cancelled.");
    process.exit(1);
  }
  return choice as string;
}
