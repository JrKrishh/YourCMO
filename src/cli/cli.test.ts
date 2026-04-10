import { describe, it, expect, beforeEach } from 'vitest';
import { parseArgs, formatHelp } from './command-parser';
import { executeCli, CliDeps } from './cli';
import { CampaignManager } from '../engines/campaign-manager';
import { CampaignStore } from '../engines/campaign-manager/campaign-store';
import { CampaignMetricsCollector } from '../engines/campaign-manager/campaign-metrics-collector';
import { CampaignType, CampaignStatus } from '../models';

// --- Command parser tests ---

describe('parseArgs', () => {
  it('parses a simple command', () => {
    const result = parseArgs(['campaign', 'list']);
    expect(result.command).toBe('campaign');
    expect(result.subcommand).toBe('list');
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it('parses flags with values', () => {
    const result = parseArgs(['campaign', 'create', '--name', 'Test', '--type', 'WHATSAPP']);
    expect(result.command).toBe('campaign');
    expect(result.subcommand).toBe('create');
    expect(result.flags.name).toBe('Test');
    expect(result.flags.type).toBe('WHATSAPP');
  });

  it('parses --flag=value syntax', () => {
    const result = parseArgs(['campaign', 'create', '--name=Test Campaign']);
    expect(result.flags.name).toBe('Test Campaign');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['--help']);
    expect(result.flags.help).toBe(true);
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    expect(result.command).toBe('');
    expect(result.subcommand).toBeUndefined();
  });

  it('collects extra positional args', () => {
    const result = parseArgs(['campaign', 'create', 'extra1', 'extra2']);
    expect(result.args).toEqual(['extra1', 'extra2']);
  });
});

describe('formatHelp', () => {
  it('includes program name and commands', () => {
    const help = formatHelp('smma', [
      { name: 'test', description: 'A test command' },
    ]);
    expect(help).toContain('smma');
    expect(help).toContain('test');
    expect(help).toContain('A test command');
  });
});

// --- CLI execution tests ---

function makeDeps(): CliDeps {
  const store = new CampaignStore();
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    campaignManager: new CampaignManager(store),
    metricsCollector: new CampaignMetricsCollector(),
    output: {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
    },
    _logs: logs,
    _errors: errors,
  } as CliDeps & { _logs: string[]; _errors: string[] };
}

type TestDeps = CliDeps & { _logs: string[]; _errors: string[] };

describe('CLI execution', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = makeDeps() as TestDeps;
  });

  it('shows help with --help flag', () => {
    const code = executeCli(parseArgs(['--help']), deps);
    expect(code).toBe(0);
    expect(deps._logs[0]).toContain('Usage:');
  });

  it('shows help with no command', () => {
    const code = executeCli(parseArgs([]), deps);
    expect(code).toBe(0);
    expect(deps._logs[0]).toContain('Usage:');
  });

  it('shows version', () => {
    const code = executeCli(parseArgs(['--version']), deps);
    expect(code).toBe(0);
    expect(deps._logs[0]).toContain('1.0.0');
  });

  it('returns error for unknown command', () => {
    const code = executeCli(parseArgs(['unknown']), deps);
    expect(code).toBe(1);
    expect(deps._errors[0]).toContain('Unknown command');
  });

  it('shows health status', () => {
    const code = executeCli(parseArgs(['health']), deps);
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.status).toBe('ok');
  });
});

describe('CLI campaign commands', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = makeDeps() as TestDeps;
  });

  it('creates a campaign', () => {
    const code = executeCli(
      parseArgs(['campaign', 'create', '--name', 'Test', '--type', 'WHATSAPP']),
      deps,
    );
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.name).toBe('Test');
    expect(output.status).toBe(CampaignStatus.DRAFT);
  });

  it('fails to create without name', () => {
    const code = executeCli(
      parseArgs(['campaign', 'create', '--type', 'WHATSAPP']),
      deps,
    );
    expect(code).toBe(1);
    expect(deps._errors[0]).toContain('--name');
  });

  it('fails to create with invalid type', () => {
    const code = executeCli(
      parseArgs(['campaign', 'create', '--name', 'Test', '--type', 'INVALID']),
      deps,
    );
    expect(code).toBe(1);
    expect(deps._errors[0]).toContain('--type');
  });

  it('lists campaigns', () => {
    deps.campaignManager.createCampaign({ name: 'C1', type: CampaignType.WHATSAPP });
    const code = executeCli(parseArgs(['campaign', 'list']), deps);
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.total).toBe(1);
  });

  it('gets a campaign by ID', () => {
    const campaign = deps.campaignManager.createCampaign({
      name: 'C1',
      type: CampaignType.WHATSAPP,
    });
    const code = executeCli(
      parseArgs(['campaign', 'get', '--id', campaign.campaignId]),
      deps,
    );
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.campaignId).toBe(campaign.campaignId);
  });

  it('fails to get without --id', () => {
    const code = executeCli(parseArgs(['campaign', 'get']), deps);
    expect(code).toBe(1);
    expect(deps._errors[0]).toContain('--id');
  });

  it('updates campaign status', () => {
    const campaign = deps.campaignManager.createCampaign({
      name: 'C1',
      type: CampaignType.WHATSAPP,
    });
    const code = executeCli(
      parseArgs(['campaign', 'status', '--id', campaign.campaignId, '--status', 'ACTIVE']),
      deps,
    );
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.status).toBe(CampaignStatus.ACTIVE);
  });

  it('gets campaign metrics', () => {
    const campaign = deps.campaignManager.createCampaign({
      name: 'C1',
      type: CampaignType.WHATSAPP,
    });
    const code = executeCli(
      parseArgs(['campaign', 'metrics', '--id', campaign.campaignId]),
      deps,
    );
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.metrics).toBeDefined();
  });

  it('returns error for unknown subcommand', () => {
    const code = executeCli(parseArgs(['campaign', 'unknown']), deps);
    expect(code).toBe(1);
    expect(deps._errors[0]).toContain('Unknown campaign subcommand');
  });
});

describe('CLI config commands', () => {
  let deps: TestDeps;

  beforeEach(() => {
    deps = makeDeps() as TestDeps;
  });

  it('shows config', () => {
    const code = executeCli(parseArgs(['config', 'show']), deps);
    expect(code).toBe(0);
    const output = JSON.parse(deps._logs[0]);
    expect(output.environment).toBeDefined();
  });

  it('validates config', () => {
    const code = executeCli(parseArgs(['config', 'validate']), deps);
    expect(code).toBe(0);
    expect(deps._logs[0]).toContain('valid');
  });

  it('returns error for unknown config subcommand', () => {
    const code = executeCli(parseArgs(['config', 'unknown']), deps);
    expect(code).toBe(1);
  });
});
