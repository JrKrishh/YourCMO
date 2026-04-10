/**
 * Error context tracking for structured error reporting.
 */
export interface ErrorContext {
  component: string;
  operation: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Base error class for all agent errors.
 * Provides structured context tracking and serialization.
 */
export class AgentError extends Error {
  public readonly context: ErrorContext;
  public readonly cause?: Error;

  constructor(message: string, context: Partial<ErrorContext> & { component: string }, cause?: Error) {
    super(message);
    this.name = 'AgentError';
    this.context = {
      component: context.component,
      operation: context.operation ?? 'unknown',
      timestamp: context.timestamp ?? new Date(),
      metadata: context.metadata,
    };
    this.cause = cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      cause: this.cause ? { name: this.cause.name, message: this.cause.message } : undefined,
    };
  }
}

export class TrendAnalysisError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'TrendAnalysisEngine', ...context }, cause);
    this.name = 'TrendAnalysisError';
  }
}

export class ContentGenerationError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'ContentGenerationEngine', ...context }, cause);
    this.name = 'ContentGenerationError';
  }
}

export class VisualAssetError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'VisualAssetCreator', ...context }, cause);
    this.name = 'VisualAssetError';
  }
}

export class PlatformIntegrationError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'PlatformIntegration', ...context }, cause);
    this.name = 'PlatformIntegrationError';
  }
}

export class CampaignManagerError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'CampaignManager', ...context }, cause);
    this.name = 'CampaignManagerError';
  }
}

export class OptimizationError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'OptimizationEngine', ...context }, cause);
    this.name = 'OptimizationError';
  }
}

export class ConfigurationError extends AgentError {
  constructor(message: string, context: Partial<ErrorContext>, cause?: Error) {
    super(message, { component: 'Configuration', ...context }, cause);
    this.name = 'ConfigurationError';
  }
}
