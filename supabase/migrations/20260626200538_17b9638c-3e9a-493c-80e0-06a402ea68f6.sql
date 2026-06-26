select cron.unschedule('intouch-poll-10s-1') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-1');
select cron.unschedule('intouch-poll-10s-2') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-2');
select cron.unschedule('intouch-poll-10s-3') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-3');
select cron.unschedule('intouch-poll-10s-4') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-4');
select cron.unschedule('intouch-poll-10s-5') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-5');
select cron.unschedule('intouch-poll-10s-6') where exists (select 1 from cron.job where jobname = 'intouch-poll-10s-6');