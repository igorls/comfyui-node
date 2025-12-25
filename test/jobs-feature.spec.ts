import { describe, expect, it, mock } from "bun:test";
import { JobsFeature } from "../src/features/jobs.js";
import { JobStatus } from "../src/types/api.js";

describe("JobsFeature", () => {
    // Helper to create a mock ComfyApi client
    const createMockClient = (fetchResponse: any) => {
        const mockFetch = mock(async () => fetchResponse);
        return {
            fetchApi: mockFetch,
            id: "test-client",
            apiHost: "http://localhost:8188"
        } as any;
    };

    describe("getJobs", () => {
        it("calls /api/jobs with no params by default", async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    jobs: [],
                    pagination: { offset: 0, limit: null, total: 0, has_more: false }
                })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const result = await feature.getJobs();

            expect(client.fetchApi).toHaveBeenCalledWith("/api/jobs");
            expect(result.jobs).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });

        it("builds query params from options", async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    jobs: [{ id: "test", status: "completed" }],
                    pagination: { offset: 0, limit: 10, total: 1, has_more: false }
                })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            await feature.getJobs({
                status: JobStatus.COMPLETED,
                limit: 10,
                offset: 5,
                sort_by: "execution_duration",
                sort_order: "asc"
            });

            const calledUrl = client.fetchApi.mock.calls[0][0];
            expect(calledUrl).toContain("status=completed");
            expect(calledUrl).toContain("limit=10");
            expect(calledUrl).toContain("offset=5");
            expect(calledUrl).toContain("sort_by=execution_duration");
            expect(calledUrl).toContain("sort_order=asc");
        });

        it("handles multiple status filters", async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({ jobs: [], pagination: { offset: 0, limit: null, total: 0, has_more: false } })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            await feature.getJobs({
                status: [JobStatus.PENDING, JobStatus.IN_PROGRESS]
            });

            const calledUrl = client.fetchApi.mock.calls[0][0];
            expect(calledUrl).toContain("status=pending%2Cin_progress");
        });

        it("throws on error response", async () => {
            const mockResponse = {
                ok: false,
                statusText: "Bad Request",
                json: async () => ({ error: "Invalid status value" })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            await expect(feature.getJobs({ status: "invalid" as any })).rejects.toThrow("Invalid status value");
        });
    });

    describe("getJob", () => {
        it("fetches single job by ID", async () => {
            const mockJob = {
                id: "prompt-123",
                status: "completed",
                outputs_count: 1,
                execution_start_time: 1000,
                execution_end_time: 2000
            };
            const mockResponse = {
                ok: true,
                status: 200,
                json: async () => mockJob
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const result = await feature.getJob("prompt-123");

            expect(client.fetchApi).toHaveBeenCalledWith("/api/jobs/prompt-123");
            expect(result).toEqual(mockJob);
        });

        it("returns null for 404", async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                json: async () => ({ error: "Job not found" })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const result = await feature.getJob("nonexistent");
            expect(result).toBeNull();
        });

        it("encodes job ID in URL", async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: async () => ({ id: "special/id" })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            await feature.getJob("special/id");

            expect(client.fetchApi).toHaveBeenCalledWith("/api/jobs/special%2Fid");
        });
    });

    describe("convenience methods", () => {
        it("getRunningJobs filters by IN_PROGRESS", async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    jobs: [{ id: "1", status: "in_progress" }],
                    pagination: { offset: 0, limit: 100, total: 1, has_more: false }
                })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const jobs = await feature.getRunningJobs();

            const calledUrl = client.fetchApi.mock.calls[0][0];
            expect(calledUrl).toContain("status=in_progress");
            expect(jobs.length).toBe(1);
        });

        it("getPendingJobs filters by PENDING", async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    jobs: [],
                    pagination: { offset: 0, limit: 100, total: 0, has_more: false }
                })
            };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            await feature.getPendingJobs();

            const calledUrl = client.fetchApi.mock.calls[0][0];
            expect(calledUrl).toContain("status=pending");
        });
    });

    describe("getExecutionDuration", () => {
        it("calculates duration from start and end times", () => {
            const feature = new JobsFeature({} as any);

            const duration = feature.getExecutionDuration({
                id: "test",
                status: "completed",
                execution_start_time: 1000,
                execution_end_time: 5000
            });

            expect(duration).toBe(4000);
        });

        it("returns null when times are missing", () => {
            const feature = new JobsFeature({} as any);

            expect(feature.getExecutionDuration({ id: "test", status: "pending" })).toBeNull();
            expect(feature.getExecutionDuration({ id: "test", status: "completed", execution_start_time: 1000 })).toBeNull();
            expect(feature.getExecutionDuration({ id: "test", status: "completed", execution_end_time: 1000 })).toBeNull();
        });
    });

    describe("checkSupported", () => {
        it("returns true when API responds successfully", async () => {
            const mockResponse = { ok: true };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const supported = await feature.checkSupported();

            expect(supported).toBe(true);
            expect(feature.isSupported).toBe(true);
            expect(client.fetchApi).toHaveBeenCalledWith("/api/jobs?limit=1");
        });

        it("returns false when API returns error", async () => {
            const mockResponse = { ok: false };
            const client = createMockClient(mockResponse);
            const feature = new JobsFeature(client);

            const supported = await feature.checkSupported();

            expect(supported).toBe(false);
            expect(feature.isSupported).toBe(false);
        });

        it("returns false when fetch throws", async () => {
            const client = {
                fetchApi: mock(async () => { throw new Error("Network error"); }),
                id: "test"
            } as any;
            const feature = new JobsFeature(client);

            const supported = await feature.checkSupported();

            expect(supported).toBe(false);
        });
    });
});
