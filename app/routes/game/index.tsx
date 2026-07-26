import { Link } from "react-router";
import { Gamepad2, Play, Settings } from "lucide-react";
import { enabledGames } from "~/lib/games";

export default function GameHubPage() {
  const games = enabledGames();

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-4 pb-16 text-white">
      <div className="mt-10 mb-8 flex flex-col items-center gap-2">
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
                  <Play className="h-5 w-5" /> 참가하기
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
