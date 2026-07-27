-- staging: 원본 이벤트를 정제한다 (공백 제거, 타입 표준화).
-- 이후 모든 mart 모델은 raw_events를 직접 참조하지 않고 반드시 이 staging을 거친다.
-- (원본이 지저분해도 mart 로직들이 전부 그 지저분함을 각자 처리하지 않도록 하기 위함)

select
    id,
    trim(session_id) as session_id,
    lower(trim(event_type)) as event_type,
    trim(artist_name) as artist_name,
    result_count,
    created_at,
    date_trunc('week', created_at) as event_week
from {{ source('raw', 'raw_events') }}
where session_id is not null
  and event_type is not null
