-- 주차별 퍼널: 검색(search) -> 추천 클릭(recommend_click) 전환율

with session_week as (
    select
        session_id,
        event_week,
        max(case when event_type = 'search' then 1 else 0 end) as did_search,
        max(case when event_type = 'recommend_click' then 1 else 0 end) as did_click
    from {{ ref('stg_events') }}
    group by session_id, event_week
)

select
    event_week as week,
    count(*) as sessions,
    sum(did_search) as searched,
    sum(did_click) as clicked,
    round(100.0 * sum(did_click) / nullif(sum(did_search), 0), 1) as click_rate_pct
from session_week
group by event_week
order by event_week
