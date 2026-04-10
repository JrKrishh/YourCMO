import { describe, it, expect } from 'vitest';
import { audit, auditEvents, AuditCategory } from './audit-logger';

describe('audit', () => {
  it('creates an audit entry with required fields', () => {
    const entry = audit(AuditCategory.API_KEY_ACCESS, 'test action');
    expect(entry.category).toBe(AuditCategory.API_KEY_ACCESS);
    expect(entry.action).toBe('test action');
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('includes optional details and actor', () => {
    const entry = audit(AuditCategory.AD_SPEND, 'spend', { amount: 100 }, 'user1');
    expect(entry.details).toEqual({ amount: 100 });
    expect(entry.actor).toBe('user1');
  });

  it('extracts resourceId from details', () => {
    const entry = audit(AuditCategory.CAMPAIGN_CREATION, 'create', { resourceId: 'camp-123' });
    expect(entry.resourceId).toBe('camp-123');
  });
});

describe('auditEvents', () => {
  it('apiKeyAccessed creates correct entry', () => {
    const entry = auditEvents.apiKeyAccessed('OPENAI_KEY', 'admin');
    expect(entry.category).toBe(AuditCategory.API_KEY_ACCESS);
    expect(entry.action).toContain('OPENAI_KEY');
    expect(entry.actor).toBe('admin');
  });

  it('campaignCreated creates correct entry', () => {
    const entry = auditEvents.campaignCreated('c-1', 'Summer Sale');
    expect(entry.category).toBe(AuditCategory.CAMPAIGN_CREATION);
    expect(entry.resourceId).toBe('c-1');
    expect(entry.action).toContain('Summer Sale');
  });

  it('adSpendAllocated creates correct entry', () => {
    const entry = auditEvents.adSpendAllocated('c-1', 500, 'USD');
    expect(entry.category).toBe(AuditCategory.AD_SPEND);
    expect(entry.details?.amount).toBe(500);
    expect(entry.details?.currency).toBe('USD');
  });

  it('contentPublished creates correct entry', () => {
    const entry = auditEvents.contentPublished('content-1', 'INSTAGRAM');
    expect(entry.category).toBe(AuditCategory.CONTENT_PUBLISH);
    expect(entry.action).toContain('INSTAGRAM');
  });

  it('authenticationAttempt logs success', () => {
    const entry = auditEvents.authenticationAttempt('Facebook', true);
    expect(entry.category).toBe(AuditCategory.AUTHENTICATION);
    expect(entry.action).toContain('succeeded');
  });

  it('authenticationAttempt logs failure', () => {
    const entry = auditEvents.authenticationAttempt('Facebook', false);
    expect(entry.action).toContain('failed');
  });

  it('configurationChanged creates correct entry', () => {
    const entry = auditEvents.configurationChanged('LOG_LEVEL');
    expect(entry.category).toBe(AuditCategory.CONFIGURATION_CHANGE);
    expect(entry.action).toContain('LOG_LEVEL');
  });
});
