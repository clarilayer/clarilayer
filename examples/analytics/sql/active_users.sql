-- Active users = distinct users with at least one session in the last 28 days.
-- A tiny sample so you can try `bootstrap` end-to-end. Swap in your own schema.
SELECT
    date_trunc('day', s.started_at)        AS day,
    count(DISTINCT s.user_id)              AS active_users
FROM sessions s
WHERE s.started_at >= current_date - INTERVAL '28 days'
GROUP BY 1
ORDER BY 1;
