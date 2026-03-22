-- Short sessions: omit confidence score (null) instead of storing a meaningless number.
alter table forensics_reports
  alter column overall_score drop not null;
