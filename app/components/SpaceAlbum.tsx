import type { MemoryPost } from "@prisma/client";

interface Props {
  title: string;
  posts: MemoryPost[];
}

export default function SpaceAlbum({ title, posts }: Props) {
  const photos = [...posts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="w-full pb-20">
      <div className="relative z-10 flex flex-col items-center justify-center px-4 pb-12 pt-24 text-center">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.4em] text-white/50">Album</p>
        <h2 className="text-4xl font-bold text-white md:text-6xl">{title}</h2>
      </div>

      <div className="container mx-auto px-4">
        <div className="columns-1 gap-8 space-y-8 sm:columns-2 lg:columns-3">
          {photos.map((photo, index) => (
            <div key={photo.id} className="break-inside-avoid bg-white p-3 pb-6 shadow-xl" style={{ transform: `rotate(${(index % 5) - 2}deg)` }}>
              {photo.mediaUrl && (
                <div className="mb-4 overflow-hidden bg-slate-100">
                  <img src={photo.mediaUrl} alt="" className="h-auto w-full object-cover" loading="lazy" />
                </div>
              )}
              <p className="text-center text-sm font-bold leading-relaxed text-slate-800">{photo.content}</p>
              <p className="mt-2 text-center text-xs text-slate-400">{photo.nickname}</p>
            </div>
          ))}
        </div>
        {photos.length === 0 && <p className="py-20 text-center text-white/50">아직 앨범이 비어 있어요.</p>}
      </div>
    </div>
  );
}
