# Supabase Edge Functions

## competition-activity-sync

Path: `supabase/functions/competition-activity-sync/index.ts`

This function manages competition participation activities and points completions.

It uses SQL functions for atomic writes:

- `public.grant_competition_activity_completion(...)`
- `public.revoke_competition_activity_completion(...)`

### Actions

- `sync_activities`
- `sync_completions`
- `sync_prune`
- `sync_all` (default)

### Config Resolution

Competition activity points use this order:

1. `CompetitionConfig` override (`key = COMPETITION_ACTIVITY_POINTS`)
2. `MasterConfig` global default (`key = COMPETITION_ACTIVITY_POINTS`)
3. Fallback default from function env `COMPETITION_ACTIVITY_POINTS_FALLBACK` (default `5`)

### Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SYSTEM_STAFF_PROFILE_ID` (recommended; optional if at least one approved staff profile exists)

### Optional Environment Variables

- `EDGE_FUNCTION_TOKEN` (if set, request must include `Authorization: Bearer <token>`)
- `COMPETITION_ACTIVITY_POINTS_FALLBACK` (integer; default `5`)
- `EDGE_SYNC_BATCH_SIZE` (integer; default `10`)

### Request Example

```json
{
  "action": "sync_all"
}
```

### cURL Example

```bash
curl -X POST \
  "https://<project-ref>.supabase.co/functions/v1/competition-activity-sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <EDGE_FUNCTION_TOKEN>" \
  -d '{"action":"sync_all"}'
```

### Response Summary

The function returns counts for created/updated activities and created/skipped completions.
