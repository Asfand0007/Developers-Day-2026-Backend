CREATE OR REPLACE FUNCTION public.revoke_competition_activity_completion(
    p_participant_id TEXT,
    p_competition_id TEXT,
    p_activity_id TEXT,
    p_actor_staff_profile_id TEXT,
    p_audit_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_completion_id TEXT;
    v_ledger_id TEXT;
    v_points_delta INTEGER;
BEGIN
    SELECT id
    INTO v_completion_id
    FROM "ParticipantActivityCompletion"
    WHERE "participantId" = p_participant_id
      AND "activityId" = p_activity_id
    LIMIT 1;

    IF v_completion_id IS NULL THEN
        RETURN 'skipped_not_found';
    END IF;

    SELECT id, "pointsDelta"
    INTO v_ledger_id, v_points_delta
    FROM "PointsLedger"
    WHERE "sourceCompletionId" = v_completion_id
      AND metadata->>'source' = 'COMPETITION_PARTICIPATION_SYNC'
    LIMIT 1;

    IF v_ledger_id IS NULL THEN
        RETURN 'skipped_non_synced';
    END IF;

    DELETE FROM "PointsLedger"
    WHERE id = v_ledger_id;

    DELETE FROM "ParticipantActivityCompletion"
    WHERE id = v_completion_id;

    INSERT INTO "PointsSummary" ("participantId", "totalPoints", "updatedAt")
    VALUES (p_participant_id, -v_points_delta, NOW())
    ON CONFLICT ("participantId")
    DO UPDATE SET
        "totalPoints" = "PointsSummary"."totalPoints" + EXCLUDED."totalPoints",
        "updatedAt" = NOW();

    INSERT INTO "PointsAuditLog"
        (id, "actorStaffProfileId", "actionType", "targetType", "targetId", note, payload, "createdAt")
    VALUES
        (
            p_audit_id,
            p_actor_staff_profile_id,
            'ACTIVITY_COMPLETION_REVOKED'::"PointsAuditActionType",
            'ParticipantActivityCompletion',
            v_completion_id,
            'Auto-revoked: participant no longer verified for competition',
            jsonb_build_object(
                'participantId', p_participant_id,
                'competitionId', p_competition_id,
                'activityId', p_activity_id,
                'pointsRemoved', v_points_delta,
                'source', 'COMPETITION_PARTICIPATION_SYNC_PRUNE'
            ),
            NOW()
        );

    RETURN 'revoked';
END;
$$;
