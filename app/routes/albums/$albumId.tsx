import { Form, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { useState } from "react";
import { Funnel } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

type SortKey = "created_desc" | "created_asc" | "taken_desc" | "taken_asc";
type CaptionFilter = "all" | "with_caption" | "without_caption";
type SourceFilter = "all" | "member" | "guest" | "mine";

function parseSort(value: string | null): SortKey {
  if (value === "created_asc" || value === "taken_desc" || value === "taken_asc") return value;
  return "created_desc";
}

function parseCaptionFilter(value: string | null): CaptionFilter {
  if (value === "with_caption" || value === "without_caption") return value;
  return "all";
}

function parseSourceFilter(value: string | null): SourceFilter {
  if (value === "member" || value === "guest" || value === "mine") return value;
  return "all";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "MEMBER");

  const albumId = Number(params.albumId);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    throw new Response("Invalid album id", { status: 400 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sort = parseSort(url.searchParams.get("sort"));
  const captionFilter = parseCaptionFilter(url.searchParams.get("caption"));
  const sourceFilter = parseSourceFilter(url.searchParams.get("source"));

  const whereConditions: Prisma.AlbumPhotoWhereInput[] = [{ albumId }];

  if (q) {
    whereConditions.push({
      OR: [
        { caption: { contains: q } },
        { uploaderName: { contains: q } },
        { uploadedByUser: { name: { contains: q } } },
      ],
    });
  }

  if (captionFilter === "with_caption") {
    whereConditions.push({
      AND: [{ caption: { not: null } }, { caption: { not: "" } }],
    });
  }

  if (captionFilter === "without_caption") {
    whereConditions.push({
      OR: [{ caption: null }, { caption: "" }],
    });
  }

  if (sourceFilter === "member") {
    whereConditions.push({ uploadedByUserId: { not: null } });
  }

  if (sourceFilter === "guest") {
    whereConditions.push({ uploadedByUserId: null });
  }

  if (sourceFilter === "mine") {
    whereConditions.push({ uploadedByUserId: user.id });
  }

  const where: Prisma.AlbumPhotoWhereInput =
    whereConditions.length === 1 ? whereConditions[0] : { AND: whereConditions };

  const orderBy: Prisma.AlbumPhotoOrderByWithRelationInput[] =
    sort === "created_asc"
      ? [{ createdAt: "asc" }]
      : sort === "taken_desc"
        ? [{ takenAt: "desc" }, { createdAt: "desc" }]
        : sort === "taken_asc"
          ? [{ takenAt: "asc" }, { createdAt: "asc" }]
          : [{ createdAt: "desc" }];

  const [album, photos, totalCount, filteredCount] = await db.$transaction([
    db.photoAlbum.findFirst({
      where: { id: albumId, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
      },
    }),
    db.albumPhoto.findMany({
      where,
      orderBy,
      include: {
        uploadedByUser: {
          select: { name: true },
        },
      },
    }),
    db.albumPhoto.count({
      where: { albumId },
    }),
    db.albumPhoto.count({
      where,
    }),
  ]);

  if (!album) {
    throw new Response("Album not found", { status: 404 });
  }

  return { album, photos, totalCount, filteredCount, q, sort, captionFilter, sourceFilter };
};

export default function AlbumDetailPage() {
  const { album, photos, totalCount, filteredCount, q, sort, captionFilter, sourceFilter } =
    useLoaderData<typeof loader>();
  const hasActiveFilter =
    q.length > 0 || sort !== "created_desc" || captionFilter !== "all" || sourceFilter !== "all";
  const [showFilters, setShowFilters] = useState(hasActiveFilter);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{album.name}</h1>
          <p className="text-sm text-muted-foreground">전체 {totalCount}장 중 현재 {filteredCount}장</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/albums">목록</Link>
          </Button>
          <Button asChild>
            <Link to="/albums/upload">업로드</Link>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowFilters((prev) => !prev)}
          aria-label={showFilters ? "검색/정렬/필터 닫기" : "검색/정렬/필터 보기"}
          title={showFilters ? "검색/정렬/필터 닫기" : "검색/정렬/필터 보기"}
        >
          <Funnel className="h-4 w-4" />
        </Button>
        {hasActiveFilter && (
          <Badge variant="secondary" className="gap-1">
            <Funnel className="h-3 w-3" />
            적용 중
          </Badge>
        )}
      </div>

      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">검색 / 정렬 / 필터</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="get" className="grid gap-2 md:grid-cols-5">
              <Input name="q" defaultValue={q} placeholder="설명, 업로더 검색" className="md:col-span-2" />

              <select name="sort" defaultValue={sort} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="created_desc">등록일 최신순</option>
                <option value="created_asc">등록일 오래된순</option>
                <option value="taken_desc">촬영일 최신순</option>
                <option value="taken_asc">촬영일 오래된순</option>
              </select>

              <select
                name="caption"
                defaultValue={captionFilter}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">설명 전체</option>
                <option value="with_caption">설명 있음</option>
                <option value="without_caption">설명 없음</option>
              </select>

              <select
                name="source"
                defaultValue={sourceFilter}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">업로더 전체</option>
                <option value="member">회원 업로드</option>
                <option value="guest">비회원 업로드</option>
                <option value="mine">내가 업로드</option>
              </select>

              <div className="flex gap-2 md:col-span-5">
                <Button type="submit">적용</Button>
                <Button type="button" variant="outline" asChild>
                  <Link to={`/albums/${album.id}`}>초기화</Link>
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {photos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">조건에 맞는 사진이 없습니다.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <Card key={photo.id} className="overflow-hidden">
              <div className="aspect-square bg-muted">
                <img src={photo.imageUrl} alt={photo.caption || "album photo"} className="h-full w-full object-cover" />
              </div>
              <CardHeader className="p-3">
                <CardTitle className="line-clamp-2 text-sm font-semibold">{photo.caption || "설명 없음"}</CardTitle>
                <div className="flex items-center gap-1 pt-1">
                  <Badge variant={photo.uploadedByUserId ? "default" : "secondary"}>
                    {photo.uploadedByUserId ? "회원" : "비회원"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  업로더 {photo.uploadedByUser?.name || photo.uploaderName || "익명"}
                </p>
                <p className="text-xs text-muted-foreground">등록 {new Date(photo.createdAt).toLocaleString()}</p>
                {photo.takenAt && (
                  <p className="text-xs text-muted-foreground">촬영 {new Date(photo.takenAt).toLocaleDateString()}</p>
                )}
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
