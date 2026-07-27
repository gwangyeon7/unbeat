-- 퍼널 분석: 검색(search) -> 추천 클릭(recommend_click) 전환
-- "탐색"에서 "행동"으로 넘어가는 비율을 세션 단위로 측정한다.

-- 1) 전체 기간 통합 전환율
WITH session_activity AS (
    SELECT
        session_id,
        MAX(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS did_search,
        MAX(CASE WHEN event_type = 'recommend_click' THEN 1 ELSE 0 END) AS did_click
    FROM raw_events
    GROUP BY session_id
)
SELECT
    COUNT(*) AS total_sessions,
    SUM(did_search) AS searched_sessions,
    SUM(did_click) AS clicked_sessions,
    ROUND(100.0 * SUM(did_click) / NULLIF(SUM(did_search), 0), 1) AS search_to_click_rate_pct
FROM session_activity;
