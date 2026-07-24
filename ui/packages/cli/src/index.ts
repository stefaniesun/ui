#!/usr/bin/env node
import { createCli } from './program.js'
await createCli().parseAsync(process.argv)
