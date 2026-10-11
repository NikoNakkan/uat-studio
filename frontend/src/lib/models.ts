import type { AgentInfo } from '../api';

/** Every agent on the model recommended for its job. */
export const recommendedModels = (agents: Record<string, AgentInfo>): Record<string, string> =>
  Object.fromEntries(Object.entries(agents).map(([agent, info]) => [agent, info.recommended]));

/** The agents whose model is not the recommended one. */
export const changedAgents = (agents: Record<string, AgentInfo>, models: Record<string, string>): string[] =>
  Object.entries(agents).filter(([agent, info]) => (models[agent] ?? info.recommended) !== info.recommended).map(([agent]) => agent);
