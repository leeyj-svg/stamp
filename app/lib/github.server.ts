import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const githubApiBaseUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const githubIssueRepoOwner = (process.env.GITHUB_ISSUE_REPO_OWNER || "").trim();
const githubIssueRepoName = (process.env.GITHUB_ISSUE_REPO_NAME || "").trim();
const githubIssueToken = (process.env.GITHUB_ISSUE_TOKEN || "").trim();
const githubIssueLabels = (process.env.GITHUB_ISSUE_LABELS || "")
  .split(",")
  .map((label) => label.trim())
  .filter((label) => label.length > 0);
const githubIssueSecret = (process.env.GITHUB_ISSUE_SETTINGS_SECRET || process.env.COOKIE_SECRET || "").trim();

export type GitHubIssueSettingsInput = {
  repoOwner?: string | null;
  repoName?: string | null;
  labels?: string | null;
  tokenEncrypted?: string | null;
};

type ResolvedGitHubIssueConfig = {
  repoOwner: string;
  repoName: string;
  repo: string;
  labels: string[];
  token: string;
  source: "workSet" | "env";
};

function normalizeRepoPart(value: string | null | undefined) {
  const normalized = (value || "").trim().replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeLabels(value: string | null | undefined) {
  return (value || "")
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

function getEncryptionKey() {
  if (!githubIssueSecret) {
    throw new Error("GitHub 토큰을 저장하려면 COOKIE_SECRET 또는 GITHUB_ISSUE_SETTINGS_SECRET이 필요해요.");
  }

  return createHash("sha256").update(githubIssueSecret).digest();
}

export function encryptGitHubIssueToken(token: string) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGitHubIssueToken(tokenEncrypted: string | null | undefined) {
  if (!tokenEncrypted) {
    return null;
  }

  const [ivEncoded, authTagEncoded, encryptedEncoded] = tokenEncrypted.split(".");
  if (!ivEncoded || !authTagEncoded || !encryptedEncoded) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivEncoded, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    return decrypted.trim() || null;
  } catch {
    return null;
  }
}

function getConfiguredRepoSlug(input?: { repoOwner?: string | null; repoName?: string | null } | null) {
  const hasInputRepo = Boolean(input && (input.repoOwner || input.repoName));
  const repoOwner = normalizeRepoPart(hasInputRepo ? input?.repoOwner : githubIssueRepoOwner);
  const repoName = normalizeRepoPart(hasInputRepo ? input?.repoName : githubIssueRepoName);

  if (!repoOwner || !repoName) {
    return null;
  }

  return `${repoOwner}/${repoName}`;
}

function resolveGitHubIssueConfig(input?: GitHubIssueSettingsInput | null): ResolvedGitHubIssueConfig | null {
  const repoOwner = normalizeRepoPart(input?.repoOwner);
  const repoName = normalizeRepoPart(input?.repoName);
  const decryptedToken = decryptGitHubIssueToken(input?.tokenEncrypted);
  const hasWorkSetConfig = Boolean(repoOwner || repoName || input?.labels || input?.tokenEncrypted);

  if (repoOwner && repoName && decryptedToken) {
    return {
      repoOwner,
      repoName,
      repo: `${repoOwner}/${repoName}`,
      labels: normalizeLabels(input?.labels),
      token: decryptedToken,
      source: "workSet",
    };
  }

  if (hasWorkSetConfig) {
    return null;
  }

  const envRepo = getConfiguredRepoSlug();
  if (!envRepo || !githubIssueToken) {
    return null;
  }

  return {
    repoOwner: githubIssueRepoOwner,
    repoName: githubIssueRepoName,
    repo: envRepo,
    labels: githubIssueLabels,
    token: githubIssueToken,
    source: "env",
  };
}

async function tryJsonResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function getGitHubIssueIntegrationSummary(input?: GitHubIssueSettingsInput | null) {
  const hasWorkSetConfig = Boolean(input?.repoOwner || input?.repoName || input?.labels || input?.tokenEncrypted);
  const repo = getConfiguredRepoSlug(input ?? undefined);
  const tokenAvailable = hasWorkSetConfig
    ? Boolean(decryptGitHubIssueToken(input?.tokenEncrypted))
    : Boolean(githubIssueToken);
  const resolved = resolveGitHubIssueConfig(input);

  return {
    repo,
    isAvailable: Boolean(resolved),
    source: resolved?.source ?? null,
    hasStoredToken: Boolean(input?.tokenEncrypted),
    usesEnvFallback: !hasWorkSetConfig && Boolean(resolveGitHubIssueConfig(null)),
    tokenAvailable,
  };
}

export function isGitHubIssueSyncAvailable(input?: GitHubIssueSettingsInput | null) {
  return Boolean(resolveGitHubIssueConfig(input));
}

export function getGitHubIssueRepoSlug(input?: GitHubIssueSettingsInput | null) {
  return getConfiguredRepoSlug(input ?? undefined);
}

export async function createGitHubIssue(input: { title: string; body: string; config?: GitHubIssueSettingsInput | null }) {
  const config = resolveGitHubIssueConfig(input.config);
  if (!config) {
    throw new Error("GitHub 이슈 연동이 아직 설정되지 않았어요.");
  }

  const response = await fetch(`${githubApiBaseUrl}/repos/${config.repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      labels: config.labels.length > 0 ? config.labels : undefined,
    }),
  });

  const payload = await tryJsonResponse(response);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `GitHub API ${response.status}`;
    throw new Error(`GitHub 이슈를 만들지 못했어요. ${message}`);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.number !== "number" ||
    typeof payload.html_url !== "string"
  ) {
    throw new Error("GitHub 이슈 응답을 확인하지 못했어요.");
  }

  return {
    repo: config.repo,
    number: payload.number,
    url: payload.html_url,
  };
}
