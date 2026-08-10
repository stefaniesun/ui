#!/usr/bin/env node
import { Command } from "commander";
import { doctor } from "./doctor.js";
import { initPage } from "./init.js";
import { openWorkbench } from "./open.js";
const program = new Command().name("ui-restore").description("Staged UI restoration workbench");
program.command("init").argument("<pageId>").requiredOption("--image <path>").option("--scale <number>", "physical-to-logical scale", "2").option("--pages-root <path>", "pages directory", "./pages").action((pageId, options) => console.log(`已创建 ${initPage({ pageId, imagePath: options.image, scale: Number(options.scale), pagesRoot: options.pagesRoot }).pageDir}`));
program.command("open").argument("<pageId>").option("--pages-root <path>", "pages directory", "./pages").action((pageId, options) => openWorkbench({ pageId, pagesRoot: options.pagesRoot }));
program.command("doctor").action(() => { const checks = doctor(); if (checks.some((item) => !item.ok && !item.warning)) process.exitCode = 1; });
await program.parseAsync();
