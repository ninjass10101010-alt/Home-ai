// src/lib/media/tools.ts
// Tools for Rubio (Garcia Family Media Stack Manager).
// Integrates Radarr, Sonarr, qBittorrent, and Plex for media search, acquisition, and status.

import type { Tool } from "@/lib/hermes-tools";
import { getServiceConfig } from "@/lib/services/config";

async function getRadarrConfig() {
  const storedUrl = await getServiceConfig("radarr", "RADARR_URL").catch(() => null);
  const storedKey = await getServiceConfig("radarr", "RADARR_API_KEY").catch(() => null);
  return {
    url: (storedUrl || process.env.RADARR_URL?.trim() || "http://radarr:7878").replace(/\/+$/, ""),
    apiKey: storedKey || process.env.RADARR_API_KEY?.trim() || "",
  };
}

async function getSonarrConfig() {
  const storedUrl = await getServiceConfig("sonarr", "SONARR_URL").catch(() => null);
  const storedKey = await getServiceConfig("sonarr", "SONARR_API_KEY").catch(() => null);
  return {
    url: (storedUrl || process.env.SONARR_URL?.trim() || "http://sonarr:8989").replace(/\/+$/, ""),
    apiKey: storedKey || process.env.SONARR_API_KEY?.trim() || "",
  };
}

async function getPlexConfig() {
  const storedUrl = await getServiceConfig("plex", "PLEX_URL").catch(() => null);
  const storedToken = await getServiceConfig("plex", "PLEX_TOKEN").catch(() => null);
  return {
    url: (storedUrl || process.env.PLEX_URL?.trim() || "http://192.168.0.28:32400").replace(/\/+$/, ""),
    token: storedToken || process.env.PLEX_TOKEN?.trim() || "",
  };
}

function getQbittorrentConfig() {
  return {
    url: process.env.QBITTORRENT_URL?.trim() || "http://qbittorrent:8080",
    user: process.env.QBITTORRENT_USER?.trim() || "",
    pass: process.env.QBITTORRENT_PASS?.trim() || "",
  };
}

function getProwlarrConfig() {
  return {
    url: process.env.PROWLARR_URL?.trim() || "http://prowlarr:9696",
    apiKey: process.env.PROWLARR_API_KEY?.trim() || "",
  };
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatEta(seconds?: number): string {
  if (seconds === undefined || seconds === null || seconds >= 8640000 || seconds < 0) {
    return "unknown";
  }
  if (seconds === 0) return "done";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function getQbittorrentCookie(): Promise<string | null> {
  const { url, user, pass } = getQbittorrentConfig();
  if (!user || !pass) return null;
  try {
    const res = await fetch(`${url}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: user,
        password: pass,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/SID=[^;]+/);
    return match ? match[0] : setCookie;
  } catch {
    return null;
  }
}

interface PlexMediaDeleteParams {
  title?: string;
  query?: string;
  mediaType?: "movie" | "show" | "episode" | "season" | string;
  type?: string;
  ratingKey?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  library?: string;
  deleteFiles?: boolean;
  deleteFile?: boolean;
  confirm?: boolean;
  toolName?: string;
}

async function executePlexMediaDelete(args: PlexMediaDeleteParams): Promise<string> {
  const toolName = args.toolName || "delete_plex_media";
  const title = String(args.title || args.query || "").trim();
  const confirm = Boolean(args.confirm);
  const deleteFiles = args.deleteFiles !== false && args.deleteFile !== false;
  let ratingKey = String(args.ratingKey || "").trim();
  let requestedType = (args.mediaType || args.type) ? String(args.mediaType || args.type).toLowerCase() : undefined;
  const requestedYear = typeof args.year === "number" ? args.year : undefined;
  const seasonNum = typeof args.seasonNumber === "number" ? args.seasonNumber : undefined;
  const episodeNum = typeof args.episodeNumber === "number" ? args.episodeNumber : undefined;
  const requestedLibrary = args.library ? String(args.library).trim() : undefined;

  if (!title && !ratingKey) {
    return JSON.stringify({ ok: false, deleted: false, fileDeleted: false, removedFromLibrary: false, error: "Movie or show title, or ratingKey, is required." });
  }

  const { url: plexBaseUrl, token: plexToken } = await getPlexConfig();
  const { url: radarrBaseUrl, apiKey: radarrKey } = await getRadarrConfig();
  const { url: sonarrBaseUrl, apiKey: sonarrKey } = await getSonarrConfig();

  const pBase = plexBaseUrl.replace(/\/+$/, "");
  const rBase = radarrBaseUrl ? radarrBaseUrl.replace(/\/+$/, "") : "";
  const sBase = sonarrBaseUrl ? sonarrBaseUrl.replace(/\/+$/, "") : "";

  let targetTitle = title;
  let targetYear: number | undefined = requestedYear;
  let resolvedType: string = requestedType || "movie";
  let librarySectionID: string | undefined;
  let libraryTitle: string | undefined = requestedLibrary;
  let seriesTitle: string | undefined;
  let parentIndex: number | undefined = seasonNum;
  let episodeIndex: number | undefined = episodeNum;
  let radarrId: number | undefined;
  let sonarrId: number | undefined;
  let episodeFileId: number | undefined;
  let filePath: string | undefined;
  let fileSizeBytes: number | undefined;
  let viewCount: number = 0;

  try {
    // 1. Locate in Plex
    if (plexToken) {
      if (ratingKey) {
        try {
          const metaUrl = `${pBase}/library/metadata/${ratingKey}?X-Plex-Token=${plexToken}`;
          const mRes = await fetch(metaUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": plexToken },
            signal: AbortSignal.timeout(6000),
          });
          if (mRes.ok) {
            const mData: any = await mRes.json();
            const item = mData.MediaContainer?.Metadata?.[0];
            if (item) {
              if (title && item.title) {
                const normInput = title.toLowerCase().replace(/[^a-z0-9]/g, "");
                const normItem = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                if (normInput && normItem && !normItem.includes(normInput) && !normInput.includes(normItem)) {
                  return JSON.stringify({
                    ok: false,
                    count: 0,
                    deleted: false,
                    fileDeleted: false,
                    filesDeleted: false,
                    deleteFile: false,
                    deleteFiles: false,
                    removedFromLibrary: false,
                    matches: [],
                    error: `Title mismatch: provided title '${title}' does not match Plex item '${item.title}' (ratingKey: ${ratingKey}). Deletion rejected.`,
                  });
                }
              }
              if (requestedYear && item.year && Math.abs(requestedYear - item.year) > 1) {
                return JSON.stringify({
                  ok: false,
                  count: 0,
                  deleted: false,
                  fileDeleted: false,
                  filesDeleted: false,
                  deleteFile: false,
                  deleteFiles: false,
                  removedFromLibrary: false,
                  matches: [],
                  error: `Year mismatch: provided year ${requestedYear} does not match Plex item '${item.title}' (${item.year}) [ratingKey: ${ratingKey}]. Deletion rejected.`,
                });
              }
              targetTitle = item.title;
              resolvedType = item.type || resolvedType;
              targetYear = item.year || targetYear;
              librarySectionID = item.librarySectionID ? String(item.librarySectionID) : undefined;
              if (item.librarySectionTitle) libraryTitle = String(item.librarySectionTitle);
              seriesTitle = item.grandparentTitle || item.parentTitle;
              parentIndex = item.parentIndex ?? parentIndex;
              episodeIndex = item.index ?? episodeIndex;
              viewCount = typeof item.viewCount === "number" ? item.viewCount : 0;
              const part = item.Media?.[0]?.Part?.[0];
              if (part?.file) filePath = part.file;
              if (typeof part?.size === "number") fileSizeBytes = part.size;
            }
          }
        } catch {
          // fallback
        }
      } else if (title) {
        try {
          const searchUrl = `${pBase}/search?query=${encodeURIComponent(title)}&X-Plex-Token=${plexToken}`;
          const sRes = await fetch(searchUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": plexToken },
            signal: AbortSignal.timeout(6000),
          });
          if (sRes.ok) {
            const sData: any = await sRes.json();
            const items: any[] = sData.MediaContainer?.Metadata || [];
            let candidates = items;
            if (requestedLibrary) {
              candidates = candidates.filter(
                (m) =>
                  String(m.librarySectionTitle || "").toLowerCase() === requestedLibrary.toLowerCase() ||
                  String(m.librarySectionID || "") === requestedLibrary
              );
            }
            if (requestedType) {
              candidates = candidates.filter((m) => m.type === requestedType);
            }
            if (requestedYear) {
              candidates = candidates.filter((m) => m.year === requestedYear);
            }
            if (seasonNum !== undefined && episodeNum !== undefined) {
              const epMatch = candidates.find((m) => m.type === "episode" && m.parentIndex === seasonNum && m.index === episodeNum);
              if (epMatch) candidates = [epMatch];
            }

            const exactMatches = candidates.filter((m) => m.title.toLowerCase() === title.toLowerCase());
            let match: any;
            if (exactMatches.length === 1) {
              match = exactMatches[0];
            } else if (exactMatches.length > 1) {
              const yearMatch = requestedYear ? exactMatches.find((m) => m.year === requestedYear) : undefined;
              if (yearMatch) {
                match = yearMatch;
              } else {
                const list = exactMatches.map((m) => `'${m.title}' (${m.year || "unknown"}) [ratingKey: ${m.ratingKey}]`).join(", ");
                const matchItems = exactMatches.map((m) => ({
                  title: m.title,
                  year: m.year,
                  mediaType: m.type,
                  ratingKey: String(m.ratingKey || m.key?.split("/").pop() || ""),
                }));
                return JSON.stringify({
                  ok: false,
                  count: exactMatches.length,
                  deleted: false,
                  fileDeleted: false,
                  removedFromLibrary: false,
                  matches: matchItems,
                  error: `Multiple matching items found for '${title}': ${list}. Specify ratingKey or year to target exactly one item.`,
                });
              }
            } else {
              const partialMatches = candidates.filter((m) => m.title.toLowerCase().includes(title.toLowerCase()));
              if (partialMatches.length === 1) {
                match = partialMatches[0];
              } else if (partialMatches.length > 1) {
                if (confirm && !ratingKey) {
                  const list = partialMatches.slice(0, 5).map((m) => `'${m.title}' (${m.year || "unknown"}) [ratingKey: ${m.ratingKey}]`).join(", ");
                  const matchItems = partialMatches.slice(0, 5).map((m) => ({
                    title: m.title,
                    year: m.year,
                    mediaType: m.type,
                    ratingKey: String(m.ratingKey || m.key?.split("/").pop() || ""),
                  }));
                  return JSON.stringify({
                    ok: false,
                    count: partialMatches.length,
                    deleted: false,
                    fileDeleted: false,
                    removedFromLibrary: false,
                    matches: matchItems,
                    error: `Multiple items match '${title}': ${list}. Ambiguous deletion rejected — specify exact ratingKey to delete exactly one item.`,
                  });
                }
                match = partialMatches[0];
              } else {
                const looseMatch = candidates.find(
                  (m) =>
                    m.title?.toLowerCase().includes(title.toLowerCase()) ||
                    title.toLowerCase().includes(m.title?.toLowerCase())
                );
                match = looseMatch;
              }
            }

            if (match) {
              ratingKey = String(match.ratingKey || match.key?.split("/").pop() || "");
              targetTitle = match.title;
              targetYear = match.year || targetYear;
              resolvedType = match.type || resolvedType;
              librarySectionID = match.librarySectionID ? String(match.librarySectionID) : undefined;
              if (match.librarySectionTitle) libraryTitle = String(match.librarySectionTitle);
              seriesTitle = match.grandparentTitle || match.parentTitle;
              parentIndex = match.parentIndex ?? parentIndex;
              episodeIndex = match.index ?? episodeIndex;
              viewCount = typeof match.viewCount === "number" ? match.viewCount : 0;
              const part = match.Media?.[0]?.Part?.[0];
              if (part?.file) filePath = part.file;
              if (typeof part?.size === "number") fileSizeBytes = part.size;

              // If match is missing full Part details, fetch full metadata
              if (ratingKey && (!filePath || fileSizeBytes === undefined)) {
                try {
                  const mRes = await fetch(`${pBase}/library/metadata/${ratingKey}?X-Plex-Token=${plexToken}`, {
                    headers: { Accept: "application/json", "X-Plex-Token": plexToken },
                    signal: AbortSignal.timeout(4000),
                  });
                  if (mRes.ok) {
                    const mData: any = await mRes.json();
                    const fullItem = mData.MediaContainer?.Metadata?.[0];
                    if (fullItem) {
                      if (fullItem.librarySectionTitle) libraryTitle = String(fullItem.librarySectionTitle);
                      if (typeof fullItem.viewCount === "number") viewCount = fullItem.viewCount;
                      const fPart = fullItem.Media?.[0]?.Part?.[0];
                      if (fPart?.file) filePath = fPart.file;
                      if (typeof fPart?.size === "number") fileSizeBytes = fPart.size;
                    }
                  }
                } catch {
                  // continue
                }
              }
            }
          }
        } catch {
          // fallback
        }
      }
    }

    // 2. Locate in Radarr / Sonarr
    if ((resolvedType === "movie" || !requestedType) && radarrKey && rBase) {
      try {
        const lookupUrl = `${rBase}/api/v3/movie`;
        const rListRes = await fetch(lookupUrl, {
          headers: { "X-Api-Key": radarrKey, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (rListRes.ok) {
          const movies: any[] = await rListRes.json();
          const rMatch = movies.find((m) => {
            const matchesTitle = m.title.toLowerCase() === targetTitle.toLowerCase();
            const matchesYear = targetYear ? m.year === targetYear : true;
            return matchesTitle && matchesYear;
          }) || movies.find((m) => m.title.toLowerCase().includes(targetTitle.toLowerCase()));
          if (rMatch && rMatch.id) {
            radarrId = rMatch.id;
            if (!targetTitle) targetTitle = rMatch.title;
            if (!targetYear) targetYear = rMatch.year;
            resolvedType = "movie";
            if (!filePath && rMatch.movieFile?.path) filePath = rMatch.movieFile.path;
            if (fileSizeBytes === undefined && typeof rMatch.movieFile?.size === "number") {
              fileSizeBytes = rMatch.movieFile.size;
            }
          }
        }
      } catch {
        // continue
      }
    }

    if ((resolvedType === "show" || resolvedType === "episode" || (!radarrId && !ratingKey)) && sonarrKey && sBase) {
      try {
        const lookupUrl = `${sBase}/api/v3/series`;
        const sListRes = await fetch(lookupUrl, {
          headers: { "X-Api-Key": sonarrKey, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (sListRes.ok) {
          const seriesList: any[] = await sListRes.json();
          const showSearch = seriesTitle || targetTitle;
          const sMatch = seriesList.find((s) => s.title.toLowerCase() === showSearch.toLowerCase()) ||
            seriesList.find((s) => s.title.toLowerCase().includes(showSearch.toLowerCase()));
          if (sMatch && sMatch.id) {
            sonarrId = sMatch.id;
            if (resolvedType === "show" || !requestedType) {
              resolvedType = "show";
              targetTitle = sMatch.title;
              targetYear = sMatch.year;
            } else if (resolvedType === "episode" && parentIndex !== undefined && episodeIndex !== undefined) {
              const epUrl = `${sBase}/api/v3/episode?seriesId=${sMatch.id}&seasonNumber=${parentIndex}`;
              const epRes = await fetch(epUrl, {
                headers: { "X-Api-Key": sonarrKey, Accept: "application/json" },
                signal: AbortSignal.timeout(6000),
              });
              if (epRes.ok) {
                const episodes: any[] = await epRes.json();
                const epMatch = episodes.find((e) => e.episodeNumber === episodeIndex);
                if (epMatch && epMatch.episodeFileId) {
                  episodeFileId = epMatch.episodeFileId;
                }
              }
            }
          }
        }
      } catch {
        // continue
      }
    }

    // 3. Confirm-first Guard
    if (!confirm) {
      if (!ratingKey) {
        return JSON.stringify({
          ok: true,
          count: 0,
          matches: [],
          deleted: false,
          fileDeleted: false,
          filesDeleted: false,
          deleteFile: false,
          deleteFiles: false,
          removedFromLibrary: false,
          needsConfirm: false,
          confirmationRequired: false,
          query: title,
          title: targetTitle,
          message: `Title '${targetTitle}' was not found in Plex. Nothing to delete.`,
        });
      }

      const typeLabel = resolvedType === "show" ? "TV show" : resolvedType === "episode" ? "episode" : "movie";
      const episodeDetail = resolvedType === "episode"
        ? ` (S${parentIndex}E${episodeIndex}${seriesTitle ? ` of '${seriesTitle}'` : ""})`
        : "";
      const targetObj = {
        title: targetTitle,
        type: resolvedType,
        mediaType: resolvedType,
        year: targetYear,
        library: libraryTitle || librarySectionID || undefined,
        ratingKey: ratingKey || undefined,
        filePath: filePath || undefined,
        fileSizeBytes: fileSizeBytes ?? undefined,
        viewCount,
        watched: Boolean(viewCount > 0),
        deleteFile: false,
        deleteFiles: false,
        removedFromLibrary: false,
        series: seriesTitle || undefined,
        season: parentIndex || undefined,
        episode: episodeIndex || undefined,
        inPlex: Boolean(ratingKey),
        inArr: Boolean(radarrId || sonarrId),
      };
      return JSON.stringify({
        ok: true,
        count: 1,
        deleted: false,
        fileDeleted: false,
        filesDeleted: false,
        deleteFile: false,
        deleteFiles: false,
        removedFromLibrary: false,
        needsConfirm: true,
        confirmationRequired: true,
        status: "confirmation_required",
        error: "confirmation_required",
        query: title,
        title: targetTitle,
        year: targetYear,
        type: resolvedType,
        mediaType: resolvedType,
        library: libraryTitle || librarySectionID || undefined,
        ratingKey: ratingKey || undefined,
        filePath: filePath || undefined,
        fileSizeBytes: fileSizeBytes ?? undefined,
        viewCount,
        watched: Boolean(viewCount > 0),
        confirmHint: ratingKey
          ? `Re-call with ratingKey "${ratingKey}", title "${targetTitle}", confirm: true${deleteFiles ? ", deleteFile: true" : ""}`
          : `Re-call with title "${targetTitle}", confirm: true${deleteFiles ? ", deleteFile: true" : ""}`,
        matches: [targetObj],
        target: targetObj,
        message: `Deleting '${targetTitle}' will permanently delete media files from disk. Call ${toolName} again with confirm: true to proceed. Found ${typeLabel} '${targetTitle}'${episodeDetail}${targetYear ? ` (${targetYear})` : ""}.`,
      });
    }

    // If confirm is true but item could not be found anywhere
    if (!ratingKey && !radarrId && !sonarrId && !episodeFileId) {
      return JSON.stringify({
        ok: false,
        count: 0,
        deleted: false,
        fileDeleted: false,
        filesDeleted: false,
        deleteFile: false,
        deleteFiles: false,
        removedFromLibrary: false,
        error: `Could not delete '${targetTitle}'. Media not found in Plex, Radarr, or Sonarr, or deletion rejected.`,
      });
    }

    // 4. Execution (confirm: true)
    let deletedFromPlex = false;
    let deletedFromRadarr = false;
    let deletedFromSonarr = false;

    // Delete from Plex
    if (plexToken && ratingKey) {
      try {
        const delUrl = `${pBase}/library/metadata/${ratingKey}?X-Plex-Token=${plexToken}`;
        const pDelRes = await fetch(delUrl, {
          method: "DELETE",
          headers: { "X-Plex-Token": plexToken },
          signal: AbortSignal.timeout(8000),
        });
        deletedFromPlex = pDelRes.ok || pDelRes.status === 200 || pDelRes.status === 204;
        if (librarySectionID) {
          fetch(`${pBase}/library/sections/${librarySectionID}/emptyTrash?X-Plex-Token=${plexToken}`, {
            method: "PUT",
            headers: { "X-Plex-Token": plexToken },
          }).catch(() => {});
        }
      } catch {
        // continue
      }
    }

    // Delete from Radarr (movie)
    if (resolvedType === "movie" && radarrKey && rBase) {
      try {
        if (!radarrId) {
          const lookupUrl = `${rBase}/api/v3/movie`;
          const rListRes = await fetch(lookupUrl, {
            headers: { "X-Api-Key": radarrKey, Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          if (rListRes.ok) {
            const movies: any[] = await rListRes.json();
            const rMatch = movies.find((m) => {
              const matchesTitle = m.title.toLowerCase() === targetTitle.toLowerCase();
              const matchesYear = targetYear ? m.year === targetYear : true;
              return matchesTitle && matchesYear;
            }) || movies.find((m) => m.title.toLowerCase().includes(targetTitle.toLowerCase()));
            if (rMatch) radarrId = rMatch.id;
          }
        }
        if (radarrId) {
          const delRadarrUrl = `${rBase}/api/v3/movie/${radarrId}?deleteFiles=${deleteFiles}&addImportExclusion=false`;
          const rDelRes = await fetch(delRadarrUrl, {
            method: "DELETE",
            headers: { "X-Api-Key": radarrKey },
            signal: AbortSignal.timeout(8000),
          });
          deletedFromRadarr = rDelRes.ok || rDelRes.status === 200 || rDelRes.status === 204;
        }
      } catch {
        // continue
      }
    }

    // Delete from Sonarr (show or episode)
    if ((resolvedType === "show" || resolvedType === "episode") && sonarrKey && sBase) {
      try {
        if (resolvedType === "show" && sonarrId) {
          const delSonarrUrl = `${sBase}/api/v3/series/${sonarrId}?deleteFiles=${deleteFiles}&addImportExclusion=false`;
          const sDelRes = await fetch(delSonarrUrl, {
            method: "DELETE",
            headers: { "X-Api-Key": sonarrKey },
            signal: AbortSignal.timeout(8000),
          });
          deletedFromSonarr = sDelRes.ok || sDelRes.status === 200 || sDelRes.status === 204;
        } else if (resolvedType === "episode" && episodeFileId) {
          const delEpUrl = `${sBase}/api/v3/episodefile/${episodeFileId}`;
          const epDelRes = await fetch(delEpUrl, {
            method: "DELETE",
            headers: { "X-Api-Key": sonarrKey },
            signal: AbortSignal.timeout(8000),
          });
          deletedFromSonarr = epDelRes.ok || epDelRes.status === 200 || epDelRes.status === 204;
        }
      } catch {
        // continue
      }
    }

    if (!deletedFromPlex && !deletedFromRadarr && !deletedFromSonarr) {
      return JSON.stringify({
        ok: false,
        deleted: false,
        fileDeleted: false,
        removedFromLibrary: false,
        error: `Could not delete '${targetTitle}'. Media not found in Plex or Arr services, or deletion rejected.`,
      });
    }

    const typeLabel = resolvedType === "show" ? "TV show" : resolvedType === "episode" ? "episode" : "movie";
    return JSON.stringify({
      ok: true,
      count: 1,
      deleted: true,
      removedFromLibrary: true,
      fileDeleted: deleteFiles,
      filesDeleted: deleteFiles,
      deleteFile: deleteFiles,
      deleteFiles: deleteFiles,
      mediaType: resolvedType,
      type: resolvedType,
      library: libraryTitle || librarySectionID || undefined,
      title: targetTitle,
      year: targetYear,
      ratingKey: ratingKey || undefined,
      viewCount,
      watched: Boolean(viewCount > 0),
      deletedFromPlex,
      deletedFromArr: deletedFromRadarr || deletedFromSonarr,
      deletedFromRadarr: deletedFromRadarr || undefined,
      deletedFromSonarr: deletedFromSonarr || undefined,
      matches: [
        {
          title: targetTitle,
          type: resolvedType,
          mediaType: resolvedType,
          year: targetYear,
          library: libraryTitle || librarySectionID || undefined,
          ratingKey: ratingKey || undefined,
          viewCount,
          watched: Boolean(viewCount > 0),
          deleted: true,
          removedFromLibrary: true,
          fileDeleted: deleteFiles,
          deleteFile: deleteFiles,
          inPlex: false,
          inArr: false,
        },
      ],
      message: deleteFiles
        ? `Successfully deleted ${typeLabel} '${targetTitle}' from media library and disk.`
        : `Successfully removed ${typeLabel} '${targetTitle}' from media library (media files preserved on disk).`,
    });
  } catch (err: any) {
    return JSON.stringify({
      ok: false,
      count: 0,
      deleted: false,
      fileDeleted: false,
      filesDeleted: false,
      deleteFile: false,
      deleteFiles: false,
      removedFromLibrary: false,
      error: "Failed to delete media from Plex/Arr stack",
      details: err?.message || String(err),
    });
  }
}

export const MEDIA_TOOLS: Tool[] = [
  {
    definition: {
      name: "search_movies",
      description:
        "Search for movies in Radarr / TMDB. Checks if a movie is already downloaded, queued in Radarr, or available to add. Returns title, year, status, tmdbId, and overview.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Movie title to search for (e.g. 'Avatar', 'Dune: Part Two')",
          },
        },
      },
    },
    handler: async (args) => {
      const query = String(args.query || "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });
      const { url, apiKey } = await getRadarrConfig();
      if (!apiKey) {
        return JSON.stringify({ error: "RADARR_API_KEY is not configured" });
      }

      try {
        const res = await fetch(
          `${url}/api/v3/movie/lookup?term=${encodeURIComponent(query)}`,
          {
            headers: {
              "X-Api-Key": apiKey,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) {
          return JSON.stringify({
            error: `Radarr lookup failed with HTTP ${res.status}`,
          });
        }

        const data: any[] = await res.json();
        const movies = (data || []).slice(0, 10).map((m) => {
          const inLibrary = typeof m.id === "number" && m.id > 0;
          const hasFile = Boolean(m.hasFile);
          return {
            title: m.title,
            year: m.year,
            tmdbId: m.tmdbId,
            inLibrary,
            hasFile,
            status: hasFile
              ? "downloaded"
              : inLibrary
              ? "monitored_queued"
              : "ready_to_add",
            overview: m.overview ? m.overview.slice(0, 200) + "..." : "",
            inCinemas: m.inCinemas ?? null,
            digitalRelease: m.digitalRelease ?? null,
          };
        });

        return JSON.stringify({
          query,
          matchCount: movies.length,
          movies,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to search movies in Radarr",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "download_movie",
      description:
        "Add a movie to Radarr and start downloading it immediately via qBittorrent. Can select standard HD or 4K/Ultra-HD.",
      parameters: {
        type: "object",
        required: ["tmdbId"],
        properties: {
          tmdbId: {
            type: "number",
            description: "The TMDB ID of the movie (from search_movies).",
          },
          qualityProfile: {
            type: "string",
            enum: ["standard", "4k"],
            description: "Target quality profile ('4k' for Ultra-HD, 'standard' for 1080p). Defaults to 'standard'.",
          },
        },
      },
    },
    handler: async (args) => {
      const tmdbId = Number(args.tmdbId);
      if (!tmdbId || Number.isNaN(tmdbId)) {
        return JSON.stringify({ error: "valid tmdbId is required" });
      }
      const { url, apiKey } = await getRadarrConfig();
      if (!apiKey) {
        return JSON.stringify({ error: "RADARR_API_KEY is not configured" });
      }

      try {
        const lookupRes = await fetch(
          `${url}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`,
          {
            headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!lookupRes.ok) {
          return JSON.stringify({
            error: `Failed to fetch TMDB movie info (HTTP ${lookupRes.status})`,
          });
        }
        const movieInfo: any = await lookupRes.json();

        if (typeof movieInfo.id === "number" && movieInfo.id > 0) {
          await fetch(`${url}/api/v3/command`, {
            method: "POST",
            headers: {
              "X-Api-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "MoviesSearch",
              movieIds: [movieInfo.id],
            }),
            signal: AbortSignal.timeout(8000),
          });
          return JSON.stringify({
            status: "search_triggered",
            title: movieInfo.title,
            year: movieInfo.year,
            message: `Search command triggered for already tracked movie '${movieInfo.title}'`,
          });
        }

        const [profilesRes, foldersRes] = await Promise.all([
          fetch(`${url}/api/v3/qualityprofile`, {
            headers: { "X-Api-Key": apiKey },
            signal: AbortSignal.timeout(5000),
          }),
          fetch(`${url}/api/v3/rootfolder`, {
            headers: { "X-Api-Key": apiKey },
            signal: AbortSignal.timeout(5000),
          }),
        ]);

        const profiles: any[] = profilesRes.ok ? await profilesRes.json() : [];
        const folders: any[] = foldersRes.ok ? await foldersRes.json() : [];

        const is4k = args.qualityProfile === "4k";
        let targetProfile = profiles.find((p) =>
          is4k
            ? /ultra-?hd|4k/i.test(p.name)
            : /hd-1080p|hd|standard/i.test(p.name)
        );
        if (!targetProfile && profiles.length > 0) {
          targetProfile = profiles[0];
        }

        let targetFolder = folders.find((f) =>
          is4k ? /4k/i.test(f.path) : !/4k/i.test(f.path)
        );
        if (!targetFolder && folders.length > 0) {
          targetFolder = folders[0];
        }

        const payload = {
          ...movieInfo,
          qualityProfileId: targetProfile ? targetProfile.id : 1,
          rootFolderPath: targetFolder ? targetFolder.path : "/media/Movies",
          monitored: true,
          addOptions: {
            searchForMovie: true,
          },
        };

        const addRes = await fetch(`${url}/api/v3/movie`, {
          method: "POST",
          headers: {
            "X-Api-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        if (!addRes.ok) {
          const errBody = await addRes.text();
          return JSON.stringify({
            error: `Failed to add movie to Radarr (HTTP ${addRes.status})`,
            details: errBody,
          });
        }

        const added: any = await addRes.json();
        return JSON.stringify({
          status: "added_and_searching",
          title: added.title,
          year: added.year,
          qualityProfile: targetProfile?.name ?? "Default",
          folder: targetFolder?.path ?? "Default",
          message: `Added '${added.title}' to Radarr and initiated download search.`,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to download movie",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "search_shows",
      description:
        "Search for TV shows in Sonarr / TVDB. Checks if a show is already tracked, monitored seasons, and availability. Returns title, year, tvdbId, status, and season count.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "TV show title to search for (e.g. 'Breaking Bad', 'Bluey')",
          },
        },
      },
    },
    handler: async (args) => {
      const query = String(args.query || "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });
      const { url, apiKey } = await getSonarrConfig();
      if (!apiKey) {
        return JSON.stringify({ error: "SONARR_API_KEY is not configured" });
      }

      try {
        const res = await fetch(
          `${url}/api/v3/series/lookup?term=${encodeURIComponent(query)}`,
          {
            headers: {
              "X-Api-Key": apiKey,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) {
          return JSON.stringify({
            error: `Sonarr lookup failed with HTTP ${res.status}`,
          });
        }

        const data: any[] = await res.json();
        const shows = (data || []).slice(0, 10).map((s) => ({
          title: s.title,
          year: s.year,
          tvdbId: s.tvdbId,
          inLibrary: typeof s.id === "number" && s.id > 0,
          status: s.status,
          seasonCount: s.seasonCount ?? (s.seasons ? s.seasons.length : 0),
          overview: s.overview ? s.overview.slice(0, 200) + "..." : "",
          network: s.network ?? "",
        }));

        return JSON.stringify({
          query,
          matchCount: shows.length,
          shows,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to search TV shows in Sonarr",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "download_show",
      description:
        "Add a TV show to Sonarr and start downloading it via qBittorrent. Can specify a specific season or monitor all seasons.",
      parameters: {
        type: "object",
        required: ["tvdbId"],
        properties: {
          tvdbId: {
            type: "number",
            description: "The TVDB ID of the TV show (from search_shows).",
          },
          season: {
            type: "number",
            description: "Optional specific season number to monitor and download. If omitted, monitors all seasons.",
          },
        },
      },
    },
    handler: async (args) => {
      const tvdbId = Number(args.tvdbId);
      if (!tvdbId || Number.isNaN(tvdbId)) {
        return JSON.stringify({ error: "valid tvdbId is required" });
      }
      const { url, apiKey } = await getSonarrConfig();
      if (!apiKey) {
        return JSON.stringify({ error: "SONARR_API_KEY is not configured" });
      }

      try {
        const lookupRes = await fetch(
          `${url}/api/v3/series/lookup?term=tvdb:${tvdbId}`,
          {
            headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!lookupRes.ok) {
          return JSON.stringify({
            error: `Failed to fetch TV show info (HTTP ${lookupRes.status})`,
          });
        }
        const results: any[] = await lookupRes.json();
        const showInfo = results && results.length > 0 ? results[0] : null;
        if (!showInfo) {
          return JSON.stringify({ error: `No TV show found for tvdbId ${tvdbId}` });
        }

        if (typeof showInfo.id === "number" && showInfo.id > 0) {
          await fetch(`${url}/api/v3/command`, {
            method: "POST",
            headers: {
              "X-Api-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "SeriesSearch",
              seriesId: showInfo.id,
            }),
            signal: AbortSignal.timeout(8000),
          });
          return JSON.stringify({
            status: "search_triggered",
            title: showInfo.title,
            message: `Search command triggered for already tracked show '${showInfo.title}'`,
          });
        }

        const [profilesRes, foldersRes] = await Promise.all([
          fetch(`${url}/api/v3/qualityprofile`, {
            headers: { "X-Api-Key": apiKey },
            signal: AbortSignal.timeout(5000),
          }),
          fetch(`${url}/api/v3/rootfolder`, {
            headers: { "X-Api-Key": apiKey },
            signal: AbortSignal.timeout(5000),
          }),
        ]);

        const profiles: any[] = profilesRes.ok ? await profilesRes.json() : [];
        const folders: any[] = foldersRes.ok ? await foldersRes.json() : [];

        const targetProfile = profiles.find((p) => /hd|standard/i.test(p.name)) || profiles[0];
        const targetFolder = folders[0];

        const targetSeason = typeof args.season === "number" ? args.season : null;
        const seasons = (showInfo.seasons || []).map((s: any) => ({
          seasonNumber: s.seasonNumber,
          monitored: targetSeason !== null ? s.seasonNumber === targetSeason : true,
        }));

        const payload = {
          ...showInfo,
          qualityProfileId: targetProfile ? targetProfile.id : 1,
          rootFolderPath: targetFolder ? targetFolder.path : "/media/TV",
          monitored: true,
          seasons,
          addOptions: {
            searchForMissingEpisodes: true,
          },
        };

        const addRes = await fetch(`${url}/api/v3/series`, {
          method: "POST",
          headers: {
            "X-Api-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        if (!addRes.ok) {
          const errBody = await addRes.text();
          return JSON.stringify({
            error: `Failed to add show to Sonarr (HTTP ${addRes.status})`,
            details: errBody,
          });
        }

        const added: any = await addRes.json();
        return JSON.stringify({
          status: "added_and_searching",
          title: added.title,
          seasonsMonitored: targetSeason !== null ? `Season ${targetSeason}` : "All Seasons",
          message: `Added '${added.title}' to Sonarr and initiated download search.`,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to download TV show",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_media_downloads",
      description:
        "Check active torrent download progress, speeds, and ETA in qBittorrent and media download clients.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      const { url } = getQbittorrentConfig();
      try {
        const cookie = await getQbittorrentCookie();
        if (!cookie) {
          return JSON.stringify({
            error: "Unable to authenticate with qBittorrent client",
          });
        }

        const res = await fetch(`${url}/api/v2/torrents/info`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(6000),
        });

        if (!res.ok) {
          return JSON.stringify({
            error: `qBittorrent torrents query returned HTTP ${res.status}`,
          });
        }

        const torrents: any[] = await res.json();
        const active = (torrents || []).map((t) => ({
          name: t.name,
          state: t.state,
          progress: `${(t.progress * 100).toFixed(1)}%`,
          downloadSpeed: formatBytes(t.dlspeed) + "/s",
          uploadSpeed: formatBytes(t.upspeed) + "/s",
          size: formatBytes(t.size),
          eta: formatEta(t.eta),
        }));

        const totalDlSpeed = (torrents || []).reduce((sum, t) => sum + (t.dlspeed || 0), 0);
        const totalUpSpeed = (torrents || []).reduce((sum, t) => sum + (t.upspeed || 0), 0);

        return JSON.stringify({
          activeTorrentCount: active.length,
          totalDownloadSpeed: formatBytes(totalDlSpeed) + "/s",
          totalUploadSpeed: formatBytes(totalUpSpeed) + "/s",
          torrents: active.slice(0, 15),
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to query active downloads from qBittorrent",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "check_plex_inventory",
      description:
        "Search the Garcia family Plex library to check if a movie, episode, or show is already in the collection and ready to watch.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Title or keyword to search in Plex.",
          },
        },
      },
    },
    handler: async (args) => {
      const query = String(args.query || "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });
      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      try {
        const url = `${plexBaseUrl.replace(/\/+$/, "")}/search?query=${encodeURIComponent(query)}&X-Plex-Token=${token}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Plex-Token": token },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          return JSON.stringify({
            error: `Plex search returned HTTP ${res.status}`,
          });
        }

        const data: any = await res.json();
        const items: any[] = data.MediaContainer?.Metadata || [];
        const matches = items.slice(0, 10).map((item) => ({
          title: item.title,
          ratingKey: String(item.ratingKey || item.key?.split("/").pop() || ""),
          library: item.librarySectionTitle?.trim() || "Unknown Library",
          year: item.year,
          type: item.type,
          watched: Boolean(item.viewCount && item.viewCount > 0),
          viewCount: item.viewCount || 0,
          lastViewedAt: item.lastViewedAt
            ? new Date(item.lastViewedAt * 1000).toISOString()
            : null,
          resolution: item.Media?.[0]?.videoResolution || "unknown",
          audio: item.Media?.[0]?.audioProfile || item.Media?.[0]?.audioCodec || "unknown",
          summary: item.summary ? item.summary.slice(0, 200) + "..." : "",
        }));

        return JSON.stringify({
          query,
          matchCount: matches.length,
          inPlex: matches.length > 0,
          items: matches,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to search Plex inventory",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_plex_watch_history",
      description:
        "Get recent watch history from Plex to see what movies or TV episodes have been watched by the family. Returns watched titles, media type, viewed date/time, user, and device. Can filter by media type (movie, episode, or all) and search query.",
      parameters: {
        type: "object",
        properties: {
          mediaType: {
            type: "string",
            enum: ["movie", "episode", "all"],
            description: "Filter by media type: 'movie' for watched movies, 'episode' for TV episodes, or 'all'. Defaults to 'movie'.",
          },
          limit: {
            type: "number",
            description: "Maximum number of history items to return (1-50, default 20).",
          },
          query: {
            type: "string",
            description: "Optional keyword to filter watched titles by name (e.g. 'Gladiator', 'Dune').",
          },
        },
      },
    },
    handler: async (args) => {
      const mediaType = String(args.mediaType || "movie").toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const query = String(args.query || "").trim().toLowerCase();

      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      try {
        let typeQuery = "";
        if (mediaType === "movie") typeQuery = "&type=1";
        else if (mediaType === "episode") typeQuery = "&type=4";

        const endpoint = `${plexBaseUrl.replace(/\/+$/, "")}/status/sessions/history/all?sort=viewedAt:desc${typeQuery}&X-Plex-Token=${token}`;
        const res = await fetch(endpoint, {
          headers: { Accept: "application/json", "X-Plex-Token": token },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          return JSON.stringify({
            error: `Plex history query returned HTTP ${res.status}`,
          });
        }

        const data: any = await res.json();
        const items: any[] = data.MediaContainer?.Metadata || [];

        let filtered = items;
        if (query) {
          filtered = filtered.filter((item) => {
            const title = (item.title || "").toLowerCase();
            const grand = (item.grandparentTitle || "").toLowerCase();
            return title.includes(query) || grand.includes(query);
          });
        }

        const history = filtered.slice(0, limit).map((item) => {
          const isEpisode = item.type === "episode";
          const displayTitle = isEpisode
            ? `${item.grandparentTitle || "Show"} S${item.parentIndex || 0}E${item.index || 0} - ${item.title}`
            : item.title;
          const viewedAtIso = item.viewedAt
            ? new Date(item.viewedAt * 1000).toISOString()
            : null;
          const viewedDate = item.viewedAt
            ? new Date(item.viewedAt * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "unknown";

          return {
            title: displayTitle,
            originalTitle: item.title,
            ratingKey: String(item.ratingKey || item.key?.split("/").pop() || ""),
            mediaType: item.type,
            year: item.year,
            viewedAt: viewedAtIso,
            viewedDate,
            user: item.userName || (item.accountID ? `User #${item.accountID}` : "Family"),
            device: item.device || "Unknown Device",
          };
        });

        return JSON.stringify({
          mediaType,
          query: query || undefined,
          historyCount: history.length,
          history,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to get Plex watch history",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_plex_watched_movies",
      description:
        "Search and retrieve movies marked as watched (viewCount > 0) in the Plex movie libraries. Returns movie titles, year, view count, last watched date, rating, and summary. Useful to see all movies watched or check if a specific movie was watched.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional keyword to search within watched movies (e.g. 'Inception', 'Star Wars').",
          },
          limit: {
            type: "number",
            description: "Maximum number of watched movies to return (1-50, default 25).",
          },
          sortBy: {
            type: "string",
            enum: ["lastViewedAt", "title", "viewCount"],
            description: "Sort order: 'lastViewedAt' (most recently watched first), 'title', or 'viewCount'. Defaults to 'lastViewedAt'.",
          },
        },
      },
    },
    handler: async (args) => {
      const query = String(args.query || "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 50);
      const sortBy = String(args.sortBy || "lastViewedAt");

      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      try {
        const base = plexBaseUrl.replace(/\/+$/, "");
        const sectionsRes = await fetch(`${base}/library/sections?X-Plex-Token=${token}`, {
          headers: { Accept: "application/json", "X-Plex-Token": token },
          signal: AbortSignal.timeout(8000),
        });

        if (!sectionsRes.ok) {
          return JSON.stringify({
            error: `Plex library sections query returned HTTP ${sectionsRes.status}`,
          });
        }

        const sectionsData: any = await sectionsRes.json();
        const directories: any[] = sectionsData.MediaContainer?.Directory || [];
        const movieSections = directories.filter((d) => d.type === "movie");

        if (movieSections.length === 0) {
          return JSON.stringify({
            watchedCount: 0,
            movies: [],
            message: "No movie libraries found on Plex server.",
          });
        }

        let plexSort = "lastViewedAt:desc";
        if (sortBy === "title") plexSort = "titleSort:asc";
        else if (sortBy === "viewCount") plexSort = "viewCount:desc";

        const allWatched: any[] = [];

        for (const section of movieSections) {
          const secUrl = `${base}/library/sections/${section.key}/all?unwatched=0&sort=${plexSort}&X-Plex-Token=${token}`;
          const secRes = await fetch(secUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(8000),
          });

          if (secRes.ok) {
            const secData: any = await secRes.json();
            const items: any[] = secData.MediaContainer?.Metadata || [];
            for (const item of items) {
              if (item.viewCount && item.viewCount > 0) {
                allWatched.push({
                  ...item,
                  library: section.title,
                });
              }
            }
          }
        }

        let filtered = allWatched;
        if (query) {
          filtered = filtered.filter((m) => (m.title || "").toLowerCase().includes(query));
        }

        filtered.sort((a, b) => {
          if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
          if (sortBy === "viewCount") return (b.viewCount || 0) - (a.viewCount || 0);
          return (b.lastViewedAt || 0) - (a.lastViewedAt || 0);
        });

        const results = filtered.slice(0, limit).map((m) => ({
          title: m.title,
          ratingKey: String(m.ratingKey || m.key?.split("/").pop() || ""),
          year: m.year,
          library: m.library,
          viewCount: m.viewCount || 1,
          lastViewedAt: m.lastViewedAt ? new Date(m.lastViewedAt * 1000).toISOString() : null,
          lastViewedDate: m.lastViewedAt
            ? new Date(m.lastViewedAt * 1000).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "unknown",
          userRating: m.userRating || m.rating || null,
          summary: m.summary ? m.summary.slice(0, 200) + "..." : "",
        }));

        return JSON.stringify({
          query: query || undefined,
          sortBy,
          watchedMovieCount: results.length,
          totalWatchedFound: filtered.length,
          movies: results,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to get watched movies from Plex",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_plex_active_sessions",
      description:
        "Check what is currently playing on Plex right now across all household devices and users. Shows active streams, who is watching, playback progress, and player device.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      try {
        const url = `${plexBaseUrl.replace(/\/+$/, "")}/status/sessions?X-Plex-Token=${token}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Plex-Token": token },
          signal: AbortSignal.timeout(6000),
        });

        if (!res.ok) {
          return JSON.stringify({
            error: `Plex sessions query returned HTTP ${res.status}`,
          });
        }

        const data: any = await res.json();
        const items: any[] = data.MediaContainer?.Metadata || [];

        const sessions = items.map((item) => {
          const isEpisode = item.type === "episode";
          const displayTitle = isEpisode
            ? `${item.grandparentTitle || "Show"} - ${item.title}`
            : item.title;
          const duration = item.duration || 0;
          const offset = item.viewOffset || 0;
          const progressPercent = duration > 0 ? Math.round((offset / duration) * 100) : 0;

          return {
            title: displayTitle,
            type: item.type,
            year: item.year,
            user: item.User?.title || item.userName || "Family",
            device: item.Player?.title || item.Player?.device || "Plex Player",
            state: item.Player?.state || "playing",
            progress: `${progressPercent}%`,
            resolution: item.Media?.[0]?.videoResolution || "unknown",
          };
        });

        return JSON.stringify({
          activeSessionCount: sessions.length,
          nowPlaying: sessions.length > 0,
          sessions,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to get active Plex sessions",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "edit_plex_movie",
      description:
        "Modify and edit metadata, fields, tags, user rating, or watch status for a movie in the Plex library. Can identify the movie by title or ratingKey. Supports updating title, sort title, summary/overview, release year, studio, content rating, adding collections/genres, setting user rating (0-10), and marking as watched/unwatched.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Movie title to find and edit (e.g. 'Gladiator', 'Inception'). Required if ratingKey is omitted.",
          },
          ratingKey: {
            type: "string",
            description: "Plex ratingKey of the movie if known.",
          },
          newTitle: {
            type: "string",
            description: "New display title for the movie.",
          },
          newSortTitle: {
            type: "string",
            description: "New title for alphabetical sorting (e.g. 'Dark Knight, The').",
          },
          newSummary: {
            type: "string",
            description: "New plot summary / synopsis.",
          },
          newYear: {
            type: "number",
            description: "New release year.",
          },
          newStudio: {
            type: "string",
            description: "New studio name (e.g. 'Warner Bros.', 'Universal Pictures').",
          },
          newContentRating: {
            type: "string",
            description: "New content advisory rating (e.g. 'PG-13', 'R', 'TV-MA').",
          },
          userRating: {
            type: "number",
            description: "Personal or family rating from 0 to 10 (or -1 to clear).",
          },
          watched: {
            type: "boolean",
            description: "true to mark as watched (scrobble), false to mark as unwatched.",
          },
          collection: {
            type: "string",
            description: "Collection name/tag to assign to this movie.",
          },
          refreshMetadata: {
            type: "boolean",
            description: "Set to true to trigger a full metadata refresh from online providers.",
          },
        },
      },
    },
    handler: async (args) => {
      const searchTitle = String(args.title || "").trim();
      let ratingKey = String(args.ratingKey || "").trim();

      if (!searchTitle && !ratingKey) {
        return JSON.stringify({ error: "Either title or ratingKey is required to identify the movie." });
      }

      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      const base = plexBaseUrl.replace(/\/+$/, "");
      let resolvedTitle = searchTitle;
      let librarySectionID = "1";

      try {
        // 1. Resolve ratingKey if only title was provided
        if (!ratingKey) {
          const searchUrl = `${base}/search?query=${encodeURIComponent(searchTitle)}&X-Plex-Token=${token}`;
          const searchRes = await fetch(searchUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(8000),
          });

          if (!searchRes.ok) {
            return JSON.stringify({ error: `Plex search failed with HTTP ${searchRes.status}` });
          }

          const searchData: any = await searchRes.json();
          const items: any[] = searchData.MediaContainer?.Metadata || [];
          const movieMatch = items.find((m) => m.type === "movie" && m.title.toLowerCase().includes(searchTitle.toLowerCase())) || items.find((m) => m.type === "movie");

          if (!movieMatch) {
            return JSON.stringify({ error: `Movie '${searchTitle}' not found in Plex library.` });
          }

          ratingKey = String(movieMatch.ratingKey || movieMatch.key?.split("/").pop() || "");
          resolvedTitle = movieMatch.title;
          if (movieMatch.librarySectionID) librarySectionID = String(movieMatch.librarySectionID);
        }

        const changes: Record<string, unknown> = {};

        // 2. Metadata field edits
        const metadataParams = new URLSearchParams();
        metadataParams.set("type", "1");
        metadataParams.set("id", ratingKey);

        if (args.newTitle) {
          metadataParams.set("title.value", String(args.newTitle).trim());
          metadataParams.set("title.locked", "1");
          changes.title = args.newTitle;
        }
        if (args.newSortTitle) {
          metadataParams.set("titleSort.value", String(args.newSortTitle).trim());
          metadataParams.set("titleSort.locked", "1");
          changes.sortTitle = args.newSortTitle;
        }
        if (args.newSummary) {
          metadataParams.set("summary.value", String(args.newSummary).trim());
          metadataParams.set("summary.locked", "1");
          changes.summary = args.newSummary;
        }
        if (args.newYear) {
          metadataParams.set("year.value", String(args.newYear));
          metadataParams.set("year.locked", "1");
          changes.year = args.newYear;
        }
        if (args.newStudio) {
          metadataParams.set("studio.value", String(args.newStudio).trim());
          metadataParams.set("studio.locked", "1");
          changes.studio = args.newStudio;
        }
        if (args.newContentRating) {
          metadataParams.set("contentRating.value", String(args.newContentRating).trim());
          metadataParams.set("contentRating.locked", "1");
          changes.contentRating = args.newContentRating;
        }
        if (args.collection) {
          metadataParams.set("collection[0].tag.tag", String(args.collection).trim());
          metadataParams.set("collection.locked", "1");
          changes.collection = args.collection;
        }

        if (metadataParams.toString().includes(".value")) {
          metadataParams.set("X-Plex-Token", token);
          const putUrl = `${base}/library/sections/${librarySectionID}/all?${metadataParams.toString()}`;
          const putRes = await fetch(putUrl, {
            method: "PUT",
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(8000),
          });
          if (!putRes.ok) {
            await fetch(`${base}/library/metadata/${ratingKey}?${metadataParams.toString()}`, {
              method: "PUT",
              headers: { Accept: "application/json", "X-Plex-Token": token },
              signal: AbortSignal.timeout(8000),
            });
          }
        }

        // 3. User rating edit
        if (typeof args.userRating === "number") {
          const ratingVal = Math.min(Math.max(args.userRating, -1), 10);
          const rateUrl = `${base}/:/rate?key=${ratingKey}&identifier=com.plexapp.plugins.library&rating=${ratingVal}&X-Plex-Token=${token}`;
          await fetch(rateUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(6000),
          });
          changes.userRating = ratingVal;
        }

        // 4. Watched / unwatched status
        if (typeof args.watched === "boolean") {
          const scrobbleEndpoint = args.watched ? "/:/scrobble" : "/:/unscrobble";
          const scrobbleUrl = `${base}${scrobbleEndpoint}?key=${ratingKey}&identifier=com.plexapp.plugins.library&X-Plex-Token=${token}`;
          await fetch(scrobbleUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(6000),
          });
          changes.watched = args.watched;
        }

        // 5. Metadata refresh
        if (args.refreshMetadata) {
          const refreshUrl = `${base}/library/metadata/${ratingKey}/refresh?X-Plex-Token=${token}`;
          await fetch(refreshUrl, {
            method: "PUT",
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(6000),
          });
          changes.refreshedMetadata = true;
        }

        return JSON.stringify({
          ok: true,
          updated: true,
          title: args.newTitle || resolvedTitle,
          ratingKey,
          changesApplied: changes,
          message: `Successfully updated '${args.newTitle || resolvedTitle}' in Plex library.`,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to edit Plex movie",
          details: err?.message || String(err),
        });
      }
    },
  },

  {
    definition: {
      name: "delete_media",
      description:
        "Permanently delete exactly one movie, TV show, or episode from Plex and disk storage (Radarr/Sonarr). Destructive by design, so the confirm-first guard is mandatory, not optional. Muse's rule (Rubio skill): no destructive operations without confirmation, especially deleting media. Two-step operation: Step 1 (preview) searches and returns target details (ratingKey, filePath, fileSizeBytes, viewCount) and needsConfirm: true without deleting anything. Step 2 requires an explicit second call with confirm: true (and preferably ratingKey) to permanently delete only that single item.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the movie, TV show, or episode to delete (e.g. 'Gladiator', 'Breaking Bad', 'Dune: Part Two'). Accepts query as alias.",
          },
          query: {
            type: "string",
            description: "Search query or title alias as given by the user (e.g. 'Dune: Part Two').",
          },
          confirm: {
            type: "boolean",
            description: "Must be set to true on explicit second call to confirm permanent deletion. If omitted or false, previews the target without deleting.",
          },
          mediaType: {
            type: "string",
            enum: ["movie", "show", "episode"],
            description: "Type of media ('movie', 'show', or 'episode'). If omitted, automatically detected from Plex and Arr libraries.",
          },
          type: {
            type: "string",
            description: "Alias for mediaType ('movie', 'show', or 'episode').",
          },
          library: {
            type: "string",
            description: "Optional Plex library section title (e.g. 'Movies', 'TV Shows') to restrict search scope.",
          },
          ratingKey: {
            type: "string",
            description: "Optional Plex ratingKey if known to ensure exact match.",
          },
          year: {
            type: "number",
            description: "Optional release year to disambiguate identically named titles.",
          },
          seasonNumber: {
            type: "number",
            description: "Optional season number if deleting a specific TV episode.",
          },
          episodeNumber: {
            type: "number",
            description: "Optional episode number if deleting a specific TV episode.",
          },
          deleteFiles: {
            type: "boolean",
            description: "Whether to delete physical media files from disk. Defaults to true.",
          },
          deleteFile: {
            type: "boolean",
            description: "Whether to delete physical media files from disk. Defaults to true.",
          },
        },
      },
    },
    handler: async (args) => {
      return executePlexMediaDelete({ ...args, toolName: "delete_media" });
    },
  },
  {
    definition: {
      name: "delete_plex_media",
      description:
        "Permanently delete exactly one movie, TV show, or episode from Plex and disk storage (Radarr/Sonarr). Destructive by design, so the confirm-first guard is mandatory, not optional. Muse's rule (Rubio skill): no destructive operations without confirmation, especially deleting media. Two-step operation: Step 1 (preview) searches and returns target details (ratingKey, filePath, fileSizeBytes, viewCount) and needsConfirm: true without deleting anything. Step 2 requires an explicit second call with confirm: true (and preferably ratingKey) to permanently delete only that single item.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the movie, TV show, or episode to delete (e.g. 'Gladiator', 'Breaking Bad', 'Dune: Part Two'). Accepts query as alias.",
          },
          query: {
            type: "string",
            description: "Search query or title alias as given by the user (e.g. 'Dune: Part Two').",
          },
          confirm: {
            type: "boolean",
            description: "Must be set to true on explicit second call to confirm permanent deletion. If omitted or false, previews the target without deleting.",
          },
          mediaType: {
            type: "string",
            enum: ["movie", "show", "episode"],
            description: "Type of media ('movie', 'show', or 'episode'). If omitted, automatically detected from Plex and Arr libraries.",
          },
          type: {
            type: "string",
            description: "Alias for mediaType ('movie', 'show', or 'episode').",
          },
          library: {
            type: "string",
            description: "Optional Plex library section title (e.g. 'Movies', 'TV Shows') to restrict search scope.",
          },
          ratingKey: {
            type: "string",
            description: "Optional Plex ratingKey if known to ensure exact match.",
          },
          year: {
            type: "number",
            description: "Optional release year to disambiguate identically named titles.",
          },
          seasonNumber: {
            type: "number",
            description: "Optional season number if deleting a specific TV episode.",
          },
          episodeNumber: {
            type: "number",
            description: "Optional episode number if deleting a specific TV episode.",
          },
          deleteFiles: {
            type: "boolean",
            description: "Whether to delete physical media files from disk. Defaults to true.",
          },
          deleteFile: {
            type: "boolean",
            description: "Whether to delete physical media files from disk. Defaults to true.",
          },
        },
      },
    },
    handler: async (args) => {
      return executePlexMediaDelete({ ...args, toolName: "delete_plex_media" });
    },
  },
  {
    definition: {
      name: "delete_plex_movie",
      description:
        "Permanently delete exactly one movie from the Plex library and Radarr. Destructive by design, so the confirm-first guard is mandatory, not optional. Muse's rule (Rubio skill): no destructive operations without confirmation, especially deleting media. Two-step operation: Step 1 (preview) returns target details and needsConfirm: true without deleting anything. Step 2 requires an explicit second call with confirm: true to permanently delete only that single movie.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the movie to delete (e.g. 'Gladiator', 'Dune: Part Two'). Accepts query as alias.",
          },
          query: {
            type: "string",
            description: "Search query or movie title alias as given by the user (e.g. 'Dune: Part Two').",
          },
          confirm: {
            type: "boolean",
            description: "Must be set to true on explicit second call to confirm permanent deletion. If omitted or false, previews the target without deleting.",
          },
          ratingKey: {
            type: "string",
            description: "Optional Plex ratingKey if known to ensure exact match.",
          },
          year: {
            type: "number",
            description: "Optional release year to disambiguate identically named titles.",
          },
          library: {
            type: "string",
            description: "Optional Plex library section title (e.g. 'Movies') to restrict search scope.",
          },
          deleteFiles: {
            type: "boolean",
            description: "Whether to delete the movie files from disk. Defaults to true.",
          },
          deleteFile: {
            type: "boolean",
            description: "Whether to delete the movie files from disk. Defaults to true.",
          },
        },
      },
    },
    handler: async (args) => {
      return executePlexMediaDelete({ ...args, mediaType: "movie", toolName: "delete_plex_movie" });
    },
  },
  {
    definition: {
      name: "mark_plex_media_watched",
      description:
        "Quickly mark a movie or episode as watched (or unwatched) in Plex. Updates view count and watch history.",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: {
            type: "string",
            description: "Movie or episode title to update in Plex (e.g. 'Gladiator', 'Dune').",
          },
          watched: {
            type: "boolean",
            description: "true to mark as watched (default), false to mark as unwatched.",
          },
          mediaType: {
            type: "string",
            enum: ["movie", "episode"],
            description: "Type of media ('movie' or 'episode'). Defaults to 'movie'.",
          },
          ratingKey: {
            type: "string",
            description: "Optional Plex ratingKey if known.",
          },
        },
      },
    },
    handler: async (args) => {
      const title = String(args.title || "").trim();
      const watched = args.watched !== false;
      const mediaType = String(args.mediaType || "movie").toLowerCase();
      let ratingKey = String(args.ratingKey || "").trim();

      if (!title && !ratingKey) {
        return JSON.stringify({ error: "Title or ratingKey is required." });
      }

      const { url: plexBaseUrl, token } = await getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      const base = plexBaseUrl.replace(/\/+$/, "");

      try {
        if (!ratingKey) {
          const searchUrl = `${base}/search?query=${encodeURIComponent(title)}&X-Plex-Token=${token}`;
          const searchRes = await fetch(searchUrl, {
            headers: { Accept: "application/json", "X-Plex-Token": token },
            signal: AbortSignal.timeout(8000),
          });
          if (!searchRes.ok) {
            return JSON.stringify({ error: `Plex search returned HTTP ${searchRes.status}` });
          }
          const data: any = await searchRes.json();
          const items: any[] = data.MediaContainer?.Metadata || [];
          const match = items.find((m) => m.type === mediaType && m.title.toLowerCase().includes(title.toLowerCase())) || items.find((m) => m.type === mediaType);
          if (!match) {
            return JSON.stringify({ error: `Media '${title}' (${mediaType}) not found in Plex.` });
          }
          ratingKey = String(match.ratingKey || match.key?.split("/").pop() || "");
        }

        const endpoint = watched ? "/:/scrobble" : "/:/unscrobble";
        const url = `${base}${endpoint}?key=${ratingKey}&identifier=com.plexapp.plugins.library&X-Plex-Token=${token}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "X-Plex-Token": token },
          signal: AbortSignal.timeout(6000),
        });

        if (!res.ok) {
          return JSON.stringify({ error: `Plex returned HTTP ${res.status} when updating watch status.` });
        }

        return JSON.stringify({
          ok: true,
          title,
          ratingKey,
          watched,
          message: `Successfully marked '${title}' as ${watched ? "watched" : "unwatched"} in Plex.`,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to update Plex watch status",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_media_stack_health",
      description:
        "Check connection and health status of all media stack services (Plex, Radarr, Sonarr, qBittorrent, Prowlarr).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      const radarr = await getRadarrConfig();
      const sonarr = await getSonarrConfig();
      const plex = await getPlexConfig();
      const prowlarr = getProwlarrConfig();

      const checks = await Promise.allSettled([
        // Radarr
        (async () => {
          if (!radarr.apiKey) return { name: "Radarr", status: "unconfigured" };
          const res = await fetch(`${radarr.url}/api/v3/system/status`, {
            headers: { "X-Api-Key": radarr.apiKey },
            signal: AbortSignal.timeout(4000),
          });
          const d: any = await res.json();
          return { name: "Radarr", status: res.ok ? "healthy" : "error", version: d?.version };
        })(),
        // Sonarr
        (async () => {
          if (!sonarr.apiKey) return { name: "Sonarr", status: "unconfigured" };
          const res = await fetch(`${sonarr.url}/api/v3/system/status`, {
            headers: { "X-Api-Key": sonarr.apiKey },
            signal: AbortSignal.timeout(4000),
          });
          const d: any = await res.json();
          return { name: "Sonarr", status: res.ok ? "healthy" : "error", version: d?.version };
        })(),
        // Plex
        (async () => {
          if (!plex.token) return { name: "Plex", status: "unconfigured" };
          const idRes = await fetch(`${plex.url}/identity`, {
            headers: { "X-Plex-Token": plex.token, Accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          });
          if (!idRes.ok) return { name: "Plex", status: "error", error: `HTTP ${idRes.status}` };
          const secRes = await fetch(`${plex.url}/library/sections`, {
            headers: { "X-Plex-Token": plex.token, Accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          });
          if (secRes.status === 401) {
            return { name: "Plex", status: "unauthorized", error: "PLEX_TOKEN invalid" };
          }
          return { name: "Plex", status: "healthy" };
        })(),
        // qBittorrent
        (async () => {
          const cookie = await getQbittorrentCookie();
          if (!cookie) return { name: "qBittorrent", status: "unauthenticated" };
          const { url } = getQbittorrentConfig();
          const res = await fetch(`${url}/api/v2/app/version`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(4000),
          });
          const version = res.ok ? await res.text() : undefined;
          return { name: "qBittorrent", status: res.ok ? "healthy" : "error", version };
        })(),
        // Prowlarr
        (async () => {
          if (!prowlarr.apiKey) return { name: "Prowlarr", status: "unconfigured" };
          const res = await fetch(`${prowlarr.url}/api/v1/system/status`, {
            headers: { "X-Api-Key": prowlarr.apiKey },
            signal: AbortSignal.timeout(4000),
          });
          const d: any = await res.json();
          return { name: "Prowlarr", status: res.ok ? "healthy" : "error", version: d?.version };
        })(),
      ]);

      const results = checks.map((c, i) => {
        if (c.status === "fulfilled") return c.value;
        const names = ["Radarr", "Sonarr", "Plex", "qBittorrent", "Prowlarr"];
        return { name: names[i], status: "offline", error: c.reason?.message || "unreachable" };
      });

      const allHealthy = results.every((r) => r.status === "healthy");

      return JSON.stringify({
        allHealthy,
        services: results,
      });
    },
  },
];
