import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { db } from "~/lib/db.server";
import { getSessionWithPermission } from "~/lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();

  if (!query) {
    return json({ events: [] });
  }

  const events = await db.event.findMany({
    where: {
      name: { contains: query },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      name: true,
    },
  });

  return json({ events });
};
