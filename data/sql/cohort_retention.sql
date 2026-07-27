-- 주간 코호트 리텐션: 가입 주(cohort_week)별로, 그 이후 몇 주차까지 다시 방문했는지
WITH first_seen AS (
    SELECT
        session_id,
        date_trunc('week', MIN(created_at)) AS cohort_week
    FROM raw_events
    GROUP BY session_id
),
activity AS (
    SELECT DISTINCT
        session_id,
        date_trunc('week', created_at) AS active_week
    FROM raw_events
)
SELECT
    f.cohort_week,
    CAST(date_diff('week', f.cohort_week, a.active_week) AS INT) AS weeks_since_signup,
    COUNT(DISTINCT a.session_id) AS active_sessions
FROM activity a
JOIN first_seen f ON a.session_id = f.session_id
GROUP BY f.cohort_week, weeks_since_signup
ORDER BY f.cohort_week, weeks_since_signup;
