import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getSpaceTheme } from "~/lib/space-theme";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const spaces = await db.memorySpace.findMany({
    include: {
      _count: { select: { posts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { spaces };
}

export default function AdminDashboard() {
  const { spaces } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">SPACE 관리자 센터</h1>
            <p className="mt-2 text-slate-500">생성된 SPACE를 관리하고 테마와 작성 링크를 설정합니다.</p>
          </div>
          <Link to="/memory/new" className="rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white hover:bg-slate-800">
            새 SPACE 만들기
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => {
            const theme = getSpaceTheme(space.themeKey);
            return (
              <div key={space.id} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                <div className="mb-4 flex items-start justify-between">
                  <h2 className="truncate pr-2 text-xl font-bold text-slate-800">{space.title}</h2>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{new Date(space.createdAt).toLocaleDateString()}</span>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-indigo-50 p-3 text-center">
                    <div className="text-2xl font-bold text-indigo-600">{space._count.posts}</div>
                    <div className="text-xs font-bold text-indigo-400">작성 글</div>
                  </div>
                  <div className="rounded-lg p-3 text-center" style={{ backgroundColor: `${theme.accentColor}18` }}>
                    <div className="text-sm font-bold" style={{ color: theme.accentColor }}>
                      {theme.shortLabel}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-400">테마</div>
                  </div>
                </div>

                <Link to={`/admin/spaces/${space.id}`} className="block w-full rounded-lg bg-slate-900 py-3 text-center font-bold text-white transition hover:bg-slate-800">
                  관리하기
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
