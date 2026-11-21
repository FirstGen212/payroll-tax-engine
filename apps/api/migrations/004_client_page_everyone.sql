-- Client pages now list every employee with their status and the reason by default.
-- Proposals whose client page was saved earlier carry the old default ("list": eligible employees only),
-- which nobody chose on purpose, so move them to the new default once. Picking "Eligible employees only"
-- after this sticks. Links that were already published keep the page they were published with.
update proposal set report_settings = jsonb_set(report_settings, '{showEmployees}', '"all"')
where report_settings->>'showEmployees' = 'list';
