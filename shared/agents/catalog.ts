/**
 * Agent catalog types and data — re-exported from src/data/agents.ts
 * This file is the shared source of truth for Agent and Division type definitions.
 */

export interface Agent {
  id: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
  division: string;
  subDivision?: string;
  fileName: string;
}

export interface Division {
  id: string;
  name: string;
  nameZh: string;
  emoji: string;
  color: string;
  agents: Agent[];
}

// Re-export from source — import from src/data/agents for the actual data
export type { Agent as AgentRecord };
