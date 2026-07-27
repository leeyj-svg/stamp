import { Link } from "react-router";
import { Gamepad2, Play, Settings, Wrench } from "lucide-react";
import { enabledGames } from "~/lib/games";

export default function GameHubPage() {
  const all = enabledGames();
  const tools = all.filter((g) => g.kind === "tool");
  const games = all.filter((g) => g.kind !== "tool");

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-slate-900 p-4 pb-16 text-white">
      {/* 도구(점수판 등) — 게임과 분리해 오른쪽 상단 */}
      {tools.length > 0 && (
        <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
          {tools.map((tool) => (
            <Link
              key={tool.slug}
              to={tool.playPath}
              className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-5 py-2.5 text-sm font-bold text-slate-100 transition hover:bg-slate-700"
            >
              <Wrench className="h-4 w-4 text-yellow-400" /> {tool.title}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-12 mb-8 flex flex-col items-center gap-2 md:mt-10">
        <Gamepad2 className="h-10 w-10 text-slate-400" />
        <h1 className="text-3xl font-bold uppercase tracking-widest text-slate-300">게임</h1>
        <p className="text-sm text-slate-500">함께 즐길 게임을 골라주세요.</p>
      </div>

      {games.length === 0 ? (
        <p className="mt-20 text-slate-500">아직 등록된 게임이 없습니다.</p>
      ) : (
        <div className="grid w-full max-w-4xl grid-cols-1 gap-4 px-2 sm:grid-cols-2">
          {games.map((game) => (
            <div
              key={game.slug}
              className="flex flex-col rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl"
            >
              <h2 className="text-xl font-extrabold text-white">{game.title}</h2>
              <p className="mt-2 flex-1 text-sm text-slate-400">{game.description}</p>
              <div className="mt-5 flex gap-3">
                {game.hostPath && (
                  <Link
                    to={game.hostPath}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-400 py-3 font-bold text-black transition hover:bg-yellow-500"
                  >
                    <Settings className="h-5 w-5" /> 진행하기
                  </Link>
                )}
                <Link
                  to={game.playPath}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-700 py-3 font-bold text-slate-100 transition hover:bg-slate-600"
                >
                  <Play className="h-5 w-5" /> {game.hostPath ? "참가하기" : "열기"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
