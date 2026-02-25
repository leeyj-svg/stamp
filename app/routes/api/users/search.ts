import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { db } from "~/lib/db.server";
import { getSessionWithPermission } from "~/lib/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");

  const url = new URL(request.url);
  const query = url.searchParams.get("q");

  if (!query) {
    return json({ users: [] });
  }

  const users = await db.user.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { phoneNumber: { contains: query } },
      ],
    },
    take: 10,
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      status: true,
    },
  });

  return json({ users });
};
