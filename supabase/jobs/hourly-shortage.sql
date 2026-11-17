-- Hourly Telegram reminder for C2 <= 4, High Flow <= 2, Brid เขียว <= 2.
-- Requires telegram-notify with type=hourly_shortage deployed first.
-- Reuse the working scheduler's authentication without printing credentials.
-- cron.schedule with the same name updates the existing job (no duplicate).
DO $do$
DECLARE cmd text;
BEGIN
  SELECT command INTO STRICT cmd FROM cron.job WHERE jobname = 'mems-shift-summary';
  IF position('''shift_summary''' in cmd) = 0 THEN
    RAISE EXCEPTION 'Unexpected cron template';
  END IF;
  cmd := replace(cmd, '''shift_summary''', '''hourly_shortage''');
  PERFORM cron.schedule('mems-hourly-shortage', '0 * * * *', cmd);
END $do$;
