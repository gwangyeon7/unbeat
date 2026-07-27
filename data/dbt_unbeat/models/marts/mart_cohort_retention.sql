-- 주간 코호트 리텐션: 가입 주(cohort_week) 대비 몇 주차까지 다시 활동했는지

with activity as (
    select distinct
        session_id,
        event_week as active_week
    from {{ ref('stg_events') }}
)

select
    f.cohort_week,
    cast(date_diff('week', f.cohort_week, a.active_week) as int) as weeks_since_signup,
    count(distinct a.session_id) as active_sessions
from activity a
join {{ ref('mart_session_first_seen') }} f on a.session_id = f.session_id
group by f.cohort_week, weeks_since_signup
order by f.cohort_week, weeks_since_signup
