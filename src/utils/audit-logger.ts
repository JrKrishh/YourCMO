import { createLogger } from './logger';

const auditLog = createLogger('Audit');

/**
 * Categories of auditable operations.
 */
export enum AuditCategory {
  API_KEY_ACCESS = 'API_KEY_ACCESS',
  CAMPAIGN_CREATION = 'CAMPAIGN_CREATION',
  CAMPAIGN_MODIFICATION = 'CAMPAIGN_MODIFICATION',
  AD_SPEND = 'AD_SPEND',
  AUTHENTICATION = 'AUTHENTICATION',
  CONTENT_PUBLISH = 'CONTENT_PUBLISH',
  CONFIGURATION_CHANGE = 'CONFIGURATION_CHANGE',
}

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  actor?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Log an auditable operation. Always logged at 'info' level
 * regardless of the global log level to ensure audit trail completeness.
 */
export function audit(
  category: AuditCategory,
  action: string,
  details?: Record<string, unknown>,
  actor?: string,
): AuditEntry {
  const entry: AuditEntry = {
    category,
    action,
    actor,
    resourceId: details?.resourceId as string | undefined,
    details,
    timestamp: new Date(),
  };

  auditLog.info({ audit: entry }, `[AUDIT] ${category}: ${action}`);
  return entry;
}

/**
 * Convenience helpers for common audit events.
 */
export const auditEvents = {
  apiKeyAccessed(keyName: string, actor?: string) {
    return audit(AuditCategory.API_KEY_ACCESS, `Accessed API key: ${keyName}`, { keyName }, actor);
  },

  campaignCreated(campaignId: string, campaignName: string, actor?: string) {
    return audit(
      AuditCategory.CAMPAIGN_CREATION,
      `Campaign created: ${campaignName}`,
      { resourceId: campaignId, campaignName },
      actor,
    );
  },

  adSpendAllocated(campaignId: string, amount: number, currency: string, actor?: string) {
    return audit(
      AuditCategory.AD_SPEND,
      `Ad spend allocated: ${amount} ${currency}`,
      { resourceId: campaignId, amount, currency },
      actor,
    );
  },

  contentPublished(contentId: string, platform: string, actor?: string) {
    return audit(
      AuditCategory.CONTENT_PUBLISH,
      `Content published to ${platform}`,
      { resourceId: contentId, platform },
      actor,
    );
  },

  authenticationAttempt(platform: string, success: boolean, actor?: string) {
    return audit(
      AuditCategory.AUTHENTICATION,
      `Authentication ${success ? 'succeeded' : 'failed'} for ${platform}`,
      { platform, success },
      actor,
    );
  },

  configurationChanged(setting: string, actor?: string) {
    return audit(
      AuditCategory.CONFIGURATION_CHANGE,
      `Configuration changed: ${setting}`,
      { setting },
      actor,
    );
  },
};
