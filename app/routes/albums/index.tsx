import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "MEMBER");

  const albums = await db.photoAlbum.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    include: {
      photos: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { imageUrl: true },
      },
      _count: {
        select: { photos: true },
      },
    },
  });

  return { albums };
};

export default function AlbumListPage() {
  const { albums } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">앨범</h1>
          <p className="text-sm text-muted-foreground">회원 전용 앨범 보기</p>
        </div>
        <Button asChild>
          <Link to="/albums/upload">사진 업로드</Link>
        </Button>
      </div>

      {albums.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">생성된 앨범이 없습니다.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((album) => (
            <Link key={album.id} to={`/albums/${album.id}`} className="block">
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                <div className="aspect-[4/3] bg-muted">
                  {album.photos[0]?.imageUrl ? (
                    <img src={album.photos[0].imageUrl} alt={album.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                      대표 이미지 없음
                    </div>
                  )}
                </div>
                <CardHeader>
                  <CardTitle className="text-lg">{album.name}</CardTitle>
                  <CardDescription>{album._count.photos}장</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
