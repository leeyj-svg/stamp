import { Prisma } from "@prisma/client";
import * as z from "zod";

const gameEntrySchema = z.object({
  position: z.number(),
  char: z.string(),
  claimerId: z.string().nullable(),
  claimerName: z.string().nullable(),
});

const gameTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  entries: z.array(gameEntrySchema),
});

const gameStateSchema = z.object({
  teams: z.array(gameTeamSchema),
});

export type GameEntry = z.infer<typeof gameEntrySchema>;
export type GameTeam = z.infer<typeof gameTeamSchema>;
export type GameState = z.infer<typeof gameStateSchema>;

export function createGameEntries(): GameEntry[] {
  return [1, 2, 3].map((position) => ({
    position,
    char: "",
    claimerId: null,
    claimerName: null,
  }));
}

export function createGameTeam(id: number): GameTeam {
  return {
    id,
    name: `${id}팀`,
    entries: createGameEntries(),
  };
}

export const initialGameState: GameState = {
  teams: [createGameTeam(1)],
};

export function parseGameState(value: unknown): GameState {
  const parsed = gameStateSchema.safeParse(value);
  return parsed.success ? parsed.data : initialGameState;
}

export function cloneGameState(state: GameState): GameState {
  return {
    teams: state.teams.map((team) => ({
      ...team,
      entries: team.entries.map((entry) => ({ ...entry })),
    })),
  };
}

export function toGameStateJson(state: GameState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}
