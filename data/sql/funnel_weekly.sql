-- 주차별 퍼널 추이: 검색->클릭 전환율이 주마다 어떻게 변하는지
WITH session_week AS (
    SELECT
        session_id,
        date_trunc('week', created_at) AS week,
        MAX(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS did_search,
        MAX(CASE WHEN event_type = 'recommend_click' THEN 1 ELSE 0 END) AS did_click
    FROM raw_events
    GROUP BY session_id, date_trunc('week', created_at)
)
SELECT
    week,
    COUNT(*) AS sessions,
    SUM(did_search) AS searched,
    SUM(did_click) AS clicked,
    ROUND(100.0 * SUM(did_click) / NULLIF(SUM(did_search), 0), 1) AS click_rate_pct
FROM session_week
GROUP BY week
ORDER BY week;
