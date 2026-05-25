import type { SceneObjectDescriptor, SceneShape } from "~/lib/space-scene";

export function SceneShapeView({ shape, descriptor }: { shape: SceneShape; descriptor: SceneObjectDescriptor }) {
  const accent = descriptor.accentColor;

  switch (shape) {
    case "star":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 5 61 38 96 38 68 58 79 92 50 71 21 92 32 58 4 38 39 38Z" fill="currentColor" />
          <circle cx="50" cy="50" r="12" fill={accent} opacity="0.32" />
        </svg>
      );
    case "sparkle":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 4 58 38 94 50 58 62 50 96 42 62 6 50 42 38Z" fill="currentColor" />
          <path d="M18 18 28 28M82 18 72 28M18 82 28 72M82 82 72 72" stroke={accent} strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    case "starburst":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 0 56 34 82 12 66 42 100 50 66 58 82 88 56 66 50 100 44 66 18 88 34 58 0 50 34 42 18 12 44 34Z" fill="currentColor" />
        </svg>
      );
    case "stardust":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <circle cx="35" cy="34" r="10" fill="currentColor" />
          <circle cx="63" cy="52" r="6" fill={accent} />
          <circle cx="48" cy="72" r="4" fill="currentColor" opacity="0.72" />
        </svg>
      );
    case "ginkgo":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 90C32 62 12 50 10 30 31 18 40 25 50 43 60 25 69 18 90 30 88 50 68 62 50 90Z" fill="currentColor" />
          <path d="M50 88V44M30 36 50 55M70 36 50 55M20 31 48 62M80 31 52 62" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.54" />
        </svg>
      );
    case "maple":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M49 94 44 66 20 79 27 56 6 47 30 38 20 17 42 27 50 4 58 27 80 17 70 38 94 47 73 56 80 79 56 66 51 94Z" fill="currentColor" />
          <path d="M50 88 50 32M32 44 50 57M68 44 50 57" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case "oak":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 94C42 76 18 72 28 55 8 49 14 30 32 33 26 14 48 8 50 28 52 8 74 14 68 33 86 30 92 49 72 55 82 72 58 76 50 94Z" fill="currentColor" />
          <path d="M50 88V31M35 47 50 61M65 47 50 61" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.48" />
        </svg>
      );
    case "leaf-chip":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M18 58C38 22 70 20 86 34 76 62 48 80 18 58Z" fill="currentColor" />
          <path d="M24 57C44 52 62 42 82 34" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity="0.44" />
        </svg>
      );
    case "snowflake":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" fill="none">
          <path d="M50 8V92M16 29l68 42M84 29 16 71" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <path d="M38 18 50 30 62 18M38 82 50 70 62 82M20 40 36 44 32 28M80 40 64 44 68 28M20 60 36 56 32 72M80 60 64 56 68 72" stroke={accent} strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "ice-crystal":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 4 72 28 84 62 50 96 16 62 28 28Z" fill="currentColor" opacity="0.72" />
          <path d="M50 4V96M28 28 72 72M72 28 28 72" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity="0.62" />
        </svg>
      );
    case "snow-dot":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <circle cx="50" cy="50" r="22" fill="currentColor" />
          <circle cx="42" cy="42" r="6" fill={accent} opacity="0.65" />
        </svg>
      );
    case "frost-shard":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M52 2 82 52 55 98 18 66Z" fill="currentColor" opacity="0.78" />
          <path d="M52 12 55 88M32 63 76 52" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity="0.58" />
        </svg>
      );
    case "cherry-petal":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M52 92C18 68 16 32 46 10 78 28 82 62 52 92Z" fill="currentColor" />
          <path d="M50 86C52 58 50 35 45 14" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case "round-petal":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 92C28 72 18 46 29 25 42 0 70 13 75 35 80 58 67 78 50 92Z" fill="currentColor" />
        </svg>
      );
    case "flower":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <ellipse cx="50" cy="24" rx="14" ry="22" fill="currentColor" />
          <ellipse cx="74" cy="50" rx="22" ry="14" fill="currentColor" />
          <ellipse cx="50" cy="76" rx="14" ry="22" fill="currentColor" />
          <ellipse cx="26" cy="50" rx="22" ry="14" fill="currentColor" />
          <circle cx="50" cy="50" r="10" fill={accent} />
        </svg>
      );
    case "pollen":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <circle cx="32" cy="38" r="8" fill="currentColor" />
          <circle cx="57" cy="32" r="6" fill={accent} />
          <circle cx="66" cy="62" r="10" fill="currentColor" opacity="0.72" />
        </svg>
      );
    case "wave":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" fill="none">
          <path d="M8 58C22 34 40 34 50 56 61 80 80 78 92 52" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
          <path d="M14 72C30 60 44 61 58 73 70 84 82 82 92 70" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity="0.62" />
        </svg>
      );
    case "droplet":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 6C34 28 22 48 22 66a28 28 0 0 0 56 0C78 48 66 28 50 6Z" fill="currentColor" />
          <path d="M39 31C31 45 30 58 35 68" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.58" />
        </svg>
      );
    case "bubble":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" fill="none">
          <circle cx="50" cy="50" r="31" stroke="currentColor" strokeWidth="8" />
          <circle cx="39" cy="38" r="7" fill={accent} opacity="0.72" />
        </svg>
      );
    case "water-shine":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 8 60 40 92 50 60 60 50 92 40 60 8 50 40 40Z" fill="currentColor" />
        </svg>
      );
    case "ember":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M54 6C64 28 83 39 82 62 81 82 66 96 48 94 28 92 16 76 20 57 23 42 42 35 54 6Z" fill="currentColor" />
          <path d="M50 40C58 54 62 72 47 82 36 73 38 56 50 40Z" fill={accent} opacity="0.7" />
        </svg>
      );
    case "lantern":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M36 24h28l8 18v34L62 90H38L28 76V42Z" fill="currentColor" />
          <path d="M38 42h24v31H38Z" fill={accent} opacity="0.64" />
          <path d="M38 24C39 10 61 10 62 24" stroke={accent} strokeWidth="5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "camp-star":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 8 57 38 88 31 65 52 80 81 50 66 20 81 35 52 12 31 43 38Z" fill="currentColor" />
        </svg>
      );
    case "smoke":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" fill="none">
          <path d="M38 88C60 72 22 62 46 43 66 27 38 20 56 8" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
          <path d="M62 88C82 70 50 59 67 42" stroke={accent} strokeWidth="7" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case "film-strip":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M18 18h64v64H18Z" fill="currentColor" />
          <path d="M31 30h38v40H31Z" fill={accent} opacity="0.52" />
          {[28, 44, 60, 76].map((y) => (
            <path key={y} d={`M20 ${y}h8M72 ${y}h8`} stroke={accent} strokeWidth="5" strokeLinecap="round" />
          ))}
        </svg>
      );
    case "ticket":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M12 31h76v16a9 9 0 0 0 0 18v16H12V65a9 9 0 0 0 0-18Z" fill="currentColor" />
          <path d="M37 32v48" stroke={accent} strokeWidth="5" strokeDasharray="5 7" opacity="0.55" />
        </svg>
      );
    case "photo-corner":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M20 18h60v64H20Z" fill="currentColor" />
          <path d="M30 30h40v30H30Z" fill={accent} opacity="0.45" />
          <path d="M26 76h48" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.6" />
        </svg>
      );
    case "light-leak":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <circle cx="38" cy="50" r="26" fill="currentColor" opacity="0.72" />
          <circle cx="62" cy="50" r="22" fill={accent} opacity="0.52" />
        </svg>
      );
    case "confetti":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M26 18h18v30H26Z" fill="currentColor" />
          <path d="M58 24h20v18H58Z" fill={accent} />
          <path d="M36 62h32v16H36Z" fill="currentColor" opacity="0.78" />
        </svg>
      );
    case "ribbon":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M12 36C32 18 45 34 50 48 55 34 68 18 88 36 72 42 60 52 50 70 40 52 28 42 12 36Z" fill="currentColor" />
          <circle cx="50" cy="49" r="9" fill={accent} />
        </svg>
      );
    case "balloon":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <ellipse cx="50" cy="38" rx="27" ry="32" fill="currentColor" />
          <path d="M43 68h14l-7 10Z" fill={accent} />
          <path d="M50 78C35 86 64 90 49 98" stroke={accent} strokeWidth="4" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "party-star":
      return (
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <path d="M50 6 61 36 93 32 68 53 78 84 50 67 22 84 32 53 7 32 39 36Z" fill="currentColor" />
          <circle cx="50" cy="50" r="9" fill={accent} opacity="0.55" />
        </svg>
      );
    default:
      return null;
  }
}
