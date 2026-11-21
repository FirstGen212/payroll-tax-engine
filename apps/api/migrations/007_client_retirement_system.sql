-- Public employers: the retirement system the client reports to (e.g. TX_TRS for a Texas school district)
-- and whether it pays Social Security (a Section 218 agreement). Most Texas districts do not.
alter table client add column if not exists retirement_system text references retirement_system(code);
alter table client add column if not exists social_security_covered boolean not null default true;
