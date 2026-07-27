-- 외부 데이터(날씨) x 서비스 데이터(검색 이벤트) 조인
-- "날씨가 검색 활동에 영향을 주는가?"를 보기 위한 일별 결합 테이블

with daily_search as (
    select
        CAST(created_at AS DATE) as date,
        count(*) as search_count
    from raw_events
    where event_type = 'search'
    group by CAST(created_at AS DATE)
)

select
    w.date,
    w.temp_max,
    w.temp_min,
    w.precipitation_mm,
    coalesce(d.search_count, 0) as search_count
from weather_daily w
left join daily_search d on w.date = d.date
order by w.date
