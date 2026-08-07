import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const GITHUB_REPO = "ninjass10101010-alt/Home-ai";
const GITHUB_BRANCH = "warm-glass-v2";

interface VersionInfo {
  hash: string;
  short: string;
  message: string;
  date: string;
  author: string;
}

interface GitHubCommit {
  sha: string;
  commit: { message: string; author: { date: string; name: string } };
}

export async function GET() {
  try {
    const versionPath = path.join(process.cwd(), "public", "version.json");
    let builtAt: VersionInfo | null = null;
    try {
      builtAt = JSON.parse(await readFile(versionPath, "utf-8"));
    } catch (e: any) {
    console.error("[admin/version]", e);
      builtAt = {
        hash: "unknown",
        short: "unknown",
        message: "Development build",
        date: new Date().toISOString(),
        author: "—",
      };
    }

    let latestRemote: VersionInfo | null = null;
    let updateAvailable = false;
    let commitsBehind = 0;

    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
        {
          headers: { Accept: "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const remote = (await res.json()) as GitHubCommit;
        latestRemote = {
          hash: remote.sha,
          short: remote.sha.substring(0, 7),
          message: remote.commit.message.split("\n")[0],
          date: remote.commit.author.date,
          author: remote.commit.author.name,
        };
        if (builtAt && builtAt.hash !== "unknown" && latestRemote.hash !== builtAt.hash) {
          const compareRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/compare/${builtAt!.hash}...${latestRemote.hash}`,
            {
              headers: { Accept: "application/vnd.github.v3+json" },
              signal: AbortSignal.timeout(5000),
            },
          );
          if (compareRes.ok) {
            const compare = (await compareRes.json()) as { behind_by: number };
            commitsBehind = compare.behind_by || 0;
            updateAvailable = commitsBehind > 0;
          } else {
            updateAvailable = true;
            commitsBehind = 1;
          }
        }
      }
    } catch (e: any) {
    console.error("[admin/version]", e);
      // GitHub unreachable — just show local version
    }

    return NextResponse.json({
      ok: true,
      built_at: builtAt,
      latest_remote: latestRemote,
      update_available: updateAvailable,
      commits_behind: commitsBehind,
      repo: `https://github.com/${GITHUB_REPO}`,
      branch: GITHUB_BRANCH,
    });
  } catch (e: any) {
    console.error("[admin/version]", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Version check failed" },
      { status: 500 },
    );
  }
}
