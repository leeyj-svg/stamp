type ImmichAlbum = {
  id: string;
  albumName?: string;
  name?: string;
};

const baseUrl = (process.env.IMMICH_URL || "").replace(/\/+$/, "");
const apiKey = process.env.IMMICH_API_KEY || "";
const deviceId = process.env.IMMICH_DEVICE_ID || "stamp-web";

function isConfigured() {
  return Boolean(baseUrl && apiKey);
}

function buildHeaders(extra?: Record<string, string>) {
  return {
    "x-api-key": apiKey,
    Accept: "application/json",
    ...extra,
  };
}

function getPossibleAssetId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.id === "string") return data.id;
  if (typeof data.assetId === "string") return data.assetId;

  const duplicate = data.duplicate as Record<string, unknown> | undefined;
  if (duplicate && typeof duplicate.id === "string") return duplicate.id;
  return null;
}

async function tryJsonResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function ensureImmichAlbum(input: {
  immichAlbumId?: string | null;
  name: string;
  description?: string | null;
}): Promise<string | null> {
  if (!isConfigured()) return null;
  if (input.immichAlbumId) return input.immichAlbumId;

  const listRes = await fetch(`${baseUrl}/api/albums`, {
    method: "GET",
    headers: buildHeaders(),
  });

  if (!listRes.ok) {
    throw new Error(`Immich album list failed: ${listRes.status}`);
  }

  const albums = (await listRes.json()) as ImmichAlbum[];
  const matched = albums.find((album) => (album.albumName || album.name) === input.name);
  if (matched?.id) return matched.id;

  const createRes = await fetch(`${baseUrl}/api/albums`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      albumName: input.name,
      description: input.description || undefined,
    }),
  });

  if (!createRes.ok) {
    const body = await tryJsonResponse(createRes);
    throw new Error(`Immich album create failed: ${createRes.status} ${JSON.stringify(body)}`);
  }

  const created = (await createRes.json()) as ImmichAlbum;
  return created.id || null;
}

export async function uploadFileToImmich(file: File, takenAt?: Date | null): Promise<string | null> {
  if (!isConfigured()) return null;

  const createdAt = (takenAt || new Date(file.lastModified || Date.now())).toISOString();
  const formData = new FormData();
  formData.append("assetData", file, file.name || `upload-${Date.now()}.jpg`);
  formData.append("deviceAssetId", `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  formData.append("deviceId", deviceId);
  formData.append("fileCreatedAt", createdAt);
  formData.append("fileModifiedAt", createdAt);
  formData.append("isFavorite", "false");

  const uploadRes = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: buildHeaders(),
    body: formData,
  });

  if (!uploadRes.ok) {
    const body = await tryJsonResponse(uploadRes);
    throw new Error(`Immich asset upload failed: ${uploadRes.status} ${JSON.stringify(body)}`);
  }

  const payload = await uploadRes.json();
  return getPossibleAssetId(payload);
}

export async function attachAssetToImmichAlbum(albumId: string, assetId: string): Promise<void> {
  if (!isConfigured()) return;
  if (!albumId || !assetId) return;

  const response = await fetch(`${baseUrl}/api/albums/${albumId}/assets`, {
    method: "PUT",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids: [assetId] }),
  });

  if (!response.ok) {
    const body = await tryJsonResponse(response);
    throw new Error(`Immich album attach failed: ${response.status} ${JSON.stringify(body)}`);
  }
}

export function isImmichSyncAvailable() {
  return isConfigured();
}
