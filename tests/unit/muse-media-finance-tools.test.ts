import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FINANCE_TOOLS } from "@/lib/finance/tools";
import { MEDIA_TOOLS } from "@/lib/media/tools";
import { getTool } from "@/lib/hermes-tools";

describe("Alex Finance Tools", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("FINANCE_DASHBOARD_URL", "http://mock-finance");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  const mockDashboardData = {
    selectedMonthKey: "2026-11",
    yearData: {
      "2026-11": {
        period: {
          monthLabel: "November",
          yearLabel: "2026",
          volume: "Vol. XI",
        },
        ledger: {
          totalBudgeted: 7712.84,
          totalSpent: 1200.5,
          leftToSpend: 6512.34,
          projectedSurplus: 500,
        },
        accounts: [
          {
            name: "LMCU Checking",
            institution: "LMCU · 9912",
            type: "Checking",
            balance: 1500.0,
            delta: 50,
          },
          {
            name: "LMCU Shares",
            institution: "LMCU · 5510",
            type: "Savings",
            balance: 5000.0,
            delta: 0,
          },
          {
            name: "Tesla Loan",
            institution: "Tesla Finance · 4410",
            type: "Loan",
            balance: 44000.0,
            delta: -700,
          },
        ],
        bills: [
          {
            name: "Mortgage",
            vendor: "Shared",
            amount: 2800,
            actual: 2800,
            dueDay: 1,
            status: "Paid",
          },
          {
            name: "Electric/Trash/Water",
            vendor: "Shared",
            amount: 320,
            actual: 0,
            dueDay: 8,
            status: "Scheduled",
          },
        ],
        expenses: [
          {
            name: "Groceries",
            group: "Living",
            budgeted: 500,
            actual: 450,
            overBudget: false,
          },
          {
            name: "Restaurants",
            group: "Lifestyle",
            budgeted: 200,
            actual: 250,
            overBudget: true,
          },
        ],
      },
    },
  };

  it("get_finance_summary calculates cash, debt, net worth, and status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDashboardData,
    } as any);

    const tool = getTool("get_finance_summary");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.monthKey).toBe("2026-11");
    expect(res.cash).toBe(6500); // 1500 + 5000
    expect(res.debt).toBe(44000);
    expect(res.netWorth).toBe(-37500);
    expect(res.totalBudgeted).toBe(7712.84);
    expect(res.totalSpent).toBe(1200.5);
    expect(res.status).toBe("on_track");
    expect(res.accounts).toHaveLength(3);
    // Verifies account masking
    expect(res.accounts[0].institution).toContain("9912");
  });

  it("get_bank_balances returns categorized accounts and totals", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDashboardData,
    } as any);

    const tool = getTool("get_bank_balances");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.totalCash).toBe(6500);
    expect(res.totalDebt).toBe(44000);
    expect(res.cashAccounts).toHaveLength(2);
    expect(res.loanAccounts).toHaveLength(1);
    expect(res.loanAccounts[0].name).toBe("Tesla Loan");
  });

  it("get_bills_status reports scheduled and paid bills with totals", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDashboardData,
    } as any);

    const tool = getTool("get_bills_status");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.billCount).toBe(2);
    expect(res.totalDue).toBe(3120);
    expect(res.totalPaid).toBe(2800);
    expect(res.bills[0].status).toBe("Paid");
  });

  it("get_spending_by_category filters categories and flags overBudget", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDashboardData,
    } as any);

    const tool = getTool("get_spending_by_category");
    expect(tool).toBeDefined();

    // All categories
    const rawAll = await tool!.handler({});
    const resAll = JSON.parse(rawAll);
    expect(resAll.categoryCount).toBe(2);
    expect(resAll.overBudgetCategories).toContain("Restaurants");

    // Filtered by category
    const rawFiltered = await tool!.handler({ category: "Groceries" });
    const resFiltered = JSON.parse(rawFiltered);
    expect(resFiltered.categoryCount).toBe(1);
    expect(resFiltered.expenses[0].name).toBe("Groceries");
    expect(resFiltered.expenses[0].overBudget).toBe(false);
  });
});

describe("Rubio Media Tools", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("RADARR_URL", "http://mock-radarr");
    vi.stubEnv("RADARR_API_KEY", "test-radarr-key");
    vi.stubEnv("SONARR_URL", "http://mock-sonarr");
    vi.stubEnv("SONARR_API_KEY", "test-sonarr-key");
    vi.stubEnv("PLEX_URL", "http://mock-plex");
    vi.stubEnv("PLEX_TOKEN", "test-plex-token");
    vi.stubEnv("QBITTORRENT_URL", "http://mock-qbit");
    vi.stubEnv("QBITTORRENT_USER", "admin");
    vi.stubEnv("QBITTORRENT_PASS", "pass");
    vi.stubEnv("PROWLARR_URL", "http://mock-prowlarr");
    vi.stubEnv("PROWLARR_API_KEY", "test-prowlarr-key");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("search_movies queries Radarr lookup and formats results", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/movie/lookup")) {
        return {
          ok: true,
          json: async () => [
            {
              title: "Avatar",
              year: 2009,
              tmdbId: 19995,
              id: 12,
              hasFile: true,
              overview: "A paraplegic Marine dispatched to the moon Pandora...",
            },
            {
              title: "Avatar: Fire and Ash",
              year: 2025,
              tmdbId: 83533,
              id: 0,
              hasFile: false,
              overview: "Jake and Neytiri's family...",
            },
          ],
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("search_movies");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ query: "Avatar" });
    const res = JSON.parse(raw);

    expect(res.matchCount).toBe(2);
    expect(res.movies[0].title).toBe("Avatar");
    expect(res.movies[0].status).toBe("downloaded");
    expect(res.movies[1].title).toBe("Avatar: Fire and Ash");
    expect(res.movies[1].status).toBe("ready_to_add");
  });

  it("search_shows queries Sonarr lookup and formats results", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/series/lookup")) {
        return {
          ok: true,
          json: async () => [
            {
              title: "Breaking Bad",
              year: 2008,
              tvdbId: 81189,
              id: 5,
              status: "ended",
              seasonCount: 5,
              network: "AMC",
              overview: "When Walter White...",
            },
          ],
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("search_shows");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ query: "Breaking Bad" });
    const res = JSON.parse(raw);

    expect(res.matchCount).toBe(1);
    expect(res.shows[0].title).toBe("Breaking Bad");
    expect(res.shows[0].seasonCount).toBe(5);
    expect(res.shows[0].inLibrary).toBe(true);
  });

  it("get_media_downloads logs into qBittorrent and returns formatted progress", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v2/auth/login")) {
        return {
          ok: true,
          headers: new Headers({ "set-cookie": "SID=test-session-id; Path=/" }),
        } as any;
      }
      if (url.includes("/api/v2/torrents/info")) {
        return {
          ok: true,
          json: async () => [
            {
              name: "Dune.Part.Two.2024.2160p.mkv",
              state: "downloading",
              progress: 0.745,
              dlspeed: 15728640, // ~15 MB/s
              upspeed: 1048576, // 1 MB/s
              size: 25000000000,
              eta: 600, // 10 minutes
            },
          ],
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("get_media_downloads");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.activeTorrentCount).toBe(1);
    expect(res.torrents[0].progress).toBe("74.5%");
    expect(res.torrents[0].downloadSpeed).toContain("15.0 MB/s");
    expect(res.torrents[0].eta).toBe("10m");
  });

  it("check_plex_inventory queries Plex and filters matching items with watch status", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Avatar: Fire and Ash",
                  librarySectionTitle: "Movies ",
                  year: 2025,
                  type: "movie",
                  viewCount: 2,
                  lastViewedAt: 1730000000,
                  summary: "Jake and Neytiri...",
                  Media: [
                    {
                      videoResolution: "4k",
                      audioProfile: "dolby digital plus + dolby atmos",
                    },
                  ],
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("check_plex_inventory");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ query: "Avatar" });
    const res = JSON.parse(raw);

    expect(res.inPlex).toBe(true);
    expect(res.matchCount).toBe(1);
    expect(res.items[0].title).toBe("Avatar: Fire and Ash");
    expect(res.items[0].resolution).toBe("4k");
    expect(res.items[0].library).toBe("Movies");
    expect(res.items[0].watched).toBe(true);
    expect(res.items[0].viewCount).toBe(2);
    expect(res.items[0].lastViewedAt).toBe(new Date(1730000000 * 1000).toISOString());
  });

  it("get_plex_watch_history queries recent history and formats entries", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/status/sessions/history/all")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Inception",
                  type: "movie",
                  year: 2010,
                  viewedAt: 1730500000,
                  userName: "Dad",
                  device: "Living Room Apple TV",
                },
                {
                  title: "Ozymandias",
                  grandparentTitle: "Breaking Bad",
                  parentIndex: 5,
                  index: 14,
                  type: "episode",
                  year: 2013,
                  viewedAt: 1730400000,
                  userName: "Alex",
                  device: "Bedroom Shield",
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("get_plex_watch_history");
    expect(tool).toBeDefined();

    // Query movies
    const rawMovies = await tool!.handler({ mediaType: "movie", limit: 10 });
    const resMovies = JSON.parse(rawMovies);

    expect(resMovies.historyCount).toBe(2);
    expect(resMovies.history[0].title).toBe("Inception");
    expect(resMovies.history[0].mediaType).toBe("movie");
    expect(resMovies.history[0].user).toBe("Dad");
    expect(resMovies.history[0].device).toBe("Living Room Apple TV");

    // Query episodes formatting
    expect(resMovies.history[1].title).toBe("Breaking Bad S5E14 - Ozymandias");
    expect(resMovies.history[1].mediaType).toBe("episode");

    // Filter by query
    const rawFiltered = await tool!.handler({ query: "Inception" });
    const resFiltered = JSON.parse(rawFiltered);
    expect(resFiltered.historyCount).toBe(1);
    expect(resFiltered.history[0].title).toBe("Inception");
  });

  it("get_plex_watched_movies queries library sections and returns watched movies", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/library/sections?")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Directory: [
                { key: "1", type: "movie", title: "Movies" },
                { key: "2", type: "show", title: "TV Shows" },
              ],
            },
          }),
        } as any;
      }
      if (url.includes("/library/sections/1/all")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Gladiator",
                  year: 2000,
                  viewCount: 3,
                  lastViewedAt: 1730100000,
                  summary: "A former Roman General...",
                  userRating: 9.0,
                },
                {
                  title: "The Dark Knight",
                  year: 2008,
                  viewCount: 1,
                  lastViewedAt: 1729000000,
                  summary: "Batman raises the stakes...",
                  userRating: 9.5,
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("get_plex_watched_movies");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ query: "Gladiator" });
    const res = JSON.parse(raw);

    expect(res.watchedMovieCount).toBe(1);
    expect(res.movies[0].title).toBe("Gladiator");
    expect(res.movies[0].viewCount).toBe(3);
    expect(res.movies[0].library).toBe("Movies");
    expect(res.movies[0].userRating).toBe(9.0);
  });

  it("get_plex_active_sessions reports currently playing media streams", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/status/sessions")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Finding Nemo",
                  type: "movie",
                  year: 2003,
                  duration: 6000000,
                  viewOffset: 3000000,
                  User: { title: "Kids" },
                  Player: { title: "Living Room Apple TV", state: "playing" },
                  Media: [{ videoResolution: "1080p" }],
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("get_plex_active_sessions");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.activeSessionCount).toBe(1);
    expect(res.nowPlaying).toBe(true);
    expect(res.sessions[0].title).toBe("Finding Nemo");
    expect(res.sessions[0].user).toBe("Kids");
    expect(res.sessions[0].progress).toBe("50%");
    expect(res.sessions[0].state).toBe("playing");
  });

  it("edit_plex_movie updates metadata, rating, and watch status", async () => {
    const putCalls: string[] = [];
    const getCalls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "PUT") {
        putCalls.push(url);
        return { ok: true } as any;
      }
      getCalls.push(url);

      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Gladiator",
                  type: "movie",
                  ratingKey: "401",
                  librarySectionID: "1",
                },
              ],
            },
          }),
        } as any;
      }
      if (url.includes("/:/rate") || url.includes("/:/scrobble") || url.includes("/:/unscrobble")) {
        return { ok: true } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("edit_plex_movie");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({
      title: "Gladiator",
      newTitle: "Gladiator (Extended)",
      newSummary: "Maximus returns in high definition.",
      userRating: 9.5,
      watched: true,
      refreshMetadata: true,
    });
    const res = JSON.parse(raw);

    expect(res.ok).toBe(true);
    expect(res.updated).toBe(true);
    expect(res.ratingKey).toBe("401");
    expect(res.changesApplied.title).toBe("Gladiator (Extended)");
    expect(res.changesApplied.summary).toBe("Maximus returns in high definition.");
    expect(res.changesApplied.userRating).toBe(9.5);
    expect(res.changesApplied.watched).toBe(true);
    expect(res.changesApplied.refreshedMetadata).toBe(true);

    expect(putCalls.some((c) => c.includes("/library/sections/1/all") && c.includes("title.value=Gladiator"))).toBe(true);
    expect(putCalls.some((c) => c.includes("/library/metadata/401/refresh"))).toBe(true);
    expect(getCalls.some((c) => c.includes("/:/rate") && c.includes("rating=9.5"))).toBe(true);
    expect(getCalls.some((c) => c.includes("/:/scrobble") && c.includes("key=401"))).toBe(true);
  });

  it("delete_plex_movie requires confirm: true before deleting", async () => {
    const tool = getTool("delete_plex_movie");
    expect(tool).toBeDefined();

    const rawNoConfirm = await tool!.handler({ title: "Gladiator" });
    const resNoConfirm = JSON.parse(rawNoConfirm);

    expect(resNoConfirm.error).toBe("confirmation_required");
    expect(resNoConfirm.message).toContain("confirm: true");
  });

  it("delete_plex_movie deletes from Plex and Radarr when confirmed", async () => {
    const deleteCalls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        deleteCalls.push(url);
        return { ok: true, status: 200 } as any;
      }

      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Gladiator",
                  year: 2000,
                  type: "movie",
                  ratingKey: "401",
                },
              ],
            },
          }),
        } as any;
      }

      if (url.includes("/api/v3/movie")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 55,
              title: "Gladiator",
              year: 2000,
            },
          ],
        } as any;
      }

      return { ok: false } as any;
    });

    const tool = getTool("delete_plex_movie");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ title: "Gladiator", confirm: true });
    const res = JSON.parse(raw);

    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(true);
    expect(res.deletedFromPlex).toBe(true);
    expect(res.deletedFromRadarr).toBe(true);
    expect(res.filesDeleted).toBe(true);

    // Verify Plex DELETE endpoint called
    expect(deleteCalls.some((c) => c.includes("/library/metadata/401"))).toBe(true);
    // Verify Radarr DELETE endpoint called with deleteFiles=true
    expect(deleteCalls.some((c) => c.includes("/api/v3/movie/55?deleteFiles=true"))).toBe(true);
  });

  it("delete_plex_media previews movie target and requires confirm: true", async () => {
    let deleteCallsCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        deleteCallsCount++;
        return { ok: true } as any;
      }
      if (url.includes("/search") || url.includes("/library/metadata/808")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Inception",
                  year: 2010,
                  type: "movie",
                  ratingKey: "808",
                  viewCount: 3,
                  Media: [
                    {
                      Part: [
                        {
                          file: "/movies/Inception (2010)/Inception.mkv",
                          size: 10737418240,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("delete_plex_media");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ title: "Inception" });
    const res = JSON.parse(raw);

    expect(res.ok).toBe(true);
    expect(res.status).toBe("confirmation_required");
    expect(res.needsConfirm).toBe(true);
    expect(res.deleted).toBe(false);
    expect(res.fileDeleted).toBe(false);
    expect(res.ratingKey).toBe("808");
    expect(res.filePath).toBe("/movies/Inception (2010)/Inception.mkv");
    expect(res.fileSizeBytes).toBe(10737418240);
    expect(res.viewCount).toBe(3);
    expect(res.title).toBe("Inception");
    expect(res.year).toBe(2010);
    expect(res.mediaType).toBe("movie");
    expect(res.message).toContain("confirm: true");

    // Item was previewed only — zero DELETE requests dispatched (item remains intact in Plex)
    expect(deleteCallsCount).toBe(0);
  });

  it("delete_plex_media supports query parameter as alias for title", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Dune: Part Two",
                  year: 2024,
                  type: "movie",
                  ratingKey: "10934",
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("delete_plex_media");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ query: "Dune: Part Two" });
    const res = JSON.parse(raw);

    expect(res.error).toBe("confirmation_required");
    expect(res.target.title).toBe("Dune: Part Two");
    expect(res.target.year).toBe(2024);
    expect(res.target.ratingKey).toBe("10934");
  });


  it("delete_plex_media deletes TV show from Plex and Sonarr when confirmed", async () => {
    const deleteCalls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        deleteCalls.push(url);
        return { ok: true, status: 200 } as any;
      }

      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Breaking Bad",
                  year: 2008,
                  type: "show",
                  ratingKey: "909",
                  librarySectionID: "2",
                },
              ],
            },
          }),
        } as any;
      }

      if (url.includes("/api/v3/series")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 12,
              title: "Breaking Bad",
              year: 2008,
            },
          ],
        } as any;
      }

      return { ok: false } as any;
    });

    const tool = getTool("delete_plex_media");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({ title: "Breaking Bad", confirm: true });
    const res = JSON.parse(raw);

    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(true);
    expect(res.mediaType).toBe("show");
    expect(res.deletedFromPlex).toBe(true);
    expect(res.deletedFromArr).toBe(true);
    expect(res.deletedFromSonarr).toBe(true);
    expect(res.filesDeleted).toBe(true);

    expect(deleteCalls.some((c) => c.includes("/library/metadata/909"))).toBe(true);
    expect(deleteCalls.some((c) => c.includes("/api/v3/series/12?deleteFiles=true"))).toBe(true);
  });

  it("delete_plex_media deletes episode file from Sonarr and Plex when confirmed", async () => {
    const deleteCalls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        deleteCalls.push(url);
        return { ok: true, status: 200 } as any;
      }

      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Ozymandias",
                  type: "episode",
                  grandparentTitle: "Breaking Bad",
                  parentIndex: 5,
                  index: 14,
                  ratingKey: "914",
                },
              ],
            },
          }),
        } as any;
      }

      if (url.includes("/api/v3/series")) {
        return {
          ok: true,
          json: async () => [{ id: 12, title: "Breaking Bad" }],
        } as any;
      }

      if (url.includes("/api/v3/episode?seriesId=12")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 101,
              seasonNumber: 5,
              episodeNumber: 14,
              episodeFileId: 777,
            },
          ],
        } as any;
      }

      return { ok: false } as any;
    });

    const tool = getTool("delete_plex_media");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({
      title: "Ozymandias",
      mediaType: "episode",
      seasonNumber: 5,
      episodeNumber: 14,
      confirm: true,
    });
    const res = JSON.parse(raw);

    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(true);
    expect(res.mediaType).toBe("episode");
    expect(res.deletedFromPlex).toBe(true);
    expect(res.deletedFromSonarr).toBe(true);

    expect(deleteCalls.some((c) => c.includes("/library/metadata/914"))).toBe(true);
    expect(deleteCalls.some((c) => c.includes("/api/v3/episodefile/777"))).toBe(true);
  });

  it("delete_plex_media returns deleted: false with error string on any failure", async () => {
    // 1. Failure when item not found in Plex or Arr
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ MediaContainer: { Metadata: [] } }),
    } as any);

    const tool = getTool("delete_plex_media");
    expect(tool).toBeDefined();

    const notFoundRaw = await tool!.handler({
      title: "Nonexistent Movie 12345",
      confirm: true,
    });
    const notFoundRes = JSON.parse(notFoundRaw);

    expect(notFoundRes.ok).toBe(false);
    expect(notFoundRes.deleted).toBe(false);
    expect(typeof notFoundRes.error).toBe("string");
    expect(notFoundRes.error).toContain("Could not delete");

    // 2. Failure when Plex rejection occurs
    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = (opts?.method || "GET").toUpperCase();
      if (method === "DELETE") {
        return { ok: false, status: 403 } as any;
      }
      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [{ title: "Protected Movie", type: "movie", ratingKey: "999" }],
            },
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    const rejectedRaw = await tool!.handler({
      title: "Protected Movie",
      confirm: true,
    });
    const rejectedRes = JSON.parse(rejectedRaw);

    expect(rejectedRes.ok).toBe(false);
    expect(rejectedRes.deleted).toBe(false);
    expect(typeof rejectedRes.error).toBe("string");
  });

  it("mark_plex_media_watched toggles scrobble status", async () => {
    const endpointsCalled: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      endpointsCalled.push(url);
      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            MediaContainer: {
              Metadata: [
                {
                  title: "Dune",
                  type: "movie",
                  ratingKey: "505",
                },
              ],
            },
          }),
        } as any;
      }
      return { ok: true } as any;
    });

    const tool = getTool("mark_plex_media_watched");
    expect(tool).toBeDefined();

    // Mark watched
    const rawWatched = await tool!.handler({ title: "Dune", watched: true });
    const resWatched = JSON.parse(rawWatched);
    expect(resWatched.ok).toBe(true);
    expect(resWatched.watched).toBe(true);
    expect(endpointsCalled.some((c) => c.includes("/:/scrobble?key=505"))).toBe(true);

    // Mark unwatched
    const rawUnwatched = await tool!.handler({ ratingKey: "505", watched: false });
    const resUnwatched = JSON.parse(rawUnwatched);
    expect(resUnwatched.ok).toBe(true);
    expect(resUnwatched.watched).toBe(false);
    expect(endpointsCalled.some((c) => c.includes("/:/unscrobble?key=505"))).toBe(true);
  });

  it("get_media_stack_health reports statuses across services", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("radarr") || url.includes("7878")) {
        return { ok: true, json: async () => ({ version: "6.1.1" }) } as any;
      }
      if (url.includes("sonarr") || url.includes("8989")) {
        return { ok: true, json: async () => ({ version: "4.0.17" }) } as any;
      }
      if (url.includes("plex") || url.includes("32400")) {
        return { ok: true } as any;
      }
      if (url.includes("api/v2/auth/login")) {
        return { ok: true, headers: new Headers({ "set-cookie": "SID=x;" }) } as any;
      }
      if (url.includes("api/v2/app/version")) {
        return { ok: true, text: async () => "v5.0.0" } as any;
      }
      if (url.includes("prowlarr") || url.includes("9696")) {
        return { ok: true, json: async () => ({ version: "2.3.5" }) } as any;
      }
      return { ok: false } as any;
    });

    const tool = getTool("get_media_stack_health");
    expect(tool).toBeDefined();

    const raw = await tool!.handler({});
    const res = JSON.parse(raw);

    expect(res.allHealthy).toBe(true);
    expect(res.services).toHaveLength(5);
    expect(res.services.find((s: any) => s.name === "Radarr")?.status).toBe("healthy");
    expect(res.services.find((s: any) => s.name === "Sonarr")?.status).toBe("healthy");
    expect(res.services.find((s: any) => s.name === "Plex")?.status).toBe("healthy");
  });
});
