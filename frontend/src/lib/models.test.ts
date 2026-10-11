import { describe, expect, it } from 'vitest';
import { changedAgents, recommendedModels } from './models';

const agents = {
  'uat-reporter': { job: 'One line per unit', recommended: 'claude-haiku-5-5', why: 'Short job' },
  'uat-diagnostician': { job: 'Diagnoses failures', recommended: 'claude-opus-5-5', why: 'Hard call' },
};

describe('model per agent', () => {
  it('puts every agent on its recommended model', () => {
    expect(recommendedModels(agents)).toEqual({ 'uat-reporter': 'claude-haiku-5-5', 'uat-diagnostician': 'claude-opus-5-5' });
  });

  it('lists only the agents moved off their recommendation', () => {
    expect(changedAgents(agents, { 'uat-reporter': 'claude-sonnet-5-5', 'uat-diagnostician': 'claude-opus-5-5' })).toEqual(['uat-reporter']);
    expect(changedAgents(agents, {})).toEqual([]);
  });
});
