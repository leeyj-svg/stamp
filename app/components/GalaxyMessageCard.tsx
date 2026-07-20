import type { SpacePost } from "~/lib/space-post";

interface Props {
  post: SpacePost;
  index: number;
  canEdit?: boolean;
  globalState?: 0 | 1 | 2;
}

export default function GalaxyMessageCard({ post, index }: Props) {
  const angle = index * 2.399963;
  const x = Math.round(Math.cos(angle) * (150 + (index % 5) * 42));
  const y = Math.round(Math.sin(angle) * (100 + (index % 5) * 28));

  return (
    <div
      className="absolute w-64 rounded-lg border border-white/15 bg-slate-900/90 p-4 text-white shadow-2xl backdrop-blur-md"
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <p className="mb-2 text-xs font-bold text-white/50">From {post.nickname}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.content}</p>
    </div>
  );
}
