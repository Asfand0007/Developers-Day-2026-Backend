"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const mod_ts_1 = require("https://deno.land/x/postgres@v0.17.0/mod.ts");
const CONFIG_KEY = "COMPETITION_ACTIVITY_POINTS";
function json(status, payload) {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
        },
    });
}
function parsePositiveInt(value, fallback) {
    if (!value)
        return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0)
        return fallback;
    return Math.trunc(parsed);
}
function normalizeBearerToken(authHeader) {
    if (!authHeader)
        return "";
    const trimmed = authHeader.trim();
    if (!trimmed.toLowerCase().startsWith("bearer "))
        return "";
    return trimmed.slice(7).trim();
}
function getFallbackPoints() {
    return parsePositiveInt(Deno.env.get("COMPETITION_ACTIVITY_POINTS_FALLBACK"), 5);
}
function buildCompetitionActivityCode(competitionId) {
    const compact = competitionId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 24);
    return `COMP_${compact}_PARTICIPATION`;
}
function requireActorStaffProfileId(client) {
    return __awaiter(this, void 0, void 0, function* () {
        const fromEnv = (Deno.env.get("SYSTEM_STAFF_PROFILE_ID") || "").trim();
        if (fromEnv)
            return fromEnv;
        const fallback = yield client.queryObject({
            text: `
      SELECT id
      FROM "StaffProfile"
      WHERE "isApproved" = true
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `,
        });
        const row = fallback.rows[0];
        if (!(row === null || row === void 0 ? void 0 : row.id)) {
            throw new Error("No approved staff profile found. Set SYSTEM_STAFF_PROFILE_ID.");
        }
        return row.id;
    });
}
function requireManualActivityTypeId(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const byCode = yield client.queryObject({
            text: `
      SELECT id
      FROM "ActivityType"
      WHERE code = 'MANUAL'
      LIMIT 1
    `,
        });
        if ((_a = byCode.rows[0]) === null || _a === void 0 ? void 0 : _a.id) {
            return byCode.rows[0].id;
        }
        const fallback = yield client.queryObject({
            text: `
      SELECT id
      FROM "ActivityType"
      WHERE "isActive" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
    `,
        });
        const row = fallback.rows[0];
        if (!(row === null || row === void 0 ? void 0 : row.id)) {
            throw new Error("No active ActivityType found.");
        }
        return row.id;
    });
}
function loadConfigPoints(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const globalResult = yield client.queryObject({
            text: `
      SELECT "valueText"
      FROM "MasterConfig"
      WHERE key = $1
      LIMIT 1
    `,
            args: [CONFIG_KEY],
        });
        const overrideResult = yield client.queryObject({
            text: `
      SELECT "competitionId", "valueText"
      FROM "CompetitionConfig"
      WHERE key = $1
    `,
            args: [CONFIG_KEY],
        });
        const globalRaw = (_b = (_a = globalResult.rows[0]) === null || _a === void 0 ? void 0 : _a.valueText) !== null && _b !== void 0 ? _b : null;
        const globalDefault = globalRaw !== null && globalRaw !== "" ? Number(globalRaw) : null;
        const overrides = new Map();
        for (const row of overrideResult.rows) {
            if (row.valueText === null || row.valueText === "")
                continue;
            const parsed = Number(row.valueText);
            if (Number.isFinite(parsed)) {
                overrides.set(row.competitionId, parsed);
            }
        }
        return {
            globalDefault: Number.isFinite(globalDefault) ? globalDefault : null,
            overrides,
        };
    });
}
function loadCompetitions(client) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield client.queryObject({
            text: `
      SELECT id, name, "isActive"
      FROM "Competition"
      ORDER BY name ASC
    `,
        });
        return result.rows;
    });
}
function syncActivities(client, actorStaffProfileId, manualActivityTypeId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const competitions = yield loadCompetitions(client);
        const { globalDefault, overrides } = yield loadConfigPoints(client);
        const fallbackPoints = getFallbackPoints();
        const activitiesByCompetitionId = new Map();
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        let pointsFallbackUsed = false;
        for (const competition of competitions) {
            const resolvedPoints = (_b = (_a = overrides.get(competition.id)) !== null && _a !== void 0 ? _a : globalDefault) !== null && _b !== void 0 ? _b : fallbackPoints;
            if (!overrides.has(competition.id) && globalDefault === null) {
                pointsFallbackUsed = true;
            }
            const code = buildCompetitionActivityCode(competition.id);
            const name = `${competition.name} Participation`;
            const description = `Auto-managed activity for competition participation (${competition.name}).`;
            const existingResult = yield client.queryObject({
                text: `
        SELECT id, code, points
        FROM "Activity"
        WHERE code = $1
        LIMIT 1
      `,
                args: [code],
            });
            if (!existingResult.rows[0]) {
                const createdRow = yield client.queryObject({
                    text: `
          INSERT INTO "Activity"
            (id, code, name, description, points, "activityTypeId", "isActive", "createdByStaffProfileId", "updatedByStaffProfileId", "createdAt", "updatedAt")
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $8, NOW(), NOW())
          RETURNING id, code, points
        `,
                    args: [
                        crypto.randomUUID(),
                        code,
                        name,
                        description,
                        resolvedPoints,
                        manualActivityTypeId,
                        competition.isActive,
                        actorStaffProfileId,
                    ],
                });
                activitiesByCompetitionId.set(competition.id, createdRow.rows[0]);
                created += 1;
                continue;
            }
            const existing = existingResult.rows[0];
            const updatedRow = yield client.queryObject({
                text: `
        UPDATE "Activity"
        SET
          name = $2,
          description = $3,
          points = $4,
          "isActive" = $5,
          "activityTypeId" = $6,
          "updatedByStaffProfileId" = $7,
          "updatedAt" = NOW()
        WHERE id = $1
        RETURNING id, code, points
      `,
                args: [
                    existing.id,
                    name,
                    description,
                    resolvedPoints,
                    competition.isActive,
                    manualActivityTypeId,
                    actorStaffProfileId,
                ],
            });
            if (existing.points !== resolvedPoints) {
                updated += 1;
            }
            else {
                unchanged += 1;
            }
            activitiesByCompetitionId.set(competition.id, updatedRow.rows[0]);
        }
        return {
            created,
            updated,
            unchanged,
            pointsFallbackUsed,
            activitiesByCompetitionId,
        };
    });
}
function syncCompletions(client, actorStaffProfileId, activitiesByCompetitionId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const verifiedMembersResult = yield client.queryObject({
            text: `
      SELECT DISTINCT tm."participantId", t."competitionId"
      FROM "TeamMember" tm
      INNER JOIN "Team" t ON t.id = tm."teamId"
      WHERE t."paymentStatus" = 'VERIFIED'::"RegistrationStatus"
    `,
        });
        let created = 0;
        let skippedExisting = 0;
        let skippedNoActivity = 0;
        for (const row of verifiedMembersResult.rows) {
            const activity = activitiesByCompetitionId.get(row.competitionId);
            if (!activity) {
                skippedNoActivity += 1;
                continue;
            }
            const completionExists = yield client.queryObject({
                text: `
        SELECT id
        FROM "ParticipantActivityCompletion"
        WHERE "participantId" = $1
          AND "activityId" = $2
        LIMIT 1
      `,
                args: [row.participantId, activity.id],
            });
            if ((_a = completionExists.rows[0]) === null || _a === void 0 ? void 0 : _a.id) {
                skippedExisting += 1;
                continue;
            }
            const completionId = crypto.randomUUID();
            yield client.queryObject({
                text: `
        INSERT INTO "ParticipantActivityCompletion"
          (id, "participantId", "activityId", "markedByStaffProfileId", note, "completedAt")
        VALUES
          ($1, $2, $3, $4, $5, NOW())
      `,
                args: [completionId, row.participantId, activity.id, actorStaffProfileId, "Auto-marked from verified competition registration"],
            });
            yield client.queryObject({
                text: `
        INSERT INTO "PointsLedger"
          (id, "participantId", "entryType", "pointsDelta", "sourceCompletionId", "actorStaffProfileId", metadata, "createdAt")
        VALUES
          ($1, $2, 'MANUAL_ACTIVITY'::"PointsLedgerEntryType", $3, $4, $5, $6::jsonb, NOW())
      `,
                args: [
                    crypto.randomUUID(),
                    row.participantId,
                    activity.points,
                    completionId,
                    actorStaffProfileId,
                    JSON.stringify({
                        source: "COMPETITION_PARTICIPATION_SYNC",
                        competitionId: row.competitionId,
                        activityCode: activity.code,
                    }),
                ],
            });
            yield client.queryObject({
                text: `
        INSERT INTO "PointsSummary" ("participantId", "totalPoints", "updatedAt")
        VALUES ($1, $2, NOW())
        ON CONFLICT ("participantId")
        DO UPDATE SET
          "totalPoints" = "PointsSummary"."totalPoints" + EXCLUDED."totalPoints",
          "updatedAt" = NOW()
      `,
                args: [row.participantId, activity.points],
            });
            yield client.queryObject({
                text: `
        INSERT INTO "PointsAuditLog"
          (id, "actorStaffProfileId", "actionType", "targetType", "targetId", note, payload, "createdAt")
        VALUES
          ($1, $2, 'ACTIVITY_COMPLETION_MARKED'::"PointsAuditActionType", $3, $4, $5, $6::jsonb, NOW())
      `,
                args: [
                    crypto.randomUUID(),
                    actorStaffProfileId,
                    "ParticipantActivityCompletion",
                    completionId,
                    "Auto-marked from verified competition registration",
                    JSON.stringify({
                        participantId: row.participantId,
                        competitionId: row.competitionId,
                        activityId: activity.id,
                        points: activity.points,
                        source: "COMPETITION_PARTICIPATION_SYNC",
                    }),
                ],
            });
            created += 1;
        }
        return { created, skippedExisting, skippedNoActivity };
    });
}
Deno.serve((req) => __awaiter(void 0, void 0, void 0, function* () {
    if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
    }
    const expectedToken = (Deno.env.get("EDGE_FUNCTION_TOKEN") || "").trim();
    if (expectedToken) {
        const suppliedToken = normalizeBearerToken(req.headers.get("authorization"));
        if (!suppliedToken || suppliedToken !== expectedToken) {
            return json(401, { error: "Unauthorized" });
        }
    }
    const dbUrl = (Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("DATABASE_URL") || "").trim();
    if (!dbUrl) {
        return json(500, { error: "Missing SUPABASE_DB_URL or DATABASE_URL" });
    }
    let body = {};
    try {
        body = yield req.json();
    }
    catch (_a) {
        return json(400, { error: "Invalid JSON body" });
    }
    const action = body.action || "sync_all";
    if (!["sync_activities", "sync_completions", "sync_all"].includes(action)) {
        return json(400, { error: "Invalid action. Use sync_activities, sync_completions, or sync_all." });
    }
    const client = new mod_ts_1.Client(dbUrl);
    try {
        yield client.connect();
        const actorStaffProfileId = yield requireActorStaffProfileId(client);
        const manualActivityTypeId = yield requireManualActivityTypeId(client);
        const activitySync = yield syncActivities(client, actorStaffProfileId, manualActivityTypeId);
        if (action === "sync_activities") {
            return json(200, {
                ok: true,
                action,
                actorStaffProfileId,
                configKey: CONFIG_KEY,
                fallbackDefaultPoints: getFallbackPoints(),
                activities: {
                    created: activitySync.created,
                    updated: activitySync.updated,
                    unchanged: activitySync.unchanged,
                    pointsFallbackUsed: activitySync.pointsFallbackUsed,
                },
            });
        }
        const completionSync = yield syncCompletions(client, actorStaffProfileId, activitySync.activitiesByCompetitionId);
        return json(200, {
            ok: true,
            action,
            actorStaffProfileId,
            configKey: CONFIG_KEY,
            fallbackDefaultPoints: getFallbackPoints(),
            activities: {
                created: activitySync.created,
                updated: activitySync.updated,
                unchanged: activitySync.unchanged,
                pointsFallbackUsed: activitySync.pointsFallbackUsed,
            },
            completions: completionSync,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown edge function failure";
        return json(500, { ok: false, error: message });
    }
    finally {
        try {
            yield client.end();
        }
        catch (_b) {
            // ignore shutdown errors
        }
    }
}));
