/**
 * Minimal CLI command parser.
 * Parses process.argv-style arrays into structured commands.
 */

/** Parsed CLI command */
export interface ParsedCommand {
  command: string;
  subcommand?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse an argv-style array into a structured command.
 * Supports --flag, --flag=value, and --flag value patterns.
 *
 * @param argv - Array of arguments (typically process.argv.slice(2))
 */
export function parseArgs(argv: string[]): ParsedCommand {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = '';
  let subcommand: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // Check if next arg is a value (not a flag)
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (!command) {
      command = arg;
    } else if (!subcommand) {
      subcommand = arg;
    } else {
      args.push(arg);
    }

    i++;
  }

  return { command, subcommand, args, flags };
}

/** CLI command definition */
export interface CommandDef {
  name: string;
  description: string;
  subcommands?: SubcommandDef[];
}

/** CLI subcommand definition */
export interface SubcommandDef {
  name: string;
  description: string;
  flags?: FlagDef[];
}

/** CLI flag definition */
export interface FlagDef {
  name: string;
  description: string;
  required?: boolean;
}

/**
 * Format help text for all registered commands.
 */
export function formatHelp(programName: string, commands: CommandDef[]): string {
  const lines: string[] = [
    `Usage: ${programName} <command> [subcommand] [options]`,
    '',
    'Commands:',
  ];

  for (const cmd of commands) {
    lines.push(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        lines.push(`    ${sub.name.padEnd(18)} ${sub.description}`);
      }
    }
  }

  lines.push('');
  lines.push('Options:');
  lines.push('  --help               Show help');
  lines.push('  --version            Show version');

  return lines.join('\n');
}
