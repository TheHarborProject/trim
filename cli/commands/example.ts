import { UsageError, type CommandHandler } from "../dispatch";
import { buildRegistryExamplePlan, applyRegistryExamplePlan } from "../generators/example-plan";
import { RegistryClient } from "../registry/client";

export async function runExampleCommand(cwd: string, name: string, client = new RegistryClient()): Promise<void> {
  try {
    const plan = await buildRegistryExamplePlan(cwd, name, client);
    await applyRegistryExamplePlan(plan);
    console.log(`Example "${name}" installed in ${plan.destination}. Dependencies have not been installed.`);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Could not install example "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const exampleCommand: CommandHandler = async (args) => {
  if (args.length !== 1 || args[0].startsWith("-")) throw new UsageError("Usage: trim example <name>");
  await runExampleCommand(process.cwd(), args[0]);
};
