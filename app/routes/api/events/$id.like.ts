import type { ActionFunctionArgs } from "react-router";

import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { user } = await getSessionWithPermission(request, "MEMBER");
  const eventId = params.id;
  if (!eventId) {
    return new Response("Event ID is required", { status: 400 });
  }

  const existingLike = await db.eventLike.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
    select: { eventId: true },
  });

  if (existingLike) {
    await db.eventLike.delete({
      where: { eventId_userId: { eventId, userId: user.id } },
    });
  } else {
    await db.eventLike.create({
      data: { eventId, userId: user.id },
    });
  }

  return new Response(null, { status: 204 });
}

