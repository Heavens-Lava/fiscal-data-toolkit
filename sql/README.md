# Arizona Legislature SQL

`arizona-legislature-content-queries.sql` contains read-only SQL Server queries
for the partial legislative schema supplied on 2026-07-17.

Best initial data products:

1. Closest floor votes by session.
2. Closest standing-committee votes.
3. Bill action timelines and days between referral and action.
4. Nominee confirmation vote breakdowns.
5. Bills with the most calendar amendments.
6. Interim-committee membership and activity.

The supplied schema does not include the lookup tables needed to publish names
for bills, sessions, committees, legislators, nominees, agendas, or calendar
items. Exporting the schemas for `BillStatus`, `Session`, `Committee`,
`Legislator`, `CalendarBill`, and `Agenda` will allow these query results to be
joined into publication-ready tables and charts.
