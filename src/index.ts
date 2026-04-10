#!/usr/bin/env node

import { cancel, intro, isCancel, outro, select } from "@clack/prompts";
import pc from "picocolors";

type Choice = "hello" | "world";

intro(pc.bold(pc.cyan("astro-style line chooser")));

const choice = await select<Choice>({
  message: pc.dim("Pick one line to print:"),
  options: [
    { value: "hello", label: pc.cyan("Print hello") },
    { value: "world", label: pc.magenta("Print world") }
  ]
});

if (isCancel(choice)) {
  cancel(pc.yellow("Canceled."));
  process.exit(0);
}

if (choice === "hello") {
  console.log(pc.cyanBright("hello"));
} else {
  console.log(pc.magentaBright("world"));
}

outro(pc.dim("Done."));
