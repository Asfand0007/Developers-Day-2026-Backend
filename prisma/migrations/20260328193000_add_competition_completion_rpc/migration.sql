CREATE OR REPLACE FUNCTION public.grant_competition_activity_completion(
    p_participant_id TEXT,
    p_competition_id TEXT,
    p_activity_id TEXT,
    p_points INTEGER,
    p_actor_staff_profile_id TEXT,
    p_completion_id TEXT,
    p_ledger_id TEXT,
    p_audit_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_completion_id TEXT;
BEGIN
    SELECT id
    INTO v_existing_completion_id
    FROM "ParticipantActivityCompletion"
    WHERE "participantId" = p_participant_id
      AND "activityId" = p_activity_id
    LIMIT 1;

    IF v_existing_completion_id IS NOT NULL THEN
        RETURN 'skipped_existing';
    END IF;

    INSERT INTO "ParticipantActivityCompletion"
        (id, "participantId", "activityId", "markedByStaffProfileId", note, "completedAt")
    VALUES
        (
            p_completion_id,
            p_participant_id,
            p_activity_id,
            p_actor_staff_profile_id,
            'Auto-marked from verified competition registration',
            NOW()
        );

    INSERT INTO "PointsLedger"
        (id, "participantId", "entryType", "pointsDelta", "sourceCompletionId", "actorStaffProfileId", metadata, "createdAt")
    VALUES
        (
            p_ledger_id,
            p_participant_id,
            'MANUAL_ACTIVITY'::"PointsLedgerEntryType",
            p_points,
            p_completion_id,
            p_actor_staff_profile_id,
            jsonb_build_object(
                'source', 'COMPETITION_PARTICIPATION_SYNC',
                'competitionId', p_competition_id,
                'activityId', p_activity_id
            ),
            NOW()
        );

    INSERT INTO "PointsSummary" ("participantId", "totalPoints", "updatedAt")
    VALUES (p_participant_id, p_points, NOW())
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
            'ACTIVITY_COMPLETION_MARKED'::"PointsAuditActionType",
            'ParticipantActivityCompletion',
            p_completion_id,
            'Auto-marked from verified competition registration',
            jsonb_build_object(
                'participantId', p_participant_id,
                'competitionId', p_competition_id,
                'activityId', p_activity_id,
                'points', p_points,
                'source', 'COMPETITION_PARTICIPATION_SYNC'
            ),
            NOW()
        );

    RETURN 'created';
EXCEPTION
    WHEN unique_violation THEN
        RETURN 'skipped_existing';
END;
$$;
