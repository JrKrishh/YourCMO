import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CMOPersona,
  serializeCMOPersona,
  deserializeCMOPersona,
} from './agent-config';

const validPersona: CMOPersona = {
  role: 'Chief Marketing Officer',
  strategicPriorities: ['Grow sign-ups', 'Increase conversion'],
  decisionPrinciples: ['Organic growth first'],
  competitiveContext: 'Competes against delivery apps',
  brandPositioning: 'Affordable zero-commission loyalty platform',
};

describe('serializeCMOPersona', () => {
  it('returns a valid JSON string', () => {
    const json = serializeCMOPersona(validPersona);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips back to the original object', () => {
    const json = serializeCMOPersona(validPersona);
    const result = deserializeCMOPersona(json);
    expect(result).toEqual(validPersona);
  });
});

describe('deserializeCMOPersona', () => {
  it('throws on invalid JSON', () => {
    expect(() => deserializeCMOPersona('not json')).toThrow();
  });

  it('throws listing all missing fields when JSON is empty object', () => {
    expect(() => deserializeCMOPersona('{}')).toThrow(
      'Missing required CMOPersona fields: role, strategicPriorities, decisionPrinciples, competitiveContext, brandPositioning',
    );
  });

  it('throws listing only the missing fields', () => {
    const partial = { role: 'CMO', strategicPriorities: ['a'], decisionPrinciples: ['b'] };
    expect(() => deserializeCMOPersona(JSON.stringify(partial))).toThrow(
      'Missing required CMOPersona fields: competitiveContext, brandPositioning',
    );
  });

  it('does not throw for a valid persona', () => {
    const json = JSON.stringify(validPersona);
    expect(() => deserializeCMOPersona(json)).not.toThrow();
  });
});

// Feature: cmo-agent-persona, Property 4: CMOPersona serialisation round trip
// Validates: Requirements 7.1, 7.2
describe('Property 4: CMOPersona serialisation round trip', () => {
  const arbCMOPersona: fc.Arbitrary<CMOPersona> = fc.record({
    role: fc.string({ minLength: 1 }),
    strategicPriorities: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
    decisionPrinciples: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
    competitiveContext: fc.string({ minLength: 1 }),
    brandPositioning: fc.string({ minLength: 1 }),
  });

  it('serialise then deserialise produces a deeply equal object', () => {
    fc.assert(
      fc.property(arbCMOPersona, (persona) => {
        const json = serializeCMOPersona(persona);
        const result = deserializeCMOPersona(json);
        expect(result).toEqual(persona);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cmo-agent-persona, Property 5: Deserialisation error identifies all missing fields
// Validates: Requirements 7.3
describe('Property 5: Deserialisation error identifies all missing fields', () => {
  const requiredFields: (keyof CMOPersona)[] = [
    'role',
    'strategicPriorities',
    'decisionPrinciples',
    'competitiveContext',
    'brandPositioning',
  ];

  const arbCMOPersona: fc.Arbitrary<CMOPersona> = fc.record({
    role: fc.string({ minLength: 1 }),
    strategicPriorities: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
    decisionPrinciples: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
    competitiveContext: fc.string({ minLength: 1 }),
    brandPositioning: fc.string({ minLength: 1 }),
  });

  // Generate a non-empty subset of required fields to remove
  const arbFieldsToRemove: fc.Arbitrary<(keyof CMOPersona)[]> = fc
    .subarray(requiredFields, { minLength: 1 })

  it('error message contains every removed field name', () => {
    fc.assert(
      fc.property(arbCMOPersona, arbFieldsToRemove, (persona, fieldsToRemove) => {
        // Convert to plain object and remove selected fields
        const obj: Record<string, unknown> = { ...persona };
        for (const field of fieldsToRemove) {
          delete obj[field];
        }

        const json = JSON.stringify(obj);

        try {
          deserializeCMOPersona(json);
          // Should have thrown — fail the property
          expect.unreachable('deserializeCMOPersona should have thrown for missing fields');
        } catch (err: unknown) {
          const message = (err as Error).message;
          for (const field of fieldsToRemove) {
            expect(message).toContain(field);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
