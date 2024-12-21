import chalk from "chalk";
import { confirm, search } from "https://esm.sh/@inquirer/prompts@7.2.1";
import { SSHClient } from "./SSHClient.ts";
import { config } from "./config.ts";

export async function main() {
  const client = new SSHClient(config);

  await client.connect();

  while (true) {
    const choice = await search({
      message: "Select an album",
      source: async (input) => {
        if (!input) return [];

        const response = await client.listFiles({ query: input });

        return response.map((item) => ({
          name: item.path(),
          value: item,
        }));
      },
    });

    if (!choice) break;

    const confirmed = await confirm({
      message: `Are you sure you want to download ${chalk.cyan(
        choice.filename
      )}?`,
    });

    if (!confirmed) continue;

    await client.downloadItem(choice);

    console.log(
      `Downloaded ${chalk.cyan(choice.path())} to ${chalk.cyan(
        config.localWorkingDirectory
      )}`
    );

    await confirm({
      message: `Are you done editing?`,
    });

    await client.uploadItem(choice);

    console.log(
      `Uploaded ${chalk.cyan(choice.path())} to ${chalk.cyan(
        config.remoteWorkingDirectory
      )}`
    );
  }
}

main();
