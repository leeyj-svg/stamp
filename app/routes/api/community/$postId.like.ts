import type { ActionFunctionArgs } from "react-router";

import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { user } = await getSessionWithPermission(request, "MEMBER");
  const postId = Number(params.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    return new Response("Post ID is required", { status: 400 });
  }

  const existingLike = await db.communityPostLike.findUnique({
    where: { postId_userId: { postId, userId: user.id } },
    select: { postId: true },
  });

  if (existingLike) {
    await db.communityPostLike.delete({
      where: { postId_userId: { postId, userId: user.id } },
    });
  } else {
    await db.communityPostLike.create({
      data: { postId, userId: user.id },
    });
  }

  return new Response(null, { status: 204 });
}
