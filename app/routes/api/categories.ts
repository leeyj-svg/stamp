import { Prisma } from "@prisma/client";
import { type ActionFunctionArgs, json } from "@remix-run/node";
import { db } from "~/lib/db.server";
import { getSessionWithPermission } from "~/lib/auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");

  switch (request.method) {
    case "POST": {
      const formData = await request.formData();
      const name = formData.get("name") as string;
      if (!name) {
        return json({ error: "카테고리 이름이 필요합니다." }, { status: 400 });
      }

      try {
        const newCategory = await db.eventCategory.create({ data: { name } });
        return json({ success: true, newCategory });
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return json({ error: "이미 존재하는 카테고리 이름입니다." }, { status: 409 });
        }
        return json({ error: "카테고리 생성에 실패했습니다." }, { status: 500 });
      }
    }

    case "DELETE": {
      const formData = await request.formData();
      const id = Number(formData.get("id"));
      if (!id) {
        return json({ error: "ID가 필요합니다." }, { status: 400 });
      }

      try {
        await db.eventCategory.delete({ where: { id } });
        return json({ success: true });
      } catch {
        return json({ error: "카테고리 삭제에 실패했습니다." }, { status: 500 });
      }
    }

    default: {
      return json({ message: "허용되지 않는 메서드입니다." }, { status: 405 });
    }
  }
};
