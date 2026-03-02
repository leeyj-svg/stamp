import { type ActionFunctionArgs, redirect } from "react-router";
import { Prisma } from "@prisma/client";

import { assertCategoryAccess, requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { deleteImages } from "~/lib/upload.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ message: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formData = await request.formData();
  const eventId = formData.get("eventId") as string;
  const force = formData.get("force") === "true";

  if (!eventId) {
    throw new Response("Event ID is required", { status: 400 });
  }

  try {
    const eventToDelete = await db.event.findUnique({
      where: { id: eventId },
      include: { images: true },
    });

    if (!eventToDelete) {
      throw new Response("Event not found", { status: 404 });
    }

    assertCategoryAccess(scope, eventToDelete.categoryId);

    const urlsToDelete: string[] = [];
    if (eventToDelete.imageUrl) {
      urlsToDelete.push(eventToDelete.imageUrl);
    }
    eventToDelete.images.forEach((image) => urlsToDelete.push(image.url));

    if (force) {
      await db.$transaction(async (prisma) => {
        await prisma.review.deleteMany({ where: { eventId } });
        await prisma.eventLike.deleteMany({ where: { eventId } });
        await prisma.eventImage.deleteMany({ where: { eventId } });
        await prisma.stampEntry.deleteMany({ where: { eventId } });
        await prisma.claimableStamp.deleteMany({ where: { eventId } });
        await prisma.event.delete({ where: { id: eventId } });
      });
    } else {
      await db.event.delete({ where: { id: eventId } });
    }

    if (urlsToDelete.length > 0) {
      await deleteImages(urlsToDelete);
    }

    const flashSession = await getFlashSession(request.headers.get("Cookie"));
    flashSession.flash("toast", {
      type: "success",
      message: "이벤트가 성공적으로 삭제되었습니다.",
    });

    return redirect("/admin/events", {
      headers: [["Set-Cookie", await commitSession(flashSession)]],
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new Response("연결된 데이터가 있어 삭제할 수 없습니다. 강제 삭제를 사용하세요.", {
        status: 409,
      });
    }
    if (error instanceof Response) {
      throw error;
    }
    throw new Response("이벤트 삭제 중 오류가 발생했습니다.", { status: 500 });
  }
};
