import type { Prisma } from "@prisma/client";

import { db } from "~/lib/db.server";
import {
  DEFAULT_SPACE_THEME_KEY,
  SPACE_SURFACES,
  SPACE_VIEWPORTS,
  generatePostAppearanceStyle,
  generateSpaceAppearanceConfig,
  getSpaceLayoutKey,
  getSurfaceForPostType,
  getSpaceTheme,
  type SpaceSurface,
  type SpaceThemeKey,
  type SpaceViewport,
} from "~/lib/space-theme";

type DbClient = typeof db | Prisma.TransactionClient;

type AppearancePost = {
  id: number;
  type: string;
};

function getPostSurface(post: AppearancePost): SpaceSurface {
  return getSurfaceForPostType(post.type);
}

export function canChangeSpaceTheme(user: { id: string; role: string | null } | null, space: { userId: string | null }) {
  return Boolean(user && (user.role === "ADMIN" || user.id === space.userId));
}

export async function upsertSpaceAppearances(client: DbClient, spaceId: string, themeKey = DEFAULT_SPACE_THEME_KEY) {
  const theme = getSpaceTheme(themeKey);

  for (const viewport of SPACE_VIEWPORTS) {
    for (const surface of SPACE_SURFACES) {
      await client.memorySpaceAppearance.upsert({
        where: {
          spaceId_viewport_surface: {
            spaceId,
            viewport,
            surface,
          },
        },
        create: {
          spaceId,
          viewport,
          surface,
          layoutKey: getSpaceLayoutKey(theme.key, viewport, surface),
          config: generateSpaceAppearanceConfig(theme.key, viewport, surface),
        },
        update: {
          layoutKey: getSpaceLayoutKey(theme.key, viewport, surface),
          config: generateSpaceAppearanceConfig(theme.key, viewport, surface),
        },
      });
    }
  }
}

export async function createDefaultSpaceAppearances(client: DbClient, spaceId: string, themeKey = DEFAULT_SPACE_THEME_KEY) {
  await upsertSpaceAppearances(client, spaceId, themeKey);
}

export async function upsertPostAppearancesForPost(
  client: DbClient,
  post: AppearancePost & { spaceId: string },
  themeKey: string,
  index?: number
) {
  const surface = getPostSurface(post);
  const sortOrder =
    typeof index === "number"
      ? index
      : Math.max(
          0,
          (await client.memoryPost.count({
            where: {
              spaceId: post.spaceId,
              OR: surface === "ALBUM" ? [{ type: "ALBUM" }, { type: "PHOTO" }] : [{ type: "MESSAGE" }],
            },
          })) - 1
        );

  for (const viewport of SPACE_VIEWPORTS) {
    await client.memoryPostAppearance.upsert({
      where: {
        postId_viewport_surface: {
          postId: post.id,
          viewport,
          surface,
        },
      },
      create: {
        postId: post.id,
        viewport,
        surface,
        sortOrder,
        style: generatePostAppearanceStyle({
          postId: post.id,
          index: sortOrder,
          total: sortOrder + 1,
          themeKey,
          viewport,
          surface,
        }),
      },
      update: {
        sortOrder,
        style: generatePostAppearanceStyle({
          postId: post.id,
          index: sortOrder,
          total: sortOrder + 1,
          themeKey,
          viewport,
          surface,
        }),
      },
    });
  }
}

export async function regeneratePostAppearances(client: DbClient, spaceId: string, themeKey: string) {
  for (const surface of SPACE_SURFACES) {
    const posts = await client.memoryPost.findMany({
      where: {
        spaceId,
        OR: surface === "ALBUM" ? [{ type: "ALBUM" }, { type: "PHOTO" }] : [{ type: "MESSAGE" }],
      },
      select: { id: true, type: true, spaceId: true },
      orderBy: { createdAt: "asc" },
    });

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      if (!post) continue;
      await upsertPostAppearancesForPost(client, post, themeKey, index);
    }
  }
}

export async function applySpaceTheme(spaceId: string, themeKey: SpaceThemeKey) {
  const theme = getSpaceTheme(themeKey);

  await db.$transaction(async (tx) => {
    await tx.memorySpace.update({
      where: { id: spaceId },
      data: { themeKey: theme.key },
    });
    await upsertSpaceAppearances(tx, spaceId, theme.key);
    await regeneratePostAppearances(tx, spaceId, theme.key);
  });
}

export function normalizeThemeKey(themeKey: string | null | undefined) {
  return getSpaceTheme(themeKey).key;
}

export function getAppearanceInclude() {
  return {
    appearances: true,
  };
}

export type SpaceRouteViewport = SpaceViewport;
