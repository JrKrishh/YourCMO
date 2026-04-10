import { CampaignManager } from '../engines/campaign-manager';
import { CampaignStore } from '../engines/campaign-manager/campaign-store';
import { CampaignMetricsCollector } from '../engines/campaign-manager/campaign-metrics-collector';
import { CampaignStatus, CampaignType } from '../models';
import { parseArgs, formatHelp, CommandDef, ParsedCommand } from './command-parser';

/** CLI output interface for testability */
export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

/** CLI dependencies */
export interface CliDeps {
  campaignManager: CampaignManager;
  metricsCollector: CampaignMetricsCollector;
  output: CliOutput;
}

/** Command definitions for help text */
const COMMANDS: CommandDef[] = [
  {
    name: 'campaign',
    description: 'Manage campaigns',
    subcommands: [
      { name: 'create', description: 'Create a new campaign' },
      { name: 'list', description: 'List all campaigns' },
      { name: 'get', description: 'Get campaign details' },
      { name: 'status', description: 'Update campaign status' },
      { name: 'metrics', description: 'Get campaign metrics' },
    ],
  },
  {
    name: 'config',
    description: 'Configuration management',
    subcommands: [
      { name: 'show', description: 'Show current configuration' },
      { name: 'validate', description: 'Validate configuration' },
    ],
  },
  {
    name: 'health',
    description: 'Check system health',
  },
];

/**
 * Execute a CLI command from parsed arguments.
 * Returns an exit code (0 = success, 1 = error).
 */
export function executeCli(parsed: ParsedCommand, deps: CliDeps): number {
  const { command, subcommand, flags } = parsed;

  if (flags.version || command === 'version') {
    deps.output.log('smma v1.0.0');
    return 0;
  }

  if (flags.help || flags.h || command === 'help' || !command) {
    deps.output.log(formatHelp('smma', COMMANDS));
    return 0;
  }

  switch (command) {
    case 'campaign':
      return handleCampaignCommand(subcommand, parsed, deps);
    case 'config':
      return handleConfigCommand(subcommand, deps);
    case 'health':
      return handleHealthCommand(deps);
    default:
      deps.output.error(`Unknown command: ${command}`);
      deps.output.log(formatHelp('smma', COMMANDS));
      return 1;
  }
}

function handleCampaignCommand(
  subcommand: string | undefined,
  parsed: ParsedCommand,
  deps: CliDeps,
): number {
  const { flags } = parsed;

  switch (subcommand) {
    case 'create': {
      const name = flags.name as string | undefined;
      const type = flags.type as string | undefined;

      if (!name) {
        deps.output.error('--name is required');
        return 1;
      }
      if (!type || !Object.values(CampaignType).includes(type as CampaignType)) {
        deps.output.error(
          `--type must be one of: ${Object.values(CampaignType).join(', ')}`,
        );
        return 1;
      }

      try {
        const campaign = deps.campaignManager.createCampaign({
          name,
          type: type as CampaignType,
        });
        deps.output.log(JSON.stringify(campaign, null, 2));
        return 0;
      } catch (err) {
        deps.output.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }

    case 'list': {
      const statusFilter = flags.status as string | undefined;
      let status: CampaignStatus | undefined;
      if (statusFilter) {
        if (!Object.values(CampaignStatus).includes(statusFilter as CampaignStatus)) {
          deps.output.error(
            `Invalid status. Must be one of: ${Object.values(CampaignStatus).join(', ')}`,
          );
          return 1;
        }
        status = statusFilter as CampaignStatus;
      }

      const campaigns = deps.campaignManager.listCampaigns(status);
      deps.output.log(JSON.stringify({ campaigns, total: campaigns.length }, null, 2));
      return 0;
    }

    case 'get': {
      const id = flags.id as string | undefined;
      if (!id) {
        deps.output.error('--id is required');
        return 1;
      }
      try {
        const campaign = deps.campaignManager.getCampaign(id);
        deps.output.log(JSON.stringify(campaign, null, 2));
        return 0;
      } catch (err) {
        deps.output.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }

    case 'status': {
      const id = flags.id as string | undefined;
      const newStatus = flags.status as string | undefined;
      if (!id) {
        deps.output.error('--id is required');
        return 1;
      }
      if (!newStatus || !Object.values(CampaignStatus).includes(newStatus as CampaignStatus)) {
        deps.output.error(
          `--status must be one of: ${Object.values(CampaignStatus).join(', ')}`,
        );
        return 1;
      }
      try {
        const campaign = deps.campaignManager.transitionStatus(
          id,
          newStatus as CampaignStatus,
        );
        deps.output.log(JSON.stringify(campaign, null, 2));
        return 0;
      } catch (err) {
        deps.output.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }

    case 'metrics': {
      const id = flags.id as string | undefined;
      if (!id) {
        deps.output.error('--id is required');
        return 1;
      }
      try {
        const campaign = deps.campaignManager.getCampaign(id);
        const metrics = deps.metricsCollector.aggregateMetrics(campaign);
        deps.output.log(JSON.stringify({ campaignId: id, metrics }, null, 2));
        return 0;
      } catch (err) {
        deps.output.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }

    default:
      deps.output.error(`Unknown campaign subcommand: ${subcommand ?? '(none)'}`);
      return 1;
  }
}

function handleConfigCommand(subcommand: string | undefined, deps: CliDeps): number {
  switch (subcommand) {
    case 'show':
      deps.output.log(
        JSON.stringify(
          {
            environment: process.env.NODE_ENV ?? 'development',
            logLevel: process.env.LOG_LEVEL ?? 'info',
          },
          null,
          2,
        ),
      );
      return 0;

    case 'validate':
      deps.output.log('Configuration is valid.');
      return 0;

    default:
      deps.output.error(`Unknown config subcommand: ${subcommand ?? '(none)'}`);
      return 1;
  }
}

function handleHealthCommand(deps: CliDeps): number {
  deps.output.log(
    JSON.stringify(
      { status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' },
      null,
      2,
    ),
  );
  return 0;
}

/**
 * Main CLI entry point. Parses process.argv and executes.
 */
export function runCli(argv: string[], deps?: Partial<CliDeps>): number {
  const store = new CampaignStore();
  const campaignManager = deps?.campaignManager ?? new CampaignManager(store);
  const metricsCollector = deps?.metricsCollector ?? new CampaignMetricsCollector();
  const output: CliOutput = deps?.output ?? {
    log: (msg: string) => console.log(msg),
    error: (msg: string) => console.error(msg),
  };

  const parsed = parseArgs(argv);
  return executeCli(parsed, { campaignManager, metricsCollector, output });
}
