import { getSpaceTheme } from "~/lib/space-theme";

export type SceneShape =
  | "star"
  | "sparkle"
  | "starburst"
  | "stardust"
  | "ginkgo"
  | "maple"
  | "oak"
  | "leaf-chip"
  | "snowflake"
  | "ice-crystal"
  | "snow-dot"
  | "frost-shard"
  | "cherry-petal"
  | "round-petal"
  | "flower"
  | "pollen"
  | "wave"
  | "droplet"
  | "bubble"
  | "water-shine"
  | "ember"
  | "lantern"
  | "camp-star"
  | "smoke"
  | "film-strip"
  | "ticket"
  | "photo-corner"
  | "light-leak"
  | "confetti"
  | "ribbon"
  | "balloon"
  | "party-star";

export type SceneMotion = "twinkle" | "sway" | "fall" | "float" | "shimmer" | "ember" | "bob" | "drift";

export type SceneObjectDescriptor = {
  shape: SceneShape;
  color: string;
  accentColor: string;
  glowColor: string;
  motion: SceneMotion;
  opacity: number;
  scale: number;
  rotation: number;
  duration: number;
  delay: number;
};

export type AmbientSceneObject = SceneObjectDescriptor & {
  id: string;
  top: number;
  left: number;
  size: number;
  blur: number;
};

type SceneDefinition = {
  shapes: readonly SceneShape[];
  ambientShapes: readonly SceneShape[];
  colors: readonly string[];
  accentColors: readonly string[];
  glowColors: readonly string[];
  motions: readonly SceneMotion[];
};

const SCENE_DEFINITIONS: Record<string, SceneDefinition> = {
  galaxy: {
    shapes: ["star", "sparkle", "starburst", "stardust"],
    ambientShapes: ["star", "sparkle", "stardust"],
    colors: ["#fff7ad", "#fef3c7", "#dbeafe", "#f5d0fe"],
    accentColors: ["#fde68a", "#bfdbfe", "#f0abfc"],
    glowColors: ["rgba(253,224,71,0.78)", "rgba(147,197,253,0.68)", "rgba(216,180,254,0.72)"],
    motions: ["twinkle", "float", "shimmer"],
  },
  camping_night: {
    shapes: ["ember", "lantern", "camp-star", "smoke"],
    ambientShapes: ["ember", "camp-star", "smoke"],
    colors: ["#fed7aa", "#fdba74", "#fde68a", "#e0f2fe"],
    accentColors: ["#fb923c", "#facc15", "#fef3c7"],
    glowColors: ["rgba(251,146,60,0.78)", "rgba(250,204,21,0.68)", "rgba(253,186,116,0.72)"],
    motions: ["ember", "float", "twinkle"],
  },
  spring_petals: {
    shapes: ["cherry-petal", "round-petal", "flower", "pollen"],
    ambientShapes: ["cherry-petal", "round-petal", "pollen"],
    colors: ["#ffe4e6", "#fecdd3", "#fbcfe8", "#fff1f2"],
    accentColors: ["#fb7185", "#f9a8d4", "#fda4af"],
    glowColors: ["rgba(251,207,232,0.76)", "rgba(254,205,211,0.68)", "rgba(255,241,242,0.72)"],
    motions: ["sway", "drift", "float"],
  },
  summer_sea: {
    shapes: ["wave", "droplet", "bubble", "water-shine"],
    ambientShapes: ["wave", "bubble", "water-shine"],
    colors: ["#cffafe", "#a5f3fc", "#bae6fd", "#ecfeff"],
    accentColors: ["#22d3ee", "#38bdf8", "#67e8f9"],
    glowColors: ["rgba(165,243,252,0.72)", "rgba(56,189,248,0.62)", "rgba(207,250,254,0.68)"],
    motions: ["shimmer", "bob", "drift"],
  },
  autumn_leaves: {
    shapes: ["ginkgo", "maple", "oak", "leaf-chip"],
    ambientShapes: ["ginkgo", "maple", "oak", "leaf-chip"],
    colors: ["#facc15", "#f97316", "#ef4444", "#b45309", "#fbbf24"],
    accentColors: ["#fde68a", "#fb923c", "#dc2626", "#92400e"],
    glowColors: ["rgba(250,204,21,0.62)", "rgba(251,146,60,0.72)", "rgba(239,68,68,0.58)", "rgba(180,83,9,0.64)"],
    motions: ["fall", "sway", "drift"],
  },
  winter_snow: {
    shapes: ["snowflake", "ice-crystal", "snow-dot", "frost-shard"],
    ambientShapes: ["snowflake", "ice-crystal", "snow-dot", "frost-shard"],
    colors: ["#eff6ff", "#dbeafe", "#bfdbfe", "#f8fafc"],
    accentColors: ["#93c5fd", "#bfdbfe", "#e0f2fe"],
    glowColors: ["rgba(219,234,254,0.82)", "rgba(147,197,253,0.68)", "rgba(240,249,255,0.72)"],
    motions: ["fall", "twinkle", "float"],
  },
  film_polaroid: {
    shapes: ["film-strip", "ticket", "photo-corner", "light-leak"],
    ambientShapes: ["film-strip", "ticket", "light-leak"],
    colors: ["#fef3c7", "#e7e5e4", "#fbbf24", "#fafaf9"],
    accentColors: ["#292524", "#f59e0b", "#78716c"],
    glowColors: ["rgba(254,243,199,0.72)", "rgba(245,158,11,0.54)", "rgba(231,229,228,0.58)"],
    motions: ["float", "shimmer", "sway"],
  },
  birthday_party: {
    shapes: ["confetti", "ribbon", "balloon", "party-star"],
    ambientShapes: ["confetti", "ribbon", "party-star"],
    colors: ["#fbcfe8", "#fde68a", "#bfdbfe", "#ddd6fe", "#fecdd3"],
    accentColors: ["#ec4899", "#facc15", "#38bdf8", "#a78bfa"],
    glowColors: ["rgba(252,231,243,0.78)", "rgba(250,204,21,0.62)", "rgba(191,219,254,0.62)", "rgba(221,214,254,0.66)"],
    motions: ["bob", "twinkle", "float"],
  },
};

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sceneRandomUnit(seed: string) {
  const value = Math.sin(hashSeed(seed)) * 10000;
  return value - Math.floor(value);
}

export function sceneRandomRange(seed: string, min: number, max: number) {
  return min + sceneRandomUnit(seed) * (max - min);
}

function pick<T>(items: readonly T[], seed: string): T {
  return items[Math.floor(sceneRandomUnit(seed) * items.length)] ?? items[0];
}

export function getSceneDefinition(themeKey: string) {
  const theme = getSpaceTheme(themeKey);
  return SCENE_DEFINITIONS[theme.key] ?? SCENE_DEFINITIONS.galaxy;
}

export function getSceneObjectDescriptor(args: {
  themeKey: string;
  seed: string;
  interactive?: boolean;
}): SceneObjectDescriptor {
  const definition = getSceneDefinition(args.themeKey);
  const shapePool = args.interactive ? definition.shapes : definition.ambientShapes;
  const isInteractive = args.interactive === true;

  return {
    shape: pick(shapePool, `${args.seed}:shape`),
    color: pick(definition.colors, `${args.seed}:color`),
    accentColor: pick(definition.accentColors, `${args.seed}:accent`),
    glowColor: pick(definition.glowColors, `${args.seed}:glow`),
    motion: pick(definition.motions, `${args.seed}:motion`),
    opacity: Number(sceneRandomRange(`${args.seed}:opacity`, isInteractive ? 0.82 : 0.18, isInteractive ? 0.98 : 0.46).toFixed(2)),
    scale: Number(sceneRandomRange(`${args.seed}:scale`, isInteractive ? 0.92 : 0.48, isInteractive ? 1.7 : 1.08).toFixed(2)),
    rotation: Math.round(sceneRandomRange(`${args.seed}:rotation`, -38, 38)),
    duration: Number(sceneRandomRange(`${args.seed}:duration`, isInteractive ? 5.5 : 12, isInteractive ? 12 : 26).toFixed(1)),
    delay: Number(sceneRandomRange(`${args.seed}:delay`, -7, isInteractive ? 1.5 : 4).toFixed(1)),
  };
}

export function getAmbientSceneObjects(themeKey: string, count = 28): AmbientSceneObject[] {
  return Array.from({ length: count }).map((_, index) => {
    const seed = `${themeKey}:ambient:${index}`;
    const descriptor = getSceneObjectDescriptor({ themeKey, seed });

    return {
      ...descriptor,
      id: seed,
      top: Number(sceneRandomRange(`${seed}:top`, -4, 96).toFixed(2)),
      left: Number(sceneRandomRange(`${seed}:left`, -4, 98).toFixed(2)),
      size: Math.round(sceneRandomRange(`${seed}:size`, 10, 54)),
      blur: Number(sceneRandomRange(`${seed}:blur`, 1.1, 3.8).toFixed(1)),
    };
  });
}
