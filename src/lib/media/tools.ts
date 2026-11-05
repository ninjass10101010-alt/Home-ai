// src/lib/media/tools.ts
// Tools for Rubio (Garcia Family Media Stack Manager).
// Integrates Radarr, Sonarr, qBittorrent, and Plex for media search, acquisition, and status.

import type { Tool } from "@/lib/hermes-tools";

function getRadarrConfig() {
  return {
    url: process.env.RADARR_URL?.trim() || "http://radarr:7878",
    apiKey: process.env.RADARR_API_KEY?.trim() || "",
  };
}

function getSonarrConfig() {
  return {
    url: process.env.SONARR_URL?.trim() || "http://sonarr:8989",
    apiKey: process.env.SONARR_API_KEY?.trim() || "",
  };
}

function getPlexConfig() {
  return {
    url: process.env.PLEX_URL?.trim() || "http://192.168.0.28:32400",
    token: process.env.PLEX_TOKEN?.trim() || "",
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
      const { url, apiKey } = getRadarrConfig();
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
      const { url, apiKey } = getRadarrConfig();
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
      const { url, apiKey } = getSonarrConfig();
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
      const { url, apiKey } = getSonarrConfig();
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
      const { url: plexBaseUrl, token } = getPlexConfig();
      if (!token) {
        return JSON.stringify({ error: "PLEX_TOKEN is not configured" });
      }

      try {
        const url = `${plexBaseUrl}/search?query=${encodeURIComponent(query)}&X-Plex-Token=${token}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
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
          library: item.librarySectionTitle?.trim() || "Unknown Library",
          year: item.year,
          type: item.type,
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
      name: "get_media_stack_health",
      description:
        "Check connection and health status of all media stack services (Plex, Radarr, Sonarr, qBittorrent, Prowlarr).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      const radarr = getRadarrConfig();
      const sonarr = getSonarrConfig();
      const plex = getPlexConfig();
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
          const res = await fetch(`${plex.url}/identity`, {
            signal: AbortSignal.timeout(4000),
          });
          return { name: "Plex", status: res.ok ? "healthy" : "error" };
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
