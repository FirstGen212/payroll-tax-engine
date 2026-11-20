-- A fifth step between 'unverified' and 'published': the figure matches a recognized compilation
-- that cites the agency (EY, USDA National Finance Center, Mercer), but the agency document itself was not read.
alter table tax_rule drop constraint if exists tax_rule_status_check;
alter table tax_rule add constraint tax_rule_status_check check (status in ('published','confirmed','draft','projected','unverified','placeholder'));
