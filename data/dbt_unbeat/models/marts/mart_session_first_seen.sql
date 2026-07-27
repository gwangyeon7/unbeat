-- 세션(익명 사용자)별 첫 방문 주 = 코호트 배정 기준.
-- 다른 mart 모델들이 "이 세션이 어느 코호트에 속하는지" 알아야 할 때 이걸 참조한다.

select
    session_id,
    min(event_week) as cohort_week
from {{ ref('stg_events') }}
group by session_id
