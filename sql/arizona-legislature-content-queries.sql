/*
  Arizona Legislature content queries
  -----------------------------------
  SQL Server queries based only on the tables and columns supplied in the
  attached schema. These queries are read-only.

  Still needed for publication-ready names and labels:
    BillStatus, Session, Committee, Legislator, CalendarBill, Agenda

  Until those lookup tables are available, x_Bill_Number and numeric IDs are
  retained so results are traceable without inventing labels.
*/

/* 1. Closest recorded floor votes: best first social post. */
SELECT TOP (50)
    bsa.SessionId,
    bsa.x_Bill_Number AS BillNumber,
    bsa.BillStatusId,
    bsa.ActionDatetime,
    atp.[Action],
    atp.ActionDescription,
    bsa.Ayes,
    bsa.Nays,
    bsa.Present,
    bsa.NotVoting,
    bsa.Excused,
    bsa.Absent,
    ABS(COALESCE(bsa.Ayes, 0) - COALESCE(bsa.Nays, 0)) AS VoteMargin,
    COALESCE(bsa.Ayes, 0) + COALESCE(bsa.Nays, 0) AS YesNoVotes
FROM dbo.BillStatusAction AS bsa
INNER JOIN dbo.ActionType AS atp
    ON atp.ActionTypeId = bsa.ActionTypeId
WHERE atp.IsFloorAction = 1
  AND bsa.Ayes IS NOT NULL
  AND bsa.Nays IS NOT NULL
  AND COALESCE(bsa.Ayes, 0) + COALESCE(bsa.Nays, 0) > 0
ORDER BY
    VoteMargin ASC,
    YesNoVotes DESC,
    bsa.ActionDatetime DESC;

/* 2. Complete action timeline for one bill. */
DECLARE @SessionId int = 0;
DECLARE @BillNumber varchar(7) = 'HB0000';

SELECT
    bsa.ActionDatetime,
    bsa.AssignedDate,
    bsa.ReportDate,
    bsa.DischargeDate,
    atp.[Action],
    atp.ActionDescription,
    atp.IsFloorAction,
    atp.IsStandingAction,
    bsa.CommitteeId,
    bsa.ReferralNumber,
    bsa.Ayes,
    bsa.Nays,
    bsa.Present,
    bsa.NotVoting,
    bsa.Excused,
    bsa.Absent,
    bsa.MiscNotes
FROM dbo.BillStatusAction AS bsa
LEFT JOIN dbo.ActionType AS atp
    ON atp.ActionTypeId = bsa.ActionTypeId
WHERE bsa.SessionId = @SessionId
  AND bsa.x_Bill_Number = @BillNumber
ORDER BY COALESCE(bsa.ActionDatetime, bsa.AssignedDate), bsa.ReferralNumber;

/* 3. Most common legislative actions by session. */
SELECT
    bsa.SessionId,
    atp.ActionTypeId,
    atp.[Action],
    atp.ActionDescription,
    atp.IsFloorAction,
    atp.IsStandingAction,
    COUNT_BIG(*) AS ActionCount,
    COUNT(DISTINCT bsa.BillStatusId) AS BillsAffected
FROM dbo.BillStatusAction AS bsa
INNER JOIN dbo.ActionType AS atp
    ON atp.ActionTypeId = bsa.ActionTypeId
GROUP BY
    bsa.SessionId,
    atp.ActionTypeId,
    atp.[Action],
    atp.ActionDescription,
    atp.IsFloorAction,
    atp.IsStandingAction
ORDER BY bsa.SessionId DESC, ActionCount DESC;

/* 4. Time from committee assignment to recorded action. */
SELECT
    bsa.SessionId,
    bsa.x_Bill_Number AS BillNumber,
    bsa.CommitteeId,
    bsa.ReferralNumber,
    bsa.AssignedDate,
    bsa.ActionDatetime,
    DATEDIFF(day, bsa.AssignedDate, bsa.ActionDatetime) AS DaysToAction,
    atp.ActionDescription
FROM dbo.BillStatusAction AS bsa
INNER JOIN dbo.ActionType AS atp
    ON atp.ActionTypeId = bsa.ActionTypeId
WHERE bsa.AssignedDate IS NOT NULL
  AND bsa.ActionDatetime IS NOT NULL
  AND bsa.ActionDatetime >= bsa.AssignedDate
ORDER BY DaysToAction DESC, bsa.ActionDatetime DESC;

/* 5. Closest standing-committee votes. */
SELECT TOP (50)
    bsa.SessionId,
    bsa.x_Bill_Number AS BillNumber,
    bsa.CommitteeId,
    bsa.ActionDatetime,
    atp.ActionDescription,
    bsa.Ayes,
    bsa.Nays,
    ABS(COALESCE(bsa.Ayes, 0) - COALESCE(bsa.Nays, 0)) AS VoteMargin
FROM dbo.BillStatusAction AS bsa
INNER JOIN dbo.ActionType AS atp
    ON atp.ActionTypeId = bsa.ActionTypeId
WHERE atp.IsStandingAction = 1
  AND bsa.Ayes IS NOT NULL
  AND bsa.Nays IS NOT NULL
  AND COALESCE(bsa.Ayes, 0) + COALESCE(bsa.Nays, 0) > 0
ORDER BY VoteMargin, bsa.ActionDatetime DESC;

/* 6. Discover nominee vote codes before labeling them. */
SELECT
    vd.Vote,
    COUNT_BIG(*) AS VoteRecords
FROM dbo.NomineeActionLegislatorVoteDetail AS vd
GROUP BY vd.Vote
ORDER BY VoteRecords DESC;

/* 7. Nominee vote totals, retaining raw vote codes. */
SELECT
    na.NomineeActionId,
    na.SessionId,
    na.CommitteeId,
    na.NomineePositionId,
    na.ReferredDate,
    na.ReportDate,
    na.ConfirmationRejected,
    vd.Vote,
    COUNT_BIG(*) AS VoteCount
FROM dbo.NomineeAction AS na
LEFT JOIN dbo.NomineeActionLegislatorVoteDetail AS vd
    ON vd.NomineeActionId = na.NomineeActionId
GROUP BY
    na.NomineeActionId,
    na.SessionId,
    na.CommitteeId,
    na.NomineePositionId,
    na.ReferredDate,
    na.ReportDate,
    na.ConfirmationRejected,
    vd.Vote
ORDER BY na.SessionId DESC, na.NomineeActionId, vd.Vote;

/* 8. Discover committee-attendance codes before interpreting attendance. */
SELECT
    Attendance,
    COUNT_BIG(*) AS Records
FROM dbo.StandingCommitteeAttendance
GROUP BY Attendance
ORDER BY Records DESC;

/* 9. Amendments per calendar item. Bill names require CalendarBill. */
SELECT TOP (100)
    cba.CalendarBillId,
    COUNT_BIG(*) AS AmendmentCount,
    COUNT(DISTINCT cba.LegislatorId) AS LegislatorsOfferingAmendments,
    MIN(cba.DisplayOrder) AS FirstDisplayOrder,
    MAX(cba.DisplayOrder) AS LastDisplayOrder
FROM dbo.CalendarBillAmendment AS cba
GROUP BY cba.CalendarBillId
ORDER BY AmendmentCount DESC, cba.CalendarBillId;

/* 10. Active and archived interim committees. */
SELECT
    ic.CommitteeId,
    ic.EffectiveDate,
    ic.CommitteeExpirationDate,
    ic.CommitteeExpirationDateJournal,
    ic.NumberPeopleOnCommittee,
    ic.IsJLBCCommittee,
    ic.Archived,
    ic.ArchivedDate,
    ic.Purpose
FROM dbo.InterimCommittee AS ic
WHERE ic.Deleted = 0
ORDER BY ic.Archived, ic.CommitteeExpirationDateJournal DESC, ic.CommitteeId;

