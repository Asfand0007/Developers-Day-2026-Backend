// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js"
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

type SyncAction = "sync_activities" | "sync_completions" | "sync_prune" | "sync_all"

type CompetitionRow = {
  id: string
  name: string
  isActive: boolean
}

type ActivityRow = {
  id: string
  code: string
  points: number
}

type ParticipantCompetitionPair = {
  participantId: string
  competitionId: string
}

const CONFIG_KEY = "COMPETITION_ACTIVITY_POINTS"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const BATCH_SIZE = parsePositiveInt(Deno.env.get("EDGE_SYNC_BATCH_SIZE"), 10)

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

type DebugEvent = {
  at: string
  step: string
  detail?: unknown
}

function toDebugError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return {
    message: typeof error === "string" ? error : "Unknown edge function failure",
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.trunc(parsed)
}

function normalizeBearerToken(authHeader: string | null): string {
  if (!authHeader) return ""
  const trimmed = authHeader.trim()
  if (!trimmed.toLowerCase().startsWith("bearer ")) return ""
  return trimmed.slice(7).trim()
}

function getFallbackPoints(): number {
  return parsePositiveInt(Deno.env.get("COMPETITION_ACTIVITY_POINTS_FALLBACK"), 5)
}

function chunkArray<T>(input: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size))
  }
  return chunks
}

function buildCompetitionActivityCode(competitionId: string): string {
  const compact = competitionId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 24)
  return `COMP_${compact}_PARTICIPATION`
}

async function requireActorStaffProfileId(): Promise<string> {
  const fromEnv = (Deno.env.get("SYSTEM_STAFF_PROFILE_ID") || "").trim()
  if (fromEnv) return fromEnv

  const { data, error } = await supabase
    .from("StaffProfile")
    .select("id")
    .eq("isApproved", true)
    .order("updatedAt", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`Could not resolve actor staff profile: ${error.message}`)
  }

  const row = data?.[0]
  if (!row?.id) {
    throw new Error("No approved staff profile found. Set SYSTEM_STAFF_PROFILE_ID.")
  }

  return row.id
}

async function requireManualActivityTypeId(): Promise<string> {
  const byCode = await supabase
    .from("ActivityType")
    .select("id")
    .eq("code", "MANUAL")
    .limit(1)

  if (byCode.error) {
    throw new Error(`Could not resolve MANUAL activity type: ${byCode.error.message}`)
  }

  if (byCode.data?.[0]?.id) {
    return byCode.data[0].id
  }

  const fallback = await supabase
    .from("ActivityType")
    .select("id")
    .eq("isActive", true)
    .order("createdAt", { ascending: true })
    .limit(1)

  if (fallback.error) {
    throw new Error(`Could not resolve active activity type: ${fallback.error.message}`)
  }

  const row = fallback.data?.[0]
  if (!row?.id) {
    throw new Error("No active ActivityType found.")
  }

  return row.id
}

async function loadConfigPoints(): Promise<{ globalDefault: number | null; overrides: Map<string, number> }> {
  const globalResult = await supabase
    .from("MasterConfig")
    .select("valueText")
    .eq("key", CONFIG_KEY)
    .maybeSingle()

  if (globalResult.error) {
    throw new Error(`Could not load master config: ${globalResult.error.message}`)
  }

  const overrideResult = await supabase
    .from("CompetitionConfig")
    .select("competitionId, valueText")
    .eq("key", CONFIG_KEY)

  if (overrideResult.error) {
    throw new Error(`Could not load competition config overrides: ${overrideResult.error.message}`)
  }

  const globalRaw = globalResult.data?.valueText ?? null
  const globalDefault = globalRaw !== null && globalRaw !== "" ? Number(globalRaw) : null

  const overrides = new Map<string, number>()
  for (const row of overrideResult.data || []) {
    if (row.valueText === null || row.valueText === "") continue
    const parsed = Number(row.valueText)
    if (Number.isFinite(parsed)) {
      overrides.set(row.competitionId, parsed)
    }
  }

  return {
    globalDefault: Number.isFinite(globalDefault as number) ? (globalDefault as number) : null,
    overrides,
  }
}

async function loadCompetitions(): Promise<CompetitionRow[]> {
  const result = await supabase
    .from("Competition")
    .select("id, name, isActive")
    .order("name", { ascending: true })

  if (result.error) {
    throw new Error(`Could not load competitions: ${result.error.message}`)
  }

  return result.data || []
}

async function syncActivities(
  actorStaffProfileId: string,
  manualActivityTypeId: string,
): Promise<{
  created: number
  updated: number
  unchanged: number
  pointsFallbackUsed: boolean
  activitiesByCompetitionId: Map<string, ActivityRow>
}> {
  const nowIso = new Date().toISOString()
  const competitions = await loadCompetitions()
  const { globalDefault, overrides } = await loadConfigPoints()
  const fallbackPoints = getFallbackPoints()

  const activitiesByCompetitionId = new Map<string, ActivityRow>()
  let created = 0
  let updated = 0
  let unchanged = 0
  let pointsFallbackUsed = false

  for (const competition of competitions) {
    const resolvedPoints = overrides.get(competition.id) ?? globalDefault ?? fallbackPoints
    if (!overrides.has(competition.id) && globalDefault === null) {
      pointsFallbackUsed = true
    }

    const code = buildCompetitionActivityCode(competition.id)
    const name = `${competition.name} Participation`
    const description = `Auto-managed activity for competition participation (${competition.name}).`

    const existingResult = await supabase
      .from("Activity")
      .select("id, code, points")
      .eq("code", code)
      .maybeSingle()

    if (existingResult.error) {
      throw new Error(`Could not query existing activity (${code}): ${existingResult.error.message}`)
    }

    if (!existingResult.data) {
      const createdResult = await supabase
        .from("Activity")
        .insert({
          id: crypto.randomUUID(),
          code,
          name,
          description,
          points: resolvedPoints,
          activityTypeId: manualActivityTypeId,
          isActive: competition.isActive,
          createdAt: nowIso,
          updatedAt: nowIso,
          createdByStaffProfileId: actorStaffProfileId,
          updatedByStaffProfileId: actorStaffProfileId,
        })
        .select("id, code, points")
        .single()

      if (createdResult.error || !createdResult.data) {
        throw new Error(`Could not create activity (${code}): ${createdResult.error?.message || "Unknown insert failure"}`)
      }

      activitiesByCompetitionId.set(competition.id, createdResult.data)
      created += 1
      continue
    }

    const existing = existingResult.data
    const updatedResult = await supabase
      .from("Activity")
      .update({
        name,
        description,
        points: resolvedPoints,
        isActive: competition.isActive,
        activityTypeId: manualActivityTypeId,
        updatedAt: nowIso,
        updatedByStaffProfileId: actorStaffProfileId,
      })
      .eq("id", existing.id)
      .select("id, code, points")
      .single()

    if (updatedResult.error || !updatedResult.data) {
      throw new Error(`Could not update activity (${code}): ${updatedResult.error?.message || "Unknown update failure"}`)
    }

    if (existing.points !== resolvedPoints) {
      updated += 1
    } else {
      unchanged += 1
    }

    activitiesByCompetitionId.set(competition.id, updatedResult.data)
  }

  return {
    created,
    updated,
    unchanged,
    pointsFallbackUsed,
    activitiesByCompetitionId,
  }
}

async function syncCompletions(
  actorStaffProfileId: string,
  activitiesByCompetitionId: Map<string, ActivityRow>,
  verifiedPairs: ParticipantCompetitionPair[],
): Promise<{ created: number; skippedExisting: number; skippedNoActivity: number }> {
  let created = 0
  let skippedExisting = 0
  let skippedNoActivity = 0

  const chunks = chunkArray(verifiedPairs, BATCH_SIZE)
  for (const batch of chunks) {
    for (const row of batch) {
      const activity = activitiesByCompetitionId.get(row.competitionId)
      if (!activity) {
        skippedNoActivity += 1
        continue
      }

      const completionExists = await supabase
        .from("ParticipantActivityCompletion")
        .select("id")
        .eq("participantId", row.participantId)
        .eq("activityId", activity.id)
        .maybeSingle()

      if (completionExists.error) {
        throw new Error(`Could not query completion for participant ${row.participantId}: ${completionExists.error.message}`)
      }

      if (completionExists.data?.id) {
        skippedExisting += 1
        continue
      }

      const completionId = crypto.randomUUID()
      const { data: outcome, error: rpcError } = await supabase.rpc(
        "grant_competition_activity_completion",
        {
          p_participant_id: row.participantId,
          p_competition_id: row.competitionId,
          p_activity_id: activity.id,
          p_points: activity.points,
          p_actor_staff_profile_id: actorStaffProfileId,
          p_completion_id: completionId,
          p_ledger_id: crypto.randomUUID(),
          p_audit_id: crypto.randomUUID(),
        },
      )

      if (rpcError) {
        throw new Error(`Could not complete sync via RPC for participant ${row.participantId}: ${rpcError.message}`)
      }

      if (outcome === "created") {
        created += 1
      } else {
        skippedExisting += 1
      }
    }
  }

  return { created, skippedExisting, skippedNoActivity }
}

async function loadVerifiedParticipantCompetitionPairs(): Promise<ParticipantCompetitionPair[]> {
  const verifiedTeamResult = await supabase
    .from("Team")
    .select("competitionId, members:TeamMember(participantId)")
    .eq("paymentStatus", "VERIFIED")

  if (verifiedTeamResult.error) {
    throw new Error(`Could not load verified team members: ${verifiedTeamResult.error.message}`)
  }

  const pairKeys = new Set<string>()
  const pairs: ParticipantCompetitionPair[] = []

  for (const team of verifiedTeamResult.data || []) {
    const competitionId = team.competitionId as string
    const members = (team.members || []) as Array<{ participantId: string }>
    for (const member of members) {
      const key = `${member.participantId}:${competitionId}`
      if (pairKeys.has(key)) continue
      pairKeys.add(key)
      pairs.push({ participantId: member.participantId, competitionId })
    }
  }

  return pairs
}

async function syncPruneCompletions(
  actorStaffProfileId: string,
  activitiesByCompetitionId: Map<string, ActivityRow>,
  verifiedPairs: ParticipantCompetitionPair[],
): Promise<{ revoked: number; skippedNotFound: number; skippedNonSynced: number }> {
  const managedEntries = Array.from(activitiesByCompetitionId.entries())
  const managedActivityIds = managedEntries.map(([, activity]) => activity.id)

  if (!managedActivityIds.length) {
    return { revoked: 0, skippedNotFound: 0, skippedNonSynced: 0 }
  }

  const completionRowsResult = await supabase
    .from("ParticipantActivityCompletion")
    .select("participantId, activityId")
    .in("activityId", managedActivityIds)

  if (completionRowsResult.error) {
    throw new Error(`Could not load managed completions for prune: ${completionRowsResult.error.message}`)
  }

  const activityToCompetitionId = new Map<string, string>()
  for (const [competitionId, activity] of managedEntries) {
    activityToCompetitionId.set(activity.id, competitionId)
  }

  const expectedVerifiedSet = new Set<string>()
  for (const pair of verifiedPairs) {
    expectedVerifiedSet.add(`${pair.participantId}:${pair.competitionId}`)
  }

  let revoked = 0
  let skippedNotFound = 0
  let skippedNonSynced = 0

  const completionRows = completionRowsResult.data || []
  const chunks = chunkArray(completionRows, BATCH_SIZE)
  for (const batch of chunks) {
    for (const completionRow of batch) {
      const competitionId = activityToCompetitionId.get(completionRow.activityId)
      if (!competitionId) {
        skippedNotFound += 1
        continue
      }

      const expectedKey = `${completionRow.participantId}:${competitionId}`
      if (expectedVerifiedSet.has(expectedKey)) {
        continue
      }

      const { data: outcome, error: rpcError } = await supabase.rpc(
        "revoke_competition_activity_completion",
        {
          p_participant_id: completionRow.participantId,
          p_competition_id: competitionId,
          p_activity_id: completionRow.activityId,
          p_actor_staff_profile_id: actorStaffProfileId,
          p_audit_id: crypto.randomUUID(),
        },
      )

      if (rpcError) {
        throw new Error(`Could not prune completion for participant ${completionRow.participantId}: ${rpcError.message}`)
      }

      if (outcome === "revoked") {
        revoked += 1
      } else if (outcome === "skipped_non_synced") {
        skippedNonSynced += 1
      } else {
        skippedNotFound += 1
      }
    }
  }

  return { revoked, skippedNotFound, skippedNonSynced }
}

Deno.serve(async (req) => {
  const debugEvents: DebugEvent[] = []
  const addDebug = (step: string, detail?: unknown) => {
    debugEvents.push({
      at: new Date().toISOString(),
      step,
      detail,
    })
  }

  addDebug("request.received", { method: req.method })

  if (req.method !== "POST") {
    addDebug("request.invalid_method", { expected: "POST", actual: req.method })
    return json(405, { error: "Method not allowed", debug: { events: debugEvents } })
  }

  const expectedToken = (Deno.env.get("EDGE_FUNCTION_TOKEN") || "").trim()
  if (expectedToken) {
    addDebug("auth.token_required")
    const suppliedToken = normalizeBearerToken(req.headers.get("authorization"))
    if (!suppliedToken || suppliedToken !== expectedToken) {
      addDebug("auth.failed", { hasSuppliedToken: Boolean(suppliedToken) })
      return json(401, { error: "Unauthorized", debug: { events: debugEvents } })
    }
    addDebug("auth.passed")
  }

  let body: { action?: SyncAction; debug?: boolean } = {}
  try {
    addDebug("request.parse_body.start")
    body = await req.json()
    addDebug("request.parse_body.success", { hasAction: Boolean(body.action), debugRequested: Boolean(body.debug) })
  } catch {
    addDebug("request.parse_body.failed")
    return json(400, { error: "Invalid JSON body", debug: { events: debugEvents } })
  }

  const action = body.action || "sync_all"
  const includeDebugInSuccess = Boolean(body.debug)
  addDebug("request.action_resolved", { action })

  if (!["sync_activities", "sync_completions", "sync_prune", "sync_all"].includes(action)) {
    addDebug("request.action_invalid", { action })
    return json(400, {
      error: "Invalid action. Use sync_activities, sync_completions, sync_prune, or sync_all.",
      debug: { events: debugEvents },
    })
  }

  try {
    addDebug("resolve.actor_staff_profile.start")
    const actorStaffProfileId = await requireActorStaffProfileId()
    addDebug("resolve.actor_staff_profile.success", { actorStaffProfileId })

    addDebug("resolve.manual_activity_type.start")
    const manualActivityTypeId = await requireManualActivityTypeId()
    addDebug("resolve.manual_activity_type.success", { manualActivityTypeId })

    addDebug("sync.activities.start")
    const activitySync = await syncActivities(actorStaffProfileId, manualActivityTypeId)
    addDebug("sync.activities.success", {
      created: activitySync.created,
      updated: activitySync.updated,
      unchanged: activitySync.unchanged,
      pointsFallbackUsed: activitySync.pointsFallbackUsed,
    })

    addDebug("load.verified_pairs.start")
    const verifiedPairs = await loadVerifiedParticipantCompetitionPairs()
    addDebug("load.verified_pairs.success", { count: verifiedPairs.length })

    if (action === "sync_activities") {
      const responsePayload = {
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
      }

      if (includeDebugInSuccess) {
        return json(200, {
          ...responsePayload,
          debug: { events: debugEvents },
        })
      }

      return json(200, responsePayload)
    }

    if (action === "sync_completions") {
      addDebug("sync.completions.start")
      const completionSync = await syncCompletions(actorStaffProfileId, activitySync.activitiesByCompetitionId, verifiedPairs)
      addDebug("sync.completions.success", completionSync)

      const responsePayload = {
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
      }

      if (includeDebugInSuccess) {
        return json(200, {
          ...responsePayload,
          debug: { events: debugEvents },
        })
      }

      return json(200, responsePayload)
    }

    if (action === "sync_prune") {
      addDebug("sync.prune.start")
      const pruneSync = await syncPruneCompletions(actorStaffProfileId, activitySync.activitiesByCompetitionId, verifiedPairs)
      addDebug("sync.prune.success", pruneSync)

      const responsePayload = {
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
        prune: pruneSync,
      }

      if (includeDebugInSuccess) {
        return json(200, {
          ...responsePayload,
          debug: { events: debugEvents },
        })
      }

      return json(200, responsePayload)
    }

    addDebug("sync.completions.start")
    const completionSync = await syncCompletions(actorStaffProfileId, activitySync.activitiesByCompetitionId, verifiedPairs)
    addDebug("sync.completions.success", completionSync)

    addDebug("sync.prune.start")
    const pruneSync = await syncPruneCompletions(actorStaffProfileId, activitySync.activitiesByCompetitionId, verifiedPairs)
    addDebug("sync.prune.success", pruneSync)

    const responsePayload = {
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
      prune: pruneSync,
    }

    if (includeDebugInSuccess) {
      return json(200, {
        ...responsePayload,
        debug: { events: debugEvents },
      })
    }

    return json(200, responsePayload)
  } catch (error) {
    const details = toDebugError(error)
    addDebug("execution.failed", details)
    return json(500, {
      ok: false,
      error: details.message,
      debug: {
        action,
        events: debugEvents,
        error: details,
      },
    })
  }
})
