import { describe, it, expect } from 'vitest';
import { buildDefaultCMOPersona } from './rewoz-brand-dna';

describe('buildDefaultCMOPersona', () => {
  const persona = buildDefaultCMOPersona();

  it('should return a valid CMOPersona with all required fields', () => {
    expect(persona).toHaveProperty('role');
    expect(persona).toHaveProperty('strategicPriorities');
    expect(persona).toHaveProperty('decisionPrinciples');
    expect(persona).toHaveProperty('competitiveContext');
    expect(persona).toHaveProperty('brandPositioning');
    expect(typeof persona.role).toBe('string');
    expect(Array.isArray(persona.strategicPriorities)).toBe(true);
    expect(Array.isArray(persona.decisionPrinciples)).toBe(true);
    expect(typeof persona.competitiveContext).toBe('string');
    expect(typeof persona.brandPositioning).toBe('string');
  });

  it('should have a CMO role', () => {
    expect(persona.role).toContain('Chief Marketing Officer');
  });

  it('should include strategic priorities', () => {
    expect(persona.strategicPriorities.length).toBeGreaterThanOrEqual(3);
  });

  it('should include decision principles', () => {
    expect(persona.decisionPrinciples.length).toBeGreaterThanOrEqual(3);
  });
});
