import { Form, Link, redirect, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "MEMBER");
  const postId = Number(params.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    throw new Response("Invalid post id", { status: 400 });
  }

  const post = await db.communityPost.findUnique({
    where: { id: postId },
    include: {
      user: { select: { id: true, name: true } },
      likes: {
        where: { userId: user.id },
        select: { userId: true },
      },
      _count: {
        select: { likes: true },
      },
    },
  });

  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }

  return {
    post,
    currentUserId: user.id,
    currentRole: user.role,
    isLiked: post.likes.length > 0,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "MEMBER");
  const postId = Number(params.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    throw new Response("Invalid post id", { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "delete") {
    throw new Response("Invalid intent", { status: 400 });
  }

  const post = await db.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, userId: true },
  });
  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }

  if (post.userId !== user.id && user.role !== "ADMIN") {
    throw new Response("Forbidden", { status: 403 });
  }

  await db.communityPost.delete({ where: { id: postId } });
  return redirect("/community");
};

export default function CommunityPostDetailPage() {
  const { post, currentUserId, currentRole, isLiked } = useLoaderData<typeof loader>();
  const likeFetcher = useFetcher();

  const canDelete = post.user.id === currentUserId || currentRole === "ADMIN";
  const optimisticLiked = likeFetcher.state !== "idle" ? !isLiked : isLiked;
  const optimisticLikeCount =
    post._count.likes + (likeFetcher.state !== "idle" ? (isLiked ? -1 : 1) : 0);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{post.title}</CardTitle>
          <CardDescription>
            작성자 {post.user.name} · {new Date(post.createdAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="whitespace-pre-wrap leading-7">{post.content}</p>

          <div className="flex items-center justify-between">
            <likeFetcher.Form method="post" action={`/api/community/${post.id}/like`}>
              <Button type="submit" variant={optimisticLiked ? "default" : "outline"}>
                좋아요 {optimisticLikeCount}
              </Button>
            </likeFetcher.Form>

            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link to="/community">목록</Link>
              </Button>
              {canDelete && (
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!confirm("정말 삭제하시겠습니까?")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="delete" />
                  <Button type="submit" variant="destructive">
                    삭제
                  </Button>
                </Form>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
