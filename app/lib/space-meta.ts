const TCROOM_LOGO_PATH = "/logo.png";

type SpaceShareMetaInput = {
  origin: string;
  path: string;
  title: string;
  description?: string;
};

export function getPublicOrigin(request: Request) {
  return process.env.APP_URL || new URL(request.url).origin;
}

export function getTcroomLogoUrl(origin: string) {
  return new URL(TCROOM_LOGO_PATH, origin).toString();
}

export function getSpaceShareMeta({ origin, path, title, description }: SpaceShareMetaInput) {
  const url = new URL(path, origin).toString();
  const imageUrl = getTcroomLogoUrl(origin);
  const descriptionTags = description
    ? [
        { name: "description", content: description },
        { property: "og:description", content: description },
        { name: "twitter:description", content: description },
      ]
    : [];

  return [
    { title },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "TCROOM" },
    { property: "og:title", content: title },
    { property: "og:url", content: url },
    { property: "og:image", content: imageUrl },
    { property: "og:image:secure_url", content: imageUrl },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:image", content: imageUrl },
    ...descriptionTags,
  ];
}
