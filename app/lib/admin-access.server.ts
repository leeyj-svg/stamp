import { redirect } from "react-router";

import { getSession } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export type AdminAccessScope = {
  user: NonNullable<Awaited<ReturnType<typeof getSession>>["user"]>;
  isAdmin: boolean;
  managedCategoryIds: number[];
};

function permissionRedirect(request: Request): never {
  throw redirect(`/login?error=permission&redirectTo=${encodeURIComponent(request.url)}`);
}

export async function requireAdminAccessScope(request: Request): Promise<AdminAccessScope> {
  const { user, session } = await getSession(request);
  if (!user || !session || !user.role) {
    permissionRedirect(request);
  }

  if (user.role === "ADMIN") {
    return { user, isAdmin: true, managedCategoryIds: [] };
  }

  if (user.role === "MEMBER") {
    const assignments = await db.eventCategoryManager.findMany({
      where: { userId: user.id },
      select: { categoryId: true },
    });
    const managedCategoryIds = assignments.map((assignment) => assignment.categoryId);
    if (managedCategoryIds.length === 0) {
      permissionRedirect(request);
    }
    return { user, isAdmin: false, managedCategoryIds };
  }

  permissionRedirect(request);
}

export function assertCategoryAccess(scope: AdminAccessScope, categoryId: number): void {
  if (!scope.isAdmin && !scope.managedCategoryIds.includes(categoryId)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export function getScopedCategoryWhere(scope: AdminAccessScope) {
  if (scope.isAdmin) {
    return {};
  }
  return { categoryId: { in: scope.managedCategoryIds } };
}

